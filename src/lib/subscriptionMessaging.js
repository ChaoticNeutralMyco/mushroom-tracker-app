// src/lib/subscriptionMessaging.js

import {
  getMinimumPublicPlanForFeature,
  getSubscriptionPlan,
} from "./subscriptionAccess.js";

import {
  SUBSCRIPTION_DOWNGRADE_POLICY,
  SUBSCRIPTION_FEATURE_LABELS,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_TRIAL_CONFIG,
} from "./subscriptionPlans.js";

import {
  getEntitlementPlanId,
  getEntitlementSource,
  getEntitlementStatus,
  isTrialEntitlement,
} from "./subscriptionEntitlements.js";

export function getPlanDisplayName(planId) {
  return getSubscriptionPlan(planId).label;
}

export function getPlanPriceLabel(planId) {
  const plan = getSubscriptionPlan(planId);

  if (plan.internalOnly) {
    return "Internal";
  }

  if (plan.billingType === "free") {
    return "$0/mo";
  }

  if (typeof plan.priceMonthlyUsd === "number") {
    return `$${plan.priceMonthlyUsd.toFixed(2)}/mo`;
  }

  return "Pricing TBD";
}

export function getTrialSummaryMessage() {
  const planName = getPlanDisplayName(SUBSCRIPTION_TRIAL_CONFIG.grantsPlanId);

  return `${SUBSCRIPTION_TRIAL_CONFIG.durationDays}-day ${planName} trial. Daily expiration reminders begin with ${SUBSCRIPTION_TRIAL_CONFIG.reminderStartsDaysRemaining} days remaining.`;
}

export function getDowngradeSafetyMessage() {
  if (!SUBSCRIPTION_DOWNGRADE_POLICY.deleteDataOnDowngrade) {
    return "Your data is safe. Downgrades keep restricted records available as read-only and preserve exports, workflow completion, and safety actions.";
  }

  return "Review downgrade behavior before changing plans.";
}

export function getEntitlementSummaryMessage(entitlement = null) {
  const planId = getEntitlementPlanId(entitlement);
  const planName = getPlanDisplayName(planId);
  const status = getEntitlementStatus(entitlement);
  const source = getEntitlementSource(entitlement);

  if (isTrialEntitlement(entitlement)) {
    const accessPlanName = getPlanDisplayName(SUBSCRIPTION_TRIAL_CONFIG.grantsPlanId);
    return `Current plan: ${planName}. ${accessPlanName} trial access is active.`;
  }

  return `Current plan: ${planName}. Status: ${status}. Source: ${source}.`;
}

export function getLimitReachedMessage({ planId, limitName, limitValue } = {}) {
  const planName = getPlanDisplayName(planId);
  const label = String(limitName || "items")
    .replace(/([A-Z])/g, " $1")
    .toLowerCase();

  if (limitValue === null) {
    return `${planName} includes unlimited ${label}.`;
  }

  return `${planName} includes ${limitValue} ${label}. Complete or archive an existing item, or upgrade to add another.`;
}

export function getFeaturePreviewMessage({
  planId,
  featureName,
  requiredPlanId = null,
} = {}) {
  const currentPlanName = getPlanDisplayName(planId);
  const minimumPlanId =
    requiredPlanId || getMinimumPublicPlanForFeature(featureName);
  const requiredPlanName = minimumPlanId
    ? getPlanDisplayName(minimumPlanId)
    : "a higher plan";
  const featureLabel =
    SUBSCRIPTION_FEATURE_LABELS[featureName] ||
    String(featureName || "this feature")
      .replace(/([A-Z])/g, " $1")
      .toLowerCase();

  return `${featureLabel} is included with ${requiredPlanName}. Your current plan is ${currentPlanName}.`;
}

export function getTrialNoticeMessage({ phase, daysRemaining } = {}) {
  if (phase === "expired") {
    return "Your Lab trial has ended. Your account now uses the Free plan, and your existing data remains safe.";
  }

  if (phase === "ends_today") {
    return "Your Lab trial ends today. Upgrade now to keep Lab access without interruption.";
  }

  if (phase === "warning" && typeof daysRemaining === "number") {
    return `Your Lab trial has ${daysRemaining} days remaining. Upgrade now or continue your trial for today.`;
  }

  return "";
}
