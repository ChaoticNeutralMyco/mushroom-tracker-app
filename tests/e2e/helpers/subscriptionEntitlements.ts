// tests/e2e/helpers/subscriptionEntitlements.ts
import { expect, Page } from "@playwright/test";
import {
  clickAppTab,
  waitForAppShell,
  waitForFirebaseAuthSession,
} from "./app";
import {
  captureNodeAuthSession,
  type NodeAuthSession,
} from "./firestore";

export type E2eEntitlement = {
  planId: "free" | "hobby" | "cultivator" | "lab" | "admin" | "trial";
  status: "active" | "trialing" | "past_due" | "canceled" | "expired";
  source: "manual" | "stripe" | "admin" | "trial" | "tester_code" | "default";
  trialStartedAt?: Date | string | null;
  trialEndsAt?: Date | string | null;
  currentPeriodEndsAt?: Date | string | null;
  pastDueStartedAt?: Date | string | null;
  graceEndsAt?: Date | string | null;
  featureOverrides?: Record<string, boolean>;
  limitOverrides?: Record<string, number | null>;
  updatedAt?: Date | string;
};

const ADMIN_TOKEN = "owner";
const REQUEST_TIMEOUT_MS = 20_000;

function requireFirestoreEmulatorHost() {
  const host = String(process.env.FIRESTORE_EMULATOR_HOST || "").trim();
  if (!host) {
    throw new Error(
      "Subscription browser tests require FIRESTORE_EMULATOR_HOST. Refusing to write entitlement fixtures outside the emulator."
    );
  }
  return host.replace(/^https?:\/\//i, "");
}

function encodeFirestoreValue(value: unknown): any {
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
    case "string": {
      const date = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
        ? new Date(value)
        : null;
      return date && Number.isFinite(date.getTime())
        ? { timestampValue: date.toISOString() }
        : { stringValue: value };
    }
    case "boolean":
      return { booleanValue: value };
    case "number":
      return Number.isInteger(value)
        ? { integerValue: String(value) }
        : { doubleValue: value };
    case "object":
      return {
        mapValue: {
          fields: encodeFirestoreFields(value as Record<string, unknown>),
        },
      };
    default:
      return { stringValue: String(value) };
  }
}

function encodeFirestoreFields(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data || {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeFirestoreValue(value)])
  );
}

function emulatorDocumentUrl(session: NodeAuthSession, documentPath: string) {
  const host = requireFirestoreEmulatorHost();
  return `http://${host}/v1/projects/${session.projectId}/databases/(default)/documents/${documentPath}`;
}

async function emulatorAdminRequest(
  session: NodeAuthSession,
  documentPath: string,
  init: RequestInit,
  label: string
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(emulatorDocumentUrl(session, documentPath), {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${label} failed (${response.status}): ${body}`);
    }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function setEmulatorAdminDocument(
  session: NodeAuthSession,
  documentPath: string,
  data: Record<string, unknown>
) {
  await emulatorAdminRequest(
    session,
    documentPath,
    {
      method: "PATCH",
      body: JSON.stringify({ fields: encodeFirestoreFields(data) }),
    },
    `Set ${documentPath}`
  );
}

export async function setE2eEntitlement(
  session: NodeAuthSession,
  entitlement: E2eEntitlement
) {
  await setEmulatorAdminDocument(
    session,
    `users/${session.userId}/billing/entitlement`,
    {
      ...entitlement,
      featureOverrides: entitlement.featureOverrides || {},
      limitOverrides: entitlement.limitOverrides || {},
      updatedAt: entitlement.updatedAt || new Date(),
    }
  );
}

export async function applyE2eEntitlement(
  page: Page,
  entitlement: E2eEntitlement
) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppShell(page);
  await waitForFirebaseAuthSession(page);

  const session = await captureNodeAuthSession(page);
  await setE2eEntitlement(session, entitlement);

  // Keep the reload in the harness: it proves both entitlement resolution and
  // Firebase Auth persistence survive a real page navigation.
  await waitForFirebaseAuthSession(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppShell(page);
  await waitForFirebaseAuthSession(page);
  return session;
}

export async function openSubscriptionSettings(page: Page) {
  await clickAppTab(page, "Settings");
  const subscriptionTab = page.getByRole("tab", { name: /^Subscription$/i });
  await expect(subscriptionTab).toBeVisible({ timeout: 20_000 });
  await subscriptionTab.click();
  await expect(subscriptionTab).toHaveAttribute("aria-selected", "true", {
    timeout: 20_000,
  });
  const panel = page.getByTestId("settings-subscription-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  return panel;
}

export async function expectResolvedPlan(page: Page, planLabel: string | RegExp) {
  const panel = await openSubscriptionSettings(page);
  const heading = panel
    .getByTestId("subscription-page")
    .locator("section")
    .first()
    .locator("h2")
    .first();
  await expect(heading).toHaveText(planLabel, { timeout: 30_000 });
  await expect(panel).toContainText(/Entitlement record/i, { timeout: 20_000 });
  await expect(panel).not.toContainText(/Checking subscription access/i, {
    timeout: 30_000,
  });
  return panel;
}

export function entitlement(
  planId: E2eEntitlement["planId"],
  overrides: Partial<E2eEntitlement> = {}
): E2eEntitlement {
  return {
    planId,
    status: "active",
    source: planId === "admin" ? "admin" : "manual",
    ...overrides,
  };
}

export function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
