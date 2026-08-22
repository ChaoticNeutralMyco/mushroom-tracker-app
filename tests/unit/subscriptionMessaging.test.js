// tests/unit/subscriptionMessaging.test.js

import { describe, expect, it } from "vitest";

import {
  getDowngradeSafetyMessage,
  getEntitlementSummaryMessage,
  getFeaturePreviewMessage,
  getLimitReachedMessage,
  getPlanDisplayName,
  getPlanPriceLabel,
  getTrialNoticeMessage,
  getTrialSummaryMessage,
} from "../../src/lib/subscriptionMessaging.js";

import {
  SUBSCRIPTION_ENTITLEMENT_SOURCES,
  SUBSCRIPTION_ENTITLEMENT_STATUSES,
} from "../../src/lib/subscriptionEntitlements.js";

import {
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_PLAN_IDS,
} from "../../src/lib/subscriptionPlans.js";

describe("subscriptionMessaging pure helpers", () => {
  it("returns plan names with legacy and Free fallback behavior", () => {
    expect(getPlanDisplayName(SUBSCRIPTION_PLAN_IDS.CULTIVATOR)).toBe("Cultivator");
    expect(getPlanDisplayName("pro")).toBe("Cultivator");
    expect(getPlanDisplayName("missing")).toBe("Free");
  });

  it("returns honest price labels before paid pricing is approved", () => {
    expect(getPlanPriceLabel(SUBSCRIPTION_PLAN_IDS.FREE)).toBe("$0/mo");
    expect(getPlanPriceLabel(SUBSCRIPTION_PLAN_IDS.HOBBY)).toBe("Pricing TBD");
    expect(getPlanPriceLabel(SUBSCRIPTION_PLAN_IDS.LAB)).toBe("Pricing TBD");
    expect(getPlanPriceLabel(SUBSCRIPTION_PLAN_IDS.ADMIN)).toBe("Internal");
  });

  it("summarizes the approved trial and downgrade rules", () => {
    expect(getTrialSummaryMessage()).toContain("14-day Lab trial");
    expect(getTrialSummaryMessage()).toContain("7 days remaining");
    expect(getDowngradeSafetyMessage()).toContain("Your data is safe");
    expect(getDowngradeSafetyMessage()).toContain("read-only");
    expect(getDowngradeSafetyMessage()).toContain("safety actions");
  });

  it("summarizes default entitlement as Free", () => {
    expect(getEntitlementSummaryMessage()).toBe(
      "Current plan: Free. Status: active. Source: default."
    );
  });

  it("summarizes trial entitlement as Lab access", () => {
    expect(
      getEntitlementSummaryMessage({
        planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
        status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING,
        source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TRIAL,
      })
    ).toBe("Current plan: Trial. Lab trial access is active.");
  });

  it("creates active-grow limit messages", () => {
    expect(
      getLimitReachedMessage({
        planId: SUBSCRIPTION_PLAN_IDS.FREE,
        limitName: "activeGrows",
        limitValue: 6,
      })
    ).toBe(
      "Free includes 6 active grows. Complete or archive an existing item, or upgrade to add another."
    );

    expect(
      getLimitReachedMessage({
        planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
        limitName: "activeGrows",
        limitValue: null,
      })
    ).toBe("Cultivator includes unlimited active grows.");
  });

  it("creates feature messages from the configuration matrix", () => {
    expect(
      getFeaturePreviewMessage({
        planId: SUBSCRIPTION_PLAN_IDS.FREE,
        featureName: SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS,
      })
    ).toBe("SOP workflows is included with Cultivator. Your current plan is Free.");

    expect(
      getFeaturePreviewMessage({
        planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
        featureName: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS,
      })
    ).toBe("Post Processing labels is included with Lab. Your current plan is Cultivator.");
  });

  it("creates warning, ends-today, and expiration notices", () => {
    expect(getTrialNoticeMessage({ phase: "warning", daysRemaining: 7 })).toContain("7 days remaining");
    expect(getTrialNoticeMessage({ phase: "ends_today", daysRemaining: 1 })).toContain("ends today");
    expect(getTrialNoticeMessage({ phase: "expired", daysRemaining: 0 })).toContain("existing data remains safe");
    expect(getTrialNoticeMessage({ phase: "none" })).toBe("");
  });
});
