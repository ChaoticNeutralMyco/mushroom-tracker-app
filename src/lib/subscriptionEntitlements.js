// src/lib/subscriptionEntitlements.js

import {
  DEFAULT_SUBSCRIPTION_PLAN_ID,
  getSubscriptionPlan,
  getSubscriptionPlanId,
  isPlanInternalOnly,
} from "./subscriptionAccess.js";

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
  MANUAL: "manual",
});

export const DEFAULT_SUBSCRIPTION_ENTITLEMENT = Object.freeze({
  planId: DEFAULT_SUBSCRIPTION_PLAN_ID,
  status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
  source: SUBSCRIPTION_ENTITLEMENT_SOURCES.DEFAULT,
  trialStartedAt: null,
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  testerCodeId: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  updatedAt: null,
});

export function normalizeSubscriptionEntitlement(entitlement = null) {
  const safeEntitlement =
    entitlement && typeof entitlement === "object" ? entitlement : {};

  const planId = getSubscriptionPlanId(safeEntitlement.planId);
  const status =
    typeof safeEntitlement.status === "string" && safeEntitlement.status.trim()
      ? safeEntitlement.status
      : DEFAULT_SUBSCRIPTION_ENTITLEMENT.status;

  const source =
    typeof safeEntitlement.source === "string" && safeEntitlement.source.trim()
      ? safeEntitlement.source
      : DEFAULT_SUBSCRIPTION_ENTITLEMENT.source;

  return {
    ...DEFAULT_SUBSCRIPTION_ENTITLEMENT,
    ...safeEntitlement,
    planId,
    status,
    source,
  };
}

export function getEntitlementPlan(entitlement = null) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);
  return getSubscriptionPlan(normalized.planId);
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

export function isEntitlementActive(entitlement = null) {
  const status = getEntitlementStatus(entitlement);

  return (
    status === SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE ||
    status === SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING
  );
}

export function isTrialEntitlement(entitlement = null) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);

  return (
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
  return getEntitlementSource(entitlement) === SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE;
}

export function isAdminEntitlement(entitlement = null) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);

  return (
    normalized.source === SUBSCRIPTION_ENTITLEMENT_SOURCES.ADMIN ||
    isPlanInternalOnly(normalized.planId)
  );
}

export function buildDefaultSubscriptionEntitlement(overrides = {}) {
  return normalizeSubscriptionEntitlement({
    ...DEFAULT_SUBSCRIPTION_ENTITLEMENT,
    ...overrides,
  });
}
