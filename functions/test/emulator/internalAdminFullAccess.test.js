// functions/test/emulator/internalAdminFullAccess.test.js

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  createGrowBatchWithEntitlement,
  isActiveGrowDocument,
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

function growsRef(uid) {
  return db.collection(`users/${uid}/grows`);
}

function activeGrow(index) {
  return {
    abbr: `INTERNAL-${index}`,
    strain: "Internal Access Test",
    type: "Agar",
    stage: "Colonizing",
    status: "Active",
    amountTotal: 10,
    amountUsed: 0,
  };
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

test("permanent internal access bypasses the public active-grow ceiling without mutating the base entitlement", async () => {
  const uid = "permanent-internal-admin";

  await db.doc(`users/${uid}/billing/entitlement`).set({
    planId: SUBSCRIPTION_PLAN_IDS.FREE,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    source: SUBSCRIPTION_SOURCES.DEFAULT,
    featureOverrides: {},
    limitOverrides: {},
    revision: 1,
  });

  const batch = db.batch();
  for (let index = 1; index <= 6; index += 1) {
    batch.set(growsRef(uid).doc(`active-${index}`), activeGrow(index));
  }
  await batch.commit();

  const result = await createGrowBatchWithEntitlement({
    db,
    uid,
    grows: [activeGrow(7), activeGrow(8)],
    internalFullAccess: true,
    now: "2026-08-22T12:00:00.000Z",
  });

  assert.equal(result.planId, SUBSCRIPTION_PLAN_IDS.ADMIN);
  assert.equal(result.limit, null);
  assert.equal(result.unlimited, true);
  assert.equal(result.resolution, "internal-admin-full-access");
  assert.equal(result.usageBefore, 6);
  assert.equal(result.usageAfter, 8);

  const grows = await growsRef(uid).get();
  assert.equal(
    grows.docs.filter((snapshot) =>
      isActiveGrowDocument(snapshot.data() || {})
    ).length,
    8
  );

  const entitlement = (
    await db.doc(`users/${uid}/billing/entitlement`).get()
  ).data();

  assert.equal(entitlement.planId, SUBSCRIPTION_PLAN_IDS.FREE);
  assert.equal(entitlement.source, SUBSCRIPTION_SOURCES.DEFAULT);
});
