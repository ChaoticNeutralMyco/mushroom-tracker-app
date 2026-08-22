// functions/test/emulator/growCapacityBackend.test.js

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  ACTIVE_GROW_LIMIT_ERROR_CODE,
  GrowServiceError,
  createGrowBatchWithEntitlement,
  isActiveGrowDocument,
  reactivateGrowBatchWithEntitlement,
} from "../../src/growService.js";
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

function growsRef(uid) {
  return db.collection(`users/${uid}/grows`);
}

function activeGrow(index = 1) {
  return {
    abbr: `ACTIVE-${index}`,
    strain: "Rules Test",
    type: "Agar",
    stage: "Colonizing",
    status: "Active",
    amountTotal: 10,
    amountUsed: 0,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

function archivedGrow(index = 1) {
  return {
    abbr: `ARCHIVED-${index}`,
    strain: "Rules Test",
    type: "Agar",
    stage: "Inoculated",
    status: "Archived",
    archived: true,
    archivedAt: new Date("2026-08-01T00:00:00.000Z"),
    amountTotal: 10,
    amountUsed: 0,
  };
}

async function seedEntitlement(
  uid,
  {
    planId = SUBSCRIPTION_PLAN_IDS.FREE,
    status = SUBSCRIPTION_STATUSES.ACTIVE,
    source = SUBSCRIPTION_SOURCES.DEFAULT,
    limitOverrides = {},
  } = {}
) {
  await entitlementRef(uid).set({
    planId,
    status,
    source,
    featureOverrides: {},
    limitOverrides,
    revision: 1,
  });
}

async function seedActiveGrows(uid, count) {
  const batch = db.batch();
  for (let index = 1; index <= count; index += 1) {
    batch.set(growsRef(uid).doc(`active-${index}`), activeGrow(index));
  }
  await batch.commit();
}

async function activeCount(uid) {
  const snapshot = await growsRef(uid).get();
  return snapshot.docs.filter((doc) => isActiveGrowDocument(doc.data())).length;
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

test("Free batch creation is all-or-nothing at the authoritative six-grow limit", async () => {
  const uid = "free-batch-user";
  await seedEntitlement(uid);
  await seedActiveGrows(uid, 5);

  await assert.rejects(
    createGrowBatchWithEntitlement({
      db,
      uid,
      grows: [activeGrow(6), activeGrow(7)],
      now: "2026-08-01T00:00:00.000Z",
    }),
    (error) => {
      assert.equal(error instanceof GrowServiceError, true);
      assert.equal(error.code, "resource-exhausted");
      assert.equal(error.details.code, ACTIVE_GROW_LIMIT_ERROR_CODE);
      assert.equal(error.details.usage, 5);
      assert.equal(error.details.limit, 6);
      assert.equal(error.details.requested, 2);
      return true;
    }
  );

  assert.equal(await activeCount(uid), 5);

  const allowed = await createGrowBatchWithEntitlement({
    db,
    uid,
    grows: [activeGrow(6)],
    now: "2026-08-01T00:00:00.000Z",
  });

  assert.equal(allowed.growIds.length, 1);
  assert.equal(allowed.usageAfter, 6);
  assert.equal(await activeCount(uid), 6);
});

test("the capacity lock serializes simultaneous browser-session creates", async () => {
  const uid = "concurrent-create-user";
  await seedEntitlement(uid);
  await seedActiveGrows(uid, 5);

  const results = await Promise.allSettled([
    createGrowBatchWithEntitlement({
      db,
      uid,
      grows: [activeGrow(6)],
      now: "2026-08-01T00:00:00.000Z",
    }),
    createGrowBatchWithEntitlement({
      db,
      uid,
      grows: [activeGrow(7)],
      now: "2026-08-01T00:00:00.000Z",
    }),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1
  );
  assert.equal(await activeCount(uid), 6);

  const lock = (
    await db.doc(`users/${uid}/billing/growCapacity`).get()
  ).data();
  assert.equal(lock.activeCountAfter, 6);
  assert.equal(lock.activeGrowLimit, 6);
  assert.equal(lock.revision, 1);
});

test("trusted overrides and unlimited plans are honored while inactive paid access falls back to Free", async () => {
  const overrideUid = "override-user";
  await seedEntitlement(overrideUid, {
    limitOverrides: { activeGrows: 7 },
  });
  await seedActiveGrows(overrideUid, 6);

  const overrideResult = await createGrowBatchWithEntitlement({
    db,
    uid: overrideUid,
    grows: [activeGrow(7)],
  });
  assert.equal(overrideResult.usageAfter, 7);
  assert.equal(overrideResult.limit, 7);

  const unlimitedUid = "unlimited-user";
  await seedEntitlement(unlimitedUid, {
    planId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
  });
  await seedActiveGrows(unlimitedUid, 6);

  const unlimitedResult = await createGrowBatchWithEntitlement({
    db,
    uid: unlimitedUid,
    grows: [activeGrow(7), activeGrow(8)],
  });
  assert.equal(unlimitedResult.limit, null);
  assert.equal(unlimitedResult.usageAfter, 8);

  const expiredUid = "expired-lab-user";
  await seedEntitlement(expiredUid, {
    planId: SUBSCRIPTION_PLAN_IDS.LAB,
    status: SUBSCRIPTION_STATUSES.EXPIRED,
    source: SUBSCRIPTION_SOURCES.STRIPE,
    limitOverrides: { activeGrows: null },
  });
  await seedActiveGrows(expiredUid, 6);

  await assert.rejects(
    createGrowBatchWithEntitlement({
      db,
      uid: expiredUid,
      grows: [activeGrow(7)],
    }),
    (error) => {
      assert.equal(error.details.limit, 6);
      return true;
    }
  );
});

test("reactivation batches are atomic and cannot partially exceed capacity", async () => {
  const uid = "reactivation-user";
  await seedEntitlement(uid);
  await seedActiveGrows(uid, 5);
  await growsRef(uid).doc("archived-one").set(archivedGrow(1));
  await growsRef(uid).doc("archived-two").set(archivedGrow(2));

  const updates = ["archived-one", "archived-two"].map((growId) => ({
    growId,
    patch: {
      status: "Active",
      archived: { __cnmDeleteField: true },
      archivedAt: { __cnmDeleteField: true },
      updatedAt: { __cnmServerTimestamp: true },
    },
  }));

  await assert.rejects(
    reactivateGrowBatchWithEntitlement({
      db,
      uid,
      updates,
    }),
    (error) => {
      assert.equal(error.code, "resource-exhausted");
      assert.equal(error.details.usage, 5);
      assert.equal(error.details.requested, 2);
      return true;
    }
  );

  assert.equal(
    (await growsRef(uid).doc("archived-one").get()).data().status,
    "Archived"
  );
  assert.equal(
    (await growsRef(uid).doc("archived-two").get()).data().status,
    "Archived"
  );
  assert.equal(await activeCount(uid), 5);

  const allowed = await reactivateGrowBatchWithEntitlement({
    db,
    uid,
    updates: [updates[0]],
  });

  assert.equal(allowed.reactivated, 1);
  assert.equal(allowed.usageAfter, 6);
  assert.equal(await activeCount(uid), 6);

  const stored = (await growsRef(uid).doc("archived-one").get()).data();
  assert.equal(stored.status, "Active");
  assert.equal(Object.prototype.hasOwnProperty.call(stored, "archived"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stored, "archivedAt"), false);
});
