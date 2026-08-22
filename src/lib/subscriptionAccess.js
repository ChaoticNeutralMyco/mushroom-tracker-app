// src/lib/subscriptionAccess.js

import {
  SUBSCRIPTION_FEATURE_LIST,
  SUBSCRIPTION_LIMIT_LIST,
  SUBSCRIPTION_PLAN_ALIASES,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLAN_ORDER,
  SUBSCRIPTION_PLANS,
} from "./subscriptionPlans.js";

export const DEFAULT_SUBSCRIPTION_PLAN_ID = SUBSCRIPTION_PLAN_IDS.FREE;

export function normalizeSubscriptionPlanId(planId = DEFAULT_SUBSCRIPTION_PLAN_ID) {
  const normalized = String(planId || "").trim().toLowerCase();

  if (SUBSCRIPTION_PLANS[normalized]) {
    return normalized;
  }

  return SUBSCRIPTION_PLAN_ALIASES[normalized] || DEFAULT_SUBSCRIPTION_PLAN_ID;
}

export function getSubscriptionPlan(planId = DEFAULT_SUBSCRIPTION_PLAN_ID) {
  return SUBSCRIPTION_PLANS[normalizeSubscriptionPlanId(planId)];
}

export function getSubscriptionPlanId(planId = DEFAULT_SUBSCRIPTION_PLAN_ID) {
  return getSubscriptionPlan(planId).id;
}

export function getPublicSubscriptionPlans() {
  return SUBSCRIPTION_PLAN_ORDER.map((planId) => getSubscriptionPlan(planId));
}

export function isKnownFeatureKey(featureName) {
  return SUBSCRIPTION_FEATURE_LIST.includes(featureName);
}

export function isKnownLimitKey(limitName) {
  return SUBSCRIPTION_LIMIT_LIST.includes(limitName);
}

export function isUnlimitedLimit(limitValue) {
  return limitValue === null;
}

export function getPlanLimit(planId, limitName) {
  if (!isKnownLimitKey(limitName)) {
    return undefined;
  }

  return getSubscriptionPlan(planId).limits?.[limitName];
}

export function isWithinPlanLimit(planId, limitName, currentCount) {
  const limit = getPlanLimit(planId, limitName);

  if (isUnlimitedLimit(limit)) {
    return true;
  }

  if (typeof limit !== "number") {
    return false;
  }

  const count = Number(currentCount);
  return Number.isFinite(count) && count <= limit;
}

export function getFeatureAccess(planId, featureName) {
  if (!isKnownFeatureKey(featureName)) {
    return false;
  }

  return getSubscriptionPlan(planId).features?.[featureName] === true;
}

export function canUseFeature(planId, featureName) {
  return getFeatureAccess(planId, featureName);
}

export function getMinimumPublicPlanForFeature(featureName) {
  return (
    SUBSCRIPTION_PLAN_ORDER.find((planId) => getFeatureAccess(planId, featureName)) ||
    null
  );
}

export function isPlanInternalOnly(planId) {
  return Boolean(getSubscriptionPlan(planId).internalOnly);
}

export function isPaidPlan(planId) {
  return getSubscriptionPlan(planId).billingType === "paid";
}

function getComparablePublicPlanId(planId) {
  const plan = getSubscriptionPlan(planId);

  if (plan.id === SUBSCRIPTION_PLAN_IDS.ADMIN) {
    return SUBSCRIPTION_PLAN_IDS.LAB;
  }

  if (plan.accessPlanId) {
    return normalizeSubscriptionPlanId(plan.accessPlanId);
  }

  return plan.id;
}

export function compareSubscriptionPlans(leftPlanId, rightPlanId) {
  const leftId = getComparablePublicPlanId(leftPlanId);
  const rightId = getComparablePublicPlanId(rightPlanId);
  const leftIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(leftId);
  const rightIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(rightId);

  if (leftIndex === -1 && rightIndex === -1) {
    return 0;
  }

  if (leftIndex === -1) {
    return -1;
  }

  if (rightIndex === -1) {
    return 1;
  }

  return leftIndex - rightIndex;
}

export function isPlanAtLeast(planId, minimumPlanId) {
  if (getSubscriptionPlanId(minimumPlanId) === SUBSCRIPTION_PLAN_IDS.ADMIN) {
    return getSubscriptionPlanId(planId) === SUBSCRIPTION_PLAN_IDS.ADMIN;
  }

  return compareSubscriptionPlans(planId, minimumPlanId) >= 0;
}
