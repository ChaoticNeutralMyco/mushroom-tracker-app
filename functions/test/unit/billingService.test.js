// functions/test/unit/billingService.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  BillingServiceError,
  buildCheckoutSessionForm,
  parseStripeConfig,
  verifyStripeWebhookSignature,
} from "../../src/billingService.js";

const configInput = {
  secretKey: "sk_test_unit_key",
  webhookSecret: "whsec_unit_secret",
  appUrl: "https://tracker.example.com/app",
  priceIds: {
    hobby: "price_hobby_unit",
    cultivator: "price_cultivator_unit",
    lab: "price_lab_unit",
  },
  automaticTax: true,
  allowPromotionCodes: false,
};

test("Stripe configuration validates paid plan prices and secure app URLs", () => {
  const config = parseStripeConfig(JSON.stringify(configInput));

  assert.equal(config.priceIds.hobby, "price_hobby_unit");
  assert.equal(config.automaticTax, true);
  assert.equal(config.allowPromotionCodes, false);
  assert.throws(
    () =>
      parseStripeConfig({
        ...configInput,
        appUrl: "http://tracker.example.com",
      }),
    BillingServiceError
  );
  assert.throws(
    () =>
      parseStripeConfig({
        ...configInput,
        priceIds: {
          hobby: "price_same",
          cultivator: "price_same",
          lab: "price_lab",
        },
      }),
    /distinct/
  );
});

test("Checkout form uses server-controlled prices, metadata, and return URLs", () => {
  const config = parseStripeConfig(configInput);
  const form = buildCheckoutSessionForm({
    uid: "firebase-user",
    email: "user@example.com",
    planId: "cultivator",
    customerId: "cus_unit",
    config,
  });

  assert.equal(form.get("mode"), "subscription");
  assert.equal(
    form.get("line_items[0][price]"),
    "price_cultivator_unit"
  );
  assert.equal(form.get("customer"), "cus_unit");
  assert.equal(form.get("metadata[firebaseUid]"), "firebase-user");
  assert.equal(form.get("metadata[planId]"), "cultivator");
  assert.match(form.get("success_url"), /billing=success/);
  assert.match(
    form.get("success_url"),
    /session_id=\{CHECKOUT_SESSION_ID\}/
  );
  assert.doesNotMatch(
    form.get("success_url"),
    /session_id=%7BCHECKOUT_SESSION_ID%7D/i
  );
  assert.match(form.get("cancel_url"), /billing=canceled/);
  assert.equal(form.get("automatic_tax[enabled]"), "true");
  assert.equal(form.get("allow_promotion_codes"), "false");
});

test("Stripe webhook verification accepts a current valid raw-body signature", () => {
  const event = {
    id: "evt_unit_valid",
    type: "customer.subscription.updated",
    created: 1780000000,
    data: { object: { id: "sub_unit" } },
  };
  const payload = JSON.stringify(event);
  const signature = createHmac("sha256", configInput.webhookSecret)
    .update(`${event.created}.${payload}`, "utf8")
    .digest("hex");

  const verified = verifyStripeWebhookSignature({
    rawBody: Buffer.from(payload),
    signatureHeader: `t=${event.created},v1=${signature}`,
    webhookSecret: configInput.webhookSecret,
    now: new Date(event.created * 1000),
  });

  assert.equal(verified.id, event.id);
});

test("Stripe webhook verification rejects tampered and replayed payloads", () => {
  const event = {
    id: "evt_unit_replay",
    type: "invoice.payment_failed",
    created: 1780000000,
    data: { object: { id: "in_unit" } },
  };
  const payload = JSON.stringify(event);
  const signature = createHmac("sha256", configInput.webhookSecret)
    .update(`${event.created}.${payload}`, "utf8")
    .digest("hex");
  const header = `t=${event.created},v1=${signature}`;

  assert.throws(
    () =>
      verifyStripeWebhookSignature({
        rawBody: `${payload} `,
        signatureHeader: header,
        webhookSecret: configInput.webhookSecret,
        now: new Date(event.created * 1000),
      }),
    /verification failed/
  );

  assert.throws(
    () =>
      verifyStripeWebhookSignature({
        rawBody: payload,
        signatureHeader: header,
        webhookSecret: configInput.webhookSecret,
        now: new Date((event.created + 301) * 1000),
      }),
    /outside the accepted tolerance/
  );
});
