// src/lib/user-data-backup.js
import {
  Bytes,
  GeoPoint,
  Timestamp,
  collection,
  doc,
  getDocs,
  writeBatch,
} from "firebase/firestore";

export const BACKUP_FORMAT = "chaotic-neutral-myco-tracker-user-data";
export const BACKUP_VERSION = 2;

// Subscription/billing collections are intentionally excluded. Those records must remain
// controlled by the future trusted billing system rather than a browser-side restore.
export const USER_DATA_COLLECTIONS = Object.freeze([
  // Current core data
  "grows",
  "recipes",
  "supplies",
  "tasks",
  "photos",
  "notes",
  "strains",
  "species",
  "library",
  "labels",
  "settings",
  "storageLocations",
  "clean_queue",
  "supply_audits",

  // Current post-processing and sales history
  "materialLots",
  "processBatches",
  "inventoryMovements",

  // Current/legacy supporting history
  "timeline",
  "analytics",
  "events",
  "images",
  "audit",
  "logs",

  // Legacy aliases retained so old data is not silently omitted from a backup
  "packageRuns",
  "packagedLots",
  "finishedInventory",
  "finishedProducts",
  "productBatches",
  "products",
  "sales",
  "salesOrders",
  "salesRecords",
  "outboundLogs",
  "outboundMovements",
  "ledger",
  "inventoryLedger",
  "preferences",
  "prefs",
  "storage_locations",
  "storage",
  "storages",
  "library_items",
  "strain_library",
  "strainLibrary",
  "strainLibraryItems",
]);

export const GROW_DATA_COLLECTIONS = Object.freeze([
  "grows",
  "tasks",
  "timeline",
  "analytics",
  "events",
  "notes",
  "photos",
  "images",
  "clean_queue",
  "materialLots",
  "processBatches",
  "inventoryMovements",
  "packageRuns",
  "packagedLots",
  "finishedInventory",
  "finishedProducts",
  "productBatches",
  "sales",
  "salesOrders",
  "salesRecords",
  "outboundLogs",
  "outboundMovements",
  "ledger",
  "inventoryLedger",
]);

export const NESTED_USER_DATA_COLLECTIONS = Object.freeze({
  grows: Object.freeze(["environmentLogs"]),
  recipes: Object.freeze(["items"]),
});

export const LOCAL_STORAGE_BACKUP_KEYS = Object.freeze([
  "preferences",
  "cn_theme_style",
  "cn_last_accent",
  "labels.template",
  "labels.codeType",
  "labels.gridOverlay",
  "labels.watermark.enabled",
  "labels.watermark.url",
]);

const TYPE_KEY = "__cnmBackupType";
const MAX_BATCH_WRITES = 400;
const ALLOWED_COLLECTIONS = new Set(USER_DATA_COLLECTIONS);

function isObject(value) {
  return value !== null && typeof value === "object";
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function serializeBackupValue(value) {
  if (value === null || value === undefined) return value ?? null;

  if (typeof value === "number") {
    if (Number.isNaN(value)) return { [TYPE_KEY]: "number", value: "NaN" };
    if (value === Number.POSITIVE_INFINITY) {
      return { [TYPE_KEY]: "number", value: "Infinity" };
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return { [TYPE_KEY]: "number", value: "-Infinity" };
    }
    return value;
  }

  if (typeof value === "string" || typeof value === "boolean") return value;

  if (value instanceof Date) {
    return { [TYPE_KEY]: "date", value: value.toISOString() };
  }

  if (
    value instanceof Timestamp ||
    (typeof value?.toDate === "function" && Number.isFinite(Number(value?.seconds)))
  ) {
    return {
      [TYPE_KEY]: "timestamp",
      seconds: safeNumber(value.seconds),
      nanoseconds: safeNumber(value.nanoseconds),
    };
  }

  if (
    value instanceof GeoPoint ||
    value?.constructor?.name === "GeoPoint"
  ) {
    return {
      [TYPE_KEY]: "geopoint",
      latitude: Number(value.latitude),
      longitude: Number(value.longitude),
    };
  }

  if (value instanceof Bytes || typeof value?.toBase64 === "function") {
    try {
      return {
        [TYPE_KEY]: "bytes",
        value:
          typeof value.toBase64 === "function"
            ? value.toBase64()
            : value.toBase64String(),
      };
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeBackupValue(item));
  }

  // Preserve Firestore document references without restoring arbitrary foreign paths.
  // Import validation below only accepts references under the current user's document.
  if (typeof value?.path === "string" && value?.type === "document") {
    return { [TYPE_KEY]: "documentReference", path: value.path };
  }

  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, serializeBackupValue(nested)])
    );
  }

  return String(value);
}

export function deserializeBackupValue(value, { db, uid } = {}) {
  if (!isObject(value)) return value;

  if (Array.isArray(value)) {
    return value.map((item) => deserializeBackupValue(item, { db, uid }));
  }

  const marker = value[TYPE_KEY];
  if (marker === "timestamp") {
    return new Timestamp(safeNumber(value.seconds), safeNumber(value.nanoseconds));
  }
  if (
    value.type === "firestore/timestamp" &&
    Number.isFinite(Number(value.seconds))
  ) {
    return new Timestamp(safeNumber(value.seconds), safeNumber(value.nanoseconds));
  }
  if (Number.isFinite(Number(value._seconds))) {
    return new Timestamp(
      safeNumber(value._seconds),
      safeNumber(value._nanoseconds)
    );
  }
  if (marker === "date") {
    const parsed = new Date(String(value.value || ""));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (marker === "geopoint") {
    return new GeoPoint(Number(value.latitude), Number(value.longitude));
  }
  if (marker === "bytes") {
    return Bytes.fromBase64String(String(value.value || ""));
  }
  if (marker === "number") {
    if (value.value === "NaN") return Number.NaN;
    if (value.value === "Infinity") return Number.POSITIVE_INFINITY;
    if (value.value === "-Infinity") return Number.NEGATIVE_INFINITY;
  }
  if (marker === "documentReference") {
    const path = String(value.path || "");
    const ownerPrefix = uid ? `users/${uid}/` : "";
    if (db && ownerPrefix && path.startsWith(ownerPrefix)) {
      return doc(db, ...path.split("/"));
    }
    return null;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      deserializeBackupValue(nested, { db, uid }),
    ])
  );
}

function readLocalStorageSnapshot(storage) {
  if (!storage || typeof storage.getItem !== "function") return {};

  const snapshot = {};
  for (const key of LOCAL_STORAGE_BACKUP_KEYS) {
    try {
      const value = storage.getItem(key);
      if (value !== null) snapshot[key] = value;
    } catch {
      // Ignore blocked or unavailable browser storage.
    }
  }
  return snapshot;
}

export function restoreLocalStorageSnapshot(snapshot, storage) {
  if (!snapshot || !storage || typeof storage.setItem !== "function") return 0;

  let restored = 0;
  for (const key of LOCAL_STORAGE_BACKUP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
    const value = snapshot[key];
    if (typeof value !== "string") continue;
    try {
      storage.setItem(key, value);
      restored += 1;
    } catch {
      // Keep restoring the remaining supported keys.
    }
  }
  return restored;
}

async function exportNestedCollections({ db, uid, parentCollection, parentId }) {
  const nestedNames = NESTED_USER_DATA_COLLECTIONS[parentCollection] || [];
  const nested = {};

  for (const nestedName of nestedNames) {
    const snap = await getDocs(
      collection(db, "users", uid, parentCollection, parentId, nestedName)
    );
    if (snap.empty) continue;
    nested[nestedName] = snap.docs.map((nestedDoc) => ({
      id: nestedDoc.id,
      data: serializeBackupValue(nestedDoc.data()),
    }));
  }

  return nested;
}

export async function buildUserDataBackup({
  db,
  uid,
  localStorage: storage = globalThis?.localStorage,
  now = new Date(),
  progress = () => {},
} = {}) {
  if (!db) throw new Error("Firestore is required to create a backup.");
  if (!uid) throw new Error("A signed-in user is required to create a backup.");

  const collections = {};
  let documentCount = 0;
  let nestedDocumentCount = 0;

  for (const collectionName of USER_DATA_COLLECTIONS) {
    progress(`Reading ${collectionName}…`);
    const snap = await getDocs(collection(db, "users", uid, collectionName));
    const records = [];

    for (const firestoreDoc of snap.docs) {
      const nestedCollections = await exportNestedCollections({
        db,
        uid,
        parentCollection: collectionName,
        parentId: firestoreDoc.id,
      });

      const nestedCount = Object.values(nestedCollections).reduce(
        (total, entries) => total + entries.length,
        0
      );
      nestedDocumentCount += nestedCount;
      documentCount += 1;

      const record = {
        id: firestoreDoc.id,
        data: serializeBackupValue(firestoreDoc.data()),
      };
      if (nestedCount > 0) record.subcollections = nestedCollections;
      records.push(record);
    }

    collections[collectionName] = records;
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: "Chaotic Neutral Myco Tracker",
    createdAt: now.toISOString(),
    storageFilesIncluded: false,
    subscriptionDataIncluded: false,
    collections,
    localStorage: readLocalStorageSnapshot(storage),
    summary: {
      collectionCount: USER_DATA_COLLECTIONS.length,
      documentCount,
      nestedDocumentCount,
      totalDocumentCount: documentCount + nestedDocumentCount,
    },
  };
}

function normalizeRecord(record) {
  if (
    !isObject(record) ||
    typeof record.id !== "string" ||
    !record.id.trim() ||
    record.id.includes("/")
  ) {
    return null;
  }

  if (isObject(record.data)) {
    return {
      id: record.id,
      data: record.data,
      subcollections: isObject(record.subcollections)
        ? { ...record.subcollections }
        : {},
    };
  }

  // Legacy backups stored each document as { id, ...data }.
  const { id, subcollections, ...legacyData } = record;
  return {
    id,
    data: legacyData,
    subcollections: isObject(subcollections) ? { ...subcollections } : {},
  };
}

export function normalizeBackupPayload(payload) {
  if (!isObject(payload)) throw new Error("Backup file must contain a JSON object.");

  const isCurrentFormat = payload.format === BACKUP_FORMAT;
  if (isCurrentFormat && Number(payload.version) > BACKUP_VERSION) {
    throw new Error(
      `This backup uses version ${payload.version}, but this app supports through version ${BACKUP_VERSION}.`
    );
  }

  const rawCollections = isObject(payload.collections)
    ? payload.collections
    : Object.fromEntries(
        Object.entries(payload).filter(([, value]) => Array.isArray(value))
      );

  const collections = {};
  const skippedCollections = [];
  let documentCount = 0;
  let nestedDocumentCount = 0;

  for (const [collectionName, rawRecords] of Object.entries(rawCollections)) {
    if (!ALLOWED_COLLECTIONS.has(collectionName)) {
      skippedCollections.push(collectionName);
      continue;
    }
    if (!Array.isArray(rawRecords)) continue;

    const records = rawRecords.map(normalizeRecord).filter(Boolean);
    for (const record of records) {
      for (const [nestedName, nestedRecords] of Object.entries(
        record.subcollections || {}
      )) {
        const allowedNested = NESTED_USER_DATA_COLLECTIONS[collectionName] || [];
        if (!allowedNested.includes(nestedName) || !Array.isArray(nestedRecords)) {
          delete record.subcollections[nestedName];
          continue;
        }
        const normalizedNested = nestedRecords.map(normalizeRecord).filter(Boolean);
        record.subcollections[nestedName] = normalizedNested;
        nestedDocumentCount += normalizedNested.length;
      }
    }

    collections[collectionName] = records;
    documentCount += records.length;
  }

  return {
    format: isCurrentFormat ? BACKUP_FORMAT : "legacy",
    version: isCurrentFormat ? Number(payload.version || 1) : 1,
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt : null,
    storageFilesIncluded: payload.storageFilesIncluded === true,
    collections,
    localStorage: isObject(payload.localStorage) ? payload.localStorage : {},
    skippedCollections,
    summary: {
      collectionCount: Object.keys(collections).length,
      documentCount,
      nestedDocumentCount,
      totalDocumentCount: documentCount + nestedDocumentCount,
    },
  };
}

export function summarizeBackupPayload(payload) {
  return normalizeBackupPayload(payload).summary;
}

async function commitOperationsInChunks(db, operations, progress) {
  let committed = 0;
  for (let start = 0; start < operations.length; start += MAX_BATCH_WRITES) {
    const chunk = operations.slice(start, start + MAX_BATCH_WRITES);
    const batch = writeBatch(db);
    for (const operation of chunk) {
      batch.set(operation.ref, operation.data, { merge: true });
    }
    await batch.commit();
    committed += chunk.length;
    progress(`Restored ${committed} of ${operations.length} records…`);
  }
  return committed;
}

export async function importUserDataBackup({
  db,
  uid,
  payload,
  localStorage: storage = globalThis?.localStorage,
  progress = () => {},
} = {}) {
  if (!db) throw new Error("Firestore is required to restore a backup.");
  if (!uid) throw new Error("A signed-in user is required to restore a backup.");

  const normalized = normalizeBackupPayload(payload);
  const operations = [];

  for (const [collectionName, records] of Object.entries(normalized.collections)) {
    progress(`Preparing ${collectionName}…`);
    for (const record of records) {
      operations.push({
        ref: doc(db, "users", uid, collectionName, record.id),
        data: deserializeBackupValue(record.data, { db, uid }),
      });

      for (const [nestedName, nestedRecords] of Object.entries(
        record.subcollections || {}
      )) {
        for (const nestedRecord of nestedRecords) {
          operations.push({
            ref: doc(
              db,
              "users",
              uid,
              collectionName,
              record.id,
              nestedName,
              nestedRecord.id
            ),
            data: deserializeBackupValue(nestedRecord.data, { db, uid }),
          });
        }
      }
    }
  }

  const restoredDocuments = await commitOperationsInChunks(
    db,
    operations,
    progress
  );
  const restoredLocalKeys = restoreLocalStorageSnapshot(
    normalized.localStorage,
    storage
  );

  return {
    restoredDocuments,
    restoredLocalKeys,
    skippedCollections: normalized.skippedCollections,
    storageFilesIncluded: normalized.storageFilesIncluded,
    summary: normalized.summary,
  };
}
