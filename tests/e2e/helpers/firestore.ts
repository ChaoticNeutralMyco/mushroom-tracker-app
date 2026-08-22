// tests/e2e/helpers/firestore.ts
import { Page } from "@playwright/test";

export type NodeAuthSession = {
  userId: string;
  idToken: string;
  projectId: string;
  apiKey: string;
};

const FIREBASE_WEB_DEFAULTS = {
  projectId: "chaotic-neutral-tracker",
  apiKey: "AIzaSyAk1paC3CBjU1RH2cXf_8m6xOnZkH_xYWg",
};

const FIRESTORE_REST_TIMEOUT_MS = 15_000;

export async function captureNodeAuthSession(page: Page): Promise<NodeAuthSession> {
  return page.evaluate(async (defaults) => {
    const bridge = (globalThis as any).__CNM_FIREBASE_E2E__;

    if (!bridge || typeof bridge.getAuthSession !== "function") {
      throw new Error(
        "The Firebase E2E session bridge is unavailable. Confirm the app is running through the Vite development server."
      );
    }

    const session = await bridge.getAuthSession();
    if (!session?.userId || !session?.idToken) {
      throw new Error(
        "No authenticated Firebase user found in the existing page runtime after waiting."
      );
    }

    return {
      userId: String(session.userId),
      idToken: String(session.idToken),
      projectId: String(session.projectId || defaults.projectId),
      apiKey: String(session.apiKey || defaults.apiKey),
    };
  }, FIREBASE_WEB_DEFAULTS);
}

function firestoreDocumentsBaseUrl(session: NodeAuthSession, path = "") {
  const suffix = path ? `/${path}` : "";
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

  if (emulatorHost) {
    return `http://${emulatorHost}/v1/projects/${session.projectId}/databases/(default)/documents${suffix}`;
  }

  return `https://firestore.googleapis.com/v1/projects/${session.projectId}/databases/(default)/documents${suffix}`;
}

function encodeFirestoreValue(value: any): any {
  if (value === undefined) return undefined;
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value
          .filter((entry) => entry !== undefined)
          .map((entry) => encodeFirestoreValue(entry)),
      },
    };
  }

  switch (typeof value) {
    case "string":
      return { stringValue: value };
    case "boolean":
      return { booleanValue: value };
    case "number":
      if (Number.isInteger(value)) return { integerValue: String(value) };
      return { doubleValue: value };
    case "object":
      return {
        mapValue: {
          fields: encodeFirestoreFields(value),
        },
      };
    default:
      return { stringValue: String(value) };
  }
}

function encodeFirestoreFields(data: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(data || {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeFirestoreValue(value)])
  );
}

function decodeFirestoreValue(value: any): any {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue || 0);
  if ("doubleValue" in value) return Number(value.doubleValue || 0);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue?.fields || {});
  if ("arrayValue" in value) {
    return Array.isArray(value.arrayValue?.values)
      ? value.arrayValue.values.map((entry: any) => decodeFirestoreValue(entry))
      : [];
  }
  return value;
}

function decodeFirestoreFields(fields: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)])
  );
}

function decodeFirestoreDocument(doc: any) {
  const name = String(doc?.name || "");
  return {
    id: name.split("/").pop() || "",
    ...decodeFirestoreFields(doc?.fields || {}),
  };
}

async function firestoreRestJson<T>(
  session: NodeAuthSession,
  url: string,
  init?: RequestInit,
  label = "Firestore REST request"
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIRESTORE_REST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${label} failed (${response.status}): ${body}`);
    }

    if (response.status === 204) return null as T;
    return (await response.json()) as T;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${FIRESTORE_REST_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listFirestoreDocuments(
  session: NodeAuthSession,
  collectionPath: string
) {
  const url = `${firestoreDocumentsBaseUrl(session, collectionPath)}?pageSize=1000`;
  const payload = await firestoreRestJson<any>(
    session,
    url,
    { method: "GET" },
    `List ${collectionPath}`
  );

  return Array.isArray(payload?.documents)
    ? payload.documents.map((doc: any) => decodeFirestoreDocument(doc))
    : [];
}

export async function setFirestoreDocument(
  session: NodeAuthSession,
  path: string,
  data: Record<string, any>
) {
  const url = firestoreDocumentsBaseUrl(session, path);
  await firestoreRestJson(
    session,
    url,
    {
      method: "PATCH",
      body: JSON.stringify({ fields: encodeFirestoreFields(data) }),
    },
    `Set ${path}`
  );
}

export const E2E_USER_COLLECTIONS = [
  // core app collections
  "grows",
  "tasks",
  "supplies",
  "recipes",
  "labels",
  "strains",
  "library",
  "settings",
  "preferences",
  "prefs",
  "notes",
  "timeline",
  "analytics",
  "events",
  "audit",
  "logs",

  // post-processing current collections
  "materialLots",
  "processBatches",
  "inventoryMovements",
  "supply_audits",
  "storageLocations",
  "storage_locations",

  // legacy/experimental post-processing and sales aliases
  "extractionBatches",
  "extractLots",
  "productionBatches",
  "productBatches",
  "finishedInventory",
  "finishedProducts",
  "packageRuns",
  "packagedLots",
  "products",
  "sales",
  "salesOrders",
  "salesRecords",
  "outboundLogs",
  "outboundMovements",
  "ledger",
  "inventoryLedger",
  "activityLog",

  // media/cache collections
  "calendarEvents",
  "environmentLogs",
  "photos",
  "images",
  "trash",
  "clean_queue",
];

export async function deleteFirestoreDocument(
  session: NodeAuthSession,
  path: string
) {
  const url = firestoreDocumentsBaseUrl(session, path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIRESTORE_REST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "DELETE",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      throw new Error(`Delete ${path} failed (${response.status}): ${body}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function deleteKnownCollection(session: NodeAuthSession, collectionPath: string) {
  const docs = await listFirestoreDocuments(session, collectionPath);

  for (const doc of docs) {
    await deleteFirestoreDocument(session, `${collectionPath}/${doc.id}`);
  }

  return docs.length;
}

export async function deleteE2eUserData(session: NodeAuthSession) {
  const deletedByCollection: Record<string, number> = {};
  let deleted = 0;

  for (const collectionId of E2E_USER_COLLECTIONS) {
    const count = await deleteKnownCollection(session, `users/${session.userId}/${collectionId}`);
    deletedByCollection[collectionId] = count;
    deleted += count;
  }

  await deleteFirestoreDocument(session, `users/${session.userId}`);

  return { deleted, deletedByCollection };
}
