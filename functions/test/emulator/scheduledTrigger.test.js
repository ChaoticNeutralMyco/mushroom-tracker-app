// functions/test/emulator/scheduledTrigger.test.js

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  SUBSCRIPTION_BACKEND_REGION,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "../../src/subscriptionConfig.js";

const projectId = process.env.GCLOUD_PROJECT || "chaotic-neutral-tracker";
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
const functionsHost = String(
  process.env.CNM_FUNCTIONS_EMULATOR_HOST ||
    process.env.FUNCTIONS_EMULATOR_HOST ||
    "127.0.0.1:5001"
)
  .replace(/^https?:\/\//i, "")
  .replace(/\/$/, "");
const requestTimeoutMs = 30_000;
const triggerTimeoutMs = 60_000;
const scheduledFunctionName = "reconcileSubscriptionEntitlements";
let app;
let db;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchWithTimeout(url, init = {}, label = "Emulator request") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
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
    throw new Error(
      `Clear Firestore emulator failed (${response.status}): ${body}`
    );
  }
}

function scheduledFunctionUrl(routeName) {
  return `http://${functionsHost}/${projectId}/${SUBSCRIPTION_BACKEND_REGION}/${routeName}`;
}

function discoverScheduledRouteName(body) {
  const text = String(body || "");
  const listMatch = text.match(/valid functions are:\s*([^\r\n]+)/i);
  if (!listMatch) return null;

  const registeredPrefix = `${SUBSCRIPTION_BACKEND_REGION}-${scheduledFunctionName}`;
  const registeredId = listMatch[1]
    .split(",")
    .map((entry) => entry.trim())
    .find(
      (entry) =>
        entry === registeredPrefix || entry.startsWith(`${registeredPrefix}-`)
    );

  if (!registeredId) return null;

  return registeredId.replace(
    new RegExp(`^${escapeRegExp(SUBSCRIPTION_BACKEND_REGION)}-`),
    ""
  );
}

async function invokeScheduledReconciliation() {
  const startedAt = Date.now();
  let routeName = scheduledFunctionName;
  let lastFailure = "No response received.";

  while (Date.now() - startedAt < triggerTimeoutMs) {
    try {
      const scheduleTime = new Date().toISOString();
      const response = await fetchWithTimeout(
        scheduledFunctionUrl(routeName),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CloudScheduler-JobName": `projects/${projectId}/locations/${SUBSCRIPTION_BACKEND_REGION}/jobs/emulator-${scheduledFunctionName}`,
            "X-CloudScheduler-ScheduleTime": scheduleTime,
          },
          body: "{}",
        },
        "Invoke scheduled reconciliation"
      );

      const body = await response.text();

      if (response.ok) {
        return { status: response.status, body, routeName };
      }

      lastFailure = `HTTP ${response.status}: ${body || "empty response"}`;

      if (response.status === 404) {
        const discoveredRouteName = discoverScheduledRouteName(body);

        if (discoveredRouteName && discoveredRouteName !== routeName) {
          routeName = discoveredRouteName;
          lastFailure = `Discovered Functions emulator route: ${routeName}`;
          continue;
        }
      }

      // During Functions startup, the emulator can briefly return a missing or
      // unavailable route. Retry only those readiness states. A loaded function
      // returning another error should fail immediately.
      if (![404, 429, 502, 503].includes(response.status)) {
        throw new Error(
          `Scheduled reconciliation invocation failed (${response.status}): ${body}`
        );
      }
    } catch (error) {
      lastFailure = error?.message || String(error);
      if (!/fetch failed|ECONNREFUSED|socket|404|429|502|503/i.test(lastFailure)) {
        throw error;
      }
    }

    await sleep(500);
  }

  throw new Error(
    `Scheduled reconciliation function was not ready within ${triggerTimeoutMs}ms. Last failure: ${lastFailure}`
  );
}

async function waitForExpired(entitlementRef) {
  const startedAt = Date.now();
  let lastStatus = null;

  while (Date.now() - startedAt < triggerTimeoutMs) {
    const snapshot = await entitlementRef.get();
    lastStatus = snapshot.data()?.status || null;
    if (lastStatus === SUBSCRIPTION_STATUSES.EXPIRED) return;
    await sleep(500);
  }

  throw new Error(
    `Scheduled reconciliation did not expire the entitlement. Last status: ${lastStatus}`
  );
}

before(async () => {
  if (!firestoreHost) {
    throw new Error("FIRESTORE_EMULATOR_HOST is required.");
  }

  if (!/^(127\.0\.0\.1|localhost):\d+$/i.test(functionsHost)) {
    throw new Error(
      `Refusing to invoke a non-local Functions host: ${functionsHost}`
    );
  }

  app = getApps()[0] || initializeApp({ projectId });
  db = getFirestore(app);
  await clearFirestore();
});

after(async () => {
  if (app) await deleteApp(app);
});

test("the exported schedule trigger runs through the Functions emulator HTTP endpoint", async () => {
  const uid = "scheduled-trigger-user";
  const entitlementRef = db.doc(`users/${uid}/billing/entitlement`);

  await entitlementRef.set({
    planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
    status: SUBSCRIPTION_STATUSES.TRIALING,
    source: SUBSCRIPTION_SOURCES.TRIAL,
    trialEndsAt: Timestamp.fromDate(new Date(Date.now() - 60_000)),
    featureOverrides: {},
    limitOverrides: {},
    revision: 1,
  });

  const invocation = await invokeScheduledReconciliation();
  assert.equal(invocation.status, 200);
  assert.match(
    invocation.routeName,
    new RegExp(`^${escapeRegExp(scheduledFunctionName)}(?:-\\d+)?$`)
  );

  await waitForExpired(entitlementRef);

  const stored = (await entitlementRef.get()).data();
  assert.equal(stored.status, SUBSCRIPTION_STATUSES.EXPIRED);
  assert.equal(stored.endReason, "trial_expired");
});
