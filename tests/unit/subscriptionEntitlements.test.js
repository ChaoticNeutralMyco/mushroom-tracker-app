// tests/unit/subscriptionEntitlements.test.js

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBSCRIPTION_ENTITLEMENT,
  SUBSCRIPTION_ENTITLEMENT_SOURCES,
  SUBSCRIPTION_ENTITLEMENT_STATUSES,
  buildDefaultSubscriptionEntitlement,
  getEntitlementPlan,
  getEntitlementPlanId,
  getEntitlementSource,
  getEntitlementStatus,
  isAdminEntitlement,
  isEntitlementActive,
  isStripeEntitlement,
  isTesterCodeEntitlement,
  isTrialEntitlement,
  normalizeSubscriptionEntitlement,
} from "../../src/lib/subscriptionEntitlements.js";

import { SUBSCRIPTION_PLAN_IDS } from "../../src/lib/subscriptionPlans.js";

describe("subscriptionEntitlements read-only helpers", () => {
  it("defaults missing entitlement data to active Free", () => {
    expect(normalizeSubscriptionEntitlement()).toEqual(DEFAULT_SUBSCRIPTION_ENTITLEMENT);
    expect(getEntitlementPlanId()).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
    expect(getEntitlementStatus()).toBe(SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE);
    expect(getEntitlementSource()).toBe(SUBSCRIPTION_ENTITLEMENT_SOURCES.DEFAULT);
  });

  it("falls back invalid plan ids to Free without throwing", () => {
    const entitlement = normalizeSubscriptionEntitlement({
      planId: "not-real",
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE,
    });

    expect(entitlement.planId).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
    expect(entitlement.source).toBe(SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE);
  });

  it("preserves known entitlement fields", () => {
    const entitlement = normalizeSubscriptionEntitlement({
      planId: SUBSCRIPTION_PLAN_IDS.PRO,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TRIAL,
      trialStartedAt: "2026-05-23T00:00:00.000Z",
      trialEndsAt: "2026-05-30T00:00:00.000Z",
      testerCodeId: "CNM-JUNE-TESTER",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      updatedAt: "serverTimestamp",
    });

    expect(entitlement).toMatchObject({
      planId: SUBSCRIPTION_PLAN_IDS.PRO,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TRIAL,
      trialStartedAt: "2026-05-23T00:00:00.000Z",
      trialEndsAt: "2026-05-30T00:00:00.000Z",
      testerCodeId: "CNM-JUNE-TESTER",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      updatedAt: "serverTimestamp",
    });
  });

  it("returns the plan object for the normalized entitlement", () => {
    const plan = getEntitlementPlan({
      planId: SUBSCRIPTION_PLAN_IDS.LAB,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE,
    });

    expect(plan.id).toBe(SUBSCRIPTION_PLAN_IDS.LAB);
    expect(plan.label).toBe("Lab");
  });

  it("treats active and trialing as usable entitlement states", () => {
    expect(isEntitlementActive({ status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE })).toBe(true);
    expect(isEntitlementActive({ status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING })).toBe(true);
    expect(isEntitlementActive({ status: SUBSCRIPTION_ENTITLEMENT_STATUSES.PAST_DUE })).toBe(false);
    expect(isEntitlementActive({ status: SUBSCRIPTION_ENTITLEMENT_STATUSES.CANCELED })).toBe(false);
    expect(isEntitlementActive({ status: SUBSCRIPTION_ENTITLEMENT_STATUSES.EXPIRED })).toBe(false);
  });

  it("detects trial, tester-code, Stripe, and admin entitlements", () => {
    expect(isTrialEntitlement({
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.DEFAULT,
    })).toBe(true);

    expect(isTrialEntitlement({
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TRIAL,
    })).toBe(true);

    expect(isTesterCodeEntitlement({
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TESTER_CODE,
    })).toBe(true);

    expect(isStripeEntitlement({
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE,
    })).toBe(true);

    expect(isAdminEntitlement({
      planId: SUBSCRIPTION_PLAN_IDS.ADMIN,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.DEFAULT,
    })).toBe(true);

    expect(isAdminEntitlement({
      planId: SUBSCRIPTION_PLAN_IDS.PRO,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.ADMIN,
    })).toBe(true);
  });

  it("builds default entitlement with safe overrides", () => {
    const entitlement = buildDefaultSubscriptionEntitlement({
      planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TESTER_CODE,
      testerCodeId: "CNM-VET-BETA",
    });

    expect(entitlement).toMatchObject({
      planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TESTER_CODE,
      testerCodeId: "CNM-VET-BETA",
    });
  });
});
