// functions/test/unit/cancellationAtPeriodEnd.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  entitlementShouldExpire,
  getExpirationReason,
} from "../../src/entitlementModel.js";
import {
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "../../src/subscriptionConfig.js";

test("scheduled Stripe cancellation expires exactly at the trusted paid-through boundary", () => {
  const entitlement = {
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    source: SUBSCRIPTION_SOURCES.STRIPE,
    cancelAtPeriodEnd: true,
    currentPeriodEndsAt: "2026-09-22T12:00:00.000Z",
    cancellationEffectiveAt: "2026-09-22T12:00:00.000Z",
  };

  assert.equal(
    entitlementShouldExpire(entitlement, "2026-09-22T11:59:59.999Z"),
    false
  );
  assert.equal(
    entitlementShouldExpire(entitlement, "2026-09-22T12:00:00.000Z"),
    true
  );
  assert.equal(
    getExpirationReason(entitlement),
    "stripe_cancellation_period_ended"
  );
});

test("ordinary active Stripe renewals do not expire only because a period end passes", () => {
  const entitlement = {
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    source: SUBSCRIPTION_SOURCES.STRIPE,
    cancelAtPeriodEnd: false,
    currentPeriodEndsAt: "2026-09-22T12:00:00.000Z",
  };

  assert.equal(
    entitlementShouldExpire(entitlement, "2026-09-23T12:00:00.000Z"),
    false
  );
});
