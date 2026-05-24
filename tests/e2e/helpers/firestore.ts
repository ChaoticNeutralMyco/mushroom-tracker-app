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

const FIRESTORE_REST_TIMEOUT_MS = 20_000;
const FIRESTORE_REST_MAX_ATTEMPTS = 7;
const FIRESTORE_REST_RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number) {
  const base = Math.min(10_000, 750 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function shouldRetryFirestoreRest(status: number) {
  return FIRESTORE_REST_RETRY_STATUS_CODES.has(status);
}

export async function captureNodeAuthSession(page: Page): Promise<NodeAuthSession> {
  return page.evaluate(async (defaults) => {
    const mod = await import("/src/firebase-config.js");
    const currentUser = mod.auth.currentUser;
    if (!currentUser) throw new Error("No authenticated Firebase user found in page context.");

    const idToken = await currentUser.getIdToken();
    return {
      userId: currentUser.uid,
      idToken,
      projectId: mod.app?.options?.projectId || defaults.projectId,
      apiKey: mod.app?.options?.apiKey || defaults.apiKey,
    };
  }, FIREBASE_WEB_DEFAULTS);
}

function firestoreDocumentsBaseUrl(session: NodeAuthSession, path = "") {
  const suffix = path ? `/${path}` : "";
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
  let lastError: unknown;

  for (let attempt = 0; attempt < FIRESTORE_REST_MAX_ATTEMPTS; attempt += 1) {
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
        const error = new Error(`${label} failed (${response.status}): ${body}`);
        lastError = error;

        if (shouldRetryFirestoreRest(response.status) && attempt < FIRESTORE_REST_MAX_ATTEMPTS - 1) {
          await sleep(retryDelayMs(attempt));
          continue;
        }

        throw error;
      }

      if (response.status === 204) return null as T;
      return (await response.json()) as T;
    } catch (error: any) {
      if (error?.name === "AbortError") {
        lastError = new Error(`${label} timed out after ${FIRESTORE_REST_TIMEOUT_MS}ms.`);
      } else {
        lastError = error;
      }

      if (attempt < FIRESTORE_REST_MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(attempt));
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

export async function listFirestoreDocuments(
  session: NodeAuthSession,
  collectionPath: string
) {
  const url = `${firestoreDocumentsBaseUrl(session, collectionPath)}?pageSize=100`;
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
