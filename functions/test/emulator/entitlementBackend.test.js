// functions/test/emulator/entitlementBackend.test.js

import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getApps, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  activatePaidEntitlement,
  markEntitlementPastDue,
  provisionInitialTrialEntitlement,
  reconcileExpiredEntitlements,
} from "../../src/entitlementService.js";
import {
  hashTesterCode,
} from "../../src/entitlementModel.js";
import { redeemTesterCode } from "../../src/testerCodeService.js";
import { processStripeBillingEvent } from "../../src/billingService.js";
import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "../../src/subscriptionConfig.js";

const projectId = process.env.GCLOUD_PROJECT || "chaotic-neutral-tracker";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
let app;
let db;

async function clearFirestore() {
  if (!firestoreHost) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required for emulator tests.");
  }

  const response = await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" }
  );

  if (!response.ok) {
    throw new Error(`Could not clear Firestore emulator: ${response.status}`);
  }
}

function entitlementRef(uid) {
  return db.doc(`users/${uid}/billing/entitlement`);
}

before(async () => {
  if (!firestoreHost) {
    throw new Error("Run this suite through the Firebase emulator script.");
  }

  app = getApps()[0] || initializeApp({ projectId });
  db = getFirestore(app);
  await clearFirestore();
});

beforeEach(async () => {
  await clearFirestore();
});

after(async () => {
  if (app) await deleteApp(app);
});

test("initial trial provisioning is transactional and idempotent", async () => {
  const uid = "trial-user";
  const now = new Date("2026-07-28T12:00:00.000Z");

  const first = await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: now,
    now,
    eventId: "auth-created-test",
  });
  const second = await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: new Date("2026-07-29T12:00:00.000Z"),
    now: new Date("2026-07-29T12:00:00.000Z"),
    eventId: "auth-created-retry",
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.planId, SUBSCRIPTION_PLAN_IDS.TRIAL);
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.TRIALING);
  assert.equal(stored.revision, 1);
  assert.equal(
    stored.trialStartedAt.toDate().toISOString(),
    "2026-07-28T12:00:00.000Z"
  );

  const events = await entitlementRef(uid).collection("events").get();
  assert.equal(events.size, 1);
});

test("paid activation and past-due transition are idempotent and use trusted grace timestamps", async () => {
  const uid = "paid-user";
  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  await activatePaidEntitlement({
    db,
    uid,
    eventId: "stripe-subscription-active-1",
    planId: SUBSCRIPTION_PLAN_IDS.LAB,
    currentPeriodEndsAt: "2026-08-28T00:00:00.000Z",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
  });

  const firstPastDue = await markEntitlementPastDue({
    db,
    uid,
    eventId: "stripe-invoice-failed-1",
    pastDueStartedAt: "2026-08-28T00:00:00.000Z",
  });
  const retryPastDue = await markEntitlementPastDue({
    db,
    uid,
    eventId: "stripe-invoice-failed-1",
    pastDueStartedAt: "2026-08-29T00:00:00.000Z",
  });

  assert.equal(firstPastDue.applied, true);
  assert.equal(retryPastDue.idempotent, true);

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.planId, SUBSCRIPTION_PLAN_IDS.LAB);
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.PAST_DUE);
  assert.equal(
    stored.graceEndsAt.toDate().toISOString(),
    "2026-08-31T00:00:00.000Z"
  );
});

test("scheduled reconciliation expires trials, grace periods, and tester grants", async () => {
  const now = new Date("2026-08-15T00:00:00.000Z");

  await entitlementRef("expired-trial").set({
    planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
    status: SUBSCRIPTION_STATUSES.TRIALING,
    source: SUBSCRIPTION_SOURCES.TRIAL,
    trialEndsAt: Timestamp.fromDate(new Date("2026-08-14T00:00:00.000Z")),
    featureOverrides: {},
    limitOverrides: {},
    revision: 1,
  });
  await entitlementRef("expired-grace").set({
    planId: SUBSCRIPTION_PLAN_IDS.LAB,
    status: SUBSCRIPTION_STATUSES.PAST_DUE,
    source: SUBSCRIPTION_SOURCES.STRIPE,
    graceEndsAt: Timestamp.fromDate(new Date("2026-08-14T00:00:00.000Z")),
    featureOverrides: {},
    limitOverrides: {},
    revision: 1,
  });
  await entitlementRef("expired-tester").set({
    planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    source: SUBSCRIPTION_SOURCES.TESTER_CODE,
    currentPeriodEndsAt: Timestamp.fromDate(new Date("2026-08-14T00:00:00.000Z")),
    featureOverrides: {},
    limitOverrides: {},
    revision: 1,
  });

  const result = await reconcileExpiredEntitlements({ db, now });
  assert.equal(result.expired, 3);

  for (const uid of ["expired-trial", "expired-grace", "expired-tester"]) {
    const stored = (await entitlementRef(uid).get()).data();
    assert.equal(stored.status, SUBSCRIPTION_STATUSES.EXPIRED);
  }

  const retry = await reconcileExpiredEntitlements({ db, now });
  assert.equal(retry.expired, 0);
});

test("tester-code redemption stores only a hash and is idempotent per user", async () => {
  const uid = "tester-user";
  const rawCode = "CNM Private Beta 2026";
  const codeHash = hashTesterCode(rawCode);

  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  await db.doc(`testerCodes/${codeHash}`).set({
    active: true,
    planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
    durationDays: 90,
    maxRedemptions: 10,
    redemptionCount: 0,
    featureOverrides: {},
    limitOverrides: { activeGrows: null },
  });

  const first = await redeemTesterCode({
    db,
    uid,
    code: rawCode,
    now: "2026-07-28T00:00:00.000Z",
  });
  const second = await redeemTesterCode({
    db,
    uid,
    code: rawCode,
    now: "2026-07-29T00:00:00.000Z",
  });

  assert.equal(first.redeemed, true);
  assert.equal(second.idempotent, true);

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.planId, SUBSCRIPTION_PLAN_IDS.CULTIVATOR);
  assert.equal(stored.source, SUBSCRIPTION_SOURCES.TESTER_CODE);
  assert.equal(stored.testerCodeId, codeHash);
  assert.equal(JSON.stringify(stored).includes(rawCode), false);

  const codeDoc = (await db.doc(`testerCodes/${codeHash}`).get()).data();
  assert.equal(codeDoc.redemptionCount, 1);
  assert.equal(
    (
      await db.doc(`testerCodes/${codeHash}/redemptions/${uid}`).get()
    ).exists,
    true
  );
});

const stripeConfig = {
  secretKey: "sk_test_emulator_key",
  webhookSecret: "whsec_emulator_secret",
  appUrl: "http://127.0.0.1:5173",
  priceIds: {
    hobby: "price_hobby_emulator",
    cultivator: "price_cultivator_emulator",
    lab: "price_lab_emulator",
  },
  portalConfigurationId: null,
  apiVersion: null,
  automaticTax: false,
  allowPromotionCodes: true,
};

function stripeSubscription({
  id = "sub_emulator",
  uid = "stripe-user",
  status = "active",
  priceId = stripeConfig.priceIds.lab,
  customerId = "cus_emulator",
  periodEnd = 1788134400,
} = {}) {
  return {
    id,
    object: "subscription",
    status,
    customer: customerId,
    current_period_end: periodEnd,
    metadata: {
      firebaseUid: uid,
      planId: "lab",
    },
    items: {
      data: [
        {
          price: { id: priceId },
          current_period_end: periodEnd,
        },
      ],
    },
  };
}

test("Stripe subscription events activate paid access and remain idempotent", async () => {
  const uid = "stripe-active-user";
  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  const event = {
    id: "evt_subscription_active",
    type: "customer.subscription.updated",
    created: 1785456000,
    data: {
      object: stripeSubscription({ uid }),
    },
  };

  const first = await processStripeBillingEvent({
    db,
    event,
    config: stripeConfig,
    stripeClient: {
      retrieveSubscription: async () => event.data.object,
    },
  });
  const retry = await processStripeBillingEvent({
    db,
    event,
    config: stripeConfig,
    stripeClient: {
      retrieveSubscription: async () => event.data.object,
    },
  });

  assert.equal(first.applied, true);
  assert.equal(retry.idempotent, true);

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.planId, SUBSCRIPTION_PLAN_IDS.LAB);
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.ACTIVE);
  assert.equal(stored.source, SUBSCRIPTION_SOURCES.STRIPE);
  assert.equal(stored.stripeCustomerId, "cus_emulator");
  assert.equal(stored.stripeSubscriptionId, "sub_emulator");
  assert.equal(stored.stripePriceId, stripeConfig.priceIds.lab);
  assert.equal(stored.stripeEventId, event.id);
});

test("repeated Stripe payment failures do not reset the trusted grace window", async () => {
  const uid = "stripe-past-due-user";
  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  const subscription = stripeSubscription({ uid });
  await processStripeBillingEvent({
    db,
    event: {
      id: "evt_paid_before_failure",
      type: "customer.subscription.updated",
      created: 1785456000,
      data: { object: subscription },
    },
    config: stripeConfig,
    stripeClient: { retrieveSubscription: async () => subscription },
  });

  const pastDueSubscription = {
    ...subscription,
    status: "past_due",
  };

  for (const [eventId, created] of [
    ["evt_invoice_failed_first", 1785542400],
    ["evt_invoice_failed_retry", 1785628800],
  ]) {
    await processStripeBillingEvent({
      db,
      event: {
        id: eventId,
        type: "invoice.payment_failed",
        created,
        data: {
          object: {
            id: `in_${eventId}`,
            object: "invoice",
            customer: subscription.customer,
            subscription: subscription.id,
          },
        },
      },
      config: stripeConfig,
      stripeClient: { retrieveSubscription: async () => pastDueSubscription },
    });
  }

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.PAST_DUE);
  assert.equal(
    stored.pastDueStartedAt.toDate().toISOString(),
    "2026-08-01T00:00:00.000Z"
  );
  assert.equal(
    stored.graceEndsAt.toDate().toISOString(),
    "2026-08-04T00:00:00.000Z"
  );
});

test("initial Stripe payment failure preserves trial access and never grants paid grace", async () => {
  const uid = "stripe-initial-failure-user";
  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  const incompleteSubscription = stripeSubscription({
    uid,
    status: "incomplete",
  });

  const result = await processStripeBillingEvent({
    db,
    event: {
      id: "evt_initial_invoice_failed",
      type: "invoice.payment_failed",
      created: 1785542400,
      data: {
        object: {
          id: "in_initial_failed",
          object: "invoice",
          customer: incompleteSubscription.customer,
          subscription: incompleteSubscription.id,
        },
      },
    },
    config: stripeConfig,
    stripeClient: {
      retrieveSubscription: async () => incompleteSubscription,
    },
  });

  assert.equal(result.action, "pending");

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.planId, SUBSCRIPTION_PLAN_IDS.TRIAL);
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.TRIALING);
  assert.equal(stored.source, SUBSCRIPTION_SOURCES.TRIAL);
  assert.equal(stored.accessGrantedThroughGrace, false);
  assert.equal(stored.pastDueStartedAt, null);
  assert.equal(stored.graceEndsAt, null);
  assert.equal(stored.stripeSubscriptionId, incompleteSubscription.id);
});

test("past-due Stripe status without established paid access preserves the existing entitlement", async () => {
  const uid = "stripe-unestablished-past-due-user";
  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  const pastDueSubscription = stripeSubscription({
    uid,
    status: "past_due",
  });

  const result = await processStripeBillingEvent({
    db,
    event: {
      id: "evt_unestablished_past_due",
      type: "customer.subscription.updated",
      created: 1785542400,
      data: { object: pastDueSubscription },
    },
    config: stripeConfig,
    stripeClient: {
      retrieveSubscription: async () => pastDueSubscription,
    },
  });

  assert.equal(result.action, "pending");

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.planId, SUBSCRIPTION_PLAN_IDS.TRIAL);
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.TRIALING);
  assert.equal(stored.source, SUBSCRIPTION_SOURCES.TRIAL);
  assert.equal(stored.accessGrantedThroughGrace, false);
  assert.equal(stored.pastDueStartedAt, null);
  assert.equal(stored.graceEndsAt, null);
});

test("canceled Stripe subscription without established paid access preserves trial access", async () => {
  const uid = "stripe-unestablished-canceled-user";
  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  const canceledSubscription = stripeSubscription({
    uid,
    status: "canceled",
  });

  const result = await processStripeBillingEvent({
    db,
    event: {
      id: "evt_unestablished_deleted",
      type: "customer.subscription.deleted",
      created: 1785542400,
      data: { object: canceledSubscription },
    },
    config: stripeConfig,
    stripeClient: {
      retrieveSubscription: async () => canceledSubscription,
    },
  });

  assert.equal(result.action, "pending");

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.planId, SUBSCRIPTION_PLAN_IDS.TRIAL);
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.TRIALING);
  assert.equal(stored.source, SUBSCRIPTION_SOURCES.TRIAL);
  assert.equal(stored.accessGrantedThroughGrace, false);
});

test("unpaid Stripe subscriptions revoke established paid access without grace", async () => {
  const uid = "stripe-unpaid-user";
  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  const activeSubscription = stripeSubscription({ uid });
  await processStripeBillingEvent({
    db,
    event: {
      id: "evt_unpaid_before_active",
      type: "customer.subscription.updated",
      created: 1785456000,
      data: { object: activeSubscription },
    },
    config: stripeConfig,
    stripeClient: {
      retrieveSubscription: async () => activeSubscription,
    },
  });

  const unpaidSubscription = {
    ...activeSubscription,
    status: "unpaid",
  };
  const result = await processStripeBillingEvent({
    db,
    event: {
      id: "evt_subscription_unpaid",
      type: "customer.subscription.updated",
      created: 1785542400,
      data: { object: unpaidSubscription },
    },
    config: stripeConfig,
    stripeClient: {
      retrieveSubscription: async () => unpaidSubscription,
    },
  });

  assert.equal(result.action, "canceled");

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.planId, SUBSCRIPTION_PLAN_IDS.LAB);
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.CANCELED);
  assert.equal(stored.source, SUBSCRIPTION_SOURCES.STRIPE);
  assert.equal(stored.accessGrantedThroughGrace, false);
  assert.equal(stored.endReason, "stripe_subscription_unpaid");
});

test("successful Stripe invoice payment activates the mapped paid plan", async () => {
  const uid = "stripe-invoice-paid-user";
  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  const subscription = stripeSubscription({
    uid,
    status: "active",
    priceId: stripeConfig.priceIds.cultivator,
  });

  const result = await processStripeBillingEvent({
    db,
    event: {
      id: "evt_invoice_paid_activation",
      type: "invoice.paid",
      created: 1785456000,
      data: {
        object: {
          id: "in_paid_activation",
          object: "invoice",
          customer: subscription.customer,
          subscription: subscription.id,
        },
      },
    },
    config: stripeConfig,
    stripeClient: {
      retrieveSubscription: async () => subscription,
    },
  });

  assert.equal(result.action, "active");

  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.planId, SUBSCRIPTION_PLAN_IDS.CULTIVATOR);
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.ACTIVE);
  assert.equal(stored.source, SUBSCRIPTION_SOURCES.STRIPE);
  assert.equal(stored.stripePriceId, stripeConfig.priceIds.cultivator);
});

test("older Stripe events are audited but cannot overwrite newer entitlement state", async () => {
  const uid = "stripe-order-user";
  await provisionInitialTrialEntitlement({
    db,
    uid,
    accountCreatedAt: "2026-07-28T00:00:00.000Z",
    now: "2026-07-28T00:00:00.000Z",
  });

  const subscription = stripeSubscription({ uid });
  await processStripeBillingEvent({
    db,
    event: {
      id: "evt_newer_active",
      type: "customer.subscription.updated",
      created: 1785628800,
      data: { object: subscription },
    },
    config: stripeConfig,
    stripeClient: { retrieveSubscription: async () => subscription },
  });

  const stale = await processStripeBillingEvent({
    db,
    event: {
      id: "evt_older_deleted",
      type: "customer.subscription.deleted",
      created: 1785542400,
      data: {
        object: {
          ...subscription,
          status: "canceled",
        },
      },
    },
    config: stripeConfig,
    stripeClient: { retrieveSubscription: async () => subscription },
  });

  assert.equal(stale.stale, true);
  const stored = (await entitlementRef(uid).get()).data();
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.ACTIVE);
  assert.equal(stored.stripeEventId, "evt_newer_active");

  const audit = await entitlementRef(uid)
    .collection("events")
    .doc("stripe-evt_older_deleted")
    .get();
  assert.equal(audit.exists, true);
  assert.match(audit.data().type, /ignored_stale$/);
});

