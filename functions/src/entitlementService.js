// functions/src/entitlementService.js

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
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "./subscriptionConfig.js";
import {
  EntitlementValidationError,
  asValidDate,
  buildInitialTrialEntitlement,
  entitlementShouldExpire,
  getExpirationReason,
  getPastDueGraceWindow,
  requireEventId,
  requirePlanId,
  requireSource,
  requireStatus,
  requireUid,
  sanitizeFeatureOverrides,
  sanitizeLimitOverrides,
} from "./entitlementModel.js";

export class EntitlementServiceError extends Error {
  constructor(message, code = "failed-precondition") {
    super(message);
    this.name = "EntitlementServiceError";
    this.code = code;
  }
}

function asTimestamp(value) {
  const date = asValidDate(value);
  return date ? Timestamp.fromDate(date) : null;
}

function entitlementRef(db, uid) {
  return db
    .collection("users")
    .doc(requireUid(uid))
    .collection(BILLING_COLLECTION_ID)
    .doc(ENTITLEMENT_DOCUMENT_ID);
}

function eventRef(db, uid, eventId) {
  return entitlementRef(db, uid)
    .collection(ENTITLEMENT_EVENTS_COLLECTION_ID)
    .doc(requireEventId(eventId));
}

function serializeForEvent(value) {
  if (!value || typeof value !== "object") return value ?? null;

  const keys = [
    "planId",
    "status",
    "source",
    "trialStartedAt",
    "trialEndsAt",
    "currentPeriodEndsAt",
    "pastDueStartedAt",
    "graceEndsAt",
    "testerCodeId",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "stripePriceId",
    "stripeEventId",
    "stripeEventCreatedAt",
    "revision",
  ];

  return Object.fromEntries(
    keys
      .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
      .map((key) => [key, value[key] ?? null])
  );
}

function canonicalizeEntitlementPatch(patch = {}) {
  const output = {};

  if (patch.planId !== undefined) output.planId = requirePlanId(patch.planId);
  if (patch.status !== undefined) output.status = requireStatus(patch.status);
  if (patch.source !== undefined) output.source = requireSource(patch.source);

  for (const key of [
    "trialStartedAt",
    "trialEndsAt",
    "currentPeriodEndsAt",
    "pastDueStartedAt",
    "graceEndsAt",
    "expiredAt",
    "canceledAt",
    "stripeEventCreatedAt",
  ]) {
    if (patch[key] !== undefined) {
      output[key] = patch[key] === null ? null : asTimestamp(patch[key]);
    }
  }

  for (const key of [
    "testerCodeId",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "stripePriceId",
    "stripeEventId",
    "endReason",
  ]) {
    if (patch[key] !== undefined) {
      output[key] = patch[key] === null ? null : String(patch[key]);
    }
  }

  if (patch.accessGrantedThroughGrace !== undefined) {
    output.accessGrantedThroughGrace = patch.accessGrantedThroughGrace === true;
  }

  if (patch.featureOverrides !== undefined) {
    output.featureOverrides = sanitizeFeatureOverrides(patch.featureOverrides);
  }

  if (patch.limitOverrides !== undefined) {
    output.limitOverrides = sanitizeLimitOverrides(patch.limitOverrides);
  }

  return output;
}

export async function provisionInitialTrialEntitlement({
  db = getFirestore(),
  uid,
  accountCreatedAt = null,
  now = new Date(),
  eventId = "initial-trial-v1",
  eventSource = "auth_user_created",
} = {}) {
  const safeUid = requireUid(uid);
  const safeEventId = requireEventId(eventId);
  const entRef = entitlementRef(db, safeUid);
  const auditRef = eventRef(db, safeUid, safeEventId);
  const model = buildInitialTrialEntitlement({ accountCreatedAt, now });

  const transactionResult = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(entRef);

    if (existing.exists) {
      return {
        created: false,
        idempotent: true,
      };
    }

    const entitlement = {
      schemaVersion: SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
      ...model,
      trialStartedAt: Timestamp.fromDate(model.trialStartedAt),
      trialEndsAt: Timestamp.fromDate(model.trialEndsAt),
      revision: 1,
      lastTransitionId: safeEventId,
      lastTransitionAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.create(entRef, entitlement);
    transaction.create(auditRef, {
      schemaVersion: SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
      eventId: safeEventId,
      type: "initial_trial_provisioned",
      source: eventSource,
      idempotencyKey: safeEventId,
      before: null,
      after: serializeForEvent(entitlement),
      occurredAt: FieldValue.serverTimestamp(),
    });

    return { created: true, idempotent: false };
  });

  const stored = await entRef.get();
  return { ...transactionResult, entitlement: stored.data() || null };
}

export async function applyTrustedEntitlementTransition({
  db = getFirestore(),
  uid,
  eventId,
  type,
  source,
  patch,
  createIfMissing = false,
  providerOccurredAt = null,
  ignoreIfProviderEventOlder = false,
} = {}) {
  const safeUid = requireUid(uid);
  const safeEventId = requireEventId(eventId);
  const safeType = typeof type === "string" && type.trim() ? type.trim() : "transition";
  const safeSource = typeof source === "string" && source.trim() ? source.trim() : "trusted_backend";
  const entRef = entitlementRef(db, safeUid);
  const auditRef = eventRef(db, safeUid, safeEventId);
  const safePatch = canonicalizeEntitlementPatch(patch);
  const safeProviderOccurredAt = asValidDate(providerOccurredAt);

  const transactionResult = await db.runTransaction(async (transaction) => {
    const [eventSnapshot, entitlementSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(entRef),
    ]);

    if (eventSnapshot.exists) {
      return {
        applied: false,
        idempotent: true,
      };
    }

    if (!entitlementSnapshot.exists && !createIfMissing) {
      throw new EntitlementServiceError(
        "Cannot transition a missing entitlement.",
        "not-found"
      );
    }

    const before = entitlementSnapshot.exists ? entitlementSnapshot.data() : null;
    const previousProviderOccurredAt = asValidDate(before?.stripeEventCreatedAt);

    if (
      ignoreIfProviderEventOlder &&
      safeProviderOccurredAt &&
      previousProviderOccurredAt &&
      safeProviderOccurredAt.getTime() < previousProviderOccurredAt.getTime()
    ) {
      transaction.create(auditRef, {
        schemaVersion: SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
        eventId: safeEventId,
        type: `${safeType}_ignored_stale`,
        source: safeSource,
        idempotencyKey: safeEventId,
        before: serializeForEvent(before),
        after: serializeForEvent(before),
        providerOccurredAt: Timestamp.fromDate(safeProviderOccurredAt),
        occurredAt: FieldValue.serverTimestamp(),
      });

      return {
        applied: false,
        idempotent: false,
        stale: true,
      };
    }

    const revision = Number(before?.revision || 0) + 1;
    const next = {
      ...(before || {
        schemaVersion: SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
        planId: SUBSCRIPTION_PLAN_IDS.FREE,
        status: SUBSCRIPTION_STATUSES.ACTIVE,
        source: SUBSCRIPTION_SOURCES.DEFAULT,
        featureOverrides: {},
        limitOverrides: {},
        createdAt: FieldValue.serverTimestamp(),
      }),
      ...safePatch,
      schemaVersion: SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
      revision,
      lastTransitionId: safeEventId,
      lastTransitionAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(entRef, next, { merge: true });
    transaction.create(auditRef, {
      schemaVersion: SUBSCRIPTION_BACKEND_SCHEMA_VERSION,
      eventId: safeEventId,
      type: safeType,
      source: safeSource,
      idempotencyKey: safeEventId,
      before: serializeForEvent(before),
      after: serializeForEvent(next),
      ...(safeProviderOccurredAt
        ? { providerOccurredAt: Timestamp.fromDate(safeProviderOccurredAt) }
        : {}),
      occurredAt: FieldValue.serverTimestamp(),
    });

    return { applied: true, idempotent: false };
  });

  const stored = await entRef.get();
  return { ...transactionResult, entitlement: stored.data() || null };
}

export async function activatePaidEntitlement({
  db = getFirestore(),
  uid,
  eventId,
  planId,
  source = SUBSCRIPTION_SOURCES.STRIPE,
  currentPeriodEndsAt,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripePriceId = null,
  stripeEventId = eventId,
  stripeEventCreatedAt = null,
  featureOverrides = {},
  limitOverrides = {},
} = {}) {
  const endDate = asValidDate(currentPeriodEndsAt);
  if (!endDate) {
    throw new EntitlementValidationError(
      "A trusted paid period end time is required."
    );
  }

  return applyTrustedEntitlementTransition({
    db,
    uid,
    eventId,
    type: "paid_entitlement_activated",
    source,
    createIfMissing: true,
    providerOccurredAt: stripeEventCreatedAt,
    ignoreIfProviderEventOlder: source === SUBSCRIPTION_SOURCES.STRIPE,
    patch: {
      planId: requirePlanId(planId, { publicOnly: true }),
      status: SUBSCRIPTION_STATUSES.ACTIVE,
      source,
      trialStartedAt: null,
      trialEndsAt: null,
      currentPeriodEndsAt: endDate,
      pastDueStartedAt: null,
      graceEndsAt: null,
      accessGrantedThroughGrace: false,
      testerCodeId: null,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
      stripeEventId,
      stripeEventCreatedAt,
      featureOverrides,
      limitOverrides,
      expiredAt: null,
      canceledAt: null,
      endReason: null,
    },
  });
}

export async function markEntitlementPastDue({
  db = getFirestore(),
  uid,
  eventId,
  pastDueStartedAt = new Date(),
  source = SUBSCRIPTION_SOURCES.STRIPE,
  planId = null,
  currentPeriodEndsAt = null,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripePriceId = null,
  stripeEventId = eventId,
  stripeEventCreatedAt = null,
} = {}) {
  const safeUid = requireUid(uid);
  const currentSnapshot = await entitlementRef(db, safeUid).get();
  const current = currentSnapshot.exists ? currentSnapshot.data() : null;
  const preservedStart =
    current?.status === SUBSCRIPTION_STATUSES.PAST_DUE
      ? asValidDate(current?.pastDueStartedAt)
      : null;
  const grace = getPastDueGraceWindow(
    preservedStart || pastDueStartedAt
  );
  const patch = {
    status: SUBSCRIPTION_STATUSES.PAST_DUE,
    source,
    pastDueStartedAt: grace.pastDueStartedAt,
    graceEndsAt: grace.graceEndsAt,
    accessGrantedThroughGrace: true,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId,
    stripeEventId,
    stripeEventCreatedAt,
    endReason: null,
  };

  if (planId !== null && planId !== undefined) {
    patch.planId = requirePlanId(planId, { publicOnly: true });
  }
  if (currentPeriodEndsAt !== null && currentPeriodEndsAt !== undefined) {
    const endDate = asValidDate(currentPeriodEndsAt);
    if (!endDate) {
      throw new EntitlementValidationError(
        "A trusted paid period end time is required."
      );
    }
    patch.currentPeriodEndsAt = endDate;
  }

  return applyTrustedEntitlementTransition({
    db,
    uid: safeUid,
    eventId,
    type: "entitlement_past_due",
    source,
    providerOccurredAt: stripeEventCreatedAt,
    ignoreIfProviderEventOlder: source === SUBSCRIPTION_SOURCES.STRIPE,
    patch,
  });
}

export async function cancelEntitlement({
  db = getFirestore(),
  uid,
  eventId,
  canceledAt = new Date(),
  source = SUBSCRIPTION_SOURCES.STRIPE,
  reason = "subscription_canceled",
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripePriceId = null,
  stripeEventId = eventId,
  stripeEventCreatedAt = null,
} = {}) {
  return applyTrustedEntitlementTransition({
    db,
    uid,
    eventId,
    type: "entitlement_canceled",
    source,
    providerOccurredAt: stripeEventCreatedAt,
    ignoreIfProviderEventOlder: source === SUBSCRIPTION_SOURCES.STRIPE,
    patch: {
      status: SUBSCRIPTION_STATUSES.CANCELED,
      source,
      canceledAt,
      accessGrantedThroughGrace: false,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
      stripeEventId,
      stripeEventCreatedAt,
      endReason: reason,
    },
  });
}

export async function expireEntitlement({
  db = getFirestore(),
  uid,
  eventId,
  expiredAt = new Date(),
  source = "scheduled_reconciler",
  reason = "entitlement_expired",
} = {}) {
  return applyTrustedEntitlementTransition({
    db,
    uid,
    eventId,
    type: "entitlement_expired",
    source,
    patch: {
      status: SUBSCRIPTION_STATUSES.EXPIRED,
      expiredAt,
      accessGrantedThroughGrace: false,
      endReason: reason,
    },
  });
}

function uidFromEntitlementDocument(snapshot) {
  const segments = snapshot.ref.path.split("/");
  return segments.length >= 4 && segments[0] === "users" ? segments[1] : null;
}

function expirationAnchor(entitlement) {
  return (
    asValidDate(entitlement?.trialEndsAt) ||
    asValidDate(entitlement?.graceEndsAt) ||
    asValidDate(entitlement?.currentPeriodEndsAt) ||
    new Date(0)
  );
}

export async function reconcileExpiredEntitlements({
  db = getFirestore(),
  now = new Date(),
} = {}) {
  const currentDate = asValidDate(now) || new Date();
  const snapshot = await db
    .collectionGroup(BILLING_COLLECTION_ID)
    .where("status", "in", [
      SUBSCRIPTION_STATUSES.TRIALING,
      SUBSCRIPTION_STATUSES.PAST_DUE,
      SUBSCRIPTION_STATUSES.ACTIVE,
    ])
    .get();

  const candidates = snapshot.docs.filter(
    (doc) =>
      doc.id === ENTITLEMENT_DOCUMENT_ID &&
      entitlementShouldExpire(doc.data(), currentDate)
  );

  const results = [];
  for (const doc of candidates) {
    const uid = uidFromEntitlementDocument(doc);
    if (!uid) continue;

    const data = doc.data();
    const anchor = expirationAnchor(data).getTime();
    const reason = getExpirationReason(data);
    const eventId = `reconcile-${reason}-${anchor}`.replace(/[^A-Za-z0-9._-]/g, "-");

    results.push(
      await expireEntitlement({
        db,
        uid,
        eventId,
        expiredAt: currentDate,
        source: "scheduled_reconciler",
        reason,
      })
    );
  }

  return {
    scanned: snapshot.size,
    expired: results.filter((result) => result.applied).length,
    idempotent: results.filter((result) => result.idempotent).length,
  };
}
