// functions/src/billingService.js

import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import {
  BILLING_COLLECTION_ID,
  ENTITLEMENT_DOCUMENT_ID,
  STRIPE_SUPPORTED_PAID_PLAN_IDS,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "./subscriptionConfig.js";
import {
  asValidDate,
  requireEventId,
  requirePlanId,
  requireUid,
} from "./entitlementModel.js";
import {
  activatePaidEntitlement,
  applyTrustedEntitlementTransition,
  cancelEntitlement,
  markEntitlementPastDue,
} from "./entitlementService.js";

const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";
const PAID_PLAN_IDS = new Set(STRIPE_SUPPORTED_PAID_PLAN_IDS);
const ACTIVE_STRIPE_STATUSES = new Set(["active", "trialing"]);
const PAST_DUE_STRIPE_STATUSES = new Set(["past_due"]);
const PENDING_STRIPE_STATUSES = new Set([
  "incomplete",
  "incomplete_expired",
]);
const INACTIVE_STRIPE_STATUSES = new Set([
  "canceled",
  "paused",
  "unpaid",
]);
const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

export class BillingServiceError extends Error {
  constructor(message, code = "failed-precondition", details = null) {
    super(message);
    this.name = "BillingServiceError";
    this.code = code;
    this.details = details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonEmptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireConfigString(value, label) {
  const normalized = nonEmptyString(value);
  if (!normalized) {
    throw new BillingServiceError(
      `${label} is missing from CNM_STRIPE_CONFIG.`,
      "failed-precondition"
    );
  }
  return normalized;
}

function normalizeAppUrl(value) {
  const raw = requireConfigString(value, "appUrl");
  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    throw new BillingServiceError(
      "appUrl in CNM_STRIPE_CONFIG must be a valid absolute URL.",
      "failed-precondition"
    );
  }

  const localHttp =
    parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new BillingServiceError(
      "appUrl must use HTTPS except for localhost emulator testing.",
      "failed-precondition"
    );
  }

  parsed.hash = "";
  return parsed.toString();
}

function normalizePriceIds(value) {
  if (!isPlainObject(value)) {
    throw new BillingServiceError(
      "priceIds must be an object in CNM_STRIPE_CONFIG.",
      "failed-precondition"
    );
  }

  const output = {};
  const seen = new Set();

  for (const planId of STRIPE_SUPPORTED_PAID_PLAN_IDS) {
    const priceId = requireConfigString(value[planId], `priceIds.${planId}`);
    if (!/^price_[A-Za-z0-9_]+$/.test(priceId)) {
      throw new BillingServiceError(
        `priceIds.${planId} must be a Stripe Price id.`,
        "failed-precondition"
      );
    }
    if (seen.has(priceId)) {
      throw new BillingServiceError(
        "Each paid plan must use a distinct Stripe Price id.",
        "failed-precondition"
      );
    }
    seen.add(priceId);
    output[planId] = priceId;
  }

  return Object.freeze(output);
}

export function parseStripeConfig(value) {
  let input = value;

  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      throw new BillingServiceError(
        "CNM_STRIPE_CONFIG must contain valid JSON.",
        "failed-precondition"
      );
    }
  }

  if (!isPlainObject(input)) {
    throw new BillingServiceError(
      "CNM_STRIPE_CONFIG is required.",
      "failed-precondition"
    );
  }

  const secretKey = requireConfigString(input.secretKey, "secretKey");
  const webhookSecret = requireConfigString(
    input.webhookSecret,
    "webhookSecret"
  );

  if (!/^sk_(test|live)_[A-Za-z0-9_]+$/.test(secretKey)) {
    throw new BillingServiceError(
      "secretKey in CNM_STRIPE_CONFIG is not a Stripe secret key.",
      "failed-precondition"
    );
  }
  if (!/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret)) {
    throw new BillingServiceError(
      "webhookSecret in CNM_STRIPE_CONFIG is not a Stripe webhook secret.",
      "failed-precondition"
    );
  }

  const config = {
    secretKey,
    webhookSecret,
    appUrl: normalizeAppUrl(input.appUrl),
    priceIds: normalizePriceIds(input.priceIds),
    portalConfigurationId:
      nonEmptyString(input.portalConfigurationId) || null,
    apiVersion: nonEmptyString(input.apiVersion) || null,
    automaticTax: input.automaticTax === true,
    allowPromotionCodes: input.allowPromotionCodes !== false,
  };

  Object.defineProperty(config, "__cnmStripeConfig", {
    value: true,
    enumerable: false,
  });

  return Object.freeze(config);
}

function ensureStripeConfig(value) {
  return value?.__cnmStripeConfig === true
    ? value
    : parseStripeConfig(value);
}

function appendFormValue(params, key, value) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value === "boolean") {
    params.append(key, value ? "true" : "false");
    return;
  }
  params.append(key, String(value));
}

function parseStripeResponseBody(bodyText) {
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText);
  } catch {
    return { raw: bodyText };
  }
}

export function createStripeRestClient({
  secretKey,
  apiVersion = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const safeKey = requireConfigString(secretKey, "Stripe secretKey");
  if (typeof fetchImpl !== "function") {
    throw new BillingServiceError(
      "A Fetch implementation is required for Stripe API requests.",
      "failed-precondition"
    );
  }

  async function request(method, path, form = null, options = {}) {
    const normalizedPath = nonEmptyString(path);
    if (!normalizedPath.startsWith("/")) {
      throw new BillingServiceError(
        "Stripe API paths must begin with a slash.",
        "invalid-argument"
      );
    }

    const headers = {
      Authorization: `Bearer ${safeKey}`,
      "User-Agent": "ChaoticNeutralMycoTracker/1.1.4",
    };
    if (apiVersion) headers["Stripe-Version"] = apiVersion;
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = String(options.idempotencyKey);
    }

    let body;
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = form instanceof URLSearchParams
        ? form.toString()
        : new URLSearchParams(form).toString();
    }

    let response;
    try {
      response = await fetchImpl(`${STRIPE_API_BASE_URL}${normalizedPath}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    } catch {
      throw new BillingServiceError(
        "Stripe could not be reached.",
        "unavailable"
      );
    }

    const bodyText = await response.text();
    const payload = parseStripeResponseBody(bodyText);

    if (!response.ok) {
      const providerMessage =
        nonEmptyString(payload?.error?.message) ||
        `Stripe returned HTTP ${response.status}.`;
      throw new BillingServiceError(
        providerMessage,
        response.status >= 500 ? "unavailable" : "failed-precondition",
        {
          provider: "stripe",
          status: response.status,
          type: payload?.error?.type || null,
          code: payload?.error?.code || null,
        }
      );
    }

    return payload;
  }

  return Object.freeze({
    async createCustomer({ uid, email, idempotencyKey }) {
      const form = new URLSearchParams();
      appendFormValue(form, "email", email);
      appendFormValue(form, "metadata[firebaseUid]", requireUid(uid));
      appendFormValue(form, "description", "Chaotic Neutral Myco Tracker user");
      return request("POST", "/customers", form, { idempotencyKey });
    },

    async createCheckoutSession(form, idempotencyKey) {
      return request("POST", "/checkout/sessions", form, { idempotencyKey });
    },

    async createPortalSession(form, idempotencyKey) {
      return request("POST", "/billing_portal/sessions", form, {
        idempotencyKey,
      });
    },

    async retrieveSubscription(subscriptionId) {
      const safeId = nonEmptyString(subscriptionId);
      if (!/^sub_[A-Za-z0-9_]+$/.test(safeId)) {
        throw new BillingServiceError(
          "A valid Stripe Subscription id is required.",
          "invalid-argument"
        );
      }
      return request("GET", `/subscriptions/${encodeURIComponent(safeId)}`);
    },
  });
}

function entitlementRef(db, uid) {
  return db
    .collection("users")
    .doc(requireUid(uid))
    .collection(BILLING_COLLECTION_ID)
    .doc(ENTITLEMENT_DOCUMENT_ID);
}

function entitlementHasEstablishedStripeAccess(
  entitlement,
  subscriptionId
) {
  if (!entitlement || typeof entitlement !== "object") return false;

  const source = nonEmptyString(entitlement.source).toLowerCase();
  const status = nonEmptyString(entitlement.status).toLowerCase();
  const storedSubscriptionId = nonEmptyString(
    entitlement.stripeSubscriptionId
  );
  const safeSubscriptionId = nonEmptyString(subscriptionId);

  return Boolean(
    source === SUBSCRIPTION_SOURCES.STRIPE &&
      [SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.PAST_DUE].includes(
        status
      ) &&
      safeSubscriptionId &&
      storedSubscriptionId === safeSubscriptionId
  );
}

function buildAppReturnUrl(appUrl, state, includeCheckoutToken = false) {
  const url = new URL(appUrl);
  url.searchParams.set("tab", "settings");
  url.searchParams.set("settingsTab", "subscription");
  url.searchParams.set("billing", state);

  if (!includeCheckoutToken) {
    return url.toString();
  }

  const checkoutSessionToken = "__CNM_CHECKOUT_SESSION_ID__";
  url.searchParams.set("session_id", checkoutSessionToken);

  return url
    .toString()
    .replace(checkoutSessionToken, "{CHECKOUT_SESSION_ID}");
}

function normalizeCheckoutRequestId(value) {
  const normalized = nonEmptyString(value);
  if (!normalized) return randomUUID();
  if (
    normalized.length > 120 ||
    !/^[A-Za-z0-9._-]+$/.test(normalized)
  ) {
    throw new BillingServiceError(
      "requestId may contain only letters, numbers, dots, underscores, and hyphens.",
      "invalid-argument"
    );
  }
  return normalized;
}

export function buildCheckoutSessionForm({
  uid,
  email,
  planId,
  customerId = null,
  config,
} = {}) {
  const safeUid = requireUid(uid);
  const safePlanId = requirePlanId(planId, { publicOnly: true });
  const safeConfig = ensureStripeConfig(config);

  if (!PAID_PLAN_IDS.has(safePlanId)) {
    throw new BillingServiceError(
      "Checkout is available only for Hobby, Cultivator, or Lab.",
      "invalid-argument"
    );
  }

  const form = new URLSearchParams();
  appendFormValue(form, "mode", "subscription");
  appendFormValue(form, "line_items[0][price]", safeConfig.priceIds[safePlanId]);
  appendFormValue(form, "line_items[0][quantity]", 1);
  appendFormValue(
    form,
    "success_url",
    buildAppReturnUrl(safeConfig.appUrl, "success", true)
  );
  appendFormValue(
    form,
    "cancel_url",
    buildAppReturnUrl(safeConfig.appUrl, "canceled")
  );
  appendFormValue(form, "client_reference_id", safeUid);
  appendFormValue(form, "metadata[firebaseUid]", safeUid);
  appendFormValue(form, "metadata[planId]", safePlanId);
  appendFormValue(form, "subscription_data[metadata][firebaseUid]", safeUid);
  appendFormValue(form, "subscription_data[metadata][planId]", safePlanId);
  appendFormValue(form, "allow_promotion_codes", safeConfig.allowPromotionCodes);
  appendFormValue(form, "automatic_tax[enabled]", safeConfig.automaticTax);
  appendFormValue(form, "billing_address_collection", "auto");

  const safeCustomerId = nonEmptyString(customerId);
  if (safeCustomerId) {
    appendFormValue(form, "customer", safeCustomerId);
    appendFormValue(form, "customer_update[address]", "auto");
    appendFormValue(form, "customer_update[name]", "auto");
  } else {
    const safeEmail = nonEmptyString(email);
    if (!safeEmail) {
      throw new BillingServiceError(
        "The signed-in Firebase account needs an email address before checkout.",
        "failed-precondition"
      );
    }
    appendFormValue(form, "customer_email", safeEmail);
  }

  return form;
}

export async function createSubscriptionCheckoutSession({
  db = getFirestore(),
  uid,
  email,
  planId,
  requestId = null,
  config,
  stripeClient = null,
} = {}) {
  const safeUid = requireUid(uid);
  const safeConfig = ensureStripeConfig(config);
  const client =
    stripeClient ||
    createStripeRestClient({
      secretKey: safeConfig.secretKey,
      apiVersion: safeConfig.apiVersion,
    });
  const entitlementSnapshot = await entitlementRef(db, safeUid).get();
  const entitlement = entitlementSnapshot.exists
    ? entitlementSnapshot.data()
    : null;

  if (
    entitlement?.source === SUBSCRIPTION_SOURCES.STRIPE &&
    [SUBSCRIPTION_STATUSES.ACTIVE, SUBSCRIPTION_STATUSES.PAST_DUE].includes(
      entitlement?.status
    ) &&
    entitlement?.stripeSubscriptionId
  ) {
    throw new BillingServiceError(
      "An existing Stripe subscription must be managed through the billing portal.",
      "failed-precondition"
    );
  }

  let customerId = nonEmptyString(entitlement?.stripeCustomerId);

  if (!customerId) {
    const customer = await client.createCustomer({
      uid: safeUid,
      email: nonEmptyString(email) || null,
      idempotencyKey: `cnm-customer-${safeUid}`,
    });
    customerId = nonEmptyString(customer?.id);

    if (!/^cus_[A-Za-z0-9_]+$/.test(customerId)) {
      throw new BillingServiceError(
        "Stripe did not return a valid Customer id.",
        "unavailable"
      );
    }

    await applyTrustedEntitlementTransition({
      db,
      uid: safeUid,
      eventId: `stripe-customer-${customerId}`,
      type: "stripe_customer_bound",
      source: "stripe_checkout_callable",
      patch: { stripeCustomerId: customerId },
    });
  }

  const safeRequestId = normalizeCheckoutRequestId(requestId);
  const form = buildCheckoutSessionForm({
    uid: safeUid,
    email,
    planId,
    customerId,
    config: safeConfig,
  });
  const session = await client.createCheckoutSession(
    form,
    `cnm-checkout-${safeUid}-${safeRequestId}`
  );
  const url = nonEmptyString(session?.url);

  if (!url || !/^https:\/\//i.test(url)) {
    throw new BillingServiceError(
      "Stripe did not return a secure Checkout URL.",
      "unavailable"
    );
  }

  return {
    sessionId: nonEmptyString(session?.id),
    url,
  };
}

export async function createCustomerPortalSession({
  db = getFirestore(),
  uid,
  requestId = null,
  config,
  stripeClient = null,
} = {}) {
  const safeUid = requireUid(uid);
  const safeConfig = ensureStripeConfig(config);
  const client =
    stripeClient ||
    createStripeRestClient({
      secretKey: safeConfig.secretKey,
      apiVersion: safeConfig.apiVersion,
    });
  const snapshot = await entitlementRef(db, safeUid).get();
  const entitlement = snapshot.exists ? snapshot.data() : null;
  const customerId = nonEmptyString(entitlement?.stripeCustomerId);

  if (!/^cus_[A-Za-z0-9_]+$/.test(customerId)) {
    throw new BillingServiceError(
      "No Stripe billing profile exists for this account yet.",
      "failed-precondition"
    );
  }

  const form = new URLSearchParams();
  appendFormValue(form, "customer", customerId);
  appendFormValue(
    form,
    "return_url",
    buildAppReturnUrl(safeConfig.appUrl, "portal-return")
  );
  appendFormValue(
    form,
    "configuration",
    safeConfig.portalConfigurationId
  );

  const session = await client.createPortalSession(
    form,
    `cnm-portal-${safeUid}-${normalizeCheckoutRequestId(requestId)}`
  );
  const url = nonEmptyString(session?.url);

  if (!url || !/^https:\/\//i.test(url)) {
    throw new BillingServiceError(
      "Stripe did not return a secure customer-portal URL.",
      "unavailable"
    );
  }

  return {
    sessionId: nonEmptyString(session?.id),
    url,
  };
}

function parseStripeSignatureHeader(value) {
  const header = nonEmptyString(value);
  const parts = header.split(",").map((part) => part.trim());
  let timestamp = null;
  const signatures = [];

  for (const part of parts) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index);
    const entryValue = part.slice(index + 1);
    if (key === "t" && /^\d+$/.test(entryValue)) {
      timestamp = Number(entryValue);
    } else if (key === "v1" && /^[a-f0-9]{64}$/i.test(entryValue)) {
      signatures.push(entryValue.toLowerCase());
    }
  }

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new BillingServiceError(
      "Stripe-Signature is malformed.",
      "permission-denied",
      { webhook: true }
    );
  }

  return { timestamp, signatures };
}

function safeHexEqual(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyStripeWebhookSignature({
  rawBody,
  signatureHeader,
  webhookSecret,
  now = new Date(),
  toleranceSeconds = STRIPE_WEBHOOK_TOLERANCE_SECONDS,
} = {}) {
  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(typeof rawBody === "string" ? rawBody : "");
  const secret = requireConfigString(webhookSecret, "Stripe webhook secret");
  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);
  const currentDate = asValidDate(now) || new Date();
  const currentSeconds = Math.floor(currentDate.getTime() / 1000);
  const tolerance = Math.max(1, Number(toleranceSeconds) || 0);

  if (Math.abs(currentSeconds - timestamp) > tolerance) {
    throw new BillingServiceError(
      "Stripe webhook timestamp is outside the accepted tolerance.",
      "permission-denied",
      { webhook: true }
    );
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body.toString("utf8")}`, "utf8")
    .digest("hex");

  if (!signatures.some((signature) => safeHexEqual(signature, expected))) {
    throw new BillingServiceError(
      "Stripe webhook signature verification failed.",
      "permission-denied",
      { webhook: true }
    );
  }

  let event;
  try {
    event = JSON.parse(body.toString("utf8"));
  } catch {
    throw new BillingServiceError(
      "Stripe webhook body is not valid JSON.",
      "invalid-argument",
      { webhook: true }
    );
  }

  requireEventId(event?.id);
  if (!nonEmptyString(event?.type) || !isPlainObject(event?.data)) {
    throw new BillingServiceError(
      "Stripe webhook event is incomplete.",
      "invalid-argument",
      { webhook: true }
    );
  }

  return event;
}

function objectId(value) {
  if (typeof value === "string") return value.trim();
  return nonEmptyString(value?.id);
}

function metadataValue(object, key) {
  return nonEmptyString(object?.metadata?.[key]);
}

function unixSecondsToDate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(Math.floor(numeric) * 1000);
}

function eventOccurredAt(event, fallback = new Date()) {
  return unixSecondsToDate(event?.created) || asValidDate(fallback) || new Date();
}

function subscriptionPriceId(subscription) {
  const items = Array.isArray(subscription?.items?.data)
    ? subscription.items.data
    : [];
  for (const item of items) {
    const priceId = objectId(item?.price) || objectId(item?.plan);
    if (priceId) return priceId;
  }
  return objectId(subscription?.plan);
}

function subscriptionPeriodEnd(subscription) {
  const direct = unixSecondsToDate(subscription?.current_period_end);
  if (direct) return direct;

  const items = Array.isArray(subscription?.items?.data)
    ? subscription.items.data
    : [];
  const itemEnds = items
    .map((item) => unixSecondsToDate(item?.current_period_end))
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime());

  return (
    itemEnds[0] ||
    unixSecondsToDate(subscription?.trial_end) ||
    unixSecondsToDate(subscription?.cancel_at)
  );
}

function subscriptionIdFromInvoice(invoice) {
  return (
    objectId(invoice?.subscription) ||
    objectId(invoice?.parent?.subscription_details?.subscription) ||
    objectId(invoice?.lines?.data?.[0]?.subscription)
  );
}

function planIdFromPrice(config, priceId) {
  for (const [planId, configuredPriceId] of Object.entries(config.priceIds)) {
    if (configuredPriceId === priceId) return planId;
  }
  return null;
}

function planIdForSubscription(subscription, config) {
  const priceId = subscriptionPriceId(subscription);
  const fromPrice = planIdFromPrice(config, priceId);
  if (fromPrice) return { planId: fromPrice, priceId };

  const metadataPlan = metadataValue(subscription, "planId");
  if (metadataPlan) {
    const planId = requirePlanId(metadataPlan, { publicOnly: true });
    if (PAID_PLAN_IDS.has(planId)) {
      return { planId, priceId: priceId || null };
    }
  }

  throw new BillingServiceError(
    "Stripe subscription price is not mapped to a Chaotic Neutral plan.",
    "failed-precondition"
  );
}

function uidFromDocumentSnapshot(snapshot) {
  const parts = snapshot.ref.path.split("/");
  return parts.length >= 4 && parts[0] === "users" ? parts[1] : null;
}

async function findUidByStripeIdentifier(db, field, value) {
  const safeValue = nonEmptyString(value);
  if (!safeValue) return null;

  const snapshot = await db
    .collectionGroup(BILLING_COLLECTION_ID)
    .where(field, "==", safeValue)
    .limit(5)
    .get();

  const entitlement = snapshot.docs.find(
    (doc) => doc.id === ENTITLEMENT_DOCUMENT_ID
  );
  return entitlement ? uidFromDocumentSnapshot(entitlement) : null;
}

async function resolveUid({
  db,
  primaryObject,
  subscription,
  customerId,
  subscriptionId,
}) {
  const direct =
    metadataValue(subscription, "firebaseUid") ||
    metadataValue(primaryObject, "firebaseUid") ||
    nonEmptyString(primaryObject?.client_reference_id);
  if (direct) return requireUid(direct);

  return (
    (await findUidByStripeIdentifier(
      db,
      "stripeSubscriptionId",
      subscriptionId
    )) ||
    (await findUidByStripeIdentifier(db, "stripeCustomerId", customerId))
  );
}

async function synchronizeSubscription({
  db,
  uid,
  event,
  subscription,
  config,
  forcedAction = null,
}) {
  const eventId = `stripe-${requireEventId(event.id)}`;
  const occurredAt = eventOccurredAt(event);
  const status = nonEmptyString(subscription?.status).toLowerCase();
  const customerId = objectId(subscription?.customer);
  const subscriptionId = objectId(subscription);
  const { planId, priceId } = planIdForSubscription(subscription, config);
  const currentPeriodEndsAt = subscriptionPeriodEnd(subscription);

  if (forcedAction === "cancel" || INACTIVE_STRIPE_STATUSES.has(status)) {
    const currentSnapshot = await entitlementRef(db, uid).get();
    const currentEntitlement = currentSnapshot.exists
      ? currentSnapshot.data()
      : null;
    const establishedPaidAccess = entitlementHasEstablishedStripeAccess(
      currentEntitlement,
      subscriptionId
    );

    if (!establishedPaidAccess) {
      const result = await applyTrustedEntitlementTransition({
        db,
        uid,
        eventId,
        type: `stripe_subscription_${status || "inactive"}_without_established_paid_access`,
        source: "stripe_webhook",
        providerOccurredAt: occurredAt,
        ignoreIfProviderEventOlder: true,
        patch: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: priceId,
          stripeEventId: event.id,
          stripeEventCreatedAt: occurredAt,
        },
      });
      return { action: "pending", result };
    }

    const result = await cancelEntitlement({
      db,
      uid,
      eventId,
      canceledAt: occurredAt,
      reason:
        forcedAction === "cancel"
          ? "stripe_subscription_deleted"
          : `stripe_subscription_${status || "inactive"}`,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      stripeEventId: event.id,
      stripeEventCreatedAt: occurredAt,
    });
    return { action: "canceled", result };
  }

  if (PENDING_STRIPE_STATUSES.has(status)) {
    const result = await applyTrustedEntitlementTransition({
      db,
      uid,
      eventId,
      type: `stripe_subscription_${status}`,
      source: "stripe_webhook",
      providerOccurredAt: occurredAt,
      ignoreIfProviderEventOlder: true,
      patch: {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: priceId,
        stripeEventId: event.id,
        stripeEventCreatedAt: occurredAt,
      },
    });
    return { action: "pending", result };
  }

  if (PAST_DUE_STRIPE_STATUSES.has(status)) {
    const currentSnapshot = await entitlementRef(db, uid).get();
    const currentEntitlement = currentSnapshot.exists
      ? currentSnapshot.data()
      : null;

    if (
      !entitlementHasEstablishedStripeAccess(
        currentEntitlement,
        subscriptionId
      )
    ) {
      const result = await applyTrustedEntitlementTransition({
        db,
        uid,
        eventId,
        type: "stripe_past_due_without_established_paid_access",
        source: "stripe_webhook",
        providerOccurredAt: occurredAt,
        ignoreIfProviderEventOlder: true,
        patch: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: priceId,
          stripeEventId: event.id,
          stripeEventCreatedAt: occurredAt,
        },
      });
      return { action: "pending", result };
    }

    const result = await markEntitlementPastDue({
      db,
      uid,
      eventId,
      pastDueStartedAt: occurredAt,
      planId,
      currentPeriodEndsAt,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      stripeEventId: event.id,
      stripeEventCreatedAt: occurredAt,
    });
    return { action: "past_due", result };
  }

  if (ACTIVE_STRIPE_STATUSES.has(status)) {
    if (!currentPeriodEndsAt) {
      throw new BillingServiceError(
        "Stripe subscription is missing a trusted current period end.",
        "failed-precondition"
      );
    }

    const result = await activatePaidEntitlement({
      db,
      uid,
      eventId,
      planId,
      currentPeriodEndsAt,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: priceId,
      stripeEventId: event.id,
      stripeEventCreatedAt: occurredAt,
    });
    return { action: "active", result };
  }

  throw new BillingServiceError(
    `Unsupported Stripe subscription status: ${status || "missing"}.`,
    "failed-precondition"
  );
}

export async function processStripeBillingEvent({
  db = getFirestore(),
  event,
  config,
  stripeClient = null,
  now = new Date(),
} = {}) {
  if (!isPlainObject(event)) {
    throw new BillingServiceError(
      "A Stripe event object is required.",
      "invalid-argument"
    );
  }

  const eventId = requireEventId(event.id);
  const eventType = nonEmptyString(event.type);
  if (!HANDLED_EVENT_TYPES.has(eventType)) {
    return {
      handled: false,
      eventId,
      eventType,
    };
  }

  const safeConfig = ensureStripeConfig(config);
  const client =
    stripeClient ||
    createStripeRestClient({
      secretKey: safeConfig.secretKey,
      apiVersion: safeConfig.apiVersion,
    });
  const primaryObject = event?.data?.object;

  if (!isPlainObject(primaryObject)) {
    throw new BillingServiceError(
      "Stripe event data.object is required.",
      "invalid-argument"
    );
  }

  let subscription = null;
  let forcedAction = null;

  if (eventType.startsWith("customer.subscription.")) {
    subscription = primaryObject;
    if (eventType === "customer.subscription.deleted") {
      forcedAction = "cancel";
    }
  } else {
    const subscriptionId =
      eventType === "checkout.session.completed"
        ? objectId(primaryObject?.subscription)
        : subscriptionIdFromInvoice(primaryObject);

    if (!subscriptionId) {
      throw new BillingServiceError(
        "Stripe event does not reference a subscription.",
        "failed-precondition"
      );
    }

    subscription = await client.retrieveSubscription(subscriptionId);
  }

  const customerId =
    objectId(subscription?.customer) ||
    objectId(primaryObject?.customer);
  const subscriptionId = objectId(subscription);
  const uid = await resolveUid({
    db,
    primaryObject,
    subscription,
    customerId,
    subscriptionId,
  });

  if (!uid) {
    throw new BillingServiceError(
      "Stripe event could not be matched to a Firebase user.",
      "not-found"
    );
  }

  const sync = await synchronizeSubscription({
    db,
    uid,
    event: {
      ...event,
      created:
        Number.isFinite(Number(event.created))
          ? event.created
          : Math.floor((asValidDate(now) || new Date()).getTime() / 1000),
    },
    subscription,
    config: safeConfig,
    forcedAction,
  });

  return {
    handled: true,
    eventId,
    eventType,
    uid,
    action: sync.action,
    applied: sync.result?.applied === true,
    idempotent: sync.result?.idempotent === true,
    stale: sync.result?.stale === true,
  };
}

export const STRIPE_HANDLED_EVENT_TYPES = Object.freeze(
  Array.from(HANDLED_EVENT_TYPES)
);
