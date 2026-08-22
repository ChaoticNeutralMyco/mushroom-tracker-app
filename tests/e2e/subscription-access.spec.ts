// tests/e2e/subscription-access.spec.ts
import { expect, Locator, Page, test } from "@playwright/test";
import { clickAppTab, waitForAppShell } from "./helpers/app";
import {
  captureNodeAuthSession,
  listFirestoreDocuments,
  type NodeAuthSession,
} from "./helpers/firestore";
import {
  applyE2eEntitlement,
  daysFromNow,
  entitlement,
  expectResolvedPlan,
  setEmulatorAdminDocument,
} from "./helpers/subscriptionEntitlements";

test.describe.configure({ mode: "serial" });
test.setTimeout(8 * 60 * 1000);

const EXISTING_EXTRACTION_ID = "e2e-existing-extraction";
const EXISTING_EXTRACTION_NAME = "E2E Existing Extraction";

function safeVisible(locator: Locator) {
  return locator.isVisible().catch(() => false);
}

async function dismissFeatureNotice(page: Page) {
  const notice = page.getByTestId("subscription-feature-notice");
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await notice.getByRole("button", { name: /^Dismiss$/i }).click();
  await expect(notice).toBeHidden({ timeout: 20_000 });
}

async function openSopToolkit(page: Page) {
  await clickAppTab(page, "Recipes");
  const toolkit = page.getByTestId("sop-workflow-toolkit");
  await expect(toolkit).toBeVisible({ timeout: 30_000 });

  const startButton = page.getByTestId("sop-start-grow-button");
  if (!(await safeVisible(startButton))) {
    await page.getByTestId("sop-toolkit-toggle").click();
  }
  await expect(startButton).toBeVisible({ timeout: 20_000 });
  return toolkit;
}

async function expectActiveGrowLimit(page: Page, expected: RegExp) {
  await clickAppTab(page, "Dashboard");
  await expect(page.getByTestId("active-grow-usage")).toHaveText(expected, {
    timeout: 30_000,
  });
}

async function openSubscriptionSettings(page: Page) {
  await clickAppTab(page, "Settings");
  await page.getByRole("tab", { name: /^Subscription$/i }).click();
  const panel = page.getByTestId("settings-subscription-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("subscription-page")).toBeVisible({
    timeout: 30_000,
  });
  return panel;
}

async function expectSopBlocked(page: Page) {
  await openSopToolkit(page);
  await page.getByTestId("sop-start-grow-button").click();
  await expect(page.locator("form.grow-form")).toHaveCount(0);
  const notice = page.getByTestId("subscription-feature-notice");
  await expect(notice).toContainText(
    /Start a new grow from an SOP template/i
  );
  await expect(notice).toContainText(
    /requires Cultivator or a higher plan/i
  );
  await dismissFeatureNotice(page);
}

async function expectSopAllowed(page: Page) {
  await openSopToolkit(page);
  await page.getByTestId("sop-start-grow-button").click();
  const form = page.locator("form.grow-form");
  await expect(form).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("grow-form-sop-banner")).toBeVisible({
    timeout: 20_000,
  });
  await form.getByRole("button", { name: /^Cancel$/i }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });
}

async function seedExistingExtraction(session: NodeAuthSession) {
  await setEmulatorAdminDocument(
    session,
    `users/${session.userId}/processBatches/${EXISTING_EXTRACTION_ID}`,
    {
      name: EXISTING_EXTRACTION_NAME,
      processType: "extraction",
      processCategory: "manufacturing",
      status: "active",
      extractionType: "ethanol",
      method: "E2E completion-safe fixture",
      strain: "E2E Fixture",
      strains: ["E2E Fixture"],
      date: "2026-07-27",
      inputDryTotal: 10,
      inputMaterialCostTotal: 5,
      batchTotalCost: 5,
      inputLots: [
        {
          lotId: "e2e-source-lot",
          name: "E2E Source Lot",
          quantity: 10,
          selectedQuantity: 10,
          unit: "g",
        },
      ],
      sourceGrowIds: [],
      originGrowIds: [],
      notes: "Created by the subscription tier browser harness.",
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  );
}

async function completeExistingExtractionAsDowngradedUser(
  page: Page,
  session: NodeAuthSession
) {
  await seedExistingExtraction(session);
  await clickAppTab(page, "Post Processing");
  await expect(page.getByTestId("postprocess-read-only-notice")).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: /^Extractions$/i }).click();
  const pendingSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Pending extract outputs$/i }) })
    .first();
  await expect(pendingSection).toBeVisible({ timeout: 30_000 });
  await pendingSection
    .getByRole("button", { name: new RegExp(EXISTING_EXTRACTION_NAME, "i") })
    .click();

  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toContainText(/Record extract output/i, { timeout: 20_000 });
  const outputAmount = dialog
    .locator("label")
    .filter({ hasText: /^Output amount/i })
    .locator("input")
    .first();
  await outputAmount.fill("5");

  const completeButton = dialog.getByRole("button", { name: /^Create Extract Lot$/i });
  await expect(completeButton).toBeEnabled();
  await completeButton.click();

  await expect(page.getByText(/Recorded extract output for E2E Existing Extraction/i)).toBeVisible({
    timeout: 30_000,
  });

  await expect
    .poll(
      async () => {
        const lots = await listFirestoreDocuments(
          session,
          `users/${session.userId}/materialLots`
        );
        return lots.some((lot) => lot.sourceBatchId === EXISTING_EXTRACTION_ID);
      },
      { timeout: 30_000, intervals: [500, 750, 1000, 1500] }
    )
    .toBe(true);
}

async function expectDirectFinishedLabelRequestBlocked(page: Page) {
  await page.goto("/?labelSource=finished_goods", { waitUntil: "domcontentloaded" });
  await waitForAppShell(page);
  await clickAppTab(page, "Labels");
  await expect(page.getByTestId("postprocess-labels-locked")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("subscription-feature-notice")).toBeVisible({
    timeout: 20_000,
  });
  await dismissFeatureNotice(page);
}

async function expectCultivatorAnalytics(page: Page) {
  await clickAppTab(page, "Analytics");
  const cultivation = page.getByRole("tab", { name: /^Cultivation/i });
  await cultivation.click();
  await expect(page.getByTestId("analytics-locked-advancedAnalytics")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Export CSV$/i })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("tab", { name: /^Production & Inventory/i }).click();
  await expect(page.getByTestId("analytics-locked-labAnalytics")).toBeVisible({
    timeout: 20_000,
  });
}

test("Free enforces six grows, blocks paid creation, guards direct labels, and completes existing work", async ({ page }) => {
  const session = await applyE2eEntitlement(page, entitlement("free"));
  await expectResolvedPlan(page, /^Free$/i);
  await expectActiveGrowLimit(page, /0 active grows · 6 allowed/i);
  await expectSopBlocked(page);

  await clickAppTab(page, "Analytics");
  await page.getByRole("tab", { name: /^Cultivation/i }).click();
  await expect(page.getByTestId("analytics-locked-advancedAnalytics").first()).toBeVisible({
    timeout: 20_000,
  });

  await completeExistingExtractionAsDowngradedUser(page, session);
  await expectDirectFinishedLabelRequestBlocked(page);
});

test("Hobby keeps Free features with a thirty-grow limit", async ({ page }) => {
  await applyE2eEntitlement(page, entitlement("hobby"));
  await expectResolvedPlan(page, /^Hobby$/i);
  await expectActiveGrowLimit(page, /0 active grows · 30 allowed/i);
  await expectSopBlocked(page);
});

test("Cultivator unlocks SOP and advanced analytics but keeps Lab operations locked", async ({ page }) => {
  await applyE2eEntitlement(page, entitlement("cultivator"));
  await expectResolvedPlan(page, /^Cultivator$/i);
  await expectActiveGrowLimit(page, /0 active grows · Unlimited/i);
  await expectSopAllowed(page);
  await expectCultivatorAnalytics(page);

  await clickAppTab(page, "Post Processing");
  await expect(page.getByTestId("postprocess-read-only-notice")).toBeVisible({
    timeout: 20_000,
  });
  await clickAppTab(page, "Labels");
  await expect(page.getByTestId("postprocess-labels-locked")).toBeVisible({
    timeout: 20_000,
  });
});

test("Lab unlocks operational creation, Lab analytics, and Post Processing labels", async ({ page }) => {
  await applyE2eEntitlement(page, entitlement("lab"));
  await expectResolvedPlan(page, /^Lab$/i);
  await expectActiveGrowLimit(page, /0 active grows · Unlimited/i);

  await clickAppTab(page, "Post Processing");
  await expect(page.getByTestId("postprocess-read-only-notice")).toHaveCount(0);
  await page.getByRole("button", { name: /^Extractions$/i }).click();
  await page.getByRole("button", { name: /^Create Extraction Batch$/i }).click();
  const createDialog = page.getByRole("dialog").last();
  await expect(createDialog).toContainText(/Create extraction batch/i, {
    timeout: 20_000,
  });
  await createDialog.getByRole("button", { name: /^Close$/i }).click();

  await clickAppTab(page, "Analytics");
  await page.getByRole("tab", { name: /^Production & Inventory/i }).click();
  await expect(page.getByTestId("analytics-locked-labAnalytics")).toHaveCount(0);

  await clickAppTab(page, "Labels");
  await expect(page.getByTestId("postprocess-labels-locked")).toHaveCount(0);
  await expect(page.getByText(/Packaging labels — Avery 5659/i)).toBeVisible({
    timeout: 20_000,
  });
});

for (const status of ["expired", "canceled"] as const) {
  test(`${status} Lab entitlement falls back to Free without deleting access history`, async ({ page }) => {
    await applyE2eEntitlement(
      page,
      entitlement("lab", { status, source: "stripe" })
    );
    const panel = await expectResolvedPlan(page, /^Free$/i);
    await expect(panel).toContainText(new RegExp(`previous lab entitlement is ${status}`, "i"));
    await expectActiveGrowLimit(page, /0 active grows · 6 allowed/i);
    await expectSopBlocked(page);
  });
}

test("past-due Lab inside grace keeps paid access", async ({ page }) => {
  await applyE2eEntitlement(
    page,
    entitlement("lab", {
      status: "past_due",
      source: "stripe",
      pastDueStartedAt: daysFromNow(-1),
      graceEndsAt: daysFromNow(2),
      currentPeriodEndsAt: daysFromNow(-1),
    })
  );
  const panel = await expectResolvedPlan(page, /^Lab$/i);
  await expect(panel).toContainText(/Payment past due/i);
  await expect(panel).toContainText(/of access remaining/i);
  await expectActiveGrowLimit(page, /0 active grows · Unlimited/i);
  await clickAppTab(page, "Post Processing");
  await expect(page.getByTestId("postprocess-read-only-notice")).toHaveCount(0);
});

test("past-due Lab after grace falls back to Free", async ({ page }) => {
  await applyE2eEntitlement(
    page,
    entitlement("lab", {
      status: "past_due",
      source: "stripe",
      pastDueStartedAt: daysFromNow(-5),
      graceEndsAt: daysFromNow(-2),
      currentPeriodEndsAt: daysFromNow(-5),
    })
  );
  const panel = await expectResolvedPlan(page, /^Free$/i);
  await expect(panel).toContainText(/previous lab entitlement is past due/i);
  await expectActiveGrowLimit(page, /0 active grows · 6 allowed/i);
});

test("feature overrides unlock only the configured features", async ({ page }) => {
  await applyE2eEntitlement(
    page,
    entitlement("free", {
      featureOverrides: {
        sopWorkflows: true,
        sopGeneratedTasks: true,
        advancedAnalytics: true,
        advancedCostAnalytics: true,
        analyticsExports: true,
      },
    })
  );
  await expectResolvedPlan(page, /^Free$/i);
  await expectSopAllowed(page);
  await expectCultivatorAnalytics(page);
  await clickAppTab(page, "Post Processing");
  await expect(page.getByTestId("postprocess-read-only-notice")).toBeVisible({
    timeout: 20_000,
  });
});

test("active-grow limit override changes capacity without changing the base plan", async ({ page }) => {
  await applyE2eEntitlement(
    page,
    entitlement("free", {
      limitOverrides: { activeGrows: 42 },
    })
  );
  await expectResolvedPlan(page, /^Free$/i);
  await expectActiveGrowLimit(page, /0 active grows · 42 allowed/i);
  await expectSopBlocked(page);
});


test("billing controls use emulator-safe redirects and current-plan-aware actions", async ({ page }) => {
  const stripeRequests: string[] = [];
  page.on("request", (request) => {
    if (/stripe\.com/i.test(request.url())) {
      stripeRequests.push(request.url());
    }
  });

  await applyE2eEntitlement(page, entitlement("free"));
  await expectResolvedPlan(page, /^Free$/i);
  await openSubscriptionSettings(page);

  await expect(
    page.getByTestId("subscription-plan-action-free")
  ).toHaveText(/^Current plan$/i);
  await expect(
    page.getByTestId("subscription-plan-action-free")
  ).toBeDisabled();

  const hobbyCheckout = page.getByTestId("subscription-plan-action-hobby");
  await expect(hobbyCheckout).toHaveText(/^Choose Hobby$/i);
  await expect(hobbyCheckout).toBeEnabled();
  await hobbyCheckout.click();

  await page.waitForURL(/billing=success/, { timeout: 30_000 });
  await waitForAppShell(page);
  await expect(page.getByTestId("settings-subscription-panel")).toBeVisible({
    timeout: 30_000,
  });
  const successNotice = page.getByTestId("subscription-billing-return");
  await expect(successNotice).toContainText(/Checkout completed/i);
  await expect(successNotice).toContainText(
    /plan will update automatically/i
  );
  await successNotice.getByRole("button", { name: /^Dismiss$/i }).click();
  await expect(successNotice).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has("billing")).toBe(
    false
  );

  await page.goto(
    "/?tab=settings&settingsTab=subscription&billing=canceled",
    { waitUntil: "domcontentloaded" }
  );
  await waitForAppShell(page);
  const canceledNotice = page.getByTestId("subscription-billing-return");
  await expect(canceledNotice).toContainText(/Checkout canceled/i);
  await expect(canceledNotice).toContainText(/access has not changed/i);

  const stripeSession = await applyE2eEntitlement(
    page,
    entitlement("lab", {
      status: "active",
      source: "stripe",
      currentPeriodEndsAt: daysFromNow(30),
    })
  );
  await setEmulatorAdminDocument(
    stripeSession,
    `users/${stripeSession.userId}/billing/entitlement`,
    {
      planId: "lab",
      status: "active",
      source: "stripe",
      currentPeriodEndsAt: daysFromNow(30),
      stripeCustomerId: "cus_e2e_billing",
      stripeSubscriptionId: "sub_e2e_billing",
      featureOverrides: {},
      limitOverrides: {},
      updatedAt: new Date(),
    }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForAppShell(page);
  await expectResolvedPlan(page, /^Lab$/i);
  await openSubscriptionSettings(page);

  const manageBilling = page.getByTestId("subscription-manage-billing");
  await expect(manageBilling).toBeVisible();
  await expect(
    page.getByTestId("subscription-plan-action-lab")
  ).toHaveText(/^Manage billing$/i);
  await expect(
    page.getByTestId("subscription-plan-action-cultivator")
  ).toHaveText(/Change in billing portal/i);

  await manageBilling.click();
  await page.waitForURL(/billing=portal-return/, { timeout: 30_000 });
  await waitForAppShell(page);
  await expect(page.getByTestId("subscription-billing-return")).toContainText(
    /Returned from billing portal/i
  );

  expect(stripeRequests).toEqual([]);
});

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  const session = await captureNodeAuthSession(page).catch(() => null);
  if (!session) return;
  // A final read proves the test stayed authenticated against the emulator.
  await listFirestoreDocuments(session, `users/${session.userId}/grows`).catch(() => []);
});
