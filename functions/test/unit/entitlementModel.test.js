// functions/test/unit/entitlementModel.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInitialTrialEntitlement,
  buildTrialWindow,
  entitlementShouldExpire,
  getPastDueGraceWindow,
  hashTesterCode,
  normalizeTesterCode,
} from "../../src/entitlementModel.js";
import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "../../src/subscriptionConfig.js";

test("new accounts receive a fourteen-day trusted Lab trial entitlement", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");
  const entitlement = buildInitialTrialEntitlement({
    accountCreatedAt: now,
    now,
  });

  assert.equal(entitlement.planId, SUBSCRIPTION_PLAN_IDS.TRIAL);
  assert.equal(entitlement.status, SUBSCRIPTION_STATUSES.TRIALING);
  assert.equal(entitlement.source, SUBSCRIPTION_SOURCES.TRIAL);
  assert.equal(entitlement.trialStartedAt.toISOString(), now.toISOString());
  assert.equal(
    entitlement.trialEndsAt.toISOString(),
    "2026-08-11T12:00:00.000Z"
  );
});

test("older accounts use the rollout anchor instead of resetting a fresh trial", () => {
  const window = buildTrialWindow({
    accountCreatedAt: "2025-01-01T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  assert.equal(window.trialStartedAt.toISOString(), "2026-07-26T00:00:00.000Z");
  assert.equal(window.trialEndsAt.toISOString(), "2026-08-09T00:00:00.000Z");
});

test("a missing old entitlement becomes an expired trial when its server window is over", () => {
  const entitlement = buildInitialTrialEntitlement({
    accountCreatedAt: "2025-01-01T00:00:00.000Z",
    now: "2026-08-10T00:00:00.000Z",
  });

  assert.equal(entitlement.status, SUBSCRIPTION_STATUSES.EXPIRED);
});

test("past-due grace is exactly three days", () => {
  const grace = getPastDueGraceWindow("2026-07-28T00:00:00.000Z");
  assert.equal(grace.pastDueStartedAt.toISOString(), "2026-07-28T00:00:00.000Z");
  assert.equal(grace.graceEndsAt.toISOString(), "2026-07-31T00:00:00.000Z");
});

test("tester codes are normalized and stored only as deterministic hashes", () => {
  assert.equal(normalizeTesterCode("  cnm vet beta  "), "CNM-VET-BETA");
  assert.equal(
    hashTesterCode("cnm vet beta"),
    hashTesterCode("CNM-VET-BETA")
  );
  assert.match(hashTesterCode("CNM-VET-BETA"), /^[a-f0-9]{64}$/);
});

test("the expiration classifier covers trial, grace, and tester-code periods", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");

  assert.equal(
    entitlementShouldExpire(
      {
        status: SUBSCRIPTION_STATUSES.TRIALING,
        trialEndsAt: "2026-07-31T00:00:00.000Z",
      },
      now
    ),
    true
  );

  assert.equal(
    entitlementShouldExpire(
      {
        status: SUBSCRIPTION_STATUSES.PAST_DUE,
        graceEndsAt: "2026-08-02T00:00:00.000Z",
      },
      now
    ),
    false
  );

  assert.equal(
    entitlementShouldExpire(
      {
        status: SUBSCRIPTION_STATUSES.ACTIVE,
        source: SUBSCRIPTION_SOURCES.TESTER_CODE,
        currentPeriodEndsAt: "2026-07-31T00:00:00.000Z",
      },
      now
    ),
    true
  );
});
