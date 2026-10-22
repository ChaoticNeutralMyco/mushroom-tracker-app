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

async function seedPackagedFinishedLot(uid, lotId = "trusted-package") {
  await db.doc(`users/${uid}/materialLots/${lotId}`).set({
    lotType: "capsules",
    inventoryCategory: "finished_goods",
    processType: "packaging",
    sourceType: "finished_package",
    packageRunId: lotId,
    status: "available",
    initialQuantity: 10,
    allocatedQuantity: 0,
    remainingQuantity: 10,
    reservationQuantity: 0,
    qcStatus: "pass",
    releaseRequired: true,
    releaseStatus: "released",
    lowStockThreshold: 2,
  });
}

async function seedDryMaterialLot(uid, lotId = "dry-material") {
  await db.doc(`users/${uid}/materialLots/${lotId}`).set({
    lotType: "dry_material",
    inventoryCategory: "material",
    processType: "drying",
    sourceType: "grow",
    status: "available",
    initialQuantity: 100,
    allocatedQuantity: 0,
    remainingQuantity: 100,
    unit: "g",
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

test("browser clients cannot mutate trusted packaged finished inventory accounting fields", async () => {
  const lotId = "protected-package";
  const path = `users/${owner.uid}/materialLots/${lotId}`;

  await seedPackagedFinishedLot(owner.uid, lotId);

  const remaining = await firestoreRequest({
    method: "PATCH",
    path,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=remainingQuantity",
    body: firestoreFields({
      remainingQuantity: 999,
    }),
  });
  assertDenied(remaining, "Packaged remaining-quantity mutation");

  const status = await firestoreRequest({
    method: "PATCH",
    path,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=status",
    body: firestoreFields({
      status: "depleted",
    }),
  });
  assertDenied(status, "Packaged status mutation");

  const movementType = await firestoreRequest({
    method: "PATCH",
    path,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=lastOutboundMovementType",
    body: firestoreFields({
      lastOutboundMovementType: "sell",
    }),
  });
  assertDenied(movementType, "Packaged outbound movement mutation");

  const archived = await firestoreRequest({
    method: "PATCH",
    path,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=archived",
    body: firestoreFields({
      archived: true,
    }),
  });
  assertDenied(archived, "Packaged archive-state mutation");

  const stored = (await db.doc(path).get()).data();
  assert.equal(stored.remainingQuantity, 10);
  assert.equal(stored.status, "available");
  assert.equal(stored.archived, undefined);
});

function nestedFirestoreFields(parentField, data) {
  return {
    fields: {
      [parentField]: {
        mapValue: firestoreFields(data),
      },
    },
  };
}

async function seedSkuIdentityFixture(uid, lotId) {
  await seedPackagedFinishedLot(uid, lotId);
  await db.doc(`users/${uid}/materialLots/${lotId}`).set({
    productType: "capsule",
    productName: "Lion's Mane",
    strainName: "Lion's Mane",
    variantTag: "standard",
    skuType: "retail",
    packageSkuType: "retail",
    packageSize: 3.5,
    packageSizeUnit: "g",
    packageSizeLabel: "3.5 g",
    packDate: "2026-10-01",
    package: {
      isPackaged: true,
      skuType: "retail",
      size: 3.5,
      unit: "g",
      label: "3.5 g",
      packagedDate: "2026-10-01",
      costPerPackage: 2,
    },
    labelMetadata: {
      productName: "Lion's Mane",
      skuType: "retail",
      packageSizeLabel: "3.5 g",
      packDate: "2026-10-01",
      bestBy: "2027-10-01",
      notes: "Initial artwork note",
    },
    shelfLife: {
      madeOn: "2026-10-01",
      bestBy: "2027-10-01",
    },
  }, { merge: true });
}

test("browser owners cannot change existing packaged SKU identity or FEFO age fields", async () => {
  const lotId = "sku-identity-locked";
  const path = `users/${owner.uid}/materialLots/${lotId}`;
  await seedSkuIdentityFixture(owner.uid, lotId);

  const immutableFields = [
    ["skuType", "sample"],
    ["packageSkuType", "promo"],
    ["productName", "Reishi"],
    ["strainName", "Cordyceps"],
    ["variantTag", "new-formula"],
    ["packageSizeLabel", "7 g"],
    ["packageSize", 7],
    ["lotType", "dry_material"],
    ["sourceType", "grow"],
    ["packDate", "2028-10-01"],
  ];

  for (const [field, value] of immutableFields) {
    const result = await firestoreRequest({
      method: "PATCH",
      path,
      token: owner.idToken,
      query: `?updateMask.fieldPaths=${field}`,
      body: firestoreFields({ [field]: value }),
    });
    assertDenied(result, `Packaged SKU identity field ${field}`);
  }

  const otherAccount = await firestoreRequest({
    method: "PATCH",
    path,
    token: otherUser.idToken,
    query: "?updateMask.fieldPaths=skuType",
    body: firestoreFields({ skuType: "sample" }),
  });
  assertDenied(otherAccount, "Cross-account packaged SKU identity edit");

  const stored = (await db.doc(path).get()).data();
  assert.equal(stored.skuType, "retail");
  assert.equal(stored.productName, "Lion's Mane");
  assert.equal(stored.packageSizeLabel, "3.5 g");
  assert.equal(stored.packDate, "2026-10-01");
});

test("browser owners cannot rewrite nested package and label FEFO identity", async () => {
  const lotId = "nested-identity-locked";
  const path = `users/${owner.uid}/materialLots/${lotId}`;
  await seedSkuIdentityFixture(owner.uid, lotId);

  for (const [field, value] of [
    ["package.skuType", "sample"],
    ["package.label", "7 g"],
    ["package.size", 7],
    ["package.isPackaged", false],
    ["package.packagedDate", "2028-10-01"],
    ["labelMetadata.productName", "Reishi"],
    ["labelMetadata.skuType", "sample"],
    ["labelMetadata.packageSizeLabel", "7 g"],
    ["labelMetadata.bestBy", "2029-01-01"],
    ["labelMetadata.packDate", "2028-10-01"],
  ]) {
    const [parent, child] = field.split(".");
    const result = await firestoreRequest({
      method: "PATCH",
      path,
      token: owner.idToken,
      query: `?updateMask.fieldPaths=${field}`,
      body: nestedFirestoreFields(parent, { [child]: value }),
    });
    assertDenied(result, `Nested SKU or FEFO identity ${field}`);
  }

  // Replacing a whole nested map must not erase a protected identity field.
  const wholeMapReplacement = await firestoreRequest({
    method: "PATCH",
    path,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=package",
    body: nestedFirestoreFields("package", { costPerPackage: 3 }),
  });
  assertDenied(wholeMapReplacement, "Whole-package map identity removal");

  const stored = (await db.doc(path).get()).data();
  assert.equal(stored.package.skuType, "retail");
  assert.equal(stored.package.label, "3.5 g");
  assert.equal(stored.labelMetadata.bestBy, "2027-10-01");
});

test("owners retain QC, shelf life, reservations and unrelated package metadata updates", async () => {
  const lotId = "sku-operational-metadata";
  const path = `users/${owner.uid}/materialLots/${lotId}`;
  await seedSkuIdentityFixture(owner.uid, lotId);

  const edits = [
    {
      field: "qcStatus",
      body: firestoreFields({ qcStatus: "pass" }),
    },
    {
      field: "releaseStatus",
      body: firestoreFields({ releaseStatus: "released" }),
    },
    {
      field: "lowStockThreshold",
      body: firestoreFields({ lowStockThreshold: 5 }),
    },
    {
      field: "reservationQuantity",
      body: firestoreFields({ reservationQuantity: 2 }),
    },
    {
      field: "shelfLife.bestBy",
      body: nestedFirestoreFields("shelfLife", { bestBy: "2027-11-01" }),
    },
    {
      field: "package.costPerPackage",
      body: nestedFirestoreFields("package", { costPerPackage: 3 }),
    },
    {
      field: "labelMetadata.notes",
      body: nestedFirestoreFields("labelMetadata", { notes: "Reprinted label" }),
    },
  ];

  for (const { field, body } of edits) {
    const result = await firestoreRequest({
      method: "PATCH",
      path,
      token: owner.idToken,
      query: `?updateMask.fieldPaths=${field}`,
      body,
    });
    assert.equal(result.status, 200, `${field}: ${result.body}`);
  }

  const stored = (await db.doc(path).get()).data();
  assert.equal(stored.qcStatus, "pass");
  assert.equal(stored.lowStockThreshold, 5);
  assert.equal(stored.reservationQuantity, 2);
  assert.equal(stored.shelfLife.bestBy, "2027-11-01");
  assert.equal(stored.package.costPerPackage, 3);
  assert.equal(stored.labelMetadata.notes, "Reprinted label");
  assert.equal(stored.skuType, "retail");
  assert.equal(stored.labelMetadata.productName, "Lion's Mane");
});

test("new packaged lots remain owner-creatable and non-packaged lots remain editable", async () => {
  const newPath = `users/${owner.uid}/materialLots/sku-new-package`;
  const create = await firestoreRequest({
    method: "PATCH",
    path: newPath,
    token: owner.idToken,
    body: firestoreFields({
      lotType: "capsules",
      sourceType: "finished_package",
      packageRunId: "sku-new-package",
      skuType: "retail",
      packageSizeLabel: "7 g",
      remainingQuantity: 10,
    }),
  });
  assert.equal(create.status, 200, create.body);

  const postCreate = await firestoreRequest({
    method: "PATCH",
    path: newPath,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=skuType",
    body: firestoreFields({ skuType: "sample" }),
  });
  assertDenied(postCreate, "SKU identity change following package creation");

  const dryPath = `users/${owner.uid}/materialLots/sku-normal-material`;
  await seedDryMaterialLot(owner.uid, "sku-normal-material");
  const materialUpdate = await firestoreRequest({
    method: "PATCH",
    path: dryPath,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=lotType",
    body: firestoreFields({ lotType: "extract" }),
  });
  assert.equal(materialUpdate.status, 200, materialUpdate.body);
});

test("browser owners cannot delete packaged finished lots but can delete ordinary material lots", async () => {
  const packagedLotId = "delete-protected-package";
  const packagedPath = `users/${owner.uid}/materialLots/${packagedLotId}`;
  const dryLotId = "delete-ordinary-dry-material";
  const dryPath = `users/${owner.uid}/materialLots/${dryLotId}`;

  await seedPackagedFinishedLot(owner.uid, packagedLotId);
  await seedDryMaterialLot(owner.uid, dryLotId);

  const ownerDeletePackaged = await firestoreRequest({
    method: "DELETE",
    path: packagedPath,
    token: owner.idToken,
  });
  assertDenied(ownerDeletePackaged, "Owner deletion of a packaged finished lot");

  const otherDeletePackaged = await firestoreRequest({
    method: "DELETE",
    path: packagedPath,
    token: otherUser.idToken,
  });
  assertDenied(otherDeletePackaged, "Cross-account packaged lot deletion");

  assert.equal((await db.doc(packagedPath).get()).exists, true);
  assert.equal((await db.doc(packagedPath).get()).data().remainingQuantity, 10);

  // Legacy package documents must not escape protection just because they
  // use the nested package marker rather than sourceType or packageRunId.
  const legacyPackagePath = `users/${owner.uid}/materialLots/legacy-nested-package`;
  await db.doc(legacyPackagePath).set({
    lotType: "capsules",
    package: { isPackaged: true },
    remainingQuantity: 3,
  });
  const deleteLegacyPackage = await firestoreRequest({
    method: "DELETE",
    path: legacyPackagePath,
    token: owner.idToken,
  });
  assertDenied(deleteLegacyPackage, "Legacy nested-package deletion");
  assert.equal((await db.doc(legacyPackagePath).get()).exists, true);

  const ownerDeleteDry = await firestoreRequest({
    method: "DELETE",
    path: dryPath,
    token: owner.idToken,
  });
  assert.ok(ownerDeleteDry.ok, ownerDeleteDry.body);
  assert.equal((await db.doc(dryPath).get()).exists, false);
});

test("browser owners cannot delete or rewrite trusted finished inventory movements", async () => {
  const lotId = "movement-deletion-protected-package";
  await seedPackagedFinishedLot(owner.uid, lotId);

  for (const movementType of [
    "sell",
    "donate",
    "sample",
    "waste",
    "destroy",
    "adjustment",
  ]) {
    const path = `users/${owner.uid}/inventoryMovements/trusted-${movementType}`;
    await db.doc(path).set({
      movementType,
      processType: "finished_inventory",
      lotId,
      direction: "out",
      quantity: 1,
    });

    const ownerDelete = await firestoreRequest({
      method: "DELETE",
      path,
      token: owner.idToken,
    });
    assertDenied(ownerDelete, `Owner deletion of trusted ${movementType} history`);

    const crossAccountDelete = await firestoreRequest({
      method: "DELETE",
      path,
      token: otherUser.idToken,
    });
    assertDenied(crossAccountDelete, `Cross-account deletion of ${movementType} history`);

    assert.equal((await db.doc(path).get()).exists, true);
  }

  // A legacy/misclassified sale must still remain protected by movementType.
  const legacySalePath = `users/${owner.uid}/inventoryMovements/legacy-sale`;
  await db.doc(legacySalePath).set({
    movementType: "sell",
    processType: "material_inventory",
    lotId,
    quantity: 1,
  });
  const legacySaleDelete = await firestoreRequest({
    method: "DELETE",
    path: legacySalePath,
    token: owner.idToken,
  });
  assertDenied(legacySaleDelete, "Legacy sale history deletion");

  // A mislabeled material destruction record referencing a packaged lot
  // must not be removable through the generic material cleanup exception.
  const mislabeledDestroyPath =
    `users/${owner.uid}/inventoryMovements/legacy-packaged-destroy`;
  await db.doc(mislabeledDestroyPath).set({
    movementType: "destroy",
    processType: "material_inventory",
    lotId,
    quantity: 1,
  });
  const packagedDestroyDelete = await firestoreRequest({
    method: "DELETE",
    path: mislabeledDestroyPath,
    token: owner.idToken,
  });
  assertDenied(packagedDestroyDelete, "Legacy packaged destruction history deletion");

  const salePath = `users/${owner.uid}/inventoryMovements/trusted-sell`;
  const ownerRewrite = await firestoreRequest({
    method: "PATCH",
    path: salePath,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=quantity",
    body: firestoreFields({ quantity: 999 }),
  });
  assertDenied(ownerRewrite, "Owner mutation of trusted sale history");
  assert.equal((await db.doc(salePath).get()).data().quantity, 1);
});

test("owners retain deletion of ordinary packaging and material destruction history", async () => {
  const packagedLotId = "history-packaging-source";
  const dryLotId = "history-dry-material";
  const dryLotPath = `users/${owner.uid}/materialLots/${dryLotId}`;
  const packagingPath = `users/${owner.uid}/inventoryMovements/history-package-in`;
  const materialDestroyPath = `users/${owner.uid}/inventoryMovements/history-material-destroy`;

  await seedPackagedFinishedLot(owner.uid, packagedLotId);
  await seedDryMaterialLot(owner.uid, dryLotId);

  const createPackageHistory = await firestoreRequest({
    method: "PATCH",
    path: packagingPath,
    token: owner.idToken,
    body: firestoreFields({
      movementType: "package_in",
      processType: "packaging",
      lotId: packagedLotId,
      direction: "in",
      quantity: 10,
    }),
  });
  assert.equal(createPackageHistory.status, 200, createPackageHistory.body);

  const createMaterialHistory = await firestoreRequest({
    method: "PATCH",
    path: materialDestroyPath,
    token: owner.idToken,
    body: firestoreFields({
      movementType: "destroy",
      processType: "material_inventory",
      lotId: dryLotId,
      direction: "out",
      quantity: 1,
    }),
  });
  assert.equal(createMaterialHistory.status, 200, createMaterialHistory.body);

  // Ordinary material cleanup can leave an orphan historical movement.
  const deleteDry = await firestoreRequest({
    method: "DELETE",
    path: dryLotPath,
    token: owner.idToken,
  });
  assert.ok(deleteDry.ok, deleteDry.body);

  for (const path of [packagingPath, materialDestroyPath]) {
    const remove = await firestoreRequest({
      method: "DELETE",
      path,
      token: owner.idToken,
    });
    assert.ok(remove.ok, `${path}: ${remove.body}`);
    assert.equal((await db.doc(path).get()).exists, false);
  }

  // Cleanup of unrelated package history must not delete its actual lot.
  assert.equal(
    (await db.doc(`users/${owner.uid}/materialLots/${packagedLotId}`).get()).exists,
    true
  );
});

test("owners retain operational package metadata updates outside trusted accounting fields", async () => {
  const lotId = "editable-package";
  const path = `users/${owner.uid}/materialLots/${lotId}`;

  await seedPackagedFinishedLot(owner.uid, lotId);

  const qc = await firestoreRequest({
    method: "PATCH",
    path,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=qcStatus",
    body: firestoreFields({
      qcStatus: "pending",
    }),
  });
  assert.equal(qc.status, 200, qc.body);

  const release = await firestoreRequest({
    method: "PATCH",
    path,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=releaseStatus",
    body: firestoreFields({
      releaseStatus: "pending",
    }),
  });
  assert.equal(release.status, 200, release.body);

  const threshold = await firestoreRequest({
    method: "PATCH",
    path,
    token: owner.idToken,
    query: "?updateMask.fieldPaths=lowStockThreshold",
    body: firestoreFields({
      lowStockThreshold: 4,
    }),
  });
  assert.equal(threshold.status, 200, threshold.body);

  const stored = (await db.doc(path).get()).data();
  assert.equal(stored.qcStatus, "pending");
  assert.equal(stored.releaseStatus, "pending");
  assert.equal(stored.lowStockThreshold, 4);
  assert.equal(stored.remainingQuantity, 10);
});

test("browser clients cannot forge trusted finished inventory movements but retain generic material disposition", async () => {
  const packagedLotId = "movement-package";
  const dryLotId = "movement-dry";

  await seedPackagedFinishedLot(owner.uid, packagedLotId);
  await seedDryMaterialLot(owner.uid, dryLotId);

  const forgedTrusted = await firestoreRequest({
    method: "PATCH",
    path: `users/${owner.uid}/inventoryMovements/forged-trusted`,
    token: owner.idToken,
    body: firestoreFields({
      movementType: "adjustment",
      processType: "finished_inventory",
      lotId: packagedLotId,
      direction: "out",
      quantity: 1,
    }),
  });
  assertDenied(forgedTrusted, "Trusted finished inventory movement creation");

  const spoofedSale = await firestoreRequest({
    method: "PATCH",
    path: `users/${owner.uid}/inventoryMovements/spoofed-sale`,
    token: owner.idToken,
    body: firestoreFields({
      movementType: "sell",
      processType: "material_inventory",
      lotId: dryLotId,
      direction: "out",
      quantity: 1,
    }),
  });
  assertDenied(spoofedSale, "Spoofed browser sale movement");

  const packagedDestroy = await firestoreRequest({
    method: "PATCH",
    path: `users/${owner.uid}/inventoryMovements/packaged-destroy`,
    token: owner.idToken,
    body: firestoreFields({
      movementType: "destroy",
      processType: "material_inventory",
      lotId: packagedLotId,
      direction: "out",
      quantity: 1,
    }),
  });
  assertDenied(packagedDestroy, "Packaged browser destruction movement");

  const genericDestroy = await firestoreRequest({
    method: "PATCH",
    path: `users/${owner.uid}/inventoryMovements/material-destroy`,
    token: owner.idToken,
    body: firestoreFields({
      movementType: "destroy",
      processType: "material_inventory",
      lotId: dryLotId,
      direction: "out",
      quantity: 1,
    }),
  });
  assert.equal(genericDestroy.status, 200, genericDestroy.body);

  const packageMovement = await firestoreRequest({
    method: "PATCH",
    path: `users/${owner.uid}/inventoryMovements/package-in`,
    token: owner.idToken,
    body: firestoreFields({
      movementType: "package_in",
      processType: "packaging",
      lotId: packagedLotId,
      direction: "in",
      quantity: 10,
    }),
  });
  assert.equal(packageMovement.status, 200, packageMovement.body);
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
