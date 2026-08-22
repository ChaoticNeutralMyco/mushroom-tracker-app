// src/lib/subscriptionBilling.js

import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLANS,
} from "./subscriptionPlans.js";

const PAID_PLAN_IDS = new Set([
  SUBSCRIPTION_PLAN_IDS.HOBBY,
  SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
  SUBSCRIPTION_PLAN_IDS.LAB,
]);

const MANAGED_STRIPE_STATUSES = new Set(["active", "past_due"]);
const BILLING_RETURN_COPY = Object.freeze({
  success: Object.freeze({
    state: "success",
    tone: "success",
    title: "Checkout completed",
    message:
      "Stripe is confirming your subscription. Your plan will update automatically after the signed billing event is processed.",
  }),
  canceled: Object.freeze({
    state: "canceled",
    tone: "info",
    title: "Checkout canceled",
    message: "Your current access has not changed.",
  }),
  "portal-return": Object.freeze({
    state: "portal-return",
    tone: "success",
    title: "Returned from billing portal",
    message:
      "Any billing changes will appear automatically after Stripe confirms them.",
  }),
});

function normalizedText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function localHostname(hostname) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(
    normalizedText(hostname)
  );
}

export function isPaidSubscriptionPlanId(planId) {
  return PAID_PLAN_IDS.has(normalizedText(planId));
}

export function buildBillingRequestId(prefix = "billing") {
  const safePrefix = String(prefix || "billing")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 32) || "billing";
  const uuid = globalThis.crypto?.randomUUID?.();
  const suffix = uuid || `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  return `${safePrefix}-${suffix}`.slice(0, 120);
}

export function requireSafeBillingRedirectUrl(
  value,
  { allowLocalhostHttp = false } = {}
) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new Error("The billing service did not return a redirect URL.");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The billing service returned an invalid redirect URL.");
  }

  if (url.username || url.password) {
    throw new Error("Billing redirect URLs cannot contain credentials.");
  }

  const secure = url.protocol === "https:";
  const localHttp =
    allowLocalhostHttp &&
    url.protocol === "http:" &&
    localHostname(url.hostname);

  if (!secure && !localHttp) {
    throw new Error("Billing redirects must use HTTPS.");
  }

  return url.toString();
}

export function buildEmulatorBillingReturnUrl({
  baseUrl,
  state,
  planId = null,
} = {}) {
  const url = new URL(baseUrl || "http://127.0.0.1/");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("tab", "settings");
  url.searchParams.set("settingsTab", "subscription");
  url.searchParams.set("billing", state);
  if (planId) url.searchParams.set("billingPlan", String(planId));
  return url.toString();
}

export function getBillingReturnNotice(search = "") {
  const params = new URLSearchParams(String(search || ""));
  const state = normalizedText(params.get("billing"));
  const copy = BILLING_RETURN_COPY[state];
  if (!copy) return null;

  return {
    ...copy,
    planId: normalizedText(params.get("billingPlan")) || null,
  };
}

export function removeBillingReturnParameters(urlLike) {
  const url = new URL(urlLike, "http://127.0.0.1/");
  for (const key of ["billing", "billingPlan", "session_id"]) {
    url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function normalizeBillingError(error, fallbackMessage) {
  const code = normalizedText(error?.code).replace(/^functions\//, "");
  const message = typeof error?.message === "string" ? error.message.trim() : "";

  if (code === "unauthenticated") {
    return "Sign in again before changing billing.";
  }
  if (code === "unavailable") {
    return "The billing service is temporarily unavailable. No changes were made.";
  }
  if (
    [
      "invalid-argument",
      "failed-precondition",
      "already-exists",
      "permission-denied",
      "resource-exhausted",
    ].includes(code) &&
    message
  ) {
    return message;
  }

  return message || fallbackMessage || "The billing request could not be completed.";
}

export function hasManagedStripeSubscription(sourceEntitlement = null) {
  const source = normalizedText(sourceEntitlement?.source);
  const status = normalizedText(sourceEntitlement?.status);
  return Boolean(
    source === "stripe" &&
      MANAGED_STRIPE_STATUSES.has(status) &&
      sourceEntitlement?.stripeCustomerId &&
      sourceEntitlement?.stripeSubscriptionId
  );
}

export function getSubscriptionPlanBillingAction({
  planId,
  currentPlanId,
  sourceEntitlement = null,
  accessReady = false,
  billingBusy = false,
} = {}) {
  const safePlanId = normalizedText(planId);
  const safeCurrentPlanId = normalizedText(currentPlanId);
  const plan = SUBSCRIPTION_PLANS[safePlanId];

  if (!plan) {
    return { kind: "none", label: "Unavailable", disabled: true };
  }

  if (!accessReady) {
    return { kind: "none", label: "Checking access", disabled: true };
  }

  if (billingBusy) {
    return { kind: "none", label: "Opening secure billing…", disabled: true };
  }

  if (safePlanId === SUBSCRIPTION_PLAN_IDS.FREE) {
    return {
      kind: "none",
      label:
        safeCurrentPlanId === SUBSCRIPTION_PLAN_IDS.FREE
          ? "Current plan"
          : "Free is always available",
      disabled: true,
    };
  }

  if (safeCurrentPlanId === SUBSCRIPTION_PLAN_IDS.ADMIN) {
    return { kind: "none", label: "Admin access", disabled: true };
  }

  if (!isPaidSubscriptionPlanId(safePlanId)) {
    return { kind: "none", label: "Unavailable", disabled: true };
  }

  if (hasManagedStripeSubscription(sourceEntitlement)) {
    const stripePlanId = normalizedText(sourceEntitlement?.planId);

    if (stripePlanId === safePlanId) {
      return {
        kind: "portal",
        label: "Manage billing",
        disabled: false,
      };
    }

    if (
      safeCurrentPlanId !== stripePlanId &&
      safeCurrentPlanId === safePlanId
    ) {
      return {
        kind: "none",
        label: "Promotional access active",
        disabled: true,
      };
    }

    return {
      kind: "none",
      label: "Plan changes coming soon",
      disabled: true,
    };
  }

  const sourceStatus = normalizedText(sourceEntitlement?.status);
  const sourcePlanId = normalizedText(sourceEntitlement?.planId);
  const restarting =
    ["canceled", "expired"].includes(sourceStatus) &&
    sourcePlanId === safePlanId;
  const currentNonStripeAccess = safeCurrentPlanId === safePlanId;

  return {
    kind: "checkout",
    label: restarting
      ? `Restart ${plan.label}`
      : currentNonStripeAccess
        ? `Subscribe to keep ${plan.label}`
        : `Choose ${plan.label}`,
    disabled: false,
  };
}

export const SUBSCRIPTION_BILLING_RETURN_STATES = Object.freeze(
  Object.keys(BILLING_RETURN_COPY)
);
