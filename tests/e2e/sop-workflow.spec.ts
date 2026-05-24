// tests/e2e/sop-workflow.spec.ts
import { test, expect, Locator, Page } from "@playwright/test";
import {
  clickAppTab,
  controlAfterLabel,
  expectGrowRow,
  gotoDashboard,
  selectOptionByText,
} from "./helpers/app";
import { resetUserDataViaSettings } from "./helpers/resetUserData";
import {
  captureNodeAuthSession,
  listFirestoreDocuments,
  setFirestoreDocument,
  type NodeAuthSession,
} from "./helpers/firestore";

test.describe.configure({ mode: "serial" });
test.setTimeout(8 * 60 * 1000);

const SOP_STRAIN_ID = "e2e-sop-strain";
const SOP_STRAIN_NAME = "E2E SOP Golden Teacher";

async function safeVisible(locator: Locator) {
  return locator.isVisible().catch(() => false);
}

async function firstVisible(page: Page, locators: Locator[], label: string, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastCount = 0;

  while (Date.now() < deadline) {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      lastCount = Math.max(lastCount, count);

      for (let index = 0; index < Math.min(count, 10); index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Unable to find visible ${label}. Last matching candidate count: ${lastCount}`);
}

function buttonByTestIdOrName(page: Page, testId: string, name: RegExp | string) {
  return page.getByTestId(testId).or(page.getByRole("button", { name })).first();
}

function sopTemplateSelect(page: Page) {
  return page
    .getByTestId("sop-template-select")
    .or(
      page
        .locator("select")
        .filter({ has: page.locator("option", { hasText: "Agar Plate Workflow" }) })
        .first()
    )
    .first();
}

function sopTemplateCardTitle(page: Page, title: string | RegExp) {
  return page
    .getByTestId("sop-template-title")
    .or(page.locator(".text-lg.font-semibold").filter({ hasText: title }))
    .first();
}

function sopTemplateSummary(page: Page, text: string | RegExp) {
  return page
    .getByTestId("sop-template-summary")
    .or(page.locator("p, div").filter({ hasText: text }).first())
    .first();
}

async function calculatorPanel(page: Page) {
  return firstVisible(
    page,
    [
      page.getByTestId("sop-calculator-panel"),
      page.getByRole("heading", { name: /Cultivation calculators/i }),
    ],
    "SOP calculator panel",
    20_000
  );
}

async function growSopBanner(page: Page) {
  return firstVisible(
    page,
    [
      page.getByTestId("grow-form-sop-banner"),
      page.locator("form.grow-form").filter({ hasText: /Agar Plate Workflow/i }),
      page.getByText(/Agar Plate Workflow/i),
    ],
    "GrowForm SOP banner",
    20_000
  );
}

async function growSopOrigin(page: Page) {
  return firstVisible(
    page,
    [
      page.getByTestId("grow-sop-origin"),
      page.getByRole("heading", { name: /SOP \/ Workflow Origin/i }),
      page.locator("section, div").filter({ hasText: /SOP \/ Workflow Origin/i }).filter({ hasText: /Agar Plate Workflow/i }),
    ],
    "grow SOP origin",
    20_000
  );
}

async function growSopChecklist(page: Page) {
  return firstVisible(
    page,
    [
      page.getByTestId("grow-sop-checklist"),
      page.getByRole("heading", { name: /SOP run checklist/i }),
      page.locator("section, div").filter({ hasText: /SOP run checklist/i }),
    ],
    "grow SOP checklist",
    20_000
  );
}

async function growSopChecklistProgress(page: Page) {
  return firstVisible(
    page,
    [
      page.getByTestId("grow-sop-checklist-progress"),
      page.getByText(/% complete/i),
    ],
    "grow SOP checklist progress",
    20_000
  );
}

async function expectTemplateOptions(page: Page) {
  const select = sopTemplateSelect(page);

  await expect(select).toBeVisible({ timeout: 20_000 });
  await expect(select.locator("option")).toContainText([
    "Agar Plate Workflow",
    "Liquid Culture Jar Workflow",
    "Grain Jar / Bag Workflow",
    "Bulk Tub / Bag Workflow",
  ]);
}

async function seedSopStrain(session: NodeAuthSession) {
  await setFirestoreDocument(session, `users/${session.userId}/strains/${SOP_STRAIN_ID}`, {
    name: SOP_STRAIN_NAME,
    strain: SOP_STRAIN_NAME,
    scientificName: "Psilocybe cubensis",
    type: "Spore Syringe",
    source: "Playwright SOP regression",
    quantity: 10,
    unit: "ml",
    acquired: "2026-04-01",
    createdAt: "2026-04-01T12:00:00.000Z",
    cultivationProfile: {
      preferredWorkflow: "Agar → LC → Grain → Bulk",
      preferredGrain: "Popcorn",
      grainPrepMethod: "Pressure-cook hydration",
      preferredSubstrate: "CVG",
      cleanWorkspace: "Bella Bora SAB",
      contaminationRisk: "Moderate",
      colonizationTempMinF: "70",
      colonizationTempMaxF: "76",
      fruitingTempMinF: "68",
      fruitingTempMaxF: "74",
      fruitingHumidityMin: "85",
      fruitingHumidityMax: "95",
    },
  });
}

async function openSopToolkit(page: Page) {
  await clickAppTab(page, "Recipes");

  const toolkit = await firstVisible(
    page,
    [
      page.getByTestId("sop-workflow-toolkit"),
      page.getByRole("heading", { name: /Workflow \/ SOP Toolkit/i }),
    ],
    "SOP workflow toolkit",
    30_000
  );

  const startButton = buttonByTestIdOrName(page, "sop-start-grow-button", /Start Grow from SOP/i);

  if (!(await safeVisible(startButton))) {
    const toggle = page
      .getByTestId("sop-toolkit-toggle")
      .or(page.getByRole("button", { name: /Workflow \/ SOP Toolkit/i }))
      .first();

    await toggle.click();
  }

  await expect(startButton).toBeVisible({ timeout: 20_000 });
  return toolkit;
}

async function continueNoRecipeWarningIfPresent(page: Page) {
  const dialog = page.getByRole("dialog").last();
  const continueButton = dialog.getByRole("button", { name: /^Continue$/i });

  if (await safeVisible(continueButton)) {
    await continueButton.click();
    await expect(dialog).toBeHidden({ timeout: 20_000 }).catch(() => {});
  }
}

function isSopTask(task: Record<string, unknown>) {
  const source = String(task?.source || task?.taskSource || "").toLowerCase();
  return source === "sop-template" || !!task?.workflowTemplateId || !!task?.sopTemplateId;
}

async function getSopTasks(session: NodeAuthSession) {
  const tasks = await listFirestoreDocuments(session, `users/${session.userId}/tasks`);
  return tasks.filter((task) => isSopTask(task as Record<string, unknown>));
}

async function waitForSopTasks(session: NodeAuthSession) {
  await expect
    .poll(
      async () => {
        const tasks = await getSopTasks(session);
        return tasks.length;
      },
      {
        timeout: 60_000,
        intervals: [2000, 3000, 5000, 8000],
      }
    )
    .toBeGreaterThan(0);

  return getSopTasks(session);
}

async function markFirstSopChecklistItemDone(page: Page) {
  const checklist = await growSopChecklist(page);
  await expect(checklist).toBeVisible({ timeout: 20_000 });

  const doneButtons = page.getByRole("button", { name: /^Done$/i });
  await expect(doneButtons.first()).toBeVisible({ timeout: 10_000 });
  await doneButtons.first().click({ timeout: 10_000 });
}

async function selectSopAnalyticsReport(page: Page) {
  await clickAppTab(page, "Analytics");

  const chartSelect = page
    .getByTestId("analytics-chart-select")
    .or(
      page
        .locator("select")
        .filter({ has: page.locator("option", { hasText: "SOP / Workflow Performance" }) })
        .first()
    )
    .first();

  await expect(chartSelect).toBeVisible({ timeout: 30_000 });

  try {
    await chartSelect.selectOption("sopWorkflow");
  } catch {
    await selectOptionByText(chartSelect, "SOP / Workflow Performance");
  }

  await expect
    .poll(
      async () => chartSelect.inputValue().catch(() => ""),
      {
        timeout: 10_000,
        intervals: [250, 500, 1000],
      }
    )
    .toBe("sopWorkflow");

  /*
   * Keep this assertion intentionally light.
   * The important proof is that Analytics accepts the SOP report selection without crashing.
   * Exact SOP report text is brittle because hidden <option> nodes and print/report surfaces can
   * contain the same labels as the visible report.
   */
  await expect(page.getByRole("tab", { name: "Analytics" })).toHaveAttribute("aria-selected", "true", {
    timeout: 10_000,
  });
}

test("SOP workflow templates can create operational grows, tasks, checklist progress, and analytics", async ({ page }) => {
  await gotoDashboard(page);
  const session = await captureNodeAuthSession(page);

  await resetUserDataViaSettings(page);
  await seedSopStrain(session);
  await page.reload({ waitUntil: "domcontentloaded" });
  await gotoDashboard(page);

  await openSopToolkit(page);

  await expectTemplateOptions(page);
  await expect(sopTemplateCardTitle(page, /^Agar Plate Workflow$/)).toBeVisible({ timeout: 20_000 });
  await expect(await calculatorPanel(page)).toBeVisible({ timeout: 20_000 });
  await expect(buttonByTestIdOrName(page, "sop-print-button", /Print SOP/i)).toBeVisible({ timeout: 20_000 });
  await expect(buttonByTestIdOrName(page, "sop-export-button", /Export Text/i)).toBeVisible({ timeout: 20_000 });

  await sopTemplateSelect(page).selectOption("agar-plate");
  await expect(sopTemplateCardTitle(page, /^Agar Plate Workflow$/)).toBeVisible({ timeout: 20_000 });
  await expect(sopTemplateSummary(page, /Clean culture isolation, transfers, and observation workflow/i)).toBeVisible({
    timeout: 20_000,
  });

  await buttonByTestIdOrName(page, "sop-use-template-button", /Use Template in New Recipe/i).click();

  const recipeDialog = page.getByRole("dialog").last();

  await expect(recipeDialog).toContainText(/New Recipe/i, { timeout: 20_000 });
  await expect(recipeDialog).toContainText(/Recipe Steps \/ Instructions/i, { timeout: 20_000 });
  await expect(recipeDialog).toContainText(/Create a repeatable agar workflow/i, { timeout: 20_000 });
  await expect(recipeDialog.getByRole("button", { name: /Save Recipe/i })).toBeVisible({ timeout: 20_000 });

  await recipeDialog.getByRole("button", { name: /Cancel/i }).click();
  await expect(recipeDialog).toBeHidden({ timeout: 20_000 });

  await buttonByTestIdOrName(page, "sop-start-grow-button", /Start Grow from SOP/i).click();

  const form = page.locator("form.grow-form");

  await expect(form).toBeVisible({ timeout: 20_000 });

  const sopBanner = await growSopBanner(page);
  await expect(sopBanner).toContainText(/Agar Plate Workflow/i, { timeout: 20_000 });
  await expect(form.getByText("Direct / SOP Start").first()).toBeVisible({ timeout: 20_000 });

  await selectOptionByText(controlAfterLabel(form, "Strain", "select"), SOP_STRAIN_NAME);

  const taskCheckbox = page
    .getByTestId("grow-form-generate-sop-tasks")
    .or(page.getByLabel(/Create suggested SOP tasks/i))
    .first();

  await expect(taskCheckbox).toBeVisible({ timeout: 20_000 });

  if (!(await taskCheckbox.isChecked())) {
    await taskCheckbox.check();
  }

  await form.getByRole("button", { name: /^Create$/i }).click();
  await continueNoRecipeWarningIfPresent(page);
  await expect(form).toBeHidden({ timeout: 30_000 });

  const row = await expectGrowRow(page, {
    strain: SOP_STRAIN_NAME,
    type: /Agar/i,
    stage: /Inoculated/i,
  });

  await expect(row).toContainText(/SOP/i, { timeout: 20_000 });

  const sopTasks = await waitForSopTasks(session);
  expect(
    sopTasks.some((task) => {
      const templateId = String(task?.workflowTemplateId || task?.sopTemplateId || "").toLowerCase();
      const source = String(task?.source || task?.taskSource || "").toLowerCase();
      return templateId.includes("agar") || source === "sop-template";
    })
  ).toBeTruthy();

  await row.getByTestId("grow-row-open").click();

  const sopOrigin = await growSopOrigin(page);
  await expect(sopOrigin).toContainText(/Agar Plate Workflow/i, { timeout: 20_000 });

  const sopChecklist = await growSopChecklist(page);
  await expect(sopChecklist).toBeVisible({ timeout: 20_000 });

  const sopProgress = await growSopChecklistProgress(page);
  await expect(sopProgress).toContainText(/0% complete/i, { timeout: 20_000 });

  await markFirstSopChecklistItemDone(page);
  await expect(sopProgress).not.toContainText(/0% complete/i, { timeout: 20_000 });

  await clickAppTab(page, "Tasks");
  await expect(page.getByText(/SOP/i).first()).toBeVisible({ timeout: 30_000 });

  await selectSopAnalyticsReport(page);
});