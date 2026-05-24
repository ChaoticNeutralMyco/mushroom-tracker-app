// src/lib/subscriptionMessaging.js

import {
  SUBSCRIPTION_DOWNGRADE_POLICY,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_TRIAL_CONFIG,
} from "./subscriptionPlans.js";

import {
  getEntitlementPlanId,
  getEntitlementStatus,
  getEntitlementSource,
  isTrialEntitlement,
} from "./subscriptionEntitlements.js";

export function getPlanDisplayName(planId) {
  return SUBSCRIPTION_PLANS[planId]?.label || SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.FREE].label;
}

export function getPlanPriceLabel(planId) {
  const price = SUBSCRIPTION_PLANS[planId]?.priceMonthlyUsd;

  if (price === null) {
    return "Internal";
  }

  if (price === 0) {
    return "$0/mo";
  }

  if (typeof price === "number") {
    return `$${price.toFixed(2)}/mo`;
  }

  return "Unavailable";
}

export function getTrialSummaryMessage() {
  return `${SUBSCRIPTION_TRIAL_CONFIG.durationDays}-day full-access trial for non-admin features.`;
}

export function getDowngradeSafetyMessage() {
  if (!SUBSCRIPTION_DOWNGRADE_POLICY.deleteDataOnDowngrade) {
    return "Your data is safe. Downgrades archive extra data as read-only instead of deleting it.";
  }

  return "Review downgrade behavior before changing plans.";
}

export function getEntitlementSummaryMessage(entitlement = null) {
  const planId = getEntitlementPlanId(entitlement);
  const planName = getPlanDisplayName(planId);
  const status = getEntitlementStatus(entitlement);
  const source = getEntitlementSource(entitlement);

  if (isTrialEntitlement(entitlement)) {
    return `Current plan: ${planName} trial. Trial access is active.`;
  }

  return `Current plan: ${planName}. Status: ${status}. Source: ${source}.`;
}

export function getLimitReachedMessage({ planId, limitName, limitValue } = {}) {
  const planName = getPlanDisplayName(planId);
  const label = String(limitName || "items").replace(/([A-Z])/g, " $1").toLowerCase();

  if (limitValue === null) {
    return `${planName} includes unlimited ${label}.`;
  }

  return `${planName} includes ${limitValue} ${label}. Upgrade later to unlock more capacity.`;
}

export function getFeaturePreviewMessage({ planId, featureName, requiredPlanId } = {}) {
  const currentPlanName = getPlanDisplayName(planId);
  const requiredPlanName = getPlanDisplayName(requiredPlanId);
  const featureLabel = String(featureName || "this feature")
    .replace(/([A-Z])/g, " $1")
    .toLowerCase();

  return `${featureLabel} is planned for ${requiredPlanName}. Your current plan is ${currentPlanName}.`;
}
