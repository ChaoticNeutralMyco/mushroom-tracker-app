// tests/unit/subscriptionPlans.test.js

import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_BILLING_CONFIG,
  SUBSCRIPTION_CONFIG_VERSION,
  SUBSCRIPTION_DOWNGRADE_POLICY,
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_FEATURE_LIST,
  SUBSCRIPTION_LIMIT_KEYS,
  SUBSCRIPTION_PLAN_ALIASES,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLAN_ORDER,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_SECURITY_NOTES,
  SUBSCRIPTION_TESTER_CODE_POLICY,
  SUBSCRIPTION_TRIAL_CONFIG,
} from "../../src/lib/subscriptionPlans.js";

describe("subscriptionPlans live entitlement foundation", () => {
  it("uses the approved live-entitlement config version", () => {
    expect(SUBSCRIPTION_CONFIG_VERSION).toBe("2026-07-27-environmental-access-v5");
  });

  it("defines four public plans plus internal trial and admin plans", () => {
    expect(SUBSCRIPTION_PLAN_ORDER).toEqual([
      SUBSCRIPTION_PLAN_IDS.FREE,
      SUBSCRIPTION_PLAN_IDS.HOBBY,
      SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      SUBSCRIPTION_PLAN_IDS.LAB,
    ]);

    expect(SUBSCRIPTION_PLAN_ORDER).not.toContain(SUBSCRIPTION_PLAN_IDS.TRIAL);
    expect(SUBSCRIPTION_PLAN_ORDER).not.toContain(SUBSCRIPTION_PLAN_IDS.ADMIN);
    expect(SUBSCRIPTION_PLAN_IDS.PRO).toBeUndefined();
  });

  it("maps the legacy Pro plan id to Cultivator", () => {
    expect(SUBSCRIPTION_PLAN_ALIASES.pro).toBe(SUBSCRIPTION_PLAN_IDS.CULTIVATOR);
  });

  it("defines every current plan exactly once", () => {
    const ids = Object.values(SUBSCRIPTION_PLAN_IDS);
    expect(new Set(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect(SUBSCRIPTION_PLANS[id]).toBeTruthy();
      expect(SUBSCRIPTION_PLANS[id].id).toBe(id);
    }
  });

  it("stores a complete boolean feature matrix for every plan", () => {
    for (const plan of Object.values(SUBSCRIPTION_PLANS)) {
      expect(Object.keys(plan.features).sort()).toEqual(
        [...SUBSCRIPTION_FEATURE_LIST].sort()
      );

      for (const featureKey of SUBSCRIPTION_FEATURE_LIST) {
        expect(typeof plan.features[featureKey]).toBe("boolean");
      }
    }
  });

  it("gives Free and Hobby identical features with different active-grow limits", () => {
    const free = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.FREE];
    const hobby = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.HOBBY];

    expect(free.features).toEqual(hobby.features);
    expect(free.limits[SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS]).toBe(6);
    expect(hobby.limits[SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS]).toBe(30);
  });

  it("includes grow labels in every public tier", () => {
    for (const planId of SUBSCRIPTION_PLAN_ORDER) {
      expect(
        SUBSCRIPTION_PLANS[planId].features[
          SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS
        ]
      ).toBe(true);
    }
  });

  it("keeps environmental tracking available in every public tier", () => {
    expect(SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ENVIRONMENTAL_CONTROLS).toBeUndefined();
    expect(SUBSCRIPTION_FEATURE_LIST).not.toContain("advancedEnvironmentalControls");

    for (const planId of SUBSCRIPTION_PLAN_ORDER) {
      expect(
        SUBSCRIPTION_PLANS[planId].features[
          SUBSCRIPTION_FEATURE_KEYS.ENVIRONMENTAL_TRACKING
        ]
      ).toBe(true);
    }
  });

  it("starts SOP workflows and advanced analytics at Cultivator", () => {
    const free = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.FREE];
    const hobby = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.HOBBY];
    const cultivator = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.CULTIVATOR];
    const lab = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.LAB];

    expect(free.features[SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS]).toBe(false);
    expect(hobby.features[SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS]).toBe(false);
    expect(cultivator.features[SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS]).toBe(true);
    expect(cultivator.features[SUBSCRIPTION_FEATURE_KEYS.SOP_GENERATED_TASKS]).toBe(true);
    expect(cultivator.features[SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS]).toBe(true);
    expect(lab.features[SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS]).toBe(true);
    expect(cultivator.limits[SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS]).toBeNull();
  });

  it("keeps operational workflows and post-processing labels Lab-only", () => {
    const cultivator = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.CULTIVATOR];
    const lab = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.LAB];

    for (const featureKey of [
      SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING,
      SUBSCRIPTION_FEATURE_KEYS.FINISHED_INVENTORY,
      SUBSCRIPTION_FEATURE_KEYS.PACKAGE_RUNS,
      SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS,
      SUBSCRIPTION_FEATURE_KEYS.SALES_TRACKING,
      SUBSCRIPTION_FEATURE_KEYS.FEFO_CONTROLS,
      SUBSCRIPTION_FEATURE_KEYS.FINAL_DISPOSITION,
      SUBSCRIPTION_FEATURE_KEYS.INVENTORY_AUDIT_HISTORY,
      SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
    ]) {
      expect(cultivator.features[featureKey]).toBe(false);
      expect(lab.features[featureKey]).toBe(true);
    }
  });

  it("configures a fourteen-day Lab trial with daily notices starting at seven days", () => {
    expect(SUBSCRIPTION_TRIAL_CONFIG).toMatchObject({
      enabled: true,
      durationDays: 14,
      existingAccountTrialStartsAt: "2026-07-26T00:00:00.000Z",
      grantsPlanId: SUBSCRIPTION_PLAN_IDS.LAB,
      expirationFallbackPlanId: SUBSCRIPTION_PLAN_IDS.FREE,
      reminderStartsDaysRemaining: 7,
      reminderCadenceDays: 1,
      requiresDailyDismissal: true,
      dismissalScope: "account-calendar-date",
      upgradeActionEnabled: true,
      deleteDataAtExpiration: false,
    });

    const trial = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.TRIAL];
    expect(trial.internalOnly).toBe(true);
    expect(trial.durationDays).toBe(14);
    expect(trial.accessPlanId).toBe(SUBSCRIPTION_PLAN_IDS.LAB);
    expect(trial.adminTools).toBe(false);
    expect(trial.features).toEqual(SUBSCRIPTION_PLANS.lab.features);
  });

  it("keeps paid-plan prices configurable until pricing is approved", () => {
    for (const planId of [
      SUBSCRIPTION_PLAN_IDS.HOBBY,
      SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      SUBSCRIPTION_PLAN_IDS.LAB,
    ]) {
      expect(SUBSCRIPTION_PLANS[planId]).toMatchObject({
        billingType: "paid",
        priceMonthlyUsd: null,
        pricingStatus: "tbd",
      });
    }
  });

  it("keeps tester codes out of client-side entitlement logic", () => {
    expect(SUBSCRIPTION_TESTER_CODE_POLICY).toEqual({
      enabled: true,
      publicExamplesExposed: false,
      redemptionRequiresTrustedBackend: true,
      clientMayGrantEntitlements: false,
      clientMayValidateCodes: false,
    });
  });

  it("keeps downgrade behavior non-destructive and safety-aware", () => {
    expect(SUBSCRIPTION_DOWNGRADE_POLICY).toMatchObject({
      deleteDataOnDowngrade: false,
      allowFullDataExport: true,
      restrictedRecordsState: "read-only",
      blockNewRestrictedRecords: true,
      allowExistingWorkflowCompletion: true,
      allowSafetyAndDispositionActions: true,
      blockCreateOrReactivateAboveActiveGrowLimit: true,
    });
  });

  it("states that React gating is UX only", () => {
    expect(SUBSCRIPTION_SECURITY_NOTES.reactGatingIsUxOnly).toBe(true);
    expect(SUBSCRIPTION_SECURITY_NOTES.futureEnforcement).toContain("Cloud Functions");
    expect(SUBSCRIPTION_SECURITY_NOTES.futureEnforcement).toContain("Stripe webhooks");
    expect(SUBSCRIPTION_SECURITY_NOTES.doNotUseAsSecuritySource).toContain("localStorage");
  });

  it("configures a three-day trusted past-due grace period", () => {
    expect(SUBSCRIPTION_BILLING_CONFIG).toMatchObject({
      inactiveFallbackPlanId: SUBSCRIPTION_PLAN_IDS.FREE,
      pastDueGraceDays: 3,
      pastDueGraceMilliseconds: 259200000,
      pastDueRequiresTrustedStart: true,
      preserveRecordsOnDowngrade: true,
      deleteDataOnPlanEnd: false,
    });
  });

});
