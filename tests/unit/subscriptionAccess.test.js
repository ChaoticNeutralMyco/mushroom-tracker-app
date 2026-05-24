// tests/unit/subscriptionAccess.test.js

import { describe, expect, it } from "vitest";

import {
  canUseFeature,
  compareSubscriptionPlans,
  DEFAULT_SUBSCRIPTION_PLAN_ID,
  getFeatureAccess,
  getPlanLimit,
  getPublicSubscriptionPlans,
  getSubscriptionPlan,
  getSubscriptionPlanId,
  isPaidPlan,
  isPlanAtLeast,
  isPlanInternalOnly,
  isUnlimitedLimit,
  isWithinPlanLimit,
} from "../../src/lib/subscriptionAccess.js";

import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLAN_ORDER,
} from "../../src/lib/subscriptionPlans.js";

describe("subscriptionAccess pure helpers", () => {
  it("defaults unknown plan ids to Free", () => {
    expect(DEFAULT_SUBSCRIPTION_PLAN_ID).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
    expect(getSubscriptionPlan("missing-plan").id).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
    expect(getSubscriptionPlanId("missing-plan")).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
  });

  it("returns public plans in configured public order", () => {
    const publicPlans = getPublicSubscriptionPlans();

    expect(publicPlans.map((plan) => plan.id)).toEqual(SUBSCRIPTION_PLAN_ORDER);
    expect(publicPlans.map((plan) => plan.id)).not.toContain(SUBSCRIPTION_PLAN_IDS.TRIAL);
    expect(publicPlans.map((plan) => plan.id)).not.toContain(SUBSCRIPTION_PLAN_IDS.ADMIN);
  });

  it("reads finite and unlimited limits", () => {
    expect(getPlanLimit(SUBSCRIPTION_PLAN_IDS.FREE, "activeGrows")).toBe(5);
    expect(getPlanLimit(SUBSCRIPTION_PLAN_IDS.HOBBY, "recipes")).toBe(15);
    expect(getPlanLimit(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, "recipes")).toBeNull();

    expect(isUnlimitedLimit(null)).toBe(true);
    expect(isUnlimitedLimit(0)).toBe(false);
    expect(isUnlimitedLimit(15)).toBe(false);
  });

  it("checks limit usage inclusively", () => {
    expect(isWithinPlanLimit(SUBSCRIPTION_PLAN_IDS.FREE, "activeGrows", 5)).toBe(true);
    expect(isWithinPlanLimit(SUBSCRIPTION_PLAN_IDS.FREE, "activeGrows", 6)).toBe(false);

    expect(isWithinPlanLimit(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, "recipes", 999)).toBe(true);
    expect(isWithinPlanLimit(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, "supplies", 999)).toBe(true);
  });

  it("returns raw feature access values", () => {
    expect(getFeatureAccess(SUBSCRIPTION_PLAN_IDS.FREE, "cogLite")).toBe(true);
    expect(getFeatureAccess(SUBSCRIPTION_PLAN_IDS.FREE, "fullCogBreakdown")).toBe(false);
    expect(getFeatureAccess(SUBSCRIPTION_PLAN_IDS.FREE, "missingFeature")).toBe(false);
  });

  it("allows true and basic feature access", () => {
    expect(canUseFeature(SUBSCRIPTION_PLAN_IDS.FREE, "cogLite")).toBe(true);
    expect(canUseFeature(SUBSCRIPTION_PLAN_IDS.FREE, "fullCogBreakdown")).toBe(false);
    expect(canUseFeature(SUBSCRIPTION_PLAN_IDS.HOBBY, "recipeBasics")).toBe(true);
  });

  it("detects internal-only and paid plans", () => {
    expect(isPlanInternalOnly(SUBSCRIPTION_PLAN_IDS.ADMIN)).toBe(true);
    expect(isPlanInternalOnly(SUBSCRIPTION_PLAN_IDS.PRO)).toBe(false);

    expect(isPaidPlan(SUBSCRIPTION_PLAN_IDS.FREE)).toBe(false);
    expect(isPaidPlan(SUBSCRIPTION_PLAN_IDS.HOBBY)).toBe(true);
    expect(isPaidPlan(SUBSCRIPTION_PLAN_IDS.LAB)).toBe(true);
  });

  it("compares public plans by upgrade order", () => {
    expect(compareSubscriptionPlans(SUBSCRIPTION_PLAN_IDS.FREE, SUBSCRIPTION_PLAN_IDS.HOBBY)).toBeLessThan(0);
    expect(compareSubscriptionPlans(SUBSCRIPTION_PLAN_IDS.PRO, SUBSCRIPTION_PLAN_IDS.HOBBY)).toBeGreaterThan(0);
    expect(compareSubscriptionPlans(SUBSCRIPTION_PLAN_IDS.LAB, SUBSCRIPTION_PLAN_IDS.LAB)).toBe(0);
  });

  it("checks minimum tier requirements", () => {
    expect(isPlanAtLeast(SUBSCRIPTION_PLAN_IDS.CULTIVATOR, SUBSCRIPTION_PLAN_IDS.HOBBY)).toBe(true);
    expect(isPlanAtLeast(SUBSCRIPTION_PLAN_IDS.HOBBY, SUBSCRIPTION_PLAN_IDS.PRO)).toBe(false);
    expect(isPlanAtLeast(SUBSCRIPTION_PLAN_IDS.LAB, SUBSCRIPTION_PLAN_IDS.PRO)).toBe(true);
  });
});
