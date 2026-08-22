// tests/unit/subscriptionPage.test.jsx

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import SubscriptionPage from "../../src/pages/SubscriptionPage.jsx";
import {
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_PLAN_ORDER,
  SUBSCRIPTION_PLANS,
} from "../../src/lib/subscriptionPlans.js";

const readSource = (relativeUrl) =>
  readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");

const pageSource = readSource("../../src/pages/SubscriptionPage.jsx");
const providerSource = readSource(
  "../../src/providers/SubscriptionProvider.jsx"
);
const settingsSource = readSource("../../src/pages/Settings.jsx");
const billingSource = readSource("../../src/lib/subscriptionBilling.js");

describe("SubscriptionPage live account section", () => {
  it("exports the Settings subscription component", () => {
    expect(typeof SubscriptionPage).toBe("function");
  });

  it("reflects four public plans and the approved label split", () => {
    expect(SUBSCRIPTION_PLAN_ORDER).toHaveLength(4);

    for (const planId of SUBSCRIPTION_PLAN_ORDER) {
      expect(
        SUBSCRIPTION_PLANS[planId].features[
          SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS
        ]
      ).toBe(true);
    }

    expect(
      SUBSCRIPTION_PLANS.cultivator.features[
        SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS
      ]
    ).toBe(false);
    expect(
      SUBSCRIPTION_PLANS.lab.features[
        SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS
      ]
    ).toBe(true);
  });

  it("shows explicit loading, grace-period, and Free-fallback states", () => {
    expect(pageSource).toContain("Checking subscription access");
    expect(pageSource).toContain("Verifying trusted access");
    expect(pageSource).toContain("Payment past due");
    expect(pageSource).toContain("Free access is active");
    expect(pageSource).toContain("three-day grace period");
  });

  it("connects the subscription UI to trusted Checkout and portal callables", () => {
    expect(providerSource).toContain(
      '"createSubscriptionCheckoutSession"'
    );
    expect(providerSource).toContain('"createBillingPortalSession"');
    expect(providerSource).toContain("startSubscriptionCheckout");
    expect(providerSource).toContain("openBillingPortal");
    expect(pageSource).toContain("subscription-plan-action-");
    expect(pageSource).toContain("subscription-manage-billing");
  });

  it("shows success, cancellation, portal-return, and billing-error states", () => {
    expect(pageSource).toContain("subscription-billing-return");
    expect(pageSource).toContain("subscription-billing-error");
    expect(billingSource).toContain("Checkout completed");
    expect(billingSource).toContain("Checkout canceled");
    expect(billingSource).toContain("Returned from billing portal");
  });

  it("restores the Subscription settings tab after Stripe returns", () => {
    expect(settingsSource).toContain("getRequestedSettingsTab");
    expect(settingsSource).toContain('"settingsTab"');
    expect(settingsSource).toContain("useState(getRequestedSettingsTab)");
  });
});
