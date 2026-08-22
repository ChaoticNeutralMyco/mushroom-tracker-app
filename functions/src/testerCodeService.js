// functions/src/testerCodeService.js

import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import {
  BILLING_COLLECTION_ID,
  ENTITLEMENT_DOCUMENT_ID,
  ENTITLEMENT_EVENTS_COLLECTION_ID,
  SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
  SUBSCRIPTION_DAY_MS,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
  TESTER_CODE_REDEMPTIONS_COLLECTION_ID,
  TESTER_CODES_COLLECTION_ID,
} from "./subscriptionConfig.js";
import {
  EntitlementValidationError,
  asValidDate,
  hashTesterCode,
  requirePlanId,
  requireUid,
  sanitizeFeatureOverrides,
  sanitizeLimitOverrides,
} from "./entitlementModel.js";
import { EntitlementServiceError } from "./entitlementService.js";

function entitlementRef(db, uid) {
  return db
    .collection("users")
    .doc(requireUid(uid))
    .collection(BILLING_COLLECTION_ID)
    .doc(ENTITLEMENT_DOCUMENT_ID);
}

function testerCodeRef(db, codeHash) {
  return db.collection(TESTER_CODES_COLLECTION_ID).doc(codeHash);
}

function testerCodeRedemptionRef(db, codeHash, uid) {
  return testerCodeRef(db, codeHash)
    .collection(TESTER_CODE_REDEMPTIONS_COLLECTION_ID)
    .doc(requireUid(uid));
}

function entitlementEventRef(db, uid, eventId) {
  return entitlementRef(db, uid)
    .collection(ENTITLEMENT_EVENTS_COLLECTION_ID)
    .doc(eventId);
}

function validateTesterCodeDocument(data, now) {
  if (!data || data.active !== true) {
    throw new EntitlementServiceError("Tester code is invalid or inactive.", "not-found");
  }

  const planId = requirePlanId(data.planId, { publicOnly: true });
  if (planId === SUBSCRIPTION_PLAN_IDS.FREE) {
    throw new EntitlementValidationError("Tester codes must grant a paid plan.");
  }

  const startsAt = asValidDate(data.startsAt);
  const expiresAt = asValidDate(data.expiresAt);
  if (startsAt && now.getTime() < startsAt.getTime()) {
    throw new EntitlementServiceError("Tester code is not active yet.", "failed-precondition");
  }
  if (expiresAt && now.getTime() >= expiresAt.getTime()) {
    throw new EntitlementServiceError("Tester code has expired.", "failed-precondition");
  }

  const durationDays = Number(data.durationDays);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    throw new EntitlementValidationError(
      "Tester code durationDays must be an integer from 1 through 3650."
    );
  }

  const maxRedemptions = data.maxRedemptions == null
    ? null
    : Number(data.maxRedemptions);
  const redemptionCount = Number(data.redemptionCount || 0);
  if (
    maxRedemptions !== null &&
    (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)
  ) {
    throw new EntitlementValidationError(
      "Tester code maxRedemptions must be null or a positive integer."
    );
  }
  if (maxRedemptions !== null && redemptionCount >= maxRedemptions) {
    throw new EntitlementServiceError(
      "Tester code has reached its redemption limit.",
      "resource-exhausted"
    );
  }

  return {
    planId,
    durationDays,
    maxRedemptions,
    redemptionCount,
    featureOverrides: sanitizeFeatureOverrides(data.featureOverrides),
    limitOverrides: sanitizeLimitOverrides(data.limitOverrides),
  };
}

export async function redeemTesterCode({
  db = getFirestore(),
  uid,
  code,
  now = new Date(),
} = {}) {
  const safeUid = requireUid(uid);
  const currentDate = asValidDate(now) || new Date();
  const codeHash = hashTesterCode(code);
  const codeRef = testerCodeRef(db, codeHash);
  const redemptionRef = testerCodeRedemptionRef(db, codeHash, safeUid);
  const entRef = entitlementRef(db, safeUid);
  const eventId = `tester-code-${codeHash}`;
  const eventRef = entitlementEventRef(db, safeUid, eventId);

  const transactionResult = await db.runTransaction(async (transaction) => {
    const [codeSnapshot, redemptionSnapshot, entitlementSnapshot, eventSnapshot] =
      await Promise.all([
        transaction.get(codeRef),
        transaction.get(redemptionRef),
        transaction.get(entRef),
        transaction.get(eventRef),
      ]);

    if (redemptionSnapshot.exists || eventSnapshot.exists) {
      return {
        redeemed: false,
        idempotent: true,
        codeHash,
      };
    }

    const currentEntitlement = entitlementSnapshot.exists
      ? entitlementSnapshot.data()
      : null;

    if (
      currentEntitlement?.planId === SUBSCRIPTION_PLAN_IDS.ADMIN ||
      (currentEntitlement?.source === SUBSCRIPTION_SOURCES.STRIPE &&
        [SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.PAST_DUE].includes(
          currentEntitlement?.status
        ))
    ) {
      throw new EntitlementServiceError(
        "Tester codes cannot replace an active Admin or Stripe entitlement.",
        "failed-precondition"
      );
    }

    const codeConfig = validateTesterCodeDocument(
      codeSnapshot.exists ? codeSnapshot.data() : null,
      currentDate
    );
    const entitlementEndsAt = new Date(
      currentDate.getTime() + codeConfig.durationDays * SUBSCRIPTION_DAY_MS
    );
    const revision = Number(currentEntitlement?.revision || 0) + 1;

    const next = {
      ...(currentEntitlement || {
        createdAt: FieldValue.serverTimestamp(),
      }),
      schemaVersion: SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
      planId: codeConfig.planId,
      status: SUBSCRIPTION_STATUSES.ACTIVE,
      source: SUBSCRIPTION_SOURCES.TESTER_CODE,
      trialStartedAt: null,
      trialEndsAt: null,
      currentPeriodEndsAt: Timestamp.fromDate(entitlementEndsAt),
      pastDueStartedAt: null,
      graceEndsAt: null,
      accessGrantedThroughGrace: false,
      testerCodeId: codeHash,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      featureOverrides: codeConfig.featureOverrides,
      limitOverrides: codeConfig.limitOverrides,
      expiredAt: null,
      canceledAt: null,
      endReason: null,
      revision,
      lastTransitionId: eventId,
      lastTransitionAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(entRef, next, { merge: true });
    transaction.update(codeRef, {
      redemptionCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(redemptionRef, {
      schemaVersion: SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
      uid: safeUid,
      codeHash,
      planId: codeConfig.planId,
      entitlementEndsAt: Timestamp.fromDate(entitlementEndsAt),
      redeemedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(eventRef, {
      schemaVersion: SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
      eventId,
      type: "tester_code_redeemed",
      source: "tester_code_callable",
      idempotencyKey: eventId,
      codeHash,
      planId: codeConfig.planId,
      entitlementEndsAt: Timestamp.fromDate(entitlementEndsAt),
      occurredAt: FieldValue.serverTimestamp(),
    });

    return {
      redeemed: true,
      idempotent: false,
      codeHash,
    };
  });

  const stored = await entRef.get();
  return { ...transactionResult, entitlement: stored.data() || null };
}
