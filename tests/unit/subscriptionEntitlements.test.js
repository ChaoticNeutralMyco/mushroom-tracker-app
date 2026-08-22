// tests/unit/subscriptionEntitlements.test.js

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBSCRIPTION_ENTITLEMENT,
  SUBSCRIPTION_ENTITLEMENT_SOURCES,
  SUBSCRIPTION_ENTITLEMENT_STATUSES,
  buildDefaultSubscriptionEntitlement,
  canEntitlementUseFeature,
  getEntitlementAccessPlanId,
  getEntitlementFeatureAccess,
  getEntitlementLimit,
  getEntitlementPlan,
  getEntitlementPlanId,
  getEntitlementSource,
  getEntitlementStatus,
  isAdminEntitlement,
  isEntitlementActive,
  isStripeEntitlement,
  isTesterCodeEntitlement,
  isTrialEntitlement,
  isWithinEntitlementLimit,
  normalizeSubscriptionEntitlement,
} from "../../src/lib/subscriptionEntitlements.js";

import {
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_PLAN_IDS,
} from "../../src/lib/subscriptionPlans.js";

describe("subscriptionEntitlements override-aware helpers", () => {
  it("defaults missing entitlement data to active Free", () => {
    expect(normalizeSubscriptionEntitlement()).toEqual(DEFAULT_SUBSCRIPTION_ENTITLEMENT);
    expect(getEntitlementPlanId()).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
    expect(getEntitlementStatus()).toBe(SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE);
    expect(getEntitlementSource()).toBe(SUBSCRIPTION_ENTITLEMENT_SOURCES.DEFAULT);
  });

  it("migrates legacy Pro entitlements to Cultivator", () => {
    const entitlement = normalizeSubscriptionEntitlement({
      planId: "pro",
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE,
    });

    expect(entitlement.planId).toBe(SUBSCRIPTION_PLAN_IDS.CULTIVATOR);
    expect(entitlement.source).toBe(SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE);
  });

  it("falls back invalid statuses, sources, and plan ids safely", () => {
    const entitlement = normalizeSubscriptionEntitlement({
      planId: "not-real",
      status: "not-real",
      source: "not-real",
    });

    expect(entitlement).toMatchObject({
      planId: SUBSCRIPTION_PLAN_IDS.FREE,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.DEFAULT,
    });
  });

  it("preserves known billing fields and sanitizes overrides", () => {
    const entitlement = normalizeSubscriptionEntitlement({
      planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE,
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      featureOverrides: {
        [SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS]: true,
        missingFeature: true,
        [SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS]: "yes",
      },
      limitOverrides: {
        activeGrows: 50,
        recipes: 100,
        negative: -1,
      },
    });

    expect(entitlement).toMatchObject({
      planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      featureOverrides: {
        [SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS]: true,
      },
      limitOverrides: {
        activeGrows: 50,
      },
    });
  });

  it("returns the stored plan and the effective trial access plan separately", () => {
    const entitlement = {
      planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TRIAL,
    };

    expect(getEntitlementPlan(entitlement).id).toBe(SUBSCRIPTION_PLAN_IDS.TRIAL);
    expect(getEntitlementAccessPlanId(entitlement)).toBe(SUBSCRIPTION_PLAN_IDS.LAB);
  });

  it("treats active and trialing as usable entitlement states", () => {
    expect(isEntitlementActive({ status: "active" })).toBe(true);
    expect(isEntitlementActive({ status: "trialing" })).toBe(true);
    expect(isEntitlementActive({ status: "past_due" })).toBe(false);
    expect(isEntitlementActive({ status: "canceled" })).toBe(false);
    expect(isEntitlementActive({ status: "expired" })).toBe(false);
  });

  it("detects entitlement sources and internal access", () => {
    expect(isTrialEntitlement({ planId: SUBSCRIPTION_PLAN_IDS.TRIAL })).toBe(true);
    expect(isTesterCodeEntitlement({ source: "tester_code" })).toBe(true);
    expect(isStripeEntitlement({ source: "stripe" })).toBe(true);
    expect(isAdminEntitlement({ planId: SUBSCRIPTION_PLAN_IDS.ADMIN })).toBe(true);
    expect(isAdminEntitlement({ source: "admin" })).toBe(true);
    expect(isAdminEntitlement({ planId: SUBSCRIPTION_PLAN_IDS.TRIAL })).toBe(false);
  });

  it("uses plan features through stable feature keys", () => {
    expect(
      canEntitlementUseFeature(
        { planId: SUBSCRIPTION_PLAN_IDS.FREE },
        SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS
      )
    ).toBe(true);

    expect(
      canEntitlementUseFeature(
        { planId: SUBSCRIPTION_PLAN_IDS.FREE },
        SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS
      )
    ).toBe(false);

    expect(
      canEntitlementUseFeature(
        {
          planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
          status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING,
          source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TRIAL,
        },
        SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS
      )
    ).toBe(true);
  });

  it("supports feature overrides that grant or revoke access", () => {
    const hobbyWithAnalytics = {
      planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
      featureOverrides: {
        [SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS]: true,
      },
    };

    const labWithoutSales = {
      planId: SUBSCRIPTION_PLAN_IDS.LAB,
      featureOverrides: {
        [SUBSCRIPTION_FEATURE_KEYS.SALES_TRACKING]: false,
      },
    };

    expect(
      getEntitlementFeatureAccess(
        hobbyWithAnalytics,
        SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS
      )
    ).toBe(true);
    expect(
      getEntitlementFeatureAccess(
        labWithoutSales,
        SUBSCRIPTION_FEATURE_KEYS.SALES_TRACKING
      )
    ).toBe(false);
  });

  it("supports finite and unlimited active-grow limit overrides", () => {
    const hobby50 = {
      planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
      limitOverrides: { activeGrows: 50 },
    };
    const freeUnlimited = {
      planId: SUBSCRIPTION_PLAN_IDS.FREE,
      limitOverrides: { activeGrows: null },
    };

    expect(getEntitlementLimit(hobby50, "activeGrows")).toBe(50);
    expect(isWithinEntitlementLimit(hobby50, "activeGrows", 50)).toBe(true);
    expect(isWithinEntitlementLimit(hobby50, "activeGrows", 51)).toBe(false);
    expect(getEntitlementLimit(freeUnlimited, "activeGrows")).toBeNull();
    expect(isWithinEntitlementLimit(freeUnlimited, "activeGrows", 999)).toBe(true);
  });

  it("grants Admin every known feature and unlimited limits", () => {
    const admin = {
      planId: SUBSCRIPTION_PLAN_IDS.ADMIN,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.ADMIN,
    };

    expect(
      canEntitlementUseFeature(admin, SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS)
    ).toBe(true);
    expect(getEntitlementLimit(admin, "activeGrows")).toBeNull();
  });

  it("does not grant features while an entitlement is inactive", () => {
    expect(
      canEntitlementUseFeature(
        {
          planId: SUBSCRIPTION_PLAN_IDS.LAB,
          status: SUBSCRIPTION_ENTITLEMENT_STATUSES.EXPIRED,
        },
        SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING
      )
    ).toBe(false);
  });

  it("builds safe default entitlements with overrides", () => {
    const entitlement = buildDefaultSubscriptionEntitlement({
      planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TESTER_CODE,
      testerCodeId: "server-issued-id",
    });

    expect(entitlement).toMatchObject({
      planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TESTER_CODE,
      testerCodeId: "server-issued-id",
    });
  });

  it("uses Free limits for inactive paid entitlements", () => {
    const expiredLab = {
      planId: SUBSCRIPTION_PLAN_IDS.LAB,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.EXPIRED,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE,
      limitOverrides: { activeGrows: null },
    };

    expect(getEntitlementAccessPlanId(expiredLab)).toBe(SUBSCRIPTION_PLAN_IDS.FREE);
    expect(getEntitlementLimit(expiredLab, "activeGrows")).toBe(6);
  });

  it("honors plan features and overrides during an approved past-due grace period", () => {
    const graceEntitlement = {
      planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.PAST_DUE,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.STRIPE,
      accessGrantedThroughGrace: true,
      featureOverrides: {
        [SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS]: true,
      },
      limitOverrides: { activeGrows: 50 },
    };

    expect(isEntitlementActive(graceEntitlement)).toBe(true);
    expect(
      canEntitlementUseFeature(
        graceEntitlement,
        SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS
      )
    ).toBe(true);
    expect(getEntitlementLimit(graceEntitlement, "activeGrows")).toBe(50);
  });

  it("keeps Admin active even if a stale status value says expired", () => {
    const admin = {
      planId: SUBSCRIPTION_PLAN_IDS.ADMIN,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.EXPIRED,
      source: SUBSCRIPTION_ENTITLEMENT_SOURCES.ADMIN,
    };

    expect(isEntitlementActive(admin)).toBe(true);
    expect(
      canEntitlementUseFeature(admin, SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING)
    ).toBe(true);
    expect(getEntitlementLimit(admin, "activeGrows")).toBeNull();
  });

});
