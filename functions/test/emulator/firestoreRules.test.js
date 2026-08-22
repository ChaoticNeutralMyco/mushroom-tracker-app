// functions/test/emulator/firestoreRules.test.js

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT || "chaotic-neutral-tracker";
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const authHost = String(
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.AUTH_EMULATOR_HOST ||
    ""
).trim();

const requestTimeoutMs = 15_000;
const firestoreBaseUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;

let app;
let db;
let owner;
let otherUser;

function encodePath(path) {
  return String(path)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function fetchWithTimeout(url, init = {}, label = "Emulator request") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${requestTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function clearFirestore() {
  const response = await fetchWithTimeout(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
    "Clear Firestore emulator"
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Could not clear Firestore emulator (${response.status}): ${body}`);
  }
}

async function createAuthUser(label) {
  const response = await fetchWithTimeout(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=cnm-rules-test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${label}@cnm-rules.test`,
        password: "RulesTestPassword123!",
        returnSecureToken: true,
      }),
    },
    `Create ${label} Auth emulator user`
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Could not create ${label} Auth user (${response.status}): ${body}`);
  }

  const payload = JSON.parse(body);
  return {
    uid: String(payload.localId),
    idToken: String(payload.idToken),
  };
}

async function firestoreRequest({
  method = "GET",
  path = "",
  token = null,
  body = undefined,
  query = "",
}) {
  const suffix = path ? `/${encodePath(path)}` : "";
  const response = await fetchWithTimeout(
    `${firestoreBaseUrl}${suffix}${query}`,
    {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    `${method} ${path || "documents"}`
  );

  return {
    status: response.status,
    ok: response.ok,
    body: await response.text(),
  };
}

function firestoreFields(data) {
  return {
    fields: Object.fromEntries(
      Object.entries(data).map(([key, value]) => {
        if (typeof value === "boolean") return [key, { booleanValue: value }];
        if (typeof value === "number" && Number.isInteger(value)) {
          return [key, { integerValue: String(value) }];
        }
        return [key, { stringValue: String(value) }];
      })
    ),
  };
}

function assertDenied(result, label) {
  assert.ok(
    result.status === 401 || result.status === 403,
    `${label} should be denied, received ${result.status}: ${result.body}`
  );
}

async function seedEntitlement(uid) {
  const ref = db.doc(`users/${uid}/billing/entitlement`);
  await ref.set({
    planId: "lab",
    status: "active",
    source: "stripe",
    currentPeriodEndsAt: Timestamp.fromDate(
      new Date("2026-08-31T00:00:00.000Z")
    ),
    featureOverrides: {},
    limitOverrides: {},
    revision: 1,
  });

  await ref.collection("events").doc("trusted-event").set({
    type: "subscription_activated",
    createdAt: Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z")),
  });
}

async function seedAdminGrant(uid) {
  await db.doc(`users/${uid}/billing/adminGrant`).set({
    planId: "lab",
    status: "active",
    startsAt: Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z")),
    endsAt: Timestamp.fromDate(new Date("2026-09-01T00:00:00.000Z")),
    reason: "Trusted promotion",
    revision: 1,
  });
}

before(async () => {
  if (!firestoreHost || !authHost) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are required."
    );
  }

  app = getApps()[0] || initializeApp({ projectId });
  db = getFirestore(app);

  owner = await createAuthUser("owner");
  otherUser = await createAuthUser("other");
  await clearFirestore();
});

beforeEach(async () => {
  await clearFirestore();
});

after(async () => {
  if (app) await deleteApp(app);
});

test("an owner can read their entitlement, promotion, and immutable audit events", async () => {
  await seedEntitlement(owner.uid);
  await seedAdminGrant(owner.uid);

  const entitlement = await firestoreRequest({
    path: `users/${owner.uid}/billing/entitlement`,
    token: owner.idToken,
  });
  assert.equal(entitlement.status, 200, entitlement.body);

  const event = await firestoreRequest({
    path: `users/${owner.uid}/billing/entitlement/events/trusted-event`,
    token: owner.idToken,
  });
  assert.equal(event.status, 200, event.body);

  const promotion = await firestoreRequest({
    path: `users/${owner.uid}/billing/adminGrant`,
    token: owner.idToken,
  });
  assert.equal(promotion.status, 200, promotion.body);
});

test("browser clients cannot create, update, delete, or append billing data", async () => {
  await seedEntitlement(owner.uid);

  const update = await firestoreRequest({
    method: "PATCH",
    path: `users/${owner.uid}/billing/entitlement`,
    token: owner.idToken,
    body: firestoreFields({ planId: "admin", status: "active" }),
  });
  assertDenied(update, "Entitlement update");

  const remove = await firestoreRequest({
    method: "DELETE",
    path: `users/${owner.uid}/billing/entitlement`,
    token: owner.idToken,
  });
  assertDenied(remove, "Entitlement deletion");

  const appendEvent = await firestoreRequest({
    method: "PATCH",
    path: `users/${owner.uid}/billing/entitlement/events/browser-event`,
    token: owner.idToken,
    body: firestoreFields({ type: "forged_upgrade" }),
  });
  assertDenied(appendEvent, "Billing audit event creation");

  const createOtherBillingDoc = await firestoreRequest({
    method: "PATCH",
    path: `users/${owner.uid}/billing/browser-created`,
    token: owner.idToken,
    body: firestoreFields({ status: "active" }),
  });
  assertDenied(createOtherBillingDoc, "Billing document creation");

  const forgePromotion = await firestoreRequest({
    method: "PATCH",
    path: `users/${owner.uid}/billing/adminGrant`,
    token: owner.idToken,
    body: firestoreFields({
      planId: "lab",
      status: "active",
      reason: "forged browser promotion",
    }),
  });
  assertDenied(forgePromotion, "Promotional grant creation");
});

test("other users and signed-out clients cannot read an entitlement", async () => {
  await seedEntitlement(owner.uid);

  const otherRead = await firestoreRequest({
    path: `users/${owner.uid}/billing/entitlement`,
    token: otherUser.idToken,
  });
  assertDenied(otherRead, "Cross-account entitlement read");

  const anonymousRead = await firestoreRequest({
    path: `users/${owner.uid}/billing/entitlement`,
  });
  assertDenied(anonymousRead, "Anonymous entitlement read");
});

test("tester codes and redemption records are completely private to the backend", async () => {
  const codeId = "hashed-code-id";
  await db.doc(`testerCodes/${codeId}`).set({
    active: true,
    planId: "cultivator",
    maxRedemptions: 10,
  });
  await db.doc(`testerCodes/${codeId}/redemptions/${owner.uid}`).set({
    uid: owner.uid,
  });

  const directRead = await firestoreRequest({
    path: `testerCodes/${codeId}`,
    token: owner.idToken,
  });
  assertDenied(directRead, "Tester-code read");

  const redemptionRead = await firestoreRequest({
    path: `testerCodes/${codeId}/redemptions/${owner.uid}`,
    token: owner.idToken,
  });
  assertDenied(redemptionRead, "Tester-code redemption read");

  const listCodes = await firestoreRequest({
    token: owner.idToken,
    path: "testerCodes",
    query: "?pageSize=10",
  });
  assertDenied(listCodes, "Tester-code enumeration");

  const writeCode = await firestoreRequest({
    method: "PATCH",
    path: "testerCodes/browser-code",
    token: owner.idToken,
    body: firestoreFields({ active: true, planId: "lab" }),
  });
  assertDenied(writeCode, "Tester-code creation");
});

test("owners retain normal read and write access outside billing", async () => {
  const taskPath = `users/${owner.uid}/tasks/rules-test-task`;

  const create = await firestoreRequest({
    method: "PATCH",
    path: taskPath,
    token: owner.idToken,
    body: firestoreFields({
      title: "Rules test task",
      status: "open",
    }),
  });
  assert.equal(create.status, 200, create.body);

  const ownerRead = await firestoreRequest({
    path: taskPath,
    token: owner.idToken,
  });
  assert.equal(ownerRead.status, 200, ownerRead.body);

  const otherRead = await firestoreRequest({
    path: taskPath,
    token: otherUser.idToken,
  });
  assertDenied(otherRead, "Cross-account task read");
});

test("internal admin audit data is invisible to every browser account", async () => {
  await db.doc("internalAdminAudit/trusted-admin-event").set({
    action: "promotional_access_granted",
    actorUid: "primary-admin",
    targetUid: owner.uid,
  });

  const ownerRead = await firestoreRequest({
    path: "internalAdminAudit/trusted-admin-event",
    token: owner.idToken,
  });
  assertDenied(ownerRead, "Internal admin audit owner read");

  const otherRead = await firestoreRequest({
    path: "internalAdminAudit/trusted-admin-event",
    token: otherUser.idToken,
  });
  assertDenied(otherRead, "Internal admin audit cross-account read");

  const write = await firestoreRequest({
    method: "PATCH",
    path: "internalAdminAudit/browser-forged",
    token: owner.idToken,
    body: firestoreFields({ action: "forged" }),
  });
  assertDenied(write, "Internal admin audit browser write");
});

test("public reference documents are readable but remain server-write-only", async () => {
  await db.doc("public/subscriptionPlans").set({
    version: 1,
    published: true,
  });

  const anonymousRead = await firestoreRequest({
    path: "public/subscriptionPlans",
  });
  assert.equal(anonymousRead.status, 200, anonymousRead.body);

  const browserWrite = await firestoreRequest({
    method: "PATCH",
    path: "public/browser-created",
    token: owner.idToken,
    body: firestoreFields({ published: true }),
  });
  assertDenied(browserWrite, "Public reference write");
});

test("unknown top-level collections remain denied", async () => {
  const write = await firestoreRequest({
    method: "PATCH",
    path: "browserBilling/forged",
    token: owner.idToken,
    body: firestoreFields({ planId: "admin" }),
  });
  assertDenied(write, "Unknown top-level write");

  await db.doc("serverOnly/secret").set({ value: "private" });
  const read = await firestoreRequest({
    path: "serverOnly/secret",
    token: owner.idToken,
  });
  assertDenied(read, "Unknown top-level read");
});
