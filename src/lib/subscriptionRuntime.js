// src/lib/subscriptionRuntime.js

import {
  SUBSCRIPTION_ENTITLEMENT_SOURCES,
  SUBSCRIPTION_ENTITLEMENT_STATUSES,
  buildDefaultSubscriptionEntitlement,
  getEntitlementAccessPlanId,
  getEntitlementLimit,
  getEntitlementPlan,
  getEntitlementPlanId,
  getEntitlementSource,
  getEntitlementStatus,
  isAdminEntitlement,
  isTrialEntitlement,
  normalizeSubscriptionEntitlement,
} from "./subscriptionEntitlements.js";
import {
  SUBSCRIPTION_BILLING_CONFIG,
  SUBSCRIPTION_LIMIT_KEYS,
  SUBSCRIPTION_PLAN_ALIASES,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_TRIAL_CONFIG,
} from "./subscriptionPlans.js";
import {
  buildTrialEntitlement,
  buildTrialExpirationFallbackEntitlement,
  getTrialDaysRemaining,
  isTrialExpired,
  toSubscriptionDate,
} from "./subscriptionTrial.js";

const VALID_PLAN_IDS = new Set([
  ...Object.keys(SUBSCRIPTION_PLANS),
  ...Object.keys(SUBSCRIPTION_PLAN_ALIASES),
]);
const VALID_STATUSES = new Set(Object.values(SUBSCRIPTION_ENTITLEMENT_STATUSES));
const VALID_SOURCES = new Set(Object.values(SUBSCRIPTION_ENTITLEMENT_SOURCES));

export function getDefaultTrialStartDate({
  accountCreatedAt = null,
  rolloutStartedAt = SUBSCRIPTION_TRIAL_CONFIG.existingAccountTrialStartsAt,
  fallbackNow = new Date(),
} = {}) {
  const createdAt = toSubscriptionDate(accountCreatedAt);
  const rolloutAt = toSubscriptionDate(rolloutStartedAt);
  const fallback = toSubscriptionDate(fallbackNow) || new Date();

  if (createdAt && rolloutAt) {
    return new Date(Math.max(createdAt.getTime(), rolloutAt.getTime()));
  }

  return createdAt || rolloutAt || fallback;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isKnownRawPlanId(planId) {
  return VALID_PLAN_IDS.has(String(planId || "").trim().toLowerCase());
}

export function classifyStoredEntitlement(storedEntitlement, entitlementExists) {
  if (!entitlementExists) {
    return "missing";
  }

  if (!isPlainObject(storedEntitlement)) {
    return "malformed";
  }

  if (!isKnownRawPlanId(storedEntitlement.planId)) {
    return "malformed";
  }

  if (
    storedEntitlement.status !== undefined &&
    !VALID_STATUSES.has(storedEntitlement.status)
  ) {
    return "malformed";
  }

  if (
    storedEntitlement.source !== undefined &&
    !VALID_SOURCES.has(storedEntitlement.source)
  ) {
    return "malformed";
  }

  return "usable";
}

export function hasUsableStoredEntitlement(storedEntitlement, entitlementExists) {
  return classifyStoredEntitlement(storedEntitlement, entitlementExists) === "usable";
}

function buildFreeFallbackEntitlement() {
  return buildTrialExpirationFallbackEntitlement();
}

export function buildLoadingSubscriptionRuntime() {
  const entitlement = buildFreeFallbackEntitlement();

  return {
    entitlement,
    sourceEntitlement: null,
    trialEntitlement: null,
    entitlementExists: false,
    accessReady: false,
    grace: null,
    resolution: "entitlement-loading-free-fallback",
  };
}

export function buildUnavailableSubscriptionRuntime({
  resolution = "entitlement-unavailable-free-fallback",
  entitlementExists = false,
  sourceEntitlement = null,
} = {}) {
  const entitlement = buildFreeFallbackEntitlement();

  return {
    entitlement,
    sourceEntitlement,
    trialEntitlement: null,
    entitlementExists,
    accessReady: true,
    grace: null,
    resolution,
  };
}

export function buildMissingSubscriptionRuntime({
  accountCreatedAt = null,
  now = new Date(),
} = {}) {
  const trialEntitlement = buildTrialEntitlement(
    getDefaultTrialStartDate({ accountCreatedAt, fallbackNow: now })
  );

  if (isTrialExpired(trialEntitlement, now)) {
    return {
      entitlement: buildFreeFallbackEntitlement(),
      sourceEntitlement: trialEntitlement,
      trialEntitlement,
      entitlementExists: false,
      accessReady: true,
      grace: null,
      resolution: "missing-expired-trial-fallback",
    };
  }

  return {
    entitlement: trialEntitlement,
    sourceEntitlement: trialEntitlement,
    trialEntitlement,
    entitlementExists: false,
    accessReady: true,
    grace: null,
    resolution: "missing-trial",
  };
}

export function getPastDueGraceStartDate(entitlement = null) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);

  return (
    toSubscriptionDate(normalized.pastDueStartedAt) ||
    toSubscriptionDate(normalized.currentPeriodEndsAt) ||
    null
  );
}

export function getPastDueGraceEndDate(entitlement = null) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);
  const explicitGraceEnd = toSubscriptionDate(normalized.graceEndsAt);

  if (explicitGraceEnd) {
    return explicitGraceEnd;
  }

  const graceStart = getPastDueGraceStartDate(normalized);
  if (!graceStart) {
    return null;
  }

  return new Date(
    graceStart.getTime() + SUBSCRIPTION_BILLING_CONFIG.pastDueGraceMilliseconds
  );
}

export function getPastDueGraceState(entitlement = null, now = new Date()) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);
  const currentDate = toSubscriptionDate(now) || new Date();

  if (normalized.status !== SUBSCRIPTION_ENTITLEMENT_STATUSES.PAST_DUE) {
    return {
      isPastDue: false,
      hasTrustedStart: false,
      withinGrace: false,
      graceStartedAt: null,
      graceEndsAt: null,
      graceDaysRemaining: null,
    };
  }

  const graceStartedAt = getPastDueGraceStartDate(normalized);
  const graceEndsAt = getPastDueGraceEndDate(normalized);
  const hasTrustedStart = Boolean(graceStartedAt && graceEndsAt);
  const withinGrace = Boolean(
    hasTrustedStart && currentDate.getTime() < graceEndsAt.getTime()
  );
  const graceDaysRemaining = hasTrustedStart
    ? Math.max(
        0,
        Math.ceil(
          (graceEndsAt.getTime() - currentDate.getTime()) /
            (24 * 60 * 60 * 1000)
        )
      )
    : null;

  return {
    isPastDue: true,
    hasTrustedStart,
    withinGrace,
    graceStartedAt,
    graceEndsAt,
    graceDaysRemaining,
  };
}

function buildInactivePaidFallbackRuntime({
  sourceEntitlement,
  entitlementExists = true,
  resolution,
  grace = null,
}) {
  return {
    entitlement: buildFreeFallbackEntitlement(),
    sourceEntitlement,
    trialEntitlement: null,
    entitlementExists,
    accessReady: true,
    grace,
    resolution,
  };
}

export function resolveSubscriptionRuntime({
  storedEntitlement = null,
  entitlementExists = false,
  accountCreatedAt = null,
  now = new Date(),
} = {}) {
  const classification = classifyStoredEntitlement(
    storedEntitlement,
    entitlementExists
  );

  if (classification === "missing") {
    return buildMissingSubscriptionRuntime({ accountCreatedAt, now });
  }

  if (classification === "malformed") {
    return buildUnavailableSubscriptionRuntime({
      resolution: "malformed-entitlement-free-fallback",
      entitlementExists: true,
      sourceEntitlement: isPlainObject(storedEntitlement)
        ? storedEntitlement
        : null,
    });
  }

  const sourceEntitlement = normalizeSubscriptionEntitlement(storedEntitlement);

  if (isAdminEntitlement(sourceEntitlement)) {
    return {
      entitlement: sourceEntitlement,
      sourceEntitlement,
      trialEntitlement: null,
      entitlementExists: true,
      accessReady: true,
      grace: null,
      resolution: "stored-admin-entitlement",
    };
  }

  if (isTrialEntitlement(sourceEntitlement)) {
    if (isTrialExpired(sourceEntitlement, now)) {
      return {
        entitlement: buildFreeFallbackEntitlement(),
        sourceEntitlement,
        trialEntitlement: sourceEntitlement,
        entitlementExists: true,
        accessReady: true,
        grace: null,
        resolution: "stored-expired-trial-fallback",
      };
    }

    return {
      entitlement: sourceEntitlement,
      sourceEntitlement,
      trialEntitlement: sourceEntitlement,
      entitlementExists: true,
      accessReady: true,
      grace: null,
      resolution: "stored-trial-entitlement",
    };
  }

  const status = getEntitlementStatus(sourceEntitlement);

  if (status === SUBSCRIPTION_ENTITLEMENT_STATUSES.PAST_DUE) {
    const grace = getPastDueGraceState(sourceEntitlement, now);

    if (grace.withinGrace) {
      return {
        entitlement: normalizeSubscriptionEntitlement({
          ...sourceEntitlement,
          accessGrantedThroughGrace: true,
          graceEndsAt: grace.graceEndsAt,
        }),
        sourceEntitlement,
        trialEntitlement: null,
        entitlementExists: true,
        accessReady: true,
        grace,
        resolution: "stored-past-due-grace",
      };
    }

    return buildInactivePaidFallbackRuntime({
      sourceEntitlement,
      resolution: grace.hasTrustedStart
        ? "stored-past-due-free-fallback"
        : "stored-past-due-missing-anchor-free-fallback",
      grace,
    });
  }

  if (
    status === SUBSCRIPTION_ENTITLEMENT_STATUSES.CANCELED ||
    status === SUBSCRIPTION_ENTITLEMENT_STATUSES.EXPIRED
  ) {
    return buildInactivePaidFallbackRuntime({
      sourceEntitlement,
      resolution: `stored-${status}-free-fallback`,
    });
  }

  return {
    entitlement: sourceEntitlement,
    sourceEntitlement,
    trialEntitlement: null,
    entitlementExists: true,
    accessReady: true,
    grace: null,
    resolution: "stored-entitlement",
  };
}

export function buildSubscriptionRuntimeSummary({
  entitlement,
  sourceEntitlement = entitlement,
  activeGrowCount = 0,
  now = new Date(),
  grace = null,
  accessReady = true,
} = {}) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);
  const normalizedSource = sourceEntitlement
    ? normalizeSubscriptionEntitlement(sourceEntitlement)
    : null;
  const plan = getEntitlementPlan(normalized);
  const activeGrowLimit = getEntitlementLimit(
    normalized,
    SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS
  );
  const count = Number(activeGrowCount);
  const safeCount = Number.isFinite(count) && count >= 0 ? count : 0;

  return {
    plan,
    planId: getEntitlementPlanId(normalized),
    accessPlanId: getEntitlementAccessPlanId(normalized),
    status: getEntitlementStatus(normalized),
    source: getEntitlementSource(normalized),
    sourcePlanId: normalizedSource
      ? getEntitlementPlanId(normalizedSource)
      : null,
    sourceStatus: normalizedSource
      ? getEntitlementStatus(normalizedSource)
      : null,
    isTrial: isTrialEntitlement(sourceEntitlement),
    trialDaysRemaining: getTrialDaysRemaining(sourceEntitlement, now),
    isPastDue: Boolean(grace?.isPastDue),
    inPastDueGrace: Boolean(grace?.withinGrace),
    graceEndsAt: grace?.graceEndsAt || null,
    graceDaysRemaining: grace?.graceDaysRemaining ?? null,
    accessReady: accessReady === true,
    activeGrowLimit,
    activeGrowCount: safeCount,
    activeGrowLimitReached:
      typeof activeGrowLimit === "number" && safeCount >= activeGrowLimit,
    activeGrowLimitExceeded:
      typeof activeGrowLimit === "number" && safeCount > activeGrowLimit,
  };
}
