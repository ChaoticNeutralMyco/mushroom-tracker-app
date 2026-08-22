// src/lib/subscriptionEntitlements.js

import {
  DEFAULT_SUBSCRIPTION_PLAN_ID,
  getFeatureAccess,
  getPlanLimit,
  getSubscriptionPlan,
  getSubscriptionPlanId,
  isKnownFeatureKey,
  isKnownLimitKey,
  isPlanInternalOnly,
  isUnlimitedLimit,
} from "./subscriptionAccess.js";

import {
  SUBSCRIPTION_BILLING_CONFIG,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_TRIAL_CONFIG,
} from "./subscriptionPlans.js";

export const SUBSCRIPTION_ENTITLEMENT_STATUSES = Object.freeze({
  ACTIVE: "active",
  TRIALING: "trialing",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
  EXPIRED: "expired",
});

export const SUBSCRIPTION_ENTITLEMENT_SOURCES = Object.freeze({
  DEFAULT: "default",
  TRIAL: "trial",
  TESTER_CODE: "tester_code",
  STRIPE: "stripe",
  ADMIN: "admin",
  ADMIN_PROMOTION: "admin_promotion",
  MANUAL: "manual",
});

const VALID_STATUSES = new Set(Object.values(SUBSCRIPTION_ENTITLEMENT_STATUSES));
const VALID_SOURCES = new Set(Object.values(SUBSCRIPTION_ENTITLEMENT_SOURCES));

export const DEFAULT_SUBSCRIPTION_ENTITLEMENT = Object.freeze({
  planId: DEFAULT_SUBSCRIPTION_PLAN_ID,
  status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
  source: SUBSCRIPTION_ENTITLEMENT_SOURCES.DEFAULT,
  trialStartedAt: null,
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  pastDueStartedAt: null,
  graceEndsAt: null,
  accessGrantedThroughGrace: false,
  testerCodeId: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  featureOverrides: Object.freeze({}),
  limitOverrides: Object.freeze({}),
  updatedAt: null,
});

function normalizeFeatureOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([featureName, access]) =>
        isKnownFeatureKey(featureName) && typeof access === "boolean"
    )
  );
}

function normalizeLimitOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([limitName, limitValue]) => {
      if (!isKnownLimitKey(limitName)) {
        return false;
      }

      return (
        limitValue === null ||
        (typeof limitValue === "number" &&
          Number.isFinite(limitValue) &&
          limitValue >= 0)
      );
    })
  );
}

export function normalizeSubscriptionEntitlement(entitlement = null) {
  const safeEntitlement =
    entitlement && typeof entitlement === "object" && !Array.isArray(entitlement)
      ? entitlement
      : {};

  const planId = getSubscriptionPlanId(safeEntitlement.planId);
  const status = VALID_STATUSES.has(safeEntitlement.status)
    ? safeEntitlement.status
    : DEFAULT_SUBSCRIPTION_ENTITLEMENT.status;
  const source = VALID_SOURCES.has(safeEntitlement.source)
    ? safeEntitlement.source
    : DEFAULT_SUBSCRIPTION_ENTITLEMENT.source;

  return {
    ...DEFAULT_SUBSCRIPTION_ENTITLEMENT,
    ...safeEntitlement,
    planId,
    status,
    source,
    accessGrantedThroughGrace:
      safeEntitlement.accessGrantedThroughGrace === true,
    featureOverrides: normalizeFeatureOverrides(safeEntitlement.featureOverrides),
    limitOverrides: normalizeLimitOverrides(safeEntitlement.limitOverrides),
  };
}

export function getEntitlementPlan(entitlement = null) {
  return getSubscriptionPlan(getEntitlementPlanId(entitlement));
}

export function getEntitlementPlanId(entitlement = null) {
  return normalizeSubscriptionEntitlement(entitlement).planId;
}

export function getEntitlementStatus(entitlement = null) {
  return normalizeSubscriptionEntitlement(entitlement).status;
}

export function getEntitlementSource(entitlement = null) {
  return normalizeSubscriptionEntitlement(entitlement).source;
}

export function isTrialEntitlement(entitlement = null) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);

  return (
    normalized.planId === SUBSCRIPTION_PLAN_IDS.TRIAL ||
    normalized.status === SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING ||
    normalized.source === SUBSCRIPTION_ENTITLEMENT_SOURCES.TRIAL
  );
}

export function isTesterCodeEntitlement(entitlement = null) {
  return (
    getEntitlementSource(entitlement) ===
    SUBSCRIPTION_ENTITLEMENT_SOURCES.TESTER_CODE
  );
}

export function isStripeEntitlement(entitlement = null) {
  return (
    getEntitlementSource(entitlement) ===
    SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE
  );
}

export function isAdminEntitlement(entitlement = null) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);

  return (
    normalized.planId === SUBSCRIPTION_PLAN_IDS.ADMIN ||
    normalized.source === SUBSCRIPTION_ENTITLEMENT_SOURCES.ADMIN ||
    (isPlanInternalOnly(normalized.planId) &&
      normalized.planId === SUBSCRIPTION_PLAN_IDS.ADMIN)
  );
}

export function isEntitlementActive(entitlement = null) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);

  if (isAdminEntitlement(normalized)) {
    return true;
  }

  return (
    normalized.status === SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE ||
    normalized.status === SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING ||
    (normalized.status === SUBSCRIPTION_ENTITLEMENT_STATUSES.PAST_DUE &&
      normalized.accessGrantedThroughGrace === true)
  );
}

export function getEntitlementAccessPlanId(entitlement = null) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);

  if (isAdminEntitlement(normalized)) {
    return SUBSCRIPTION_PLAN_IDS.ADMIN;
  }

  if (!isEntitlementActive(normalized)) {
    return SUBSCRIPTION_BILLING_CONFIG.inactiveFallbackPlanId;
  }

  if (isTrialEntitlement(normalized)) {
    return SUBSCRIPTION_TRIAL_CONFIG.grantsPlanId;
  }

  return normalized.planId;
}

export function getEntitlementFeatureAccess(entitlement, featureName) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);

  if (!isKnownFeatureKey(featureName) || !isEntitlementActive(normalized)) {
    return false;
  }

  if (isAdminEntitlement(normalized)) {
    return true;
  }

  if (typeof normalized.featureOverrides[featureName] === "boolean") {
    return normalized.featureOverrides[featureName];
  }

  return getFeatureAccess(getEntitlementAccessPlanId(normalized), featureName);
}

export function canEntitlementUseFeature(entitlement, featureName) {
  return getEntitlementFeatureAccess(entitlement, featureName);
}

export function getEntitlementLimit(entitlement, limitName) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);

  if (!isKnownLimitKey(limitName)) {
    return undefined;
  }

  if (isAdminEntitlement(normalized)) {
    return null;
  }

  if (!isEntitlementActive(normalized)) {
    return getPlanLimit(
      SUBSCRIPTION_BILLING_CONFIG.inactiveFallbackPlanId,
      limitName
    );
  }

  if (Object.prototype.hasOwnProperty.call(normalized.limitOverrides, limitName)) {
    return normalized.limitOverrides[limitName];
  }

  return getPlanLimit(getEntitlementAccessPlanId(normalized), limitName);
}

export function isWithinEntitlementLimit(entitlement, limitName, currentCount) {
  const limit = getEntitlementLimit(entitlement, limitName);

  if (isUnlimitedLimit(limit)) {
    return true;
  }

  if (typeof limit !== "number") {
    return false;
  }

  const count = Number(currentCount);
  return Number.isFinite(count) && count <= limit;
}

export function buildDefaultSubscriptionEntitlement(overrides = {}) {
  return normalizeSubscriptionEntitlement({
    ...DEFAULT_SUBSCRIPTION_ENTITLEMENT,
    ...overrides,
  });
}
