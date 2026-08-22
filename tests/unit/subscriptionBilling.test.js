// tests/unit/subscriptionBilling.test.js

import { describe, expect, it } from "vitest";
import {
  buildBillingRequestId,
  buildEmulatorBillingReturnUrl,
  getBillingReturnNotice,
  getSubscriptionPlanBillingAction,
  hasManagedStripeSubscription,
  normalizeBillingError,
  removeBillingReturnParameters,
  requireSafeBillingRedirectUrl,
} from "../../src/lib/subscriptionBilling.js";

describe("subscription billing client safety", () => {
  it("accepts secure Stripe URLs and rejects unsafe redirect protocols", () => {
    expect(
      requireSafeBillingRedirectUrl("https://checkout.stripe.com/c/pay/test")
    ).toBe("https://checkout.stripe.com/c/pay/test");

    expect(() =>
      requireSafeBillingRedirectUrl("javascript:alert(1)")
    ).toThrow(/HTTPS/i);
    expect(() =>
      requireSafeBillingRedirectUrl("http://example.com/billing")
    ).toThrow(/HTTPS/i);
  });

  it("allows localhost HTTP only for the explicit emulator transport", () => {
    expect(
      requireSafeBillingRedirectUrl("http://127.0.0.1:5180/?billing=success", {
        allowLocalhostHttp: true,
      })
    ).toContain("127.0.0.1:5180");

    expect(() =>
      requireSafeBillingRedirectUrl("http://127.0.0.1:5180/", {
        allowLocalhostHttp: false,
      })
    ).toThrow(/HTTPS/i);
  });

  it("builds safe request identifiers within the backend limit", () => {
    const requestId = buildBillingRequestId("checkout request");
    expect(requestId).toMatch(/^checkout-request-[A-Za-z0-9._-]+$/);
    expect(requestId.length).toBeLessThanOrEqual(120);
  });

  it("builds local emulator return URLs without external billing traffic", () => {
    const url = new URL(
      buildEmulatorBillingReturnUrl({
        baseUrl: "http://127.0.0.1:5180/current?old=1",
        state: "success",
        planId: "hobby",
      })
    );

    expect(url.origin).toBe("http://127.0.0.1:5180");
    expect(url.searchParams.get("tab")).toBe("settings");
    expect(url.searchParams.get("settingsTab")).toBe("subscription");
    expect(url.searchParams.get("billing")).toBe("success");
    expect(url.searchParams.get("billingPlan")).toBe("hobby");
  });

  it("maps Checkout and portal return states to user-facing notices", () => {
    expect(getBillingReturnNotice("?billing=success")).toMatchObject({
      state: "success",
      title: "Checkout completed",
    });
    expect(getBillingReturnNotice("?billing=canceled")).toMatchObject({
      state: "canceled",
      title: "Checkout canceled",
    });
    expect(getBillingReturnNotice("?billing=portal-return")).toMatchObject({
      state: "portal-return",
      title: "Returned from billing portal",
    });
    expect(getBillingReturnNotice("?billing=unknown")).toBeNull();
  });

  it("removes temporary billing return parameters without removing app routing", () => {
    expect(
      removeBillingReturnParameters(
        "https://app.example.com/?tab=settings&settingsTab=subscription&billing=success&session_id=cs_test&billingPlan=lab"
      )
    ).toBe("/?tab=settings&settingsTab=subscription");
  });

  it("routes active Stripe subscriptions through the customer portal", () => {
    const sourceEntitlement = {
      planId: "lab",
      status: "active",
      source: "stripe",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
    };

    expect(hasManagedStripeSubscription(sourceEntitlement)).toBe(true);
    expect(
      getSubscriptionPlanBillingAction({
        planId: "lab",
        currentPlanId: "lab",
        sourceEntitlement,
        accessReady: true,
      })
    ).toEqual({
      kind: "portal",
      label: "Manage billing",
      disabled: false,
    });
    expect(
      getSubscriptionPlanBillingAction({
        planId: "cultivator",
        currentPlanId: "lab",
        sourceEntitlement,
        accessReady: true,
      })
    ).toMatchObject({
      kind: "portal",
      label: "Change in billing portal",
    });
  });

  it("uses Checkout for new, trial, tester, canceled, and expired paid access", () => {
    expect(
      getSubscriptionPlanBillingAction({
        planId: "hobby",
        currentPlanId: "free",
        sourceEntitlement: { planId: "free", status: "active", source: "default" },
        accessReady: true,
      })
    ).toMatchObject({ kind: "checkout", label: "Choose Hobby" });

    expect(
      getSubscriptionPlanBillingAction({
        planId: "cultivator",
        currentPlanId: "cultivator",
        sourceEntitlement: {
          planId: "cultivator",
          status: "active",
          source: "tester_code",
        },
        accessReady: true,
      })
    ).toMatchObject({
      kind: "checkout",
      label: "Subscribe to keep Cultivator",
    });

    expect(
      getSubscriptionPlanBillingAction({
        planId: "lab",
        currentPlanId: "free",
        sourceEntitlement: {
          planId: "lab",
          status: "canceled",
          source: "stripe",
          stripeCustomerId: "cus_test",
          stripeSubscriptionId: "sub_old",
        },
        accessReady: true,
      })
    ).toMatchObject({ kind: "checkout", label: "Restart Lab" });
  });

  it("normalizes callable failures into safe billing messages", () => {
    expect(
      normalizeBillingError({ code: "functions/unauthenticated" })
    ).toMatch(/Sign in again/i);
    expect(
      normalizeBillingError({
        code: "functions/failed-precondition",
        message: "Use the billing portal.",
      })
    ).toBe("Use the billing portal.");
    expect(
      normalizeBillingError({ code: "functions/unavailable" })
    ).toMatch(/temporarily unavailable/i);
  });
});
