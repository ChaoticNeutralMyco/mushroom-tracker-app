// tests/unit/subscriptionMessaging.test.js

import { describe, expect, it } from "vitest";

import {
  getDowngradeSafetyMessage,
  getEntitlementSummaryMessage,
  getFeaturePreviewMessage,
  getLimitReachedMessage,
  getPlanDisplayName,
  getPlanPriceLabel,
  getTrialSummaryMessage,
} from "../../src/lib/subscriptionMessaging.js";

import {
  SUBSCRIPTION_ENTITLEMENT_SOURCES,
  SUBSCRIPTION_ENTITLEMENT_STATUSES,
} from "../../src/lib/subscriptionEntitlements.js";

import { SUBSCRIPTION_PLAN_IDS } from "../../src/lib/subscriptionPlans.js";

describe("subscriptionMessaging pure helpers", () => {
  it("returns plan names with Free fallback", () => {
    expect(getPlanDisplayName(SUBSCRIPTION_PLAN_IDS.PRO)).toBe("Pro");
    expect(getPlanDisplayName("missing")).toBe("Free");
  });

  it("returns price labels", () => {
    expect(getPlanPriceLabel(SUBSCRIPTION_PLAN_IDS.FREE)).toBe("$0/mo");
    expect(getPlanPriceLabel(SUBSCRIPTION_PLAN_IDS.HOBBY)).toBe("$4.99/mo");
    expect(getPlanPriceLabel(SUBSCRIPTION_PLAN_IDS.ADMIN)).toBe("Internal");
    expect(getPlanPriceLabel("missing")).toBe("Unavailable");
  });

  it("returns trial and downgrade safety messages", () => {
    expect(getTrialSummaryMessage()).toContain("7-day full-access trial");
    expect(getDowngradeSafetyMessage()).toContain("Your data is safe");
    expect(getDowngradeSafetyMessage()).toContain("read-only");
  });

  it("summarizes default entitlement as Free", () => {
    expect(getEntitlementSummaryMessage()).toBe(
      "Current plan: Free. Status: active. Source: default."
    );
  });

  it("summarizes trial entitlement specially", () => {
    expect(
      getEntitlementSummaryMessage({
        planId: SUBSCRIPTION_PLAN_IDS.PRO,
        status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING,
        source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TRIAL,
      })
    ).toBe("Current plan: Pro trial. Trial access is active.");
  });

  it("creates limit reached messages", () => {
    expect(
      getLimitReachedMessage({
        planId: SUBSCRIPTION_PLAN_IDS.FREE,
        limitName: "activeGrows",
        limitValue: 5,
      })
    ).toBe("Free includes 5 active grows. Upgrade later to unlock more capacity.");

    expect(
      getLimitReachedMessage({
        planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
        limitName: "recipes",
        limitValue: null,
      })
    ).toBe("Cultivator includes unlimited recipes.");
  });

  it("creates feature preview messages", () => {
    expect(
      getFeaturePreviewMessage({
        planId: SUBSCRIPTION_PLAN_IDS.FREE,
        featureName: "fullCogBreakdown",
        requiredPlanId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      })
    ).toBe("full cog breakdown is planned for Cultivator. Your current plan is Free.");
  });
});
