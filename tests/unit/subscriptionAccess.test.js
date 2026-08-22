// tests/unit/subscriptionAccess.test.js

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBSCRIPTION_PLAN_ID,
  canUseFeature,
  compareSubscriptionPlans,
  getFeatureAccess,
  getMinimumPublicPlanForFeature,
  getPlanLimit,
  getPublicSubscriptionPlans,
  getSubscriptionPlan,
  getSubscriptionPlanId,
  isKnownFeatureKey,
  isKnownLimitKey,
  isPaidPlan,
  isPlanAtLeast,
  isPlanInternalOnly,
  isUnlimitedLimit,
  isWithinPlanLimit,
  normalizeSubscriptionPlanId,
} from "../../src/lib/subscriptionAccess.js";

import {
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_LIMIT_KEYS,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLAN_ORDER,
} from "../../src/lib/subscriptionPlans.js";

describe("subscriptionAccess plan helpers", () => {
  it("defaults unknown plan ids to Free and migrates legacy Pro to Cultivator", () => {
    expect(DEFAULT_SUBSCRIPTION_PLAN_ID).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
    expect(normalizeSubscriptionPlanId("missing-plan")).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
    expect(normalizeSubscriptionPlanId(" PRO ")).toBe(SUBSCRIPTION_PLAN_IDS.CULTIVATOR);
    expect(getSubscriptionPlan("pro").id).toBe(SUBSCRIPTION_PLAN_IDS.CULTIVATOR);
    expect(getSubscriptionPlanId("missing-plan")).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
  });

  it("returns four public plans in configured order", () => {
    const publicPlans = getPublicSubscriptionPlans();

    expect(publicPlans.map((plan) => plan.id)).toEqual(SUBSCRIPTION_PLAN_ORDER);
    expect(publicPlans).toHaveLength(4);
  });

  it("recognizes stable feature and limit keys", () => {
    expect(isKnownFeatureKey(SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS)).toBe(true);
    expect(isKnownFeatureKey("missingFeature")).toBe(false);
    expect(isKnownLimitKey(SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS)).toBe(true);
    expect(isKnownLimitKey("recipes")).toBe(false);
  });

  it("reads finite and unlimited active-grow limits", () => {
    expect(getPlanLimit(SUBSCRIPTION_PLAN_IDS.FREE, "activeGrows")).toBe(6);
    expect(getPlanLimit(SUBSCRIPTION_PLAN_IDS.HOBBY, "activeGrows")).toBe(30);
    expect(getPlanLimit(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, "activeGrows")).toBeNull();
    expect(getPlanLimit(SUBSCRIPTION_PLAN_IDS.LAB, "activeGrows")).toBeNull();
    expect(getPlanLimit(SUBSCRIPTION_PLAN_IDS.FREE, "recipes")).toBeUndefined();

    expect(isUnlimitedLimit(null)).toBe(true);
    expect(isUnlimitedLimit(0)).toBe(false);
  });

  it("checks active-grow usage inclusively", () => {
    expect(isWithinPlanLimit(SUBSCRIPTION_PLAN_IDS.FREE, "activeGrows", 6)).toBe(true);
    expect(isWithinPlanLimit(SUBSCRIPTION_PLAN_IDS.FREE, "activeGrows", 7)).toBe(false);
    expect(isWithinPlanLimit(SUBSCRIPTION_PLAN_IDS.HOBBY, "activeGrows", 30)).toBe(true);
    expect(isWithinPlanLimit(SUBSCRIPTION_PLAN_IDS.HOBBY, "activeGrows", 31)).toBe(false);
    expect(isWithinPlanLimit(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, "activeGrows", 9999)).toBe(true);
  });

  it("reads feature access without checking plan names in components", () => {
    expect(canUseFeature(SUBSCRIPTION_PLAN_IDS.FREE, SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS)).toBe(true);
    expect(canUseFeature(SUBSCRIPTION_PLAN_IDS.HOBBY, SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS)).toBe(false);
    expect(canUseFeature(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS)).toBe(true);
    expect(canUseFeature(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING)).toBe(false);
    expect(canUseFeature(SUBSCRIPTION_PLAN_IDS.LAB, SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING)).toBe(true);
    expect(getFeatureAccess(SUBSCRIPTION_PLAN_IDS.LAB, "missingFeature")).toBe(false);
  });

  it("finds the minimum public plan for a feature", () => {
    expect(getMinimumPublicPlanForFeature(SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS)).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
    expect(getMinimumPublicPlanForFeature(SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS)).toBe(SUBSCRIPTION_PLAN_IDS.CULTIVATOR);
    expect(getMinimumPublicPlanForFeature(SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS)).toBe(SUBSCRIPTION_PLAN_IDS.LAB);
    expect(getMinimumPublicPlanForFeature("missingFeature")).toBeNull();
  });

  it("detects internal and paid plan types without requiring approved prices", () => {
    expect(isPlanInternalOnly(SUBSCRIPTION_PLAN_IDS.TRIAL)).toBe(true);
    expect(isPlanInternalOnly(SUBSCRIPTION_PLAN_IDS.ADMIN)).toBe(true);
    expect(isPlanInternalOnly(SUBSCRIPTION_PLAN_IDS.LAB)).toBe(false);

    expect(isPaidPlan(SUBSCRIPTION_PLAN_IDS.FREE)).toBe(false);
    expect(isPaidPlan(SUBSCRIPTION_PLAN_IDS.HOBBY)).toBe(true);
    expect(isPaidPlan(SUBSCRIPTION_PLAN_IDS.CULTIVATOR)).toBe(true);
    expect(isPaidPlan(SUBSCRIPTION_PLAN_IDS.LAB)).toBe(true);
  });

  it("compares public plans and treats Trial as Lab access", () => {
    expect(compareSubscriptionPlans(SUBSCRIPTION_PLAN_IDS.FREE, SUBSCRIPTION_PLAN_IDS.HOBBY)).toBeLessThan(0);
    expect(compareSubscriptionPlans(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, SUBSCRIPTION_PLAN_IDS.HOBBY)).toBeGreaterThan(0);
    expect(compareSubscriptionPlans(SUBSCRIPTION_PLAN_IDS.TRIAL, SUBSCRIPTION_PLAN_IDS.LAB)).toBe(0);
    expect(compareSubscriptionPlans(SUBSCRIPTION_PLAN_IDS.ADMIN, SUBSCRIPTION_PLAN_IDS.LAB)).toBe(0);
  });

  it("checks minimum tier requirements", () => {
    expect(isPlanAtLeast(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, SUBSCRIPTION_PLAN_IDS.HOBBY)).toBe(true);
    expect(isPlanAtLeast(SUBSCRIPTION_PLAN_IDS.HOBBY, SUBSCRIPTION_PLAN_IDS.CULTIVATOR)).toBe(false);
    expect(isPlanAtLeast(SUBSCRIPTION_PLAN_IDS.LAB, SUBSCRIPTION_PLAN_IDS.CULTIVATOR)).toBe(true);
    expect(isPlanAtLeast(SUBSCRIPTION_PLAN_IDS.TRIAL, SUBSCRIPTION_PLAN_IDS.LAB)).toBe(true);
    expect(isPlanAtLeast(SUBSCRIPTION_PLAN_IDS.LAB, SUBSCRIPTION_PLAN_IDS.ADMIN)).toBe(false);
    expect(isPlanAtLeast(SUBSCRIPTION_PLAN_IDS.ADMIN, SUBSCRIPTION_PLAN_IDS.ADMIN)).toBe(true);
  });
});
