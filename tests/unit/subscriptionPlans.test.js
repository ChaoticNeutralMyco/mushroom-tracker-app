// tests/unit/subscriptionPlans.test.js

import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_CONFIG_VERSION,
  SUBSCRIPTION_DOWNGRADE_POLICY,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLAN_ORDER,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_SECURITY_NOTES,
  SUBSCRIPTION_TRIAL_CONFIG,
  TESTER_CODE_EXAMPLES,
} from "../../src/lib/subscriptionPlans.js";

describe("subscriptionPlans static config", () => {
  it("has a stable planning config version", () => {
    expect(SUBSCRIPTION_CONFIG_VERSION).toBe("2026-05-23-planning-v1");
  });

  it("defines every plan id exactly once", () => {
    const ids = Object.values(SUBSCRIPTION_PLAN_IDS);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);

    for (const id of ids) {
      expect(SUBSCRIPTION_PLANS[id]).toBeTruthy();
      expect(SUBSCRIPTION_PLANS[id].id).toBe(id);
    }
  });

  it("keeps public paid plan order separate from trial and admin", () => {
    expect(SUBSCRIPTION_PLAN_ORDER).toEqual([
      SUBSCRIPTION_PLAN_IDS.FREE,
      SUBSCRIPTION_PLAN_IDS.HOBBY,
      SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      SUBSCRIPTION_PLAN_IDS.PRO,
      SUBSCRIPTION_PLAN_IDS.LAB,
    ]);

    expect(SUBSCRIPTION_PLAN_ORDER).not.toContain(SUBSCRIPTION_PLAN_IDS.TRIAL);
    expect(SUBSCRIPTION_PLAN_ORDER).not.toContain(SUBSCRIPTION_PLAN_IDS.ADMIN);
  });

  it("matches the planned trial rules", () => {
    expect(SUBSCRIPTION_TRIAL_CONFIG.enabled).toBe(true);
    expect(SUBSCRIPTION_TRIAL_CONFIG.durationDays).toBe(7);
    expect(SUBSCRIPTION_TRIAL_CONFIG.fullAccess).toBe(true);
    expect(SUBSCRIPTION_TRIAL_CONFIG.adminFeaturesIncluded).toBe(false);
    expect(SUBSCRIPTION_TRIAL_CONFIG.blockingModalAllowed).toBe(false);

    const trial = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.TRIAL];
    expect(trial.durationDays).toBe(7);
    expect(trial.features.fullAccess).toBe(true);
    expect(trial.features.adminTools).toBe(false);
  });

  it("matches the planned free tier limits", () => {
    const free = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.FREE];

    expect(free.priceMonthlyUsd).toBe(0);
    expect(free.limits).toEqual({
      activeGrows: 5,
      recipes: 3,
      supplies: 10,
    });
    expect(free.features.cogLite).toBe(true);
    expect(free.features.rawDataExport).toBe(true);
  });

  it("matches the planned paid tier prices and active grow limits", () => {
    expect(SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.HOBBY]).toMatchObject({
      priceMonthlyUsd: 4.99,
      limits: { activeGrows: 15, recipes: 15, supplies: 50 },
    });

    expect(SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.CULTIVATOR]).toMatchObject({
      priceMonthlyUsd: 9.99,
      limits: { activeGrows: 50, recipes: null, supplies: null },
    });

    expect(SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.PRO]).toMatchObject({
      priceMonthlyUsd: 19.99,
      limits: { activeGrows: 150, recipes: null, supplies: null },
    });

    expect(SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.LAB]).toMatchObject({
      priceMonthlyUsd: 39.99,
      limits: { activeGrows: 500, recipes: null, supplies: null },
    });
  });

  it("keeps admin internal only and unlimited", () => {
    const admin = SUBSCRIPTION_PLANS[SUBSCRIPTION_PLAN_IDS.ADMIN];

    expect(admin.internalOnly).toBe(true);
    expect(admin.priceMonthlyUsd).toBeNull();
    expect(admin.limits).toEqual({
      activeGrows: null,
      recipes: null,
      supplies: null,
    });
    expect(admin.features.adminTools).toBe(true);
  });

  it("documents tester code examples without making them security logic", () => {
    expect(TESTER_CODE_EXAMPLES).toEqual([
      expect.objectContaining({
        code: "CNM-JUNE-TESTER",
        grantsPlanId: SUBSCRIPTION_PLAN_IDS.PRO,
        durationDays: 30,
      }),
      expect.objectContaining({
        code: "CNM-FOUNDER-2026",
        grantsPlanId: SUBSCRIPTION_PLAN_IDS.LAB,
        durationDays: 365,
      }),
      expect.objectContaining({
        code: "CNM-VET-BETA",
        grantsPlanId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
        durationDays: 90,
      }),
    ]);
  });

  it("keeps downgrade policy non-destructive", () => {
    expect(SUBSCRIPTION_DOWNGRADE_POLICY.deleteDataOnDowngrade).toBe(false);
    expect(SUBSCRIPTION_DOWNGRADE_POLICY.allowFullDataExport).toBe(true);
    expect(SUBSCRIPTION_DOWNGRADE_POLICY.extraDataState).toBe("archived-read-only");
    expect(SUBSCRIPTION_DOWNGRADE_POLICY.messagingTone).toBe("your-data-is-safe");
  });

  it("states that React gating is UX only", () => {
    expect(SUBSCRIPTION_SECURITY_NOTES.reactGatingIsUxOnly).toBe(true);
    expect(SUBSCRIPTION_SECURITY_NOTES.futureEnforcement).toContain("Cloud Functions");
    expect(SUBSCRIPTION_SECURITY_NOTES.futureEnforcement).toContain("Stripe webhooks");
    expect(SUBSCRIPTION_SECURITY_NOTES.doNotUseAsSecuritySource).toContain("localStorage");
    expect(SUBSCRIPTION_SECURITY_NOTES.doNotUseAsSecuritySource).toContain("React state");
  });
});
