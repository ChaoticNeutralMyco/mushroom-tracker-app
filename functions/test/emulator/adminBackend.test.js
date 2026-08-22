// functions/test/emulator/adminBackend.test.js

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  AdminServiceError,
  grantPromotionalAccess,
  parseAdminConfig,
  revokePromotionalAccess,
} from "../../src/adminService.js";
import {
  GrowServiceError,
  createGrowBatchWithEntitlement,
} from "../../src/growService.js";
import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "../../src/subscriptionConfig.js";

const projectId = process.env.GCLOUD_PROJECT || "chaotic-neutral-tracker";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const adminConfig = parseAdminConfig({
  adminUids: ["primary-admin", "personal-admin"],
});

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

function grantRef(uid) {
  return db.doc(`users/${uid}/billing/adminGrant`);
}

function growsRef(uid) {
  return db.collection(`users/${uid}/grows`);
}

async function seedEntitlement(
  uid,
  {
    planId = SUBSCRIPTION_PLAN_IDS.FREE,
    status = SUBSCRIPTION_STATUSES.ACTIVE,
    source = SUBSCRIPTION_SOURCES.DEFAULT,
    stripeCustomerId = null,
    stripeSubscriptionId = null,
    currentPeriodEndsAt = null,
  } = {}
) {
  await entitlementRef(uid).set({
    planId,
    status,
    source,
    featureOverrides: {},
    limitOverrides: {},
    revision: 1,
    stripeCustomerId,
    stripeSubscriptionId,
    currentPeriodEndsAt,
  });
}

function activeGrow(index) {
  return {
    abbr: `ADMIN-PROMO-${index}`,
    strain: "Admin Promo Test",
    type: "Agar",
    stage: "Colonizing",
    status: "Active",
    amountTotal: 10,
    amountUsed: 0,
  };
}

async function seedActiveGrows(uid, count) {
  const batch = db.batch();

  for (let index = 1; index <= count; index += 1) {
    batch.set(growsRef(uid).doc(`active-${index}`), activeGrow(index));
  }

  await batch.commit();
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

test("unauthorized accounts cannot grant promotional access", async () => {
  const uid = "promo-target";
  await seedEntitlement(uid);

  await assert.rejects(
    grantPromotionalAccess({
      db,
      actorUid: "ordinary-user",
      targetUid: uid,
      planId: "lab",
      durationDays: 30,
      reason: "Unauthorized attempt",
      eventId: "unauthorized-promo-attempt",
      adminConfig,
      now: "2026-08-22T12:00:00.000Z",
    }),
    (error) => {
      assert.equal(error instanceof AdminServiceError, true);
      assert.equal(error.code, "permission-denied");
      return true;
    }
  );

  assert.equal((await grantRef(uid).get()).exists, false);
  assert.equal(
    (await db.doc("internalAdminAudit/unauthorized-promo-attempt").get()).exists,
    false
  );
});

test("authorized promotion upgrades and extends without mutating the base entitlement", async () => {
  const uid = "promotion-user";
  await seedEntitlement(uid);

  const before = (await entitlementRef(uid).get()).data();

  const first = await grantPromotionalAccess({
    db,
    actorUid: "primary-admin",
    targetUid: uid,
    planId: "hobby",
    durationDays: 30,
    reason: "Launch giveaway",
    campaign: "launch-2026",
    eventId: "promo-grant-1",
    adminConfig,
    now: "2026-08-22T12:00:00.000Z",
  });

  assert.equal(first.applied, true);
  assert.equal(first.grant.planId, "hobby");
  assert.equal(first.grant.endsAt, "2026-09-21T12:00:00.000Z");

  const extended = await grantPromotionalAccess({
    db,
    actorUid: "personal-admin",
    targetUid: uid,
    planId: "hobby",
    durationDays: 10,
    reason: "Giveaway extension",
    campaign: "launch-2026",
    eventId: "promo-grant-2",
    adminConfig,
    now: "2026-08-23T12:00:00.000Z",
  });

  assert.equal(extended.grant.planId, "hobby");
  assert.equal(extended.grant.endsAt, "2026-10-01T12:00:00.000Z");

  const upgraded = await grantPromotionalAccess({
    db,
    actorUid: "primary-admin",
    targetUid: uid,
    planId: "lab",
    durationDays: 5,
    reason: "Grand prize upgrade",
    campaign: "launch-2026",
    eventId: "promo-grant-3",
    adminConfig,
    now: "2026-08-24T12:00:00.000Z",
  });

  assert.equal(upgraded.grant.planId, "lab");
  assert.equal(upgraded.grant.endsAt, "2026-10-06T12:00:00.000Z");

  await assert.rejects(
    grantPromotionalAccess({
      db,
      actorUid: "primary-admin",
      targetUid: uid,
      planId: "cultivator",
      durationDays: 5,
      reason: "Attempted promo downgrade",
      eventId: "promo-grant-4",
      adminConfig,
      now: "2026-08-25T12:00:00.000Z",
    }),
    (error) => {
      assert.equal(error instanceof AdminServiceError, true);
      assert.equal(error.code, "failed-precondition");
      return true;
    }
  );

  const after = (await entitlementRef(uid).get()).data();
  assert.deepEqual(after, before);

  const audit = await db.collection("internalAdminAudit").get();
  assert.equal(audit.size, 3);
});

test("same-tier paid promotions begin after the trusted paid period end", async () => {
  const uid = "stripe-hobby-extension-user";

  await seedEntitlement(uid, {
    planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    source: SUBSCRIPTION_SOURCES.STRIPE,
    stripeCustomerId: "cus_extension",
    stripeSubscriptionId: "sub_extension",
    currentPeriodEndsAt: new Date("2026-09-15T12:00:00.000Z"),
  });

  const result = await grantPromotionalAccess({
    db,
    actorUid: "primary-admin",
    targetUid: uid,
    planId: "hobby",
    durationDays: 30,
    reason: "Thirty courtesy access days",
    eventId: "same-tier-paid-extension",
    adminConfig,
    now: "2026-08-22T12:00:00.000Z",
  });

  assert.equal(result.grant.startsAt, "2026-09-15T12:00:00.000Z");
  assert.equal(result.grant.endsAt, "2026-10-15T12:00:00.000Z");

  const entitlement = (await entitlementRef(uid).get()).data();
  assert.equal(entitlement.planId, SUBSCRIPTION_PLAN_IDS.HOBBY);
  assert.equal(entitlement.source, SUBSCRIPTION_SOURCES.STRIPE);
  assert.equal(entitlement.stripeSubscriptionId, "sub_extension");
});

test("promotional grants cannot reduce active Stripe-paid access", async () => {
  const uid = "stripe-lab-user";

  await seedEntitlement(uid, {
    planId: SUBSCRIPTION_PLAN_IDS.LAB,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    source: SUBSCRIPTION_SOURCES.STRIPE,
    stripeCustomerId: "cus_admin_test",
    stripeSubscriptionId: "sub_admin_test",
  });

  await assert.rejects(
    grantPromotionalAccess({
      db,
      actorUid: "primary-admin",
      targetUid: uid,
      planId: "hobby",
      durationDays: 30,
      reason: "Invalid lower promotion",
      eventId: "promo-lower-than-paid",
      adminConfig,
      now: "2026-08-22T12:00:00.000Z",
    }),
    (error) => {
      assert.equal(error instanceof AdminServiceError, true);
      assert.equal(error.code, "failed-precondition");
      return true;
    }
  );

  assert.equal((await grantRef(uid).get()).exists, false);
});

test("trusted grow enforcement honors an active higher promotional grant", async () => {
  const uid = "promo-grow-user";
  await seedEntitlement(uid);
  await seedActiveGrows(uid, 6);

  await assert.rejects(
    createGrowBatchWithEntitlement({
      db,
      uid,
      grows: [activeGrow(7)],
      now: "2026-08-22T12:00:00.000Z",
    }),
    (error) => {
      assert.equal(error instanceof GrowServiceError, true);
      assert.equal(error.code, "resource-exhausted");
      return true;
    }
  );

  await grantPromotionalAccess({
    db,
    actorUid: "primary-admin",
    targetUid: uid,
    planId: "hobby",
    durationDays: 30,
    reason: "Promotional Hobby access",
    eventId: "promo-grow-grant",
    adminConfig,
    now: "2026-08-22T12:00:00.000Z",
  });

  const created = await createGrowBatchWithEntitlement({
    db,
    uid,
    grows: [activeGrow(7)],
    now: "2026-08-22T12:01:00.000Z",
  });

  assert.equal(created.usageBefore, 6);
  assert.equal(created.usageAfter, 7);
  assert.equal(created.limit, 30);
  assert.equal(created.planId, "hobby");
  assert.equal(created.resolution, "admin-promotion");

  await revokePromotionalAccess({
    db,
    actorUid: "primary-admin",
    targetUid: uid,
    reason: "Promotion ended early",
    eventId: "promo-grow-revoke",
    adminConfig,
    now: "2026-08-22T12:02:00.000Z",
  });

  await assert.rejects(
    createGrowBatchWithEntitlement({
      db,
      uid,
      grows: [activeGrow(8)],
      now: "2026-08-22T12:03:00.000Z",
    }),
    (error) => {
      assert.equal(error instanceof GrowServiceError, true);
      assert.equal(error.code, "resource-exhausted");
      assert.equal(error.details.limit, 6);
      return true;
    }
  );
});

test("revoking a promotion never changes the Stripe entitlement", async () => {
  const uid = "stripe-hobby-promo-user";

  await seedEntitlement(uid, {
    planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    source: SUBSCRIPTION_SOURCES.STRIPE,
    stripeCustomerId: "cus_keep_paid",
    stripeSubscriptionId: "sub_keep_paid",
  });

  const before = (await entitlementRef(uid).get()).data();

  await grantPromotionalAccess({
    db,
    actorUid: "primary-admin",
    targetUid: uid,
    planId: "lab",
    durationDays: 14,
    reason: "Support courtesy upgrade",
    eventId: "stripe-promo-grant",
    adminConfig,
    now: "2026-08-22T12:00:00.000Z",
  });

  const revoked = await revokePromotionalAccess({
    db,
    actorUid: "primary-admin",
    targetUid: uid,
    reason: "Courtesy promotion complete",
    eventId: "stripe-promo-revoke",
    adminConfig,
    now: "2026-08-23T12:00:00.000Z",
  });

  assert.equal(revoked.grant.status, "revoked");

  const after = (await entitlementRef(uid).get()).data();
  assert.deepEqual(after, before);
});
