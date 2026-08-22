// src/lib/subscriptionFeatureGates.js

import {
  getMinimumPublicPlanForFeature,
  getSubscriptionPlan,
} from "./subscriptionAccess.js";
import {
  SUBSCRIPTION_FEATURE_LABELS,
} from "./subscriptionPlans.js";

export const SUBSCRIPTION_FEATURE_ACCESS_ERROR_CODE =
  "subscription-feature-access-required";

export class SubscriptionFeatureAccessError extends Error {
  constructor(details = {}) {
    super(details.message || "This action requires a different subscription plan.");
    this.name = "SubscriptionFeatureAccessError";
    this.code = SUBSCRIPTION_FEATURE_ACCESS_ERROR_CODE;
    this.details = details;
  }
}

export function getSubscriptionFeatureGateState({
  allowed = false,
  featureKey,
  actionLabel = "Use this feature",
  supportingText = "",
} = {}) {
  const minimumPlanId = getMinimumPublicPlanForFeature(featureKey);
  const minimumPlan = minimumPlanId
    ? getSubscriptionPlan(minimumPlanId)
    : null;
  const featureLabel =
    SUBSCRIPTION_FEATURE_LABELS[featureKey] || "Subscription feature";
  const minimumPlanLabel = minimumPlan?.label || "an eligible plan";

  return {
    allowed: Boolean(allowed),
    featureKey: featureKey || "",
    featureLabel,
    minimumPlanId,
    minimumPlanLabel,
    actionLabel,
    supportingText: String(supportingText || "").trim(),
    message: `${actionLabel} requires ${minimumPlanLabel} or a higher plan.`,
  };
}

export function assertSubscriptionFeatureAccess(options = {}) {
  const state = getSubscriptionFeatureGateState(options);

  if (!state.allowed) {
    throw new SubscriptionFeatureAccessError(state);
  }

  return state;
}
