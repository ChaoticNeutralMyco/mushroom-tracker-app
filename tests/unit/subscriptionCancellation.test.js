// tests/unit/subscriptionCancellation.test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getSubscriptionPlanBillingAction,
  isStripeCancellationScheduled,
} from "../../src/lib/subscriptionBilling.js";

const subscriptionPageSource = readFileSync(
  fileURLToPath(new URL("../../src/pages/SubscriptionPage.jsx", import.meta.url)),
  "utf8"
);

const scheduledStripeEntitlement = {
  planId: "lab",
  status: "active",
  source: "stripe",
  stripeCustomerId: "cus_cancel_test",
  stripeSubscriptionId: "sub_cancel_test",
  currentPeriodEndsAt: "2026-09-22T12:00:00.000Z",
  cancellationEffectiveAt: "2026-09-22T12:00:00.000Z",
  cancelAtPeriodEnd: true,
};

describe("cancel-at-period-end subscription behavior", () => {
  it("recognizes a trusted active Stripe subscription scheduled to cancel", () => {
    expect(isStripeCancellationScheduled(scheduledStripeEntitlement)).toBe(true);

    expect(
      isStripeCancellationScheduled({
        ...scheduledStripeEntitlement,
        cancelAtPeriodEnd: false,
      })
    ).toBe(false);

    expect(
      isStripeCancellationScheduled({
        ...scheduledStripeEntitlement,
        source: "trial",
      })
    ).toBe(false);
  });

  it("keeps the billing portal available so a scheduled cancellation can be managed or reversed", () => {
    expect(
      getSubscriptionPlanBillingAction({
        planId: "lab",
        currentPlanId: "lab",
        sourceEntitlement: scheduledStripeEntitlement,
        accessReady: true,
      })
    ).toEqual({
      kind: "portal",
      label: "Manage cancellation",
      disabled: false,
    });
  });

  it("shows the paid-through date and explains that access remains until the billing period ends", () => {
    expect(subscriptionPageSource).toContain(
      'data-testid="subscription-cancellation-scheduled"'
    );
    expect(subscriptionPageSource).toContain("Renewal canceled");
    expect(subscriptionPageSource).toMatch(
      /billing\s+period is already paid/
    );
    expect(subscriptionPageSource).toContain(
      "Canceling a paid subscription stops the next renewal"
    );
  });
});
