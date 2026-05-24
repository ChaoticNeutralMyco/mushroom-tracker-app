// src/lib/subscriptionAccess.js

import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLAN_ORDER,
  SUBSCRIPTION_PLANS,
} from "./subscriptionPlans.js";

export const DEFAULT_SUBSCRIPTION_PLAN_ID = SUBSCRIPTION_PLAN_IDS.FREE;

export function getSubscriptionPlan(planId = DEFAULT_SUBSCRIPTION_PLAN_ID) {
  return SUBSCRIPTION_PLANS[planId] || SUBSCRIPTION_PLANS[DEFAULT_SUBSCRIPTION_PLAN_ID];
}

export function getSubscriptionPlanId(planId = DEFAULT_SUBSCRIPTION_PLAN_ID) {
  return getSubscriptionPlan(planId).id;
}

export function getPublicSubscriptionPlans() {
  return SUBSCRIPTION_PLAN_ORDER.map((planId) => getSubscriptionPlan(planId));
}

export function isUnlimitedLimit(limitValue) {
  return limitValue === null;
}

export function getPlanLimit(planId, limitName) {
  const plan = getSubscriptionPlan(planId);
  return plan.limits?.[limitName];
}

export function isWithinPlanLimit(planId, limitName, currentCount) {
  const limit = getPlanLimit(planId, limitName);

  if (isUnlimitedLimit(limit)) {
    return true;
  }

  if (typeof limit !== "number") {
    return false;
  }

  return Number(currentCount) <= limit;
}

export function getFeatureAccess(planId, featureName) {
  const plan = getSubscriptionPlan(planId);
  return plan.features?.[featureName] ?? false;
}

export function canUseFeature(planId, featureName) {
  const access = getFeatureAccess(planId, featureName);
  return access === true || access === "basic";
}

export function isPlanInternalOnly(planId) {
  return Boolean(getSubscriptionPlan(planId).internalOnly);
}

export function isPaidPlan(planId) {
  const plan = getSubscriptionPlan(planId);
  return Number(plan.priceMonthlyUsd) > 0;
}

export function compareSubscriptionPlans(leftPlanId, rightPlanId) {
  const leftIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(leftPlanId);
  const rightIndex = SUBSCRIPTION_PLAN_ORDER.indexOf(rightPlanId);

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
  return compareSubscriptionPlans(planId, minimumPlanId) >= 0;
}
