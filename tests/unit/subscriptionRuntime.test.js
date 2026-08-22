// tests/unit/subscriptionRuntime.test.js

import { describe, expect, it } from "vitest";

import {
  buildLoadingSubscriptionRuntime,
  buildMissingSubscriptionRuntime,
  buildSubscriptionRuntimeSummary,
  buildUnavailableSubscriptionRuntime,
  classifyStoredEntitlement,
  getDefaultTrialStartDate,
  getPastDueGraceState,
  hasUsableStoredEntitlement,
  resolveSubscriptionRuntime,
} from "../../src/lib/subscriptionRuntime.js";
import {
  buildDefaultSubscriptionEntitlement,
  canEntitlementUseFeature,
  getEntitlementLimit,
} from "../../src/lib/subscriptionEntitlements.js";
import { buildTrialEntitlement } from "../../src/lib/subscriptionTrial.js";
import {
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_PLAN_IDS,
} from "../../src/lib/subscriptionPlans.js";

describe("subscription runtime resolution", () => {
  it("starts existing accounts at the rollout date", () => {
    expect(
      getDefaultTrialStartDate({
        accountCreatedAt: "2024-01-01T00:00:00.000Z",
        rolloutStartedAt: "2026-07-26T00:00:00.000Z",
      }).toISOString()
    ).toBe("2026-07-26T00:00:00.000Z");
  });

  it("starts newer accounts at account creation", () => {
    expect(
      getDefaultTrialStartDate({
        accountCreatedAt: "2026-08-01T12:00:00.000Z",
        rolloutStartedAt: "2026-07-26T00:00:00.000Z",
      }).toISOString()
    ).toBe("2026-08-01T12:00:00.000Z");
  });

  it("uses a fail-closed Free runtime while the entitlement is loading", () => {
    expect(buildLoadingSubscriptionRuntime()).toMatchObject({
      accessReady: false,
      entitlementExists: false,
      resolution: "entitlement-loading-free-fallback",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.FREE },
      sourceEntitlement: null,
    });
  });

  it("classifies missing, malformed, and usable entitlement snapshots", () => {
    expect(classifyStoredEntitlement(null, false)).toBe("missing");
    expect(classifyStoredEntitlement({}, true)).toBe("malformed");
    expect(
      classifyStoredEntitlement(
        { planId: "not-real", status: "active", source: "stripe" },
        true
      )
    ).toBe("malformed");
    expect(
      classifyStoredEntitlement(
        { planId: "lab", status: "active", source: "stripe" },
        true
      )
    ).toBe("usable");
  });

  it("does not turn a malformed existing entitlement into a new trial", () => {
    const runtime = resolveSubscriptionRuntime({
      storedEntitlement: { planId: "not-real", status: "active" },
      entitlementExists: true,
      accountCreatedAt: "2024-01-01T00:00:00.000Z",
      now: new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(runtime).toMatchObject({
      accessReady: true,
      entitlementExists: true,
      resolution: "malformed-entitlement-free-fallback",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.FREE },
      trialEntitlement: null,
    });
  });

  it("treats an empty entitlement document as malformed existing data", () => {
    expect(hasUsableStoredEntitlement({}, true)).toBe(false);

    const runtime = resolveSubscriptionRuntime({
      storedEntitlement: {},
      entitlementExists: true,
      accountCreatedAt: "2024-01-01T00:00:00.000Z",
      now: new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(runtime).toMatchObject({
      entitlementExists: true,
      resolution: "malformed-entitlement-free-fallback",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.FREE },
    });
  });

  it("uses a fail-closed Free fallback when entitlement reads are unavailable", () => {
    expect(buildUnavailableSubscriptionRuntime()).toMatchObject({
      accessReady: true,
      entitlementExists: false,
      resolution: "entitlement-unavailable-free-fallback",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.FREE },
      trialEntitlement: null,
    });
  });

  it("defaults a genuinely missing entitlement to an active Lab trial", () => {
    const runtime = buildMissingSubscriptionRuntime({
      accountCreatedAt: "2024-01-01T00:00:00.000Z",
      now: new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(runtime).toMatchObject({
      accessReady: true,
      entitlementExists: false,
      resolution: "missing-trial",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.TRIAL },
      trialEntitlement: { planId: SUBSCRIPTION_PLAN_IDS.TRIAL },
    });
  });

  it("falls back to Free after a missing-account trial expires", () => {
    const runtime = buildMissingSubscriptionRuntime({
      accountCreatedAt: "2024-01-01T00:00:00.000Z",
      now: new Date("2026-08-10T00:00:01.000Z"),
    });

    expect(runtime).toMatchObject({
      entitlementExists: false,
      resolution: "missing-expired-trial-fallback",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.FREE },
      trialEntitlement: { planId: SUBSCRIPTION_PLAN_IDS.TRIAL },
    });
  });

  it("uses a connected active paid entitlement without changing it", () => {
    const storedEntitlement = buildDefaultSubscriptionEntitlement({
      planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      source: "stripe",
    });
    const runtime = resolveSubscriptionRuntime({
      storedEntitlement,
      entitlementExists: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });

    expect(runtime).toMatchObject({
      accessReady: true,
      entitlementExists: true,
      resolution: "stored-entitlement",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR },
      trialEntitlement: null,
    });
  });

  it("falls back to Free for an expired stored trial while preserving trial history", () => {
    const storedEntitlement = buildTrialEntitlement(
      new Date("2026-07-01T00:00:00.000Z")
    );
    const runtime = resolveSubscriptionRuntime({
      storedEntitlement,
      entitlementExists: true,
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(runtime).toMatchObject({
      entitlementExists: true,
      resolution: "stored-expired-trial-fallback",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.FREE },
      sourceEntitlement: { planId: SUBSCRIPTION_PLAN_IDS.TRIAL },
    });
  });

  it.each(["expired", "canceled"])(
    "falls back to Free for a %s paid entitlement",
    (status) => {
      const runtime = resolveSubscriptionRuntime({
        storedEntitlement: {
          planId: SUBSCRIPTION_PLAN_IDS.LAB,
          status,
          source: "stripe",
          limitOverrides: { activeGrows: null },
        },
        entitlementExists: true,
        now: new Date("2026-08-10T00:00:00.000Z"),
      });

      expect(runtime).toMatchObject({
        resolution: `stored-${status}-free-fallback`,
        entitlement: { planId: SUBSCRIPTION_PLAN_IDS.FREE },
        sourceEntitlement: { planId: SUBSCRIPTION_PLAN_IDS.LAB, status },
      });
      expect(getEntitlementLimit(runtime.entitlement, "activeGrows")).toBe(6);
      expect(
        canEntitlementUseFeature(
          runtime.entitlement,
          SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING
        )
      ).toBe(false);
    }
  );

  it("keeps paid access during the approved three-day past-due grace period", () => {
    const storedEntitlement = {
      planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      status: "past_due",
      source: "stripe",
      pastDueStartedAt: "2026-08-10T12:00:00.000Z",
      featureOverrides: {
        [SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING]: true,
      },
      limitOverrides: { activeGrows: 50 },
    };
    const runtime = resolveSubscriptionRuntime({
      storedEntitlement,
      entitlementExists: true,
      now: new Date("2026-08-12T11:59:59.000Z"),
    });

    expect(runtime).toMatchObject({
      resolution: "stored-past-due-grace",
      entitlement: {
        planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
        status: "past_due",
        accessGrantedThroughGrace: true,
      },
      grace: { withinGrace: true, graceDaysRemaining: 2 },
    });
    expect(getEntitlementLimit(runtime.entitlement, "activeGrows")).toBe(50);
    expect(
      canEntitlementUseFeature(
        runtime.entitlement,
        SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING
      )
    ).toBe(true);
  });

  it("falls back to Free when the past-due grace period ends", () => {
    const runtime = resolveSubscriptionRuntime({
      storedEntitlement: {
        planId: SUBSCRIPTION_PLAN_IDS.LAB,
        status: "past_due",
        source: "stripe",
        pastDueStartedAt: "2026-08-10T12:00:00.000Z",
      },
      entitlementExists: true,
      now: new Date("2026-08-13T12:00:00.000Z"),
    });

    expect(runtime).toMatchObject({
      resolution: "stored-past-due-free-fallback",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.FREE },
      grace: { withinGrace: false, graceDaysRemaining: 0 },
    });
  });

  it("fails closed when a past-due entitlement has no trusted grace anchor", () => {
    const runtime = resolveSubscriptionRuntime({
      storedEntitlement: {
        planId: SUBSCRIPTION_PLAN_IDS.LAB,
        status: "past_due",
        source: "stripe",
      },
      entitlementExists: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });

    expect(runtime).toMatchObject({
      resolution: "stored-past-due-missing-anchor-free-fallback",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.FREE },
      grace: { hasTrustedStart: false, withinGrace: false },
    });
  });

  it("calculates explicit past-due grace timestamps", () => {
    const state = getPastDueGraceState(
      {
        planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
        status: "past_due",
        source: "stripe",
        graceEndsAt: "2026-08-20T00:00:00.000Z",
        pastDueStartedAt: "2026-08-17T00:00:00.000Z",
      },
      new Date("2026-08-18T00:00:00.000Z")
    );

    expect(state).toMatchObject({
      isPastDue: true,
      hasTrustedStart: true,
      withinGrace: true,
      graceDaysRemaining: 2,
    });
    expect(state.graceEndsAt.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("keeps Admin access independent of paid-plan status fallbacks", () => {
    const runtime = resolveSubscriptionRuntime({
      storedEntitlement: {
        planId: SUBSCRIPTION_PLAN_IDS.ADMIN,
        status: "expired",
        source: "admin",
      },
      entitlementExists: true,
    });

    expect(runtime).toMatchObject({
      resolution: "stored-admin-entitlement",
      entitlement: { planId: SUBSCRIPTION_PLAN_IDS.ADMIN },
    });
    expect(getEntitlementLimit(runtime.entitlement, "activeGrows")).toBeNull();
  });

  it("summarizes active-grow usage and grace state", () => {
    const entitlement = buildDefaultSubscriptionEntitlement({
      planId: SUBSCRIPTION_PLAN_IDS.FREE,
    });
    const summary = buildSubscriptionRuntimeSummary({
      entitlement,
      sourceEntitlement: entitlement,
      activeGrowCount: 7,
      grace: { isPastDue: true, withinGrace: false, graceDaysRemaining: 0 },
      accessReady: true,
    });

    expect(summary).toMatchObject({
      planId: SUBSCRIPTION_PLAN_IDS.FREE,
      accessReady: true,
      activeGrowLimit: 6,
      activeGrowCount: 7,
      activeGrowLimitReached: true,
      activeGrowLimitExceeded: true,
      isPastDue: true,
      inPastDueGrace: false,
    });
  });
});
