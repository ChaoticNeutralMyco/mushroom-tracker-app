// functions/test/unit/growService.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  isActiveGrowDocument,
  resolveEffectiveActiveGrowLimit,
  resolveEffectiveGrowAccessPlan,
} from "../../src/growService.js";
import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "../../src/subscriptionConfig.js";

test("backend active-grow classification matches cultivation lifecycle rules", () => {
  assert.equal(
    isActiveGrowDocument({
      status: "Active",
      stage: "Colonizing",
    }),
    true
  );
  assert.equal(
    isActiveGrowDocument({
      status: "Stored",
      stage: "Colonized",
    }),
    false
  );
  assert.equal(
    isActiveGrowDocument({
      status: "Active",
      stage: "Harvested",
    }),
    false
  );
  assert.equal(
    isActiveGrowDocument({
      status: "Active",
      stage: "Colonized",
      amountTotal: 10,
      amountUsed: 10,
    }),
    false
  );
});

test("Free and Hobby use finite limits while Cultivator, Lab, Trial, and Admin are unlimited", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");

  assert.equal(
    resolveEffectiveActiveGrowLimit({
      planId: SUBSCRIPTION_PLAN_IDS.FREE,
      status: SUBSCRIPTION_STATUSES.ACTIVE,
    }, now).limit,
    6
  );
  assert.equal(
    resolveEffectiveActiveGrowLimit({
      planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
      status: SUBSCRIPTION_STATUSES.ACTIVE,
    }, now).limit,
    30
  );

  for (const planId of [
    SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
    SUBSCRIPTION_PLAN_IDS.LAB,
    SUBSCRIPTION_PLAN_IDS.ADMIN,
  ]) {
    assert.equal(
      resolveEffectiveActiveGrowLimit({
        planId,
        status: SUBSCRIPTION_STATUSES.ACTIVE,
      }, now).limit,
      null
    );
  }

  assert.equal(
    resolveEffectiveActiveGrowLimit({
      planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
      status: SUBSCRIPTION_STATUSES.TRIALING,
      trialEndsAt: new Date("2026-08-02T00:00:00.000Z"),
    }, now).limit,
    null
  );
});

test("trusted active-grow overrides support finite custom limits and unlimited access", () => {
  const finite = resolveEffectiveActiveGrowLimit({
    planId: SUBSCRIPTION_PLAN_IDS.FREE,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    limitOverrides: { activeGrows: 42 },
  });
  assert.equal(finite.limit, 42);
  assert.equal(finite.source, "override");

  const unlimited = resolveEffectiveActiveGrowLimit({
    planId: SUBSCRIPTION_PLAN_IDS.FREE,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    limitOverrides: { activeGrows: null },
  });
  assert.equal(unlimited.limit, null);
  assert.equal(unlimited.source, "override");
});

test("expired, canceled, and expired tester entitlements fall back to Free without stale overrides", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");

  for (const entitlement of [
    {
      planId: SUBSCRIPTION_PLAN_IDS.LAB,
      status: SUBSCRIPTION_STATUSES.EXPIRED,
      limitOverrides: { activeGrows: null },
    },
    {
      planId: SUBSCRIPTION_PLAN_IDS.LAB,
      status: SUBSCRIPTION_STATUSES.CANCELED,
      limitOverrides: { activeGrows: 99 },
    },
    {
      planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      status: SUBSCRIPTION_STATUSES.ACTIVE,
      source: SUBSCRIPTION_SOURCES.TESTER_CODE,
      currentPeriodEndsAt: new Date("2026-08-09T00:00:00.000Z"),
      limitOverrides: { activeGrows: null },
    },
  ]) {
    const resolved = resolveEffectiveActiveGrowLimit(entitlement, now);
    assert.equal(resolved.planId, SUBSCRIPTION_PLAN_IDS.FREE);
    assert.equal(resolved.limit, 6);
    assert.equal(resolved.source, "plan");
  }
});

test("past-due access remains paid only inside its trusted three-day grace window", () => {
  const entitlement = {
    planId: SUBSCRIPTION_PLAN_IDS.LAB,
    status: SUBSCRIPTION_STATUSES.PAST_DUE,
    pastDueStartedAt: new Date("2026-08-01T00:00:00.000Z"),
  };

  assert.equal(
    resolveEffectiveGrowAccessPlan(
      entitlement,
      new Date("2026-08-03T23:59:59.000Z")
    ).planId,
    SUBSCRIPTION_PLAN_IDS.LAB
  );

  assert.equal(
    resolveEffectiveGrowAccessPlan(
      entitlement,
      new Date("2026-08-04T00:00:00.000Z")
    ).planId,
    SUBSCRIPTION_PLAN_IDS.FREE
  );
});
