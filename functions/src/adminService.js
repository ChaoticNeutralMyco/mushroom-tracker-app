// functions/src/adminService.js

import { randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import {
  ADMIN_GRANT_DOCUMENT_ID,
  ADMIN_MAX_AUTHORIZED_UIDS,
  ADMIN_PROMOTIONAL_GRANT_MAX_DAYS,
  ADMIN_PROMOTIONAL_GRANT_SCHEMA_VERSION,
  BILLING_COLLECTION_ID,
  ENTITLEMENT_DOCUMENT_ID,
  INTERNAL_ADMIN_AUDIT_COLLECTION_ID,
  PROMOTIONAL_SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_ACCESS_RANKS,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "./subscriptionConfig.js";
import {
  asValidDate,
  requireEventId,
  requirePlanId,
  requireUid,
} from "./entitlementModel.js";
import {
  isActiveGrowDocument,
  resolveEffectiveGrowAccessPlan,
} from "./growService.js";

const PROMOTIONAL_PLAN_SET = new Set(PROMOTIONAL_SUBSCRIPTION_PLAN_IDS);

export class AdminServiceError extends Error {
  constructor(message, code = "failed-precondition", details = null) {
    super(message);
    this.name = "AdminServiceError";
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAdminConfigObject(value) {
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      throw new AdminServiceError(
        "Admin access is not configured.",
        "failed-precondition"
      );
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new AdminServiceError(
        "Admin access configuration is invalid.",
        "failed-precondition"
      );
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  throw new AdminServiceError(
    "Admin access is not configured.",
    "failed-precondition"
  );
}

export function parseAdminConfig(value) {
  const parsed = normalizeAdminConfigObject(value);
  const rawUids = Array.isArray(parsed.adminUids) ? parsed.adminUids : [];
  const adminUids = Array.from(
    new Set(
      rawUids
        .map((uid) => normalizeText(uid))
        .filter(Boolean)
    )
  );

  if (adminUids.length < 1) {
    throw new AdminServiceError(
      "At least one administrator UID must be configured.",
      "failed-precondition"
    );
  }

  if (adminUids.length > ADMIN_MAX_AUTHORIZED_UIDS) {
    throw new AdminServiceError(
      `Admin access is limited to ${ADMIN_MAX_AUTHORIZED_UIDS} explicitly configured accounts.`,
      "failed-precondition"
    );
  }

  for (const uid of adminUids) {
    requireUid(uid);
  }

  return Object.freeze({
    adminUids: Object.freeze(adminUids),
  });
}

function normalizeAdminConfig(value) {
  return value?.adminUids ? value : parseAdminConfig(value);
}

export function isAuthorizedAdminUid(uid, adminConfig) {
  const safeUid = normalizeText(uid);
  if (!safeUid) return false;

  const config = normalizeAdminConfig(adminConfig);
  return config.adminUids.includes(safeUid);
}

// Internal full-access accounts currently use the same server-secret UID
// allowlist as the private Admin dashboard. Keep this as a separate helper so
// dashboard authorization and subscription access can diverge later without
// changing call sites throughout the app.
export function hasInternalAdminFullAccess(uid, adminConfig) {
  return isAuthorizedAdminUid(uid, adminConfig);
}

export function assertAuthorizedAdminUid(uid, adminConfig) {
  const safeUid = requireUid(uid);
  const config = normalizeAdminConfig(adminConfig);

  if (!config.adminUids.includes(safeUid)) {
    throw new AdminServiceError(
      "This account is not authorized for administrative access.",
      "permission-denied"
    );
  }

  return safeUid;
}

function planRank(planId) {
  return Number(SUBSCRIPTION_ACCESS_RANKS[planId] ?? -1);
}

function requirePromotionalPlanId(planId) {
  const safePlanId = requirePlanId(planId, { publicOnly: true });

  if (!PROMOTIONAL_PLAN_SET.has(safePlanId)) {
    throw new AdminServiceError(
      "Promotional access may only grant Hobby, Cultivator, or Lab.",
      "invalid-argument"
    );
  }

  return safePlanId;
}

function requireDurationDays(value) {
  const numeric = Number(value);

  if (
    !Number.isInteger(numeric) ||
    numeric < 1 ||
    numeric > ADMIN_PROMOTIONAL_GRANT_MAX_DAYS
  ) {
    throw new AdminServiceError(
      `Promotional access must be between 1 and ${ADMIN_PROMOTIONAL_GRANT_MAX_DAYS} days.`,
      "invalid-argument"
    );
  }

  return numeric;
}

function requireReason(value) {
  const reason = normalizeText(value);

  if (reason.length < 3 || reason.length > 500) {
    throw new AdminServiceError(
      "A promotion or support reason between 3 and 500 characters is required.",
      "invalid-argument"
    );
  }

  return reason;
}

function normalizeCampaign(value) {
  const campaign = normalizeText(value);

  if (!campaign) return null;

  if (campaign.length > 120) {
    throw new AdminServiceError(
      "Campaign labels may contain at most 120 characters.",
      "invalid-argument"
    );
  }

  return campaign;
}

function normalizeAdminEventId(value, prefix) {
  const candidate = normalizeText(value) || `${prefix}-${randomUUID()}`;
  return requireEventId(candidate);
}

function entitlementRef(db, uid) {
  return db
    .collection("users")
    .doc(requireUid(uid))
    .collection(BILLING_COLLECTION_ID)
    .doc(ENTITLEMENT_DOCUMENT_ID);
}

function adminGrantRef(db, uid) {
  return db
    .collection("users")
    .doc(requireUid(uid))
    .collection(BILLING_COLLECTION_ID)
    .doc(ADMIN_GRANT_DOCUMENT_ID);
}

function adminAuditRef(db, eventId) {
  return db
    .collection(INTERNAL_ADMIN_AUDIT_COLLECTION_ID)
    .doc(requireEventId(eventId));
}

function serializeDate(value) {
  const date = asValidDate(value);
  return date ? date.toISOString() : null;
}

function serializeGrant(grant) {
  if (!grant || typeof grant !== "object") return null;

  return {
    schemaVersion: Number(
      grant.schemaVersion || ADMIN_PROMOTIONAL_GRANT_SCHEMA_VERSION
    ),
    planId: normalizeText(grant.planId).toLowerCase() || null,
    status: normalizeText(grant.status).toLowerCase() || null,
    startsAt: serializeDate(grant.startsAt),
    endsAt: serializeDate(grant.endsAt),
    reason: normalizeText(grant.reason) || null,
    campaign: normalizeText(grant.campaign) || null,
    revision: Number(grant.revision || 0),
    lastActionId: normalizeText(grant.lastActionId) || null,
    revokedAt: serializeDate(grant.revokedAt),
  };
}

export function isPromotionalGrantActive(grant, now = new Date()) {
  if (!grant || normalizeText(grant.status).toLowerCase() !== "active") {
    return false;
  }

  const currentDate = asValidDate(now) || new Date();
  const startsAt = asValidDate(grant.startsAt);
  const endsAt = asValidDate(grant.endsAt);

  if (!startsAt || !endsAt) return false;

  return (
    startsAt.getTime() <= currentDate.getTime() &&
    endsAt.getTime() > currentDate.getTime() &&
    PROMOTIONAL_PLAN_SET.has(normalizeText(grant.planId).toLowerCase())
  );
}

function isPromotionalGrantOpen(grant, now = new Date()) {
  if (!grant || normalizeText(grant.status).toLowerCase() !== "active") {
    return false;
  }

  const currentDate = asValidDate(now) || new Date();
  const startsAt = asValidDate(grant.startsAt);
  const endsAt = asValidDate(grant.endsAt);
  const planId = normalizeText(grant.planId).toLowerCase();

  return Boolean(
    startsAt &&
      endsAt &&
      endsAt.getTime() > currentDate.getTime() &&
      PROMOTIONAL_PLAN_SET.has(planId)
  );
}

export function resolveEffectiveSubscriptionPlanId({
  entitlement = null,
  promotionalGrant = null,
  internalFullAccess = false,
  now = new Date(),
} = {}) {
  if (internalFullAccess === true) {
    return SUBSCRIPTION_PLAN_IDS.ADMIN;
  }

  const baseAccess = resolveEffectiveGrowAccessPlan(entitlement, now);
  const promoActive = isPromotionalGrantActive(promotionalGrant, now);

  if (!promoActive) return baseAccess.planId;

  const promoPlanId = normalizeText(promotionalGrant.planId).toLowerCase();

  return planRank(promoPlanId) > planRank(baseAccess.planId)
    ? promoPlanId
    : baseAccess.planId;
}

function protectedStripePlanId(entitlement, now) {
  if (
    normalizeText(entitlement?.source).toLowerCase() !==
    SUBSCRIPTION_SOURCES.STRIPE
  ) {
    return null;
  }

  const access = resolveEffectiveGrowAccessPlan(entitlement, now);

  return access.planId === SUBSCRIPTION_PLAN_IDS.FREE
    ? null
    : access.planId;
}

function assertGrantDoesNotReduceAccess({
  entitlement,
  existingGrant,
  requestedPlanId,
  now,
}) {
  const protectedPaidPlan = protectedStripePlanId(entitlement, now);

  if (
    protectedPaidPlan &&
    planRank(requestedPlanId) < planRank(protectedPaidPlan)
  ) {
    throw new AdminServiceError(
      "Promotional access cannot reduce an active Stripe-paid plan.",
      "failed-precondition"
    );
  }

  if (
    isPromotionalGrantOpen(existingGrant, now) &&
    planRank(requestedPlanId) < planRank(existingGrant.planId)
  ) {
    throw new AdminServiceError(
      "An active promotional grant may only be extended or upgraded.",
      "failed-precondition"
    );
  }

  return protectedPaidPlan;
}

function getDeferredPromotionAnchor({
  entitlement,
  requestedPlanId,
  now,
}) {
  if (!entitlement || typeof entitlement !== "object") return null;

  const baseAccess = resolveEffectiveGrowAccessPlan(entitlement, now);

  if (planRank(requestedPlanId) > planRank(baseAccess.planId)) {
    return null;
  }

  const status = normalizeText(entitlement.status).toLowerCase();
  if (
    ![
      SUBSCRIPTION_STATUSES.ACTIVE,
      SUBSCRIPTION_STATUSES.TRIALING,
      SUBSCRIPTION_STATUSES.PAST_DUE,
    ].includes(status)
  ) {
    return null;
  }

  const candidates = [
    asValidDate(entitlement.trialEndsAt),
    asValidDate(entitlement.graceEndsAt),
    asValidDate(entitlement.currentPeriodEndsAt),
  ].filter(
    (date) => date && date.getTime() > now.getTime()
  );

  if (candidates.length === 0) return null;

  return candidates.reduce((latest, candidate) =>
    candidate.getTime() > latest.getTime() ? candidate : latest
  );
}

function buildAuditSnapshot(grant) {
  const serialized = serializeGrant(grant);
  return serialized || null;
}

export async function grantPromotionalAccess({
  db = getFirestore(),
  actorUid,
  targetUid,
  planId,
  durationDays,
  reason,
  campaign = null,
  eventId = null,
  adminConfig,
  now = new Date(),
} = {}) {
  const config = normalizeAdminConfig(adminConfig);
  const safeActorUid = assertAuthorizedAdminUid(actorUid, config);
  const safeTargetUid = requireUid(targetUid);

  if (hasInternalAdminFullAccess(safeTargetUid, config)) {
    throw new AdminServiceError(
      "Internal admin accounts already have permanent full access and do not need promotional access.",
      "failed-precondition"
    );
  }

  const safePlanId = requirePromotionalPlanId(planId);
  const safeDurationDays = requireDurationDays(durationDays);
  const safeReason = requireReason(reason);
  const safeCampaign = normalizeCampaign(campaign);
  const safeEventId = normalizeAdminEventId(eventId, "admin-promo-grant");
  const currentDate = asValidDate(now) || new Date();

  const entRef = entitlementRef(db, safeTargetUid);
  const grantRef = adminGrantRef(db, safeTargetUid);
  const auditRef = adminAuditRef(db, safeEventId);

  const transactionResult = await db.runTransaction(async (transaction) => {
    const [auditSnapshot, entitlementSnapshot, grantSnapshot] =
      await Promise.all([
        transaction.get(auditRef),
        transaction.get(entRef),
        transaction.get(grantRef),
      ]);

    if (auditSnapshot.exists) {
      const existingAudit = auditSnapshot.data() || {};

      if (
        existingAudit.actorUid !== safeActorUid ||
        existingAudit.targetUid !== safeTargetUid ||
        existingAudit.action !== "promotional_access_granted"
      ) {
        throw new AdminServiceError(
          "That admin request id was already used for a different action.",
          "already-exists"
        );
      }

      return {
        applied: false,
        idempotent: true,
      };
    }

    const entitlement = entitlementSnapshot.exists
      ? entitlementSnapshot.data()
      : null;
    const existingGrant = grantSnapshot.exists
      ? grantSnapshot.data()
      : null;

    assertGrantDoesNotReduceAccess({
      entitlement,
      existingGrant,
      requestedPlanId: safePlanId,
      now: currentDate,
    });

    const existingOpen = isPromotionalGrantOpen(
      existingGrant,
      currentDate
    );
    const existingEnd = existingOpen
      ? asValidDate(existingGrant?.endsAt)
      : null;
    const deferredAnchor = getDeferredPromotionAnchor({
      entitlement,
      requestedPlanId: safePlanId,
      now: currentDate,
    });
    const newGrantAnchor =
      deferredAnchor && deferredAnchor.getTime() > currentDate.getTime()
        ? deferredAnchor
        : currentDate;
    const extensionAnchor =
      existingEnd && existingEnd.getTime() > newGrantAnchor.getTime()
        ? existingEnd
        : newGrantAnchor;
    const endsAt = new Date(
      extensionAnchor.getTime() +
        safeDurationDays * 24 * 60 * 60 * 1000
    );
    const startsAt =
      existingOpen && asValidDate(existingGrant?.startsAt)
        ? asValidDate(existingGrant.startsAt)
        : newGrantAnchor;
    const revision = Number(existingGrant?.revision || 0) + 1;

    const nextGrant = {
      schemaVersion: ADMIN_PROMOTIONAL_GRANT_SCHEMA_VERSION,
      planId: safePlanId,
      status: "active",
      startsAt: Timestamp.fromDate(startsAt),
      endsAt: Timestamp.fromDate(endsAt),
      reason: safeReason,
      campaign: safeCampaign,
      revision,
      lastActionId: safeEventId,
      revokedAt: null,
      createdAt:
        existingGrant?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(grantRef, nextGrant);
    transaction.create(auditRef, {
      schemaVersion: ADMIN_PROMOTIONAL_GRANT_SCHEMA_VERSION,
      eventId: safeEventId,
      action: "promotional_access_granted",
      actorUid: safeActorUid,
      targetUid: safeTargetUid,
      reason: safeReason,
      campaign: safeCampaign,
      durationDays: safeDurationDays,
      before: buildAuditSnapshot(existingGrant),
      after: buildAuditSnapshot(nextGrant),
      occurredAt: FieldValue.serverTimestamp(),
    });

    return {
      applied: true,
      idempotent: false,
    };
  });

  const stored = await grantRef.get();

  return {
    ...transactionResult,
    eventId: safeEventId,
    grant: serializeGrant(stored.exists ? stored.data() : null),
  };
}

export async function revokePromotionalAccess({
  db = getFirestore(),
  actorUid,
  targetUid,
  reason,
  eventId = null,
  adminConfig,
  now = new Date(),
} = {}) {
  const safeActorUid = assertAuthorizedAdminUid(actorUid, adminConfig);
  const safeTargetUid = requireUid(targetUid);
  const safeReason = requireReason(reason);
  const safeEventId = normalizeAdminEventId(eventId, "admin-promo-revoke");
  const currentDate = asValidDate(now) || new Date();

  const grantRef = adminGrantRef(db, safeTargetUid);
  const auditRef = adminAuditRef(db, safeEventId);

  const transactionResult = await db.runTransaction(async (transaction) => {
    const [auditSnapshot, grantSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(grantRef),
    ]);

    if (auditSnapshot.exists) {
      const existingAudit = auditSnapshot.data() || {};

      if (
        existingAudit.actorUid !== safeActorUid ||
        existingAudit.targetUid !== safeTargetUid ||
        existingAudit.action !== "promotional_access_revoked"
      ) {
        throw new AdminServiceError(
          "That admin request id was already used for a different action.",
          "already-exists"
        );
      }

      return {
        applied: false,
        idempotent: true,
      };
    }

    if (!grantSnapshot.exists) {
      throw new AdminServiceError(
        "That account does not have a promotional grant.",
        "not-found"
      );
    }

    const existingGrant = grantSnapshot.data() || {};

    if (normalizeText(existingGrant.status).toLowerCase() === "revoked") {
      return {
        applied: false,
        idempotent: true,
      };
    }

    const nextGrant = {
      ...existingGrant,
      status: "revoked",
      revokedAt: Timestamp.fromDate(currentDate),
      reason: safeReason,
      revision: Number(existingGrant.revision || 0) + 1,
      lastActionId: safeEventId,
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(grantRef, nextGrant);
    transaction.create(auditRef, {
      schemaVersion: ADMIN_PROMOTIONAL_GRANT_SCHEMA_VERSION,
      eventId: safeEventId,
      action: "promotional_access_revoked",
      actorUid: safeActorUid,
      targetUid: safeTargetUid,
      reason: safeReason,
      before: buildAuditSnapshot(existingGrant),
      after: buildAuditSnapshot(nextGrant),
      occurredAt: FieldValue.serverTimestamp(),
    });

    return {
      applied: true,
      idempotent: false,
    };
  });

  const stored = await grantRef.get();

  return {
    ...transactionResult,
    eventId: safeEventId,
    grant: serializeGrant(stored.exists ? stored.data() : null),
  };
}

const ADMIN_ACCOUNT_PAGE_SIZE_DEFAULT = 25;
const ADMIN_ACCOUNT_PAGE_SIZE_MAX = 100;

function normalizeAdminPageSize(value) {
  if (value === null || value === undefined || value === "") {
    return ADMIN_ACCOUNT_PAGE_SIZE_DEFAULT;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new AdminServiceError(
      "Admin account page size must be a positive integer.",
      "invalid-argument"
    );
  }

  return Math.min(numeric, ADMIN_ACCOUNT_PAGE_SIZE_MAX);
}

function normalizeAdminPageToken(value) {
  const token = normalizeText(value);
  if (!token) return undefined;

  if (token.length > 2048) {
    throw new AdminServiceError(
      "Admin account page token is invalid.",
      "invalid-argument"
    );
  }

  return token;
}

function serializeEntitlementForAdmin(entitlement, now) {
  if (!entitlement || typeof entitlement !== "object") {
    return {
      exists: false,
      planId: SUBSCRIPTION_PLAN_IDS.FREE,
      accessPlanId: SUBSCRIPTION_PLAN_IDS.FREE,
      status: "missing",
      source: "missing",
      currentPeriodEndsAt: null,
      stripeManaged: false,
    };
  }

  const access = resolveEffectiveGrowAccessPlan(entitlement, now);
  const source = normalizeText(entitlement.source).toLowerCase();
  const status = normalizeText(entitlement.status).toLowerCase();
  const storedPlanId =
    normalizeText(entitlement.planId).toLowerCase() ||
    SUBSCRIPTION_PLAN_IDS.FREE;

  return {
    exists: true,
    planId: storedPlanId,
    accessPlanId: access.planId,
    status: status || "unknown",
    source: source || "unknown",
    currentPeriodEndsAt: serializeDate(entitlement.currentPeriodEndsAt),
    stripeManaged: Boolean(
      source === SUBSCRIPTION_SOURCES.STRIPE &&
        entitlement.stripeCustomerId &&
        entitlement.stripeSubscriptionId
    ),
  };
}

async function buildAdminAccountRecord({
  db,
  userRecord,
  adminConfig,
  now,
}) {
  const uid = requireUid(userRecord?.uid);
  const [entitlementSnapshot, grantSnapshot, growsSnapshot] = await Promise.all([
    entitlementRef(db, uid).get(),
    adminGrantRef(db, uid).get(),
    db.collection("users").doc(uid).collection("grows").get(),
  ]);

  const entitlement = entitlementSnapshot.exists
    ? entitlementSnapshot.data()
    : null;
  const grant = grantSnapshot.exists ? grantSnapshot.data() : null;
  const baseAccess = resolveEffectiveGrowAccessPlan(entitlement, now);
  const internalFullAccess = hasInternalAdminFullAccess(uid, adminConfig);
  const effectivePlanId = resolveEffectiveSubscriptionPlanId({
    entitlement,
    promotionalGrant: grant,
    internalFullAccess,
    now,
  });
  const promotionActive = isPromotionalGrantActive(grant, now);
  const activeGrowCount = growsSnapshot.docs.reduce(
    (count, snapshot) =>
      count + (isActiveGrowDocument(snapshot.data() || {}) ? 1 : 0),
    0
  );

  return {
    uid,
    email: normalizeText(userRecord.email) || null,
    displayName: normalizeText(userRecord.displayName) || null,
    emailVerified: userRecord.emailVerified === true,
    disabled: userRecord.disabled === true,
    createdAt: serializeDate(userRecord.metadata?.creationTime),
    lastSignInAt: serializeDate(userRecord.metadata?.lastSignInTime),
    isAuthorizedAdmin: isAuthorizedAdminUid(uid, adminConfig),
    internalFullAccess,
    entitlement: serializeEntitlementForAdmin(entitlement, now),
    effectivePlanId,
    baseAccessPlanId: baseAccess.planId,
    promotion: serializeGrant(grant),
    promotionActive,
    promotionApplied:
      !internalFullAccess &&
      promotionActive &&
      effectivePlanId !== baseAccess.planId,
    activeGrowCount,
  };
}

export async function listAdminAccounts({
  db = getFirestore(),
  auth = getAuth(),
  actorUid,
  adminConfig,
  pageSize = ADMIN_ACCOUNT_PAGE_SIZE_DEFAULT,
  pageToken = null,
  now = new Date(),
} = {}) {
  const safeActorUid = assertAuthorizedAdminUid(actorUid, adminConfig);
  const config = normalizeAdminConfig(adminConfig);
  const safePageSize = normalizeAdminPageSize(pageSize);
  const safePageToken = normalizeAdminPageToken(pageToken);
  const currentDate = asValidDate(now) || new Date();

  let listed;
  try {
    listed = await auth.listUsers(safePageSize, safePageToken);
  } catch (error) {
    throw new AdminServiceError(
      "The account directory could not be loaded.",
      "unavailable",
      {
        cause: normalizeText(error?.code) || "auth-list-users-failed",
      }
    );
  }

  const accounts = await Promise.all(
    listed.users.map((userRecord) =>
      buildAdminAccountRecord({
        db,
        userRecord,
        adminConfig: config,
        now: currentDate,
      })
    )
  );

  return {
    actorUid: safeActorUid,
    accounts,
    nextPageToken: normalizeText(listed.pageToken) || null,
    pageSize: safePageSize,
  };
}

