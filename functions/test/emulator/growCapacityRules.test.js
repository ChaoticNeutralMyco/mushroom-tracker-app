// functions/test/emulator/growCapacityRules.test.js

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

async function createAuthUser() {
  const response = await fetchWithTimeout(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=cnm-grow-rules-test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "grow-rules-owner@cnm-rules.test",
        password: "RulesTestPassword123!",
        returnSecureToken: true,
      }),
    },
    "Create grow-rules Auth emulator user"
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Could not create Auth user (${response.status}): ${body}`);
  }

  const payload = JSON.parse(body);
  return {
    uid: String(payload.localId),
    idToken: String(payload.idToken),
  };
}

function encodePath(path) {
  return String(path)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function fields(data) {
  return {
    fields: Object.fromEntries(
      Object.entries(data).map(([key, value]) => {
        if (value === null) return [key, { nullValue: null }];
        if (typeof value === "boolean") return [key, { booleanValue: value }];
        if (typeof value === "number" && Number.isInteger(value)) {
          return [key, { integerValue: String(value) }];
        }
        return [key, { stringValue: String(value) }];
      })
    ),
  };
}

async function request({
  method = "GET",
  path,
  body,
}) {
  const response = await fetchWithTimeout(
    `${firestoreBaseUrl}/${encodePath(path)}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${owner.idToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    `${method} ${path}`
  );

  return {
    status: response.status,
    body: await response.text(),
  };
}

function assertDenied(result, label) {
  assert.ok(
    result.status === 401 || result.status === 403,
    `${label} should be denied, received ${result.status}: ${result.body}`
  );
}

before(async () => {
  if (!firestoreHost || !authHost) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are required."
    );
  }

  app = getApps()[0] || initializeApp({ projectId });
  db = getFirestore(app);
  owner = await createAuthUser();
  await clearFirestore();
});

beforeEach(async () => {
  await clearFirestore();
});

after(async () => {
  if (app) await deleteApp(app);
});

test("browser clients cannot create active or inactive grow documents directly", async () => {
  const active = await request({
    method: "PATCH",
    path: `users/${owner.uid}/grows/browser-active`,
    body: fields({
      strain: "Forged Active",
      status: "Active",
      stage: "Colonizing",
    }),
  });
  assertDenied(active, "Direct active-grow creation");

  const archived = await request({
    method: "PATCH",
    path: `users/${owner.uid}/grows/browser-archived`,
    body: fields({
      strain: "Forged Archived",
      status: "Archived",
      stage: "Harvested",
      archived: true,
    }),
  });
  assertDenied(archived, "Direct inactive-grow creation");
});

test("browser clients cannot reactivate an inactive grow", async () => {
  const path = `users/${owner.uid}/grows/archived-grow`;
  await db.doc(path).set({
    strain: "Archived Grow",
    status: "Archived",
    stage: "Inoculated",
    archived: true,
  });

  const result = await request({
    method: "PATCH",
    path,
    body: fields({
      strain: "Archived Grow",
      status: "Active",
      stage: "Inoculated",
      archived: false,
    }),
  });

  assertDenied(result, "Direct grow reactivation");
  assert.equal((await db.doc(path).get()).data().status, "Archived");
});

test("owners can continue editing active grows and can complete or archive them", async () => {
  const path = `users/${owner.uid}/grows/active-grow`;
  await db.doc(path).set({
    strain: "Active Grow",
    status: "Active",
    stage: "Colonizing",
    notes: "Before",
  });

  const ordinaryEdit = await request({
    method: "PATCH",
    path,
    body: fields({
      strain: "Active Grow",
      status: "Active",
      stage: "Colonizing",
      notes: "After",
    }),
  });
  assert.equal(ordinaryEdit.status, 200, ordinaryEdit.body);

  const archive = await request({
    method: "PATCH",
    path,
    body: fields({
      strain: "Active Grow",
      status: "Archived",
      stage: "Harvested",
      archived: true,
    }),
  });
  assert.equal(archive.status, 200, archive.body);

  const stored = (await db.doc(path).get()).data();
  assert.equal(stored.status, "Archived");
  assert.equal(stored.stage, "Harvested");
});

test("owners can edit or delete existing inactive grows without reactivating them", async () => {
  const path = `users/${owner.uid}/grows/inactive-grow`;
  await db.doc(path).set({
    strain: "Inactive Grow",
    status: "Archived",
    stage: "Harvested",
    archived: true,
    notes: "Before",
  });

  const edit = await request({
    method: "PATCH",
    path,
    body: fields({
      strain: "Inactive Grow",
      status: "Archived",
      stage: "Harvested",
      archived: true,
      notes: "After",
    }),
  });
  assert.equal(edit.status, 200, edit.body);

  const remove = await request({
    method: "DELETE",
    path,
  });
  assert.ok(
    remove.status === 200 || remove.status === 204,
    `Inactive grow deletion failed (${remove.status}): ${remove.body}`
  );
  assert.equal((await db.doc(path).get()).exists, false);
});
