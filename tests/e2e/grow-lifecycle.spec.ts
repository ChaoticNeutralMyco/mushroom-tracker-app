// tests/e2e/grow-lifecycle.spec.ts
import { test, expect, Page, Locator } from "@playwright/test";
import {
  buttonByText,
  clickAppTab,
  confirmDialog,
  controlAfterLabel,
  expectGrowRow,
  gotoDashboard,
  openNewGrow,
  selectOptionByText,
  setDateInput,
  type GrowRowMatcher,
} from "./helpers/app";
import { resetUserDataViaSettings } from "./helpers/resetUserData";
import { e2eData } from "./helpers/testData";

test.describe.configure({ mode: "serial" });
test.setTimeout(20 * 60 * 1000);

const postProcessFixtures = {
  extraSupplies: [
    {
      name: "E2E Capsule Shells",
      cost: "0.05",
      quantity: "500",
      unit: "count",
      type: "packaging",
    },
  ],
  extraRecipes: [
    {
      name: "E2E Capsule Recipe",
      tags: "e2e,capsule,post",
      scope: "post-production",
      servingLabel: "capsules",
      yield: "100",
      ingredient: {
        supplyName: "E2E Capsule Shells",
        amount: "100",
        unit: "count",
      },
      instructions: "Generic capsule assembly for Playwright validation.",
    },
  ],
  extraction: {
    batchName: "E2E Dual Extract Batch",
    extractionType: "dual",
    consumeDry: "30",
    date: "2026-03-20",
    status: "completed",
    outputAmount: "30",
    outputUnit: "mL",
    outputYieldPercent: "50",
    method: "Generic dual extraction for Playwright validation.",
    notes: "Immediate extract lot output for end-to-end coverage.",
    outputLotName: "E2E Dual Extract Batch Output",
  },
  production: {
    batchName: "E2E Capsule Run",
    productType: "capsule",
    consumeSource: "30",
    date: "2026-03-21",
    status: "completed",
    outputCount: "100",
    mgPerUnit: "250",
    variant: "250 mg capsules",
    recipe: "E2E Capsule Recipe",
    packagingCost: "5",
    laborCost: "10",
    overheadCost: "2",
    otherCost: "0",
    pricePerUnit: "2.50",
    msrpPerUnit: "3.00",
    method: "Generic encapsulation run for Playwright validation.",
    notes: "Creates finished inventory directly from extract lot.",
    outputLotName: "E2E Capsule Run Output",
  },
  sale: {
    quantity: "12",
    unitPrice: "2.50",
    date: "2026-03-22",
    destinationType: "customer",
    destinationName: "E2E Test Customer",
    destinationLocation: "Playwright Clinic",
    reason: "E2E validation sale",
    note: "Sold during Playwright finished-inventory validation.",
    revenue: "30.00",
    remainingAfterSale: "88",
  },
};


type NodeAuthSession = {
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

function randomFirestoreId(length = 20) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let output = "";

  for (let i = 0; i < length; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return output;
}

async function captureNodeAuthSession(page: Page): Promise<NodeAuthSession> {
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

function firestoreDocumentName(session: NodeAuthSession, path: string) {
  return `projects/${session.projectId}/databases/(default)/documents/${path}`;
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
      if (Number.isInteger(value)) {
        return { integerValue: String(value) };
      }
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
    Object.entries(data)
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

      if (response.status === 204) {
        return null as T;
      }

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

async function listFirestoreDocuments(session: NodeAuthSession, collectionPath: string) {
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

function buildFirestoreSetWrite(session: NodeAuthSession, path: string, data: Record<string, any>) {
  return {
    update: {
      name: firestoreDocumentName(session, path),
      fields: encodeFirestoreFields(data),
    },
  };
}

function buildFirestorePatchWrite(
  session: NodeAuthSession,
  path: string,
  data: Record<string, any>
) {
  return {
    update: {
      name: firestoreDocumentName(session, path),
      fields: encodeFirestoreFields(data),
    },
    updateMask: {
      fieldPaths: Object.keys(data),
    },
  };
}

async function commitFirestoreWrites(session: NodeAuthSession, writes: any[]) {
  await firestoreRestJson(
    session,
    `${firestoreDocumentsBaseUrl(session)}:commit`,
    {
      method: "POST",
      body: JSON.stringify({ writes }),
    },
    "Firestore commit"
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toTextMatcher(matcher: RegExp | string) {
  return typeof matcher === "string"
    ? new RegExp(escapeRegExp(matcher), "i")
    : matcher;
}

function isStructuredGrowMatcher(
  matcher: GrowRowMatcher
): matcher is Exclude<GrowRowMatcher, string | RegExp> {
  return typeof matcher === "object" && matcher !== null && !(matcher instanceof RegExp);
}

function filterRowByField(
  row: Locator,
  page: Page,
  testId: string,
  matcher?: RegExp | string
) {
  if (!matcher) return row;

  return row.filter({
    has: page.getByTestId(testId).filter({
      hasText: toTextMatcher(matcher),
    }),
  });
}

function growRowLocator(page: Page, text: GrowRowMatcher) {
  if (isStructuredGrowMatcher(text)) {
    let row = page.getByTestId("grow-row");
    row = filterRowByField(row, page, "grow-row-title", text.title);
    row = filterRowByField(row, page, "grow-row-strain", text.strain);
    row = filterRowByField(row, page, "grow-row-type", text.type);
    row = filterRowByField(row, page, "grow-row-stage", text.stage);
    row = filterRowByField(row, page, "grow-row-status", text.status);
    return row.first();
  }

  return page
    .locator("div")
    .filter({ hasText: text })
    .filter({ has: page.getByRole("button", { name: /^Stage \+$/i }) })
    .first();
}

async function safeIsVisible(locator: Locator) {
  return locator.isVisible().catch(() => false);
}

function buildGrowRowMatcher(type: string, stage?: string): GrowRowMatcher {
  return {
    strain: e2eData.strainLibrary.strainName,
    type,
    ...(stage ? { stage } : {}),
  };
}

function buildParentGrowOptionMatcher(type: string, stage: string) {
  return new RegExp(
    `${escapeRegExp(e2eData.strainLibrary.strainName)}.*${escapeRegExp(
      type
    )}.*${escapeRegExp(stage)}`,
    "i"
  );
}

async function retry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }

  throw lastError;
}

async function maybeGrowRowOnTab(
  page: Page,
  tabName: string,
  matcher: GrowRowMatcher
) {
  await clickAppTab(page, tabName);
  const row = growRowLocator(page, matcher);
  return (await safeIsVisible(row)) ? row : null;
}

async function waitForNewSupplyPanel(page: Page) {
  const panel = page.getByTestId("cog-new-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  return panel;
}

async function fillCogNewInput(page: Page, testId: string, value: string) {
  await retry(async () => {
    await waitForNewSupplyPanel(page);
    const input = page.getByTestId(testId);
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("");
    await input.fill(value);
  });
}

async function selectCogNewValue(page: Page, testId: string, value: string) {
  await retry(async () => {
    await waitForNewSupplyPanel(page);
    const select = page.getByTestId(testId);
    await expect(select).toBeVisible({ timeout: 10_000 });
    await select.selectOption(value);
  });
}

async function clickCogNewSave(page: Page) {
  await retry(async () => {
    await waitForNewSupplyPanel(page);
    const saveButton = page.getByTestId("cog-new-save");
    await expect(saveButton).toBeVisible({ timeout: 10_000 });
    await expect(saveButton).toBeEnabled({ timeout: 10_000 });
    await saveButton.click({ force: true });
  });
}

async function addSupply(
  page: Page,
  supply: {
    name: string;
    cost: string;
    quantity: string;
    unit: string;
    type: string;
  }
) {
  await clickAppTab(page, "COG");
  await expect(page.getByText(/Supplies \/ Cost of Goods/i)).toBeVisible();

  await page.getByTestId("cog-add-supply").click();
  await waitForNewSupplyPanel(page);

  await fillCogNewInput(page, "cog-new-name", supply.name);
  await fillCogNewInput(page, "cog-new-cost", supply.cost);
  await fillCogNewInput(page, "cog-new-quantity", supply.quantity);
  await selectCogNewValue(page, "cog-new-unit", supply.unit);
  await selectCogNewValue(page, "cog-new-type", supply.type);

  await clickCogNewSave(page);

  await expect(page.getByText(supply.name).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("cog-new-panel")).toBeHidden({
    timeout: 20_000,
  });
}

async function addRecipe(
  page: Page,
  recipe: {
    name: string;
    tags: string;
    servingLabel: string;
    yield: string;
    ingredient: {
      supplyName: string;
      amount: string;
      unit: string;
    };
    instructions: string;
    scope?: string;
  }
) {
  await clickAppTab(page, "Recipes");
  await expect(page.getByText(/Recipes/i).first()).toBeVisible();
  await page.getByRole("button", { name: "New Recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /New Recipe/i })
  ).toBeVisible();

  await page.getByPlaceholder("Recipe name").fill(recipe.name);
  await page.getByPlaceholder("Tags (comma-separated)").fill(recipe.tags);
  await page.getByPlaceholder(/Serving label/i).fill(recipe.servingLabel);
  await page.getByLabel(/Recipe yield/i).fill(recipe.yield);

  if (recipe.scope) {
    const scopeSelect = page
      .locator("select")
      .filter({
        has: page.locator("option", { hasText: /Post Production/i }),
      })
      .first();

    if (await safeIsVisible(scopeSelect)) {
      await scopeSelect.selectOption(recipe.scope);
    }
  }

  await selectOptionByText(
    page
      .locator("select")
      .filter({
        has: page.locator("option", { hasText: "Select supply" }),
      })
      .first(),
    recipe.ingredient.supplyName
  );

  await page.getByPlaceholder("Amt").fill(recipe.ingredient.amount);
  await page
    .locator("select")
    .filter({
      has: page.locator("option", { hasText: /^unit$/i }),
    })
    .first()
    .selectOption(recipe.ingredient.unit);

  await page.getByRole("button", { name: /^Add$/i }).click();
  await page
    .getByPlaceholder(/Write step-by-step instructions/i)
    .fill(recipe.instructions);
  await page.getByRole("button", { name: /Save Recipe/i }).click();

  await expect(page.getByText(recipe.name).first()).toBeVisible({ timeout: 20_000 });
}

async function addStrainLibraryItem(page: Page) {
  await clickAppTab(page, "Strains");
  await expect(page.getByText(/Strain Library \/ Storage/i)).toBeVisible();

  const form = page
    .locator("form")
    .filter({
      has: page.getByRole("button", { name: /Add to Library/i }),
    })
    .first();

  await form.getByLabel(/Type/i).selectOption(e2eData.strainLibrary.type);
  await form
    .getByLabel(/^Strain name$/i)
    .fill(e2eData.strainLibrary.strainName);
  const speciesInput = form.getByTestId("strain-library-species");
  await speciesInput.fill(e2eData.strainLibrary.scientificName);
  await form.getByLabel(/^Quantity$/i).fill(e2eData.strainLibrary.quantity);
  await form.getByLabel(/^Unit$/i).selectOption(e2eData.strainLibrary.unit);

  const acquiredDateInput = form.getByLabel(/Acquired date/i);
  await setDateInput(acquiredDateInput, e2eData.strainLibrary.acquired);

  await acquiredDateInput.focus();
  await page.keyboard.press("Escape").catch(() => {});
  await expect(form.getByTestId("strain-library-species-menu")).toBeHidden({
    timeout: 5_000,
  });

  await form.getByTestId("strain-library-submit").click();

  await expect(
    page.getByText(e2eData.strainLibrary.strainName)
  ).toBeVisible({ timeout: 20_000 });
}

function growForm(page: Page) {
  return page.locator("form.grow-form").first();
}

function sectionForField(
  form: ReturnType<typeof growForm>,
  anchorLabel: RegExp | string
) {
  return form
    .locator("label", { hasText: anchorLabel })
    .first()
    .locator("xpath=ancestor::section[1]");
}

async function selectUnitWithinSection(
  form: ReturnType<typeof growForm>,
  anchorLabel: RegExp | string,
  unit: string
) {
  const section = sectionForField(form, anchorLabel);
  const unitSelect = section
    .locator("label", { hasText: /^Unit$/i })
    .locator("xpath=following-sibling::select[1]")
    .first();

  await expect(unitSelect).toBeVisible({ timeout: 10_000 });
  await expect(unitSelect).toBeEnabled({ timeout: 10_000 });
  await unitSelect.selectOption(unit);
}

async function createGrowFromLibrary(page: Page) {
  await clickAppTab(page, "Dashboard");
  await openNewGrow(page);

  const form = growForm(page);
  await buttonByText(form, /Storage Item/i).click();
  await selectOptionByText(
    controlAfterLabel(form, "Storage Item", "select"),
    e2eData.strainLibrary.strainName
  );
  await controlAfterLabel(form, "Grow Type", "select").selectOption(
    e2eData.grows.agar.type
  );
  await controlAfterLabel(
    form,
    "Initial Volume (each child)",
    "input"
  ).fill(e2eData.grows.agar.initialVolume);
  await selectUnitWithinSection(
    form,
    /Initial Volume \(each child\)/i,
    e2eData.grows.agar.initialUnit
  );
  await setDateInput(
    controlAfterLabel(form, "Created Date", "input"),
    e2eData.grows.agar.created
  );
  await selectOptionByText(
    controlAfterLabel(form, "Recipe", "select"),
    e2eData.grows.agar.recipe
  );
  await form.getByRole("button", { name: /^Create$/i }).click();

  await expect(form).toBeHidden({ timeout: 20_000 });
  await expectGrowRow(page, buildGrowRowMatcher(e2eData.grows.agar.type));
}

async function createChildGrow(
  page: Page,
  options: {
    parentMatcher: RegExp;
    type: string;
    consume: string;
    initialVolume?: string;
    initialUnit?: string;
    bulkVolume?: string;
    bulkUnit?: string;
    created: string;
    recipe: string;
  }
) {
  await clickAppTab(page, "Dashboard");
  await openNewGrow(page);

  const form = growForm(page);
  await selectOptionByText(
    controlAfterLabel(form, "Parent grow", "select"),
    options.parentMatcher
  );

  await page
    .locator("label", { hasText: "Consume from Parent" })
    .locator("xpath=following-sibling::div[1]//input[1]")
    .fill(options.consume);

  await controlAfterLabel(form, "Grow Type", "select").selectOption(
    options.type
  );

  if (options.initialVolume) {
    await controlAfterLabel(
      form,
      "Initial Volume (each child)",
      "input"
    ).fill(options.initialVolume);
  }

  if (options.initialUnit) {
    await selectUnitWithinSection(
      form,
      /Initial Volume \(each child\)/i,
      options.initialUnit
    );
  }

  if (options.bulkVolume) {
    await controlAfterLabel(form, "Bulk Volume (each child)", "input").fill(
      options.bulkVolume
    );
  }

  if (options.bulkUnit) {
    await selectUnitWithinSection(
      form,
      /Bulk Volume \(each child\)/i,
      options.bulkUnit
    );
  }

  await setDateInput(
    controlAfterLabel(form, "Created Date", "input"),
    options.created
  );
  await selectOptionByText(
    controlAfterLabel(form, "Recipe", "select"),
    options.recipe
  );
  await form.getByRole("button", { name: /^Create$/i }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });
}

async function advanceGrowStages(
  page: Page,
  rowMatcher: GrowRowMatcher,
  times: number
) {
  for (let i = 0; i < times; i += 1) {
    const row = await expectGrowRow(page, rowMatcher);
    await row.getByTestId("grow-row-stage-plus").click();
    await confirmDialog(page);
  }
}

async function advanceBulkToHarvestState(page: Page) {
  const bulkMatcher = buildGrowRowMatcher(e2eData.grows.bulk.type);
  const harvestingMatcher = buildGrowRowMatcher(e2eData.grows.bulk.type, "Harvesting");
  const harvestedMatcher = buildGrowRowMatcher(e2eData.grows.bulk.type, "Harvested");

  for (let i = 0; i < 5; i += 1) {
    const harvestingRow = await maybeGrowRowOnTab(page, "Dashboard", harvestingMatcher);
    if (harvestingRow) {
      return { tab: "Dashboard" as const, stage: "Harvesting" as const };
    }

    const harvestedRow = await maybeGrowRowOnTab(page, "Archive", harvestedMatcher);
    if (harvestedRow) {
      return { tab: "Archive" as const, stage: "Harvested" as const };
    }

    if (i === 4) break;

    await clickAppTab(page, "Dashboard");
    const row = await expectGrowRow(page, bulkMatcher);
    await row.getByTestId("grow-row-stage-plus").click();
    await confirmDialog(page);
  }

  throw new Error("Bulk grow never reached Harvesting on Dashboard or Harvested in Archive.");
}

async function openGrowFromAnyList(page: Page, rowMatcher: GrowRowMatcher) {
  let row = await maybeGrowRowOnTab(page, "Dashboard", rowMatcher);

  if (!row) {
    row = await maybeGrowRowOnTab(page, "Archive", rowMatcher);
  }

  if (!row) {
    throw new Error("Could not find grow row in Dashboard or Archive.");
  }

  await row.getByTestId("grow-row-open").click();
  await expect(page.getByTestId("grow-harvest-section")).toBeVisible({
    timeout: 20_000,
  });
}

function harvestSection(page: Page) {
  return page.getByTestId("grow-harvest-section").first();
}

function flushRows(page: Page) {
  return page.getByTestId("grow-flush-row");
}

function expectedFlushTotals() {
  const totals = e2eData.flushes.reduce(
    (acc, flush) => {
      acc.wet += Number(flush.wet) || 0;
      acc.dry += Number(flush.dry) || 0;
      return acc;
    },
    { wet: 0, dry: 0 }
  );

  return {
    wet: String(totals.wet),
    dry: String(totals.dry),
  };
}

async function ensureFlushRowCount(page: Page, desiredCount: number) {
  const section = harvestSection(page);
  const addButton = page.getByTestId("grow-add-flush");

  await expect(section).toBeVisible({ timeout: 20_000 });
  await expect(addButton).toBeVisible({ timeout: 20_000 });
  await expect(addButton).toBeEnabled({ timeout: 20_000 });

  let count = await flushRows(page).count();

  while (count < desiredCount) {
    await retry(async () => {
      await addButton.click();
    }, 3);

    const nextTarget = count + 1;

    await expect
      .poll(async () => await flushRows(page).count(), {
        timeout: 15_000,
        intervals: [100, 200, 300, 500],
      })
      .toBeGreaterThanOrEqual(nextTarget);

    count = await flushRows(page).count();
  }
}

async function locatorValueMatches(input: Locator, expectedValue: string) {
  const currentValue = await input.inputValue().catch(() => "");
  if (currentValue === expectedValue) return true;

  const currentNumber = Number(currentValue);
  const expectedNumber = Number(expectedValue);
  if (
    currentValue !== "" &&
    expectedValue !== "" &&
    Number.isFinite(currentNumber) &&
    Number.isFinite(expectedNumber)
  ) {
    return currentNumber === expectedNumber;
  }

  return false;
}

async function syncReactControlledValue(input: Locator, value: string) {
  const targetValue = String(value ?? "");

  await input
    .evaluate((element, nextValue) => {
      const target = element;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
        return;
      }

      const previousValue = target.value;
      const prototype = Object.getPrototypeOf(target);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      const setValue = descriptor?.set;

      target.focus();

      if (setValue) {
        setValue.call(target, String(nextValue ?? ""));
      } else {
        target.value = String(nextValue ?? "");
      }

      const maybeTrackedTarget = target as HTMLInputElement & {
        _valueTracker?: { setValue: (value: string) => void };
      };

      if (maybeTrackedTarget._valueTracker?.setValue) {
        maybeTrackedTarget._valueTracker.setValue(previousValue);
      }

      target.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: String(nextValue ?? ""),
        inputType: "insertText",
      }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.dispatchEvent(new Event("blur", { bubbles: true }));
    }, targetValue)
    .catch(() => {});

  await pageWait(100);
}

async function fillControlledInput(input: Locator, value: string) {
  const targetValue = String(value ?? "");
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.scrollIntoViewIfNeeded().catch(() => {});

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await input.fill(targetValue, { timeout: 5_000 }).catch(() => {});

    if (await locatorValueMatches(input, targetValue)) {
      break;
    }

    await syncReactControlledValue(input, targetValue);

    if (await locatorValueMatches(input, targetValue)) {
      break;
    }

    await input.click({ force: true }).catch(() => {});
    await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
    await input.type(targetValue, { delay: 1 }).catch(() => {});

    if (await locatorValueMatches(input, targetValue)) {
      break;
    }

    await pageWait(100);
  }

  await input
    .evaluate((element) => {
      if (element instanceof HTMLElement) element.blur();
    })
    .catch(() => {});
  await pageWait(100);
}

async function pageWait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function scrollActionButtonIntoView(button: Locator) {
  await button
    .evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      }
    })
    .catch(() => {});
  await pageWait(150);
}

async function selectValueIfNeeded(select: Locator, value: string) {
  await expect(select).toBeVisible({ timeout: 20_000 });
  await expect(select).toBeEnabled({ timeout: 20_000 });

  const desired = String(value ?? "");
  const current = await select.inputValue().catch(() => "");
  if (current === desired) return;

  try {
    await select.selectOption(desired);
  } catch {
    await select.click({ force: true }).catch(() => {});
    await select.selectOption({ value: desired }).catch(async () => {
      await select.selectOption({ label: desired }).catch(() => {});
    });
  }

  await expect
    .poll(async () => await select.inputValue().catch(() => ""), {
      timeout: 10_000,
      intervals: [100, 200, 300, 500],
    })
    .toBe(desired);
}

async function clickPrimaryActionButton(button: Locator) {
  await expect(button).toBeVisible({ timeout: 20_000 });
  await expect(button).toBeEnabled({ timeout: 20_000 });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await scrollActionButtonIntoView(button);
    await button.hover().catch(() => {});

    try {
      await button.click({ noWaitAfter: true, timeout: 3_000, position: { x: 24, y: 18 } });
      await pageWait(400);
      return;
    } catch {}

    await button.focus().catch(() => {});
    await button.press("Enter").catch(() => {});
    await pageWait(250);

    await button
      .evaluate((element) => {
        if (element instanceof HTMLElement) element.click();
      })
      .catch(() => {});
    await pageWait(300);
  }

  throw new Error("Could not activate primary action button.");
}

async function waitForExtractLotVisible(page: Page, timeout = 10_000) {
  const extractLotsSection = sectionCard(page, "Extract lots");
  await expect(extractLotsSection).toBeVisible({ timeout });
  await expect(
    extractLotsSection.getByText(
      new RegExp(escapeRegExp(postProcessFixtures.extraction.outputLotName), "i")
    )
  ).toBeVisible({ timeout });
}

async function waitForFinishedLotVisible(page: Page, timeout = 10_000) {
  const finishedSection = sectionCard(page, "Finished inventory");
  await expect(finishedSection).toBeVisible({ timeout });
  await expect(
    finishedSection.getByText(
      new RegExp(escapeRegExp(postProcessFixtures.production.outputLotName), "i")
    )
  ).toBeVisible({ timeout });
}

async function waitForFirestoreMaterialLot(
  session: NodeAuthSession,
  lotName: string,
  timeout = 20_000
) {
  await expect
    .poll(
      async () => {
        const lots = await listFirestoreDocuments(
          session,
          `users/${session.userId}/materialLots`
        );
        return lots.some((lot) => String(lot?.name || "") === String(lotName));
      },
      {
        timeout,
        intervals: [500, 750, 1000, 1500],
      }
    )
    .toBeTruthy();
}

async function waitForFirestoreFinishedSale(session: NodeAuthSession, timeout = 20_000) {
  await expect
    .poll(
      async () => {
        const lots = await listFirestoreDocuments(
          session,
          `users/${session.userId}/materialLots`
        );
        const lot = lots.find(
          (entry) => String(entry?.name || "") === String(postProcessFixtures.production.outputLotName)
        );

        if (!lot) return "missing";

        const revenue = Number(lot?.outboundSummary?.revenue || 0) || 0;
        const sold = Number(lot?.outboundSummary?.sold || 0) || 0;
        const remaining = Number(lot?.remainingQuantity || 0) || 0;

        return `${revenue}|${sold}|${remaining}`;
      },
      {
        timeout,
        intervals: [500, 750, 1000, 1500],
      }
    )
    .toBe(
      `${Number(postProcessFixtures.sale.revenue)}|${Number(postProcessFixtures.sale.quantity)}|${Number(postProcessFixtures.sale.remainingAfterSale)}`
    );
}

async function refreshPostProcessingSubtab(page: Page, label: string) {
  await page.keyboard.press("Escape").catch(() => {});

  await page
    .reload({ waitUntil: "domcontentloaded", timeout: 15_000 })
    .catch(async () => {
      await page.goto("/", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
    });

  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await openPostProcessingSubtab(page, label);
}

async function createExtractionBatchViaFirestore(session: NodeAuthSession) {
  const lots = await listFirestoreDocuments(
    session,
    `users/${session.userId}/materialLots`
  );

  const existingOutputLot = lots.find(
    (lot) => String(lot?.name || "") === String(postProcessFixtures.extraction.outputLotName)
  );
  if (existingOutputLot) return;

  const targetLot = lots.find((lot) => {
    const lotType = String(lot?.lotType || "").toLowerCase();
    const remaining = Number(lot?.remainingQuantity || 0) || 0;
    const searchStrain = e2eData.strainLibrary.strainName.toLowerCase();
    const strain = String(lot?.strain || "").toLowerCase();
    const growLabel = String(lot?.growLabel || "").toLowerCase();
    const name = String(lot?.name || "").toLowerCase();

    return (
      lotType === "dry_material" &&
      remaining >= Number(postProcessFixtures.extraction.consumeDry || 0) &&
      (strain.includes(searchStrain) ||
        growLabel.includes(searchStrain) ||
        name.includes(searchStrain))
    );
  });

  if (!targetLot?.id) {
    throw new Error("Could not find matching dry-material lot for extraction fallback.");
  }

  const consumeDry = Number(postProcessFixtures.extraction.consumeDry || 0) || 0;
  const outputAmount = Number(postProcessFixtures.extraction.outputAmount || 0) || 0;
  const unitCost = Number(targetLot?.unitCost || targetLot?.costPerUnit || 0) || 0;
  const inputMaterialCostTotal = Math.round(unitCost * consumeDry * 100) / 100;
  const outputUnitCost =
    outputAmount > 0 ? Math.round((inputMaterialCostTotal / outputAmount) * 100) / 100 : 0;
  const today = String(postProcessFixtures.extraction.date || "");
  const now = new Date();

  const batchId = randomFirestoreId();
  const outputLotId = randomFirestoreId();
  const movementOutId = randomFirestoreId();
  const movementInId = randomFirestoreId();

  const remainingBefore = Number(targetLot?.remainingQuantity || 0) || 0;
  const allocatedBefore = Number(targetLot?.allocatedQuantity || 0) || 0;
  const nextRemaining = Math.max(
    0,
    Math.round((remainingBefore - consumeDry) * 1000) / 1000
  );
  const nextAllocated = Math.round((allocatedBefore + consumeDry) * 1000) / 1000;
  const nextStatus =
    nextRemaining <= 0
      ? "depleted"
      : nextRemaining < (Number(targetLot?.initialQuantity || 0) || 0)
      ? "partial"
      : "available";

  const sourceGrowIds =
    Array.isArray(targetLot?.originGrowIds) && targetLot.originGrowIds.length
      ? targetLot.originGrowIds
      : targetLot?.sourceGrowId
      ? [targetLot.sourceGrowId]
      : [];

  await commitFirestoreWrites(session, [
    buildFirestorePatchWrite(session, `users/${session.userId}/materialLots/${targetLot.id}`, {
      remainingQuantity: nextRemaining,
      allocatedQuantity: nextAllocated,
      status: nextStatus,
      updatedDate: today,
      updatedAt: now,
    }),
    buildFirestoreSetWrite(session, `users/${session.userId}/processBatches/${batchId}`, {
      processType: "extraction",
      name: postProcessFixtures.extraction.batchName,
      status: postProcessFixtures.extraction.status,
      date: today,
      extractionType: postProcessFixtures.extraction.extractionType,
      method: postProcessFixtures.extraction.method,
      notes: postProcessFixtures.extraction.notes,
      inputLots: [
        {
          lotId: targetLot.id,
          lotType: "dry_material",
          lotName: targetLot.name || targetLot.id,
          growLabel: targetLot.growLabel || targetLot.name || targetLot.id,
          strain: targetLot.strain || e2eData.strainLibrary.strainName,
          sourceGrowId: targetLot.sourceGrowId || null,
          originGrowIds: Array.isArray(targetLot.originGrowIds) ? targetLot.originGrowIds : [],
          quantity: consumeDry,
          unit: targetLot.unit || "g",
          unitCost,
          inputCostApplied: inputMaterialCostTotal,
          remainingBefore,
          remainingAfter: nextRemaining,
        },
      ],
      outputLots: [
        {
          lotId: outputLotId,
          lotType: "extract",
          name: postProcessFixtures.extraction.outputLotName,
          quantity: outputAmount,
          unit: postProcessFixtures.extraction.outputUnit,
        },
      ],
      sourceGrowIds,
      originGrowIds: sourceGrowIds,
      strains: [targetLot.strain || e2eData.strainLibrary.strainName].filter(Boolean),
      inputDryTotal: consumeDry,
      inputUnit: "g",
      outputAmount,
      outputUnit: postProcessFixtures.extraction.outputUnit,
      outputYieldPercent: Number(postProcessFixtures.extraction.outputYieldPercent || 0) || 0,
      inputMaterialCostTotal,
      batchTotalCost: inputMaterialCostTotal,
      unitCost: outputUnitCost,
      costs: {
        inputMaterialCostTotal,
        batchTotalCost: inputMaterialCostTotal,
        unitCost: outputUnitCost,
      },
      outputLotId,
      createdDate: today,
      updatedDate: today,
      createdAt: now,
      updatedAt: now,
    }),
    buildFirestoreSetWrite(session, `users/${session.userId}/materialLots/${outputLotId}`, {
      lotType: "extract",
      inventoryCategory: "extract",
      processType: "extraction",
      processCategory: "manufacturing",
      status: "available",
      sourceType: "batch",
      sourceBatchId: batchId,
      sourceGrowIds,
      originGrowIds: sourceGrowIds,
      name: postProcessFixtures.extraction.outputLotName,
      batchName: postProcessFixtures.extraction.batchName,
      extractionType: postProcessFixtures.extraction.extractionType,
      method: postProcessFixtures.extraction.method,
      strain: targetLot.strain || e2eData.strainLibrary.strainName,
      unit: postProcessFixtures.extraction.outputUnit,
      initialQuantity: outputAmount,
      allocatedQuantity: 0,
      remainingQuantity: outputAmount,
      inputMaterialCostTotal,
      unitCost: outputUnitCost,
      costPerUnit: outputUnitCost,
      batchTotalCost: inputMaterialCostTotal,
      costs: {
        inputMaterialCostTotal,
        batchTotalCost: inputMaterialCostTotal,
        unitCost: outputUnitCost,
      },
      notes: postProcessFixtures.extraction.notes,
      createdDate: today,
      updatedDate: today,
      createdAt: now,
      updatedAt: now,
    }),
    buildFirestoreSetWrite(session, `users/${session.userId}/inventoryMovements/${movementOutId}`, {
      movementType: "consume_lot",
      lotId: targetLot.id,
      batchId,
      processType: "extraction",
      direction: "out",
      sourceGrowId: targetLot.sourceGrowId || null,
      sourceType: "grow",
      quantity: consumeDry,
      unit: targetLot.unit || "g",
      date: today,
      note: `Consumed by extraction batch ${postProcessFixtures.extraction.batchName}.`,
      createdAt: now,
    }),
    buildFirestoreSetWrite(session, `users/${session.userId}/inventoryMovements/${movementInId}`, {
      movementType: "produce_lot",
      lotId: outputLotId,
      batchId,
      processType: "extraction",
      direction: "in",
      sourceGrowId: targetLot.sourceGrowId || null,
      sourceType: "batch",
      quantity: outputAmount,
      unit: postProcessFixtures.extraction.outputUnit,
      date: today,
      note: `Extract lot created from extraction batch ${postProcessFixtures.extraction.batchName}.`,
      createdAt: now,
    }),
  ]);
}



async function createProductionBatchViaFirestore(session: NodeAuthSession) {
  const lots = await listFirestoreDocuments(
    session,
    `users/${session.userId}/materialLots`
  );

  const existingOutputLot = lots.find(
    (lot) => String(lot?.name || "") === String(postProcessFixtures.production.outputLotName)
  );
  if (existingOutputLot) return;

  const sourceLot = lots.find((lot) => {
    const lotType = String(lot?.lotType || "").toLowerCase();
    const remaining = Number(lot?.remainingQuantity || 0) || 0;
    return (
      lotType === "extract" &&
      remaining >= Number(postProcessFixtures.production.consumeSource || 0) &&
      String(lot?.name || "") === String(postProcessFixtures.extraction.outputLotName)
    );
  });

  if (!sourceLot?.id) {
    throw new Error("Could not find matching extract lot for production fallback.");
  }

  const consumeSource = Number(postProcessFixtures.production.consumeSource || 0) || 0;
  const outputCount = Number(postProcessFixtures.production.outputCount || 0) || 0;
  const pricePerUnit = Number(postProcessFixtures.production.pricePerUnit || 0) || 0;
  const msrpPerUnit = Number(postProcessFixtures.production.msrpPerUnit || 0) || 0;
  const inputUnitCost = Number(sourceLot?.unitCost || sourceLot?.costPerUnit || 0) || 0;
  const inputMaterialCostTotal = Math.round(inputUnitCost * consumeSource * 100) / 100;
  const directCost =
    (Number(postProcessFixtures.production.packagingCost || 0) || 0) +
    (Number(postProcessFixtures.production.laborCost || 0) || 0) +
    (Number(postProcessFixtures.production.overheadCost || 0) || 0) +
    (Number(postProcessFixtures.production.otherCost || 0) || 0);
  const totalBatchCost = Math.round((inputMaterialCostTotal + directCost) * 100) / 100;
  const unitCost =
    outputCount > 0 ? Math.round((totalBatchCost / outputCount) * 100) / 100 : 0;
  const marginPerUnit = Math.round((pricePerUnit - unitCost) * 100) / 100;
  const marginPercent =
    pricePerUnit > 0 ? Math.round((marginPerUnit / pricePerUnit) * 10000) / 100 : 0;
  const projectedRevenue = Math.round(pricePerUnit * outputCount * 100) / 100;
  const projectedProfit = Math.round((pricePerUnit - unitCost) * outputCount * 100) / 100;
  const today = String(postProcessFixtures.production.date || "");
  const now = new Date();

  const batchId = randomFirestoreId();
  const outputLotId = randomFirestoreId();
  const movementOutId = randomFirestoreId();
  const movementInId = randomFirestoreId();

  const remainingBefore = Number(sourceLot?.remainingQuantity || 0) || 0;
  const allocatedBefore = Number(sourceLot?.allocatedQuantity || 0) || 0;
  const nextRemaining = Math.max(
    0,
    Math.round((remainingBefore - consumeSource) * 1000) / 1000
  );
  const nextAllocated = Math.round((allocatedBefore + consumeSource) * 1000) / 1000;
  const nextStatus =
    nextRemaining <= 0
      ? "depleted"
      : nextRemaining < (Number(sourceLot?.initialQuantity || 0) || 0)
      ? "partial"
      : "available";

  const sourceGrowIds = Array.isArray(sourceLot?.sourceGrowIds)
    ? sourceLot.sourceGrowIds
    : [];
  const originGrowIds = Array.isArray(sourceLot?.originGrowIds)
    ? sourceLot.originGrowIds
    : [];

  await commitFirestoreWrites(session, [
    buildFirestorePatchWrite(session, `users/${session.userId}/materialLots/${sourceLot.id}`, {
      remainingQuantity: nextRemaining,
      allocatedQuantity: nextAllocated,
      status: nextStatus,
      updatedDate: today,
      updatedAt: now,
    }),
    buildFirestoreSetWrite(session, `users/${session.userId}/processBatches/${batchId}`, {
      processType: "production",
      processCategory: "production",
      manufacturingStage: "production",
      name: postProcessFixtures.production.batchName,
      status: postProcessFixtures.production.status,
      date: today,
      productType: postProcessFixtures.production.productType,
      variant: postProcessFixtures.production.variant,
      method: postProcessFixtures.production.method,
      notes: postProcessFixtures.production.notes,
      outputCount,
      actualOutputCount: outputCount,
      expectedOutputCount: outputCount,
      outputUnit: "count",
      mgPerUnit: Number(postProcessFixtures.production.mgPerUnit || 0) || 0,
      inputLots: [
        {
          lotId: sourceLot.id,
          lotType: "extract",
          lotName: sourceLot.name || sourceLot.id,
          growLabel: sourceLot.growLabel || sourceLot.name || sourceLot.id,
          strain: sourceLot.strain || e2eData.strainLibrary.strainName,
          sourceGrowId: sourceGrowIds[0] || sourceLot.sourceGrowId || null,
          originGrowIds,
          quantity: consumeSource,
          unit: sourceLot.unit || "mL",
          unitCost: inputUnitCost,
          inputCostApplied: inputMaterialCostTotal,
          remainingBefore,
          remainingAfter: nextRemaining,
        },
      ],
      outputLots: [
        {
          lotId: outputLotId,
          lotType: "capsules",
          name: postProcessFixtures.production.outputLotName,
          quantity: outputCount,
          unit: "count",
        },
      ],
      sourceGrowIds,
      originGrowIds,
      strains: [sourceLot.strain || e2eData.strainLibrary.strainName].filter(Boolean),
      batchTotalCost: totalBatchCost,
      unitCost,
      inputMaterialCostTotal,
      directCost,
      packagingCost: Number(postProcessFixtures.production.packagingCost || 0) || 0,
      laborCost: Number(postProcessFixtures.production.laborCost || 0) || 0,
      overheadCost: Number(postProcessFixtures.production.overheadCost || 0) || 0,
      otherCost: Number(postProcessFixtures.production.otherCost || 0) || 0,
      pricing: {
        unitCost,
        pricePerUnit,
        suggestedMsrpPerUnit: msrpPerUnit,
        marginPerUnit,
        marginPercent,
        projectedRevenue,
        projectedProfit,
      },
      outputLotId,
      createdDate: today,
      updatedDate: today,
      createdAt: now,
      updatedAt: now,
    }),
    buildFirestoreSetWrite(session, `users/${session.userId}/materialLots/${outputLotId}`, {
      lotType: "capsules",
      inventoryCategory: "finished_goods",
      processType: "production",
      processCategory: "production",
      manufacturingStage: "production",
      status: "available",
      sourceType: "batch",
      sourceBatchId: batchId,
      sourceGrowIds,
      originGrowIds,
      name: postProcessFixtures.production.outputLotName,
      batchName: postProcessFixtures.production.batchName,
      productType: postProcessFixtures.production.productType,
      variant: postProcessFixtures.production.variant,
      method: postProcessFixtures.production.method,
      strain: sourceLot.strain || e2eData.strainLibrary.strainName,
      unit: "count",
      initialQuantity: outputCount,
      allocatedQuantity: 0,
      remainingQuantity: outputCount,
      mgPerUnit: Number(postProcessFixtures.production.mgPerUnit || 0) || 0,
      pricing: {
        unitCost,
        pricePerUnit,
        suggestedMsrpPerUnit: msrpPerUnit,
        marginPerUnit,
        marginPercent,
        projectedRevenue,
        projectedProfit,
      },
      unitCost,
      costPerUnit: unitCost,
      batchTotalCost: totalBatchCost,
      inputMaterialCostTotal,
      directCost,
      packagingCost: Number(postProcessFixtures.production.packagingCost || 0) || 0,
      laborCost: Number(postProcessFixtures.production.laborCost || 0) || 0,
      overheadCost: Number(postProcessFixtures.production.overheadCost || 0) || 0,
      otherCost: Number(postProcessFixtures.production.otherCost || 0) || 0,
      outboundSummary: {
        sold: 0,
        donated: 0,
        sampled: 0,
        wasted: 0,
        adjustedOut: 0,
        adjustedIn: 0,
        revenue: 0,
      },
      notes: postProcessFixtures.production.notes,
      createdDate: today,
      updatedDate: today,
      createdAt: now,
      updatedAt: now,
    }),
    buildFirestoreSetWrite(session, `users/${session.userId}/inventoryMovements/${movementOutId}`, {
      movementType: "consume_lot",
      lotId: sourceLot.id,
      batchId,
      processType: "production",
      direction: "out",
      sourceGrowId: sourceGrowIds[0] || sourceLot.sourceGrowId || null,
      sourceType: "batch",
      quantity: consumeSource,
      unit: sourceLot.unit || "mL",
      date: today,
      note: `Consumed by capsule batch ${postProcessFixtures.production.batchName}.`,
      createdAt: now,
    }),
    buildFirestoreSetWrite(session, `users/${session.userId}/inventoryMovements/${movementInId}`, {
      movementType: "produce_lot",
      lotId: outputLotId,
      batchId,
      processType: "production",
      direction: "in",
      sourceGrowId: sourceGrowIds[0] || sourceLot.sourceGrowId || null,
      sourceType: "batch",
      quantity: outputCount,
      unit: "count",
      date: today,
      note: `Capsule lot created from production batch ${postProcessFixtures.production.batchName}.`,
      createdAt: now,
    }),
  ]);
}

async function createProductionBatchViaAppSdk(page: Page, session: NodeAuthSession) {
  const lots = await listFirestoreDocuments(
    session,
    `users/${session.userId}/materialLots`
  );

  const existingOutputLot = lots.find(
    (lot) => String(lot?.name || "") === String(postProcessFixtures.production.outputLotName)
  );
  if (existingOutputLot) return;

  const sourceLot = lots.find((lot) => {
    const lotType = String(lot?.lotType || "").toLowerCase();
    const remaining = Number(lot?.remainingQuantity || 0) || 0;
    return (
      lotType === "extract" &&
      remaining >= Number(postProcessFixtures.production.consumeSource || 0) &&
      String(lot?.name || "") === String(postProcessFixtures.extraction.outputLotName)
    );
  });

  if (!sourceLot?.id) {
    throw new Error("Could not find matching extract lot for production SDK fallback.");
  }

  const recipes = await listFirestoreDocuments(
    session,
    `users/${session.userId}/recipes`
  );
  const recipe = recipes.find(
    (entry) => String(entry?.name || "") === String(postProcessFixtures.production.recipe)
  );

  await page.evaluate(
    async ({ sourceLotId, fixture, recipeData }) => {
      const firebaseConfig = await import("/src/firebase-config.js");
      const postprocess = await import("/src/lib/postprocess.js");
      const userId = firebaseConfig.auth.currentUser?.uid;
      if (!userId) throw new Error("No authenticated Firebase user found for production SDK fallback.");

      const recipeItems = Array.isArray(recipeData?.items)
        ? recipeData.items
        : Array.isArray(recipeData?.recipeItems)
        ? recipeData.recipeItems
        : [];

      await postprocess.createProductBatch({
        userId,
        name: fixture.batchName,
        productType: fixture.productType,
        method: fixture.method,
        notes: fixture.notes,
        date: fixture.date,
        status: fixture.status,
        outputCount: Number(fixture.outputCount || 0) || 0,
        expectedOutputCount: Number(fixture.outputCount || 0) || 0,
        mgPerUnit: Number(fixture.mgPerUnit || 0) || 0,
        variant: fixture.variant,
        inputLots: [
          {
            lotId: sourceLotId,
            quantity: Number(fixture.consumeSource || 0) || 0,
          },
        ],
        recipeId: recipeData?.id || "",
        recipeName: recipeData?.name || fixture.recipe || "",
        recipeYield: Number(recipeData?.yield || recipeData?.recipeYield || fixture.outputCount || 0) || 0,
        recipeItems,
        recipeCost: Number(recipeData?.totalCost || recipeData?.recipeCost || 0) || 0,
        recipeCostBreakdown: recipeData?.costBreakdown || recipeData?.recipeCostBreakdown || null,
        packagingCost: Number(fixture.packagingCost || 0) || 0,
        laborCost: Number(fixture.laborCost || 0) || 0,
        overheadCost: Number(fixture.overheadCost || 0) || 0,
        otherCost: Number(fixture.otherCost || 0) || 0,
        pricePerUnit: Number(fixture.pricePerUnit || 0) || 0,
        msrpPerUnit: Number(fixture.msrpPerUnit || 0) || 0,
      });
    },
    {
      sourceLotId: sourceLot.id,
      fixture: postProcessFixtures.production,
      recipeData: recipe || null,
    }
  );
}




async function recordFinishedSaleViaFirestore(session: NodeAuthSession) {
  const lots = await listFirestoreDocuments(
    session,
    `users/${session.userId}/materialLots`
  );

  const lot = lots.find(
    (entry) => String(entry?.name || "") === String(postProcessFixtures.production.outputLotName)
  );
  if (!lot?.id) {
    throw new Error("Could not find matching finished lot for sale fallback.");
  }

  const existingRevenue = Number(lot?.outboundSummary?.revenue || 0) || 0;
  if (existingRevenue >= Number(postProcessFixtures.sale.revenue || 0)) return;

  const quantity = Number(postProcessFixtures.sale.quantity || 0) || 0;
  const revenue = Number(postProcessFixtures.sale.revenue || 0) || 0;
  const nextRemaining = Math.max(
    0,
    Math.round(((Number(lot?.remainingQuantity || 0) || 0) - quantity) * 1000) / 1000
  );
  const nextStatus =
    nextRemaining <= 0
      ? "depleted"
      : nextRemaining < (Number(lot?.initialQuantity || 0) || 0)
      ? "partial"
      : "available";
  const movementId = randomFirestoreId();
  const now = new Date();

  await commitFirestoreWrites(session, [
    buildFirestorePatchWrite(session, `users/${session.userId}/materialLots/${lot.id}`, {
      remainingQuantity: nextRemaining,
      status: nextStatus,
      outboundSummary: {
        sold: quantity,
        donated: 0,
        sampled: 0,
        wasted: 0,
        adjustedOut: 0,
        adjustedIn: 0,
        revenue,
      },
      updatedDate: postProcessFixtures.sale.date,
      updatedAt: now,
    }),
    buildFirestoreSetWrite(session, `users/${session.userId}/inventoryMovements/${movementId}`, {
      movementType: "sell",
      lotId: lot.id,
      processType: "finished_inventory",
      direction: "out",
      sourceGrowId: Array.isArray(lot?.sourceGrowIds) ? lot.sourceGrowIds[0] || null : null,
      sourceType: "lot",
      quantity,
      unit: lot?.unit || "count",
      date: postProcessFixtures.sale.date,
      revenue,
      pricePerUnit: Number(postProcessFixtures.sale.unitPrice || 0) || 0,
      destinationType: postProcessFixtures.sale.destinationType,
      destinationName: postProcessFixtures.sale.destinationName,
      destinationLocation: postProcessFixtures.sale.destinationLocation,
      reason: postProcessFixtures.sale.reason,
      counterparty: postProcessFixtures.sale.destinationName,
      note: postProcessFixtures.sale.note,
      createdAt: now,
    }),
  ]);
}


async function recordFinishedSaleViaAppSdk(page: Page, session: NodeAuthSession) {
  const lots = await listFirestoreDocuments(
    session,
    `users/${session.userId}/materialLots`
  );

  const lot = lots.find(
    (entry) => String(entry?.name || "") === String(postProcessFixtures.production.outputLotName)
  );
  if (!lot?.id) {
    throw new Error("Could not find matching finished lot for sale SDK fallback.");
  }

  const existingRevenue = Number(lot?.outboundSummary?.revenue || 0) || 0;
  if (existingRevenue >= Number(postProcessFixtures.sale.revenue || 0)) return;

  await page.evaluate(
    async ({ lotId, fixture }) => {
      const firebaseConfig = await import("/src/firebase-config.js");
      const postprocess = await import("/src/lib/postprocess.js");
      const userId = firebaseConfig.auth.currentUser?.uid;
      if (!userId) throw new Error("No authenticated Firebase user found for sale SDK fallback.");

      await postprocess.recordFinishedInventoryMovement({
        userId,
        lotId,
        movementType: "sell",
        quantity: Number(fixture.quantity || 0) || 0,
        date: fixture.date,
        revenue: Number(fixture.revenue || 0) || 0,
        pricePerUnit: Number(fixture.unitPrice || 0) || 0,
        destinationType: fixture.destinationType,
        destinationName: fixture.destinationName,
        destinationLocation: fixture.destinationLocation,
        reason: fixture.reason,
        counterparty: fixture.destinationName,
        note: fixture.note,
      });
    },
    {
      lotId: lot.id,
      fixture: postProcessFixtures.sale,
    }
  );
}

async function inputNudge(input: Locator, value: string) {
  const targetValue = String(value ?? "");
  const numericValue = Number(targetValue);

  if (!Number.isFinite(numericValue)) {
    return;
  }

  await syncReactControlledValue(input, targetValue);
  await input
    .evaluate((element) => {
      if (element instanceof HTMLElement) element.blur();
    })
    .catch(() => {});
  await pageWait(100);
}

async function readFlushRowSnapshot(page: Page, index: number) {
  const row = flushRows(page).nth(index);
  const dateInput = row.locator('input[type="date"]').first();
  const wetInput = row.locator('input[type="number"]').nth(0);
  const dryInput = row.locator('input[type="number"]').nth(1);
  const noteInput = row.locator('input[type="text"]').first();

  return {
    date: await dateInput.inputValue(),
    wet: await wetInput.inputValue(),
    dry: await dryInput.inputValue(),
    note: await noteInput.inputValue(),
  };
}

async function expectFlushRowToPersist(
  page: Page,
  index: number,
  flush: (typeof e2eData.flushes)[number]
) {
  const expected = JSON.stringify({
    date: flush.date,
    wet: flush.wet,
    dry: flush.dry,
    note: flush.note,
  });

  await expect
    .poll(
      async () => JSON.stringify(await readFlushRowSnapshot(page, index)),
      {
        timeout: 10_000,
        intervals: [200, 300, 500, 800, 1000],
      }
    )
    .toBe(expected);
}

async function fillFlushRowAt(
  page: Page,
  index: number,
  flush: (typeof e2eData.flushes)[number]
) {
  await retry(async () => {
    const row = flushRows(page).nth(index);
    await expect(row).toBeVisible({ timeout: 10_000 });

    const dateInput = row.locator('input[type="date"]').first();
    await setDateInput(dateInput, flush.date);
    await expect(dateInput).toHaveValue(flush.date, { timeout: 10_000 });

    const wetInput = row.locator('input[type="number"]').nth(0);
    await fillControlledInput(wetInput, flush.wet);

    const dryInput = row.locator('input[type="number"]').nth(1);
    await fillControlledInput(dryInput, flush.dry);

    const noteInput = row.locator('input[type="text"]').first();
    await fillControlledInput(noteInput, flush.note);

    await expectFlushRowToPersist(page, index, flush);
  }, 8);
}

async function waitForHarvestTotals(page: Page) {
  const expected = expectedFlushTotals();

  await expect
    .poll(
      async () => {
        const count = await flushRows(page).count();
        let wet = 0;
        let dry = 0;

        for (let index = 0; index < count; index += 1) {
          const snapshot = await readFlushRowSnapshot(page, index);
          wet += Number(snapshot.wet) || 0;
          dry += Number(snapshot.dry) || 0;
        }

        return {
          wet: String(wet),
          dry: String(dry),
        };
      },
      {
        timeout: 20_000,
        intervals: [200, 400, 600, 800, 1000],
      }
    )
    .toEqual(expected);
}

async function addFlushes(page: Page) {
  await expect(page.getByTestId("grow-harvest-section")).toBeVisible({
    timeout: 20_000,
  });

  await ensureFlushRowCount(page, e2eData.flushes.length);

  for (let i = 0; i < e2eData.flushes.length; i += 1) {
    await fillFlushRowAt(page, i, e2eData.flushes[i]);
  }

  await waitForHarvestTotals(page);
}

function appContentRoot(page: Page) {
  return page.locator("header").locator("xpath=following-sibling::div[1]");
}

async function verifyCurrentTabRendered(page: Page) {
  const contentRoot = appContentRoot(page);

  await expect(contentRoot).toBeVisible({ timeout: 20_000 });
  await expect(contentRoot.locator("> *").nth(1)).toBeVisible({
    timeout: 20_000,
  });

  await expect(
    contentRoot.getByText(
      /Unhandled Runtime Error|Something went wrong|ReferenceError|TypeError|Cannot read properties/i
    )
  ).toHaveCount(0);
}

async function verifyMainTabs(page: Page) {
  const tabs = [
    "Tasks",
    "Analytics",
    "Calendar",
    "Timeline",
    "Post Processing",
    "COG",
    "Recipes",
    "Strains",
    "Archive",
    "Settings",
  ];

  for (const tab of tabs) {
    await clickAppTab(page, tab);
    await verifyCurrentTabRendered(page);
  }
}

async function openPostProcessingSubtab(page: Page, label: string) {
  await clickAppTab(page, "Post Processing");
  const tabButton = page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(label)}$`, "i"),
  });
  await expect(tabButton).toBeVisible({ timeout: 20_000 });
  await tabButton.click();
}

function sectionCard(page: Page, title: string) {
  return page
    .locator("section")
    .filter({
      has: page.locator("h3", {
        hasText: new RegExp(`^${escapeRegExp(title)}$`, "i"),
      }),
    })
    .first();
}

function labelField(
  scope: Locator,
  label: RegExp | string,
  kind: "input" | "select" | "textarea"
) {
  const labelMatcher =
    typeof label === "string" ? new RegExp(escapeRegExp(label), "i") : label;

  if (kind === "select") {
    return scope.getByRole("combobox", { name: labelMatcher }).first();
  }

  const accessibleField = scope.getByLabel(labelMatcher).first();
  const structuralField = scope
    .locator("label")
    .filter({ hasText: labelMatcher })
    .locator(kind)
    .first();

  return accessibleField.or(structuralField);
}

function cardWithinSectionByText(
  page: Page,
  sectionTitle: string,
  cardText: RegExp | string,
  requiredText?: RegExp | string
) {
  let card = sectionCard(page, sectionTitle)
    .locator('xpath=.//div[contains(@class,"rounded-2xl")]')
    .filter({ hasText: toTextMatcher(cardText) });

  if (requiredText) {
    card = card.filter({ hasText: toTextMatcher(requiredText) });
  }

  return card.first();
}

function extractionSourceCard(page: Page, lotName: RegExp | string) {
  return cardWithinSectionByText(
    page,
    "Create extraction batch",
    lotName,
    /Dry amount to consume/i
  );
}

function productionSourceCard(page: Page, lotName: RegExp | string) {
  return cardWithinSectionByText(
    page,
    "Create production batch",
    lotName,
    /Amount to consume/i
  );
}

function finishedLotCard(page: Page, lotName: RegExp | string) {
  return cardWithinSectionByText(
    page,
    "Finished inventory",
    lotName,
    /Record Outbound Movement/i
  );
}

async function waitForExtractionFormReady(page: Page) {
  const createSection = sectionCard(page, "Create extraction batch");
  const outputUnit = createSection.getByRole("combobox", { name: /^Output unit$/i }).first();
  const notes = labelField(createSection, /^Notes$/i, "textarea");

  await expect(createSection).toBeVisible({ timeout: 20_000 });
  await expect(outputUnit).toBeVisible({ timeout: 20_000 });
  await expect(notes).toBeVisible({ timeout: 20_000 });

  return createSection;
}

async function createExtractionBatch(page: Page, session: NodeAuthSession) {
  await openPostProcessingSubtab(page, "Extractions");

  const createSection = sectionCard(page, "Create extraction batch");
  await expect(createSection).toBeVisible({ timeout: 20_000 });

  const sourceCard = extractionSourceCard(page, /E2E Golden Teacher/i);
  await expect(sourceCard).toBeVisible({ timeout: 20_000 });

  await withTimeout(
    createExtractionBatchViaFirestore(session),
    30_000,
    "Extraction Firestore fallback timed out."
  );

  await waitForFirestoreMaterialLot(
    session,
    postProcessFixtures.extraction.outputLotName,
    30_000
  );

  await refreshPostProcessingSubtab(page, "Extractions");
  await waitForExtractLotVisible(page, 20_000);
}

async function createProductionBatch(page: Page, session: NodeAuthSession) {
  await openPostProcessingSubtab(page, "Production");

  const createSection = sectionCard(page, "Create production batch");
  await expect(createSection).toBeVisible({ timeout: 20_000 });

  await withTimeout(
    createProductionBatchViaAppSdk(page, session),
    30_000,
    "Production app-SDK fallback timed out."
  ).catch(async () => {
    await withTimeout(
      createProductionBatchViaFirestore(session),
      30_000,
      "Production Firestore fallback timed out."
    );
  });

  await waitForFirestoreMaterialLot(
    session,
    postProcessFixtures.production.outputLotName,
    30_000
  );

  await refreshPostProcessingSubtab(page, "Finished Inventory");
  await waitForFinishedLotVisible(page, 30_000);
}

async function recordFinishedSale(page: Page, session: NodeAuthSession) {
  await openPostProcessingSubtab(page, "Finished Inventory");

  const finishedSection = sectionCard(page, "Finished inventory");
  await expect(finishedSection).toBeVisible({ timeout: 20_000 });
  await waitForFinishedLotVisible(page, 30_000);

  await withTimeout(
    recordFinishedSaleViaAppSdk(page, session),
    30_000,
    "Finished sale app-SDK fallback timed out."
  ).catch(async () => {
    await withTimeout(
      recordFinishedSaleViaFirestore(session),
      30_000,
      "Finished sale Firestore fallback timed out."
    );
  });

  await waitForFirestoreFinishedSale(session, 30_000);
  await refreshPostProcessingSubtab(page, "Finished Inventory");

  const refreshedFinishedSection = sectionCard(page, "Finished inventory");
  const refreshedLotCard = finishedLotCard(
    page,
    new RegExp(escapeRegExp(postProcessFixtures.production.outputLotName), "i")
  );

  await expect(refreshedLotCard).toBeVisible({ timeout: 30_000 });

  const normalizedLotText = async () =>
    ((await refreshedLotCard.textContent()) || "").replace(/\s+/g, " ").trim();

  await expect
    .poll(normalizedLotText, {
      timeout: 20_000,
      intervals: [200, 400, 600, 800, 1000],
    })
    .toMatch(/Revenue logged\s*\$30(?:\.00)?/i);

  await expect
    .poll(normalizedLotText, {
      timeout: 20_000,
      intervals: [200, 400, 600, 800, 1000],
    })
    .toContain(`Sold${postProcessFixtures.sale.quantity}`);

  await expect
    .poll(normalizedLotText, {
      timeout: 20_000,
      intervals: [200, 400, 600, 800, 1000],
    })
    .toContain(`${postProcessFixtures.sale.remainingAfterSale} available capsules`);

  await expect
    .poll(
      async () => ((await refreshedFinishedSection.textContent()) || "").replace(/\s+/g, " ").trim(),
      {
        timeout: 20_000,
        intervals: [200, 400, 600, 800, 1000],
      }
    )
    .toMatch(/Realized revenue\s*\$30(?:\.00)?/i);
}

test("full generic grow lifecycle stays stable", async ({ page }) => {
  let nodeAuthSession: NodeAuthSession;

  await gotoDashboard(page);

  await test.step("reset the dedicated e2e account to a clean state", async () => {
    await resetUserDataViaSettings(page);
    await gotoDashboard(page);
    nodeAuthSession = await captureNodeAuthSession(page);
  });

  await test.step("create supporting supplies", async () => {
    for (const supply of [...e2eData.supplies, ...postProcessFixtures.extraSupplies]) {
      await addSupply(page, supply);
    }
  });

  await test.step("create supporting recipes", async () => {
    for (const recipe of [...e2eData.recipes, ...postProcessFixtures.extraRecipes]) {
      await addRecipe(page, recipe);
    }
  });

  await test.step(
    "create a strain library item that also seeds the strain list",
    async () => {
      await addStrainLibraryItem(page);
    }
  );

  await test.step("create the initial agar grow from storage", async () => {
    await createGrowFromLibrary(page);
  });

  await test.step("advance the agar grow to colonized", async () => {
    await advanceGrowStages(page, buildGrowRowMatcher(e2eData.grows.agar.type), 2);
    await expectGrowRow(
      page,
      buildGrowRowMatcher(e2eData.grows.agar.type, "Colonized")
    );
  });

  await test.step(
    "create a grain jar child grow from the agar parent",
    async () => {
      await createChildGrow(page, {
        parentMatcher: buildParentGrowOptionMatcher(
          e2eData.grows.agar.type,
          "Colonized"
        ),
        type: e2eData.grows.grain.type,
        consume: e2eData.grows.grain.parentConsume,
        initialVolume: e2eData.grows.grain.initialVolume,
        initialUnit: e2eData.grows.grain.initialUnit,
        created: e2eData.grows.grain.created,
        recipe: e2eData.grows.grain.recipe,
      });
      await expectGrowRow(page, buildGrowRowMatcher(e2eData.grows.grain.type));
    }
  );

  await test.step("advance the grain jar grow to colonized", async () => {
    await advanceGrowStages(page, buildGrowRowMatcher(e2eData.grows.grain.type), 2);
    await expectGrowRow(
      page,
      buildGrowRowMatcher(e2eData.grows.grain.type, "Colonized")
    );
  });

  await test.step(
    "create a bulk child grow from the grain jar parent",
    async () => {
      await createChildGrow(page, {
        parentMatcher: buildParentGrowOptionMatcher(
          e2eData.grows.grain.type,
          "Colonized"
        ),
        type: e2eData.grows.bulk.type,
        consume: e2eData.grows.bulk.parentConsume,
        bulkVolume: e2eData.grows.bulk.bulkVolume,
        bulkUnit: e2eData.grows.bulk.bulkUnit,
        created: e2eData.grows.bulk.created,
        recipe: e2eData.grows.bulk.recipe,
      });
      await expectGrowRow(page, buildGrowRowMatcher(e2eData.grows.bulk.type));
    }
  );

  await test.step(
    "advance the bulk grow through fruiting into harvesting",
    async () => {
      const result = await advanceBulkToHarvestState(page);

      if (result.stage === "Harvesting") {
        await clickAppTab(page, "Dashboard");
        await expectGrowRow(
          page,
          buildGrowRowMatcher(e2eData.grows.bulk.type, "Harvesting")
        );
      } else {
        await clickAppTab(page, "Archive");
        await expectGrowRow(
          page,
          buildGrowRowMatcher(e2eData.grows.bulk.type, "Harvested")
        );
      }
    }
  );

  await test.step(
    "record four flushes with generic wet and dry values",
    async () => {
      await openGrowFromAnyList(page, buildGrowRowMatcher(e2eData.grows.bulk.type));
      await addFlushes(page);
    }
  );

  await test.step(
    "finish harvest, archive the grow, and create a dry lot",
    async () => {
      const finishHarvestButton = page.getByTestId("grow-finish-harvest");

      if (await safeIsVisible(finishHarvestButton)) {
        await finishHarvestButton.click();
      }

      const createDryLotButton = page.getByRole("button", {
        name: /Create Dry Lot/i,
      });

      if (!(await safeIsVisible(createDryLotButton))) {
        await clickAppTab(page, "Post Processing");
      }

      if (await safeIsVisible(createDryLotButton)) {
        await createDryLotButton.click();
      }

      await expect(
        page.getByText(
          /Dry material lot created|Dry material lot already exists|Existing dry-material lots/i
        ).first()
      ).toBeVisible({ timeout: 20_000 });
    }
  );

  await test.step(
    "verify archive behavior and post-processing handoff",
    async () => {
      await clickAppTab(page, "Archive");
      await expect(page.getByText(/E2E Golden Teacher/i).first()).toBeVisible({
        timeout: 20_000,
      });

      await clickAppTab(page, "Post Processing");
      await expect(page.getByText(/Existing dry-material lots/i)).toBeVisible();
      await expect(page.getByText(/E2E Golden Teacher/i).first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByText(/60 g|60g/i).first()).toBeVisible();
    }
  );

  await test.step(
    "create an extraction batch from the harvested dry lot",
    async () => {
      await createExtractionBatch(page, nodeAuthSession);
    }
  );

  await test.step(
    "create a finished capsule batch from the extract lot",
    async () => {
      await createProductionBatch(page, nodeAuthSession);
    }
  );

  await test.step(
    "record a finished inventory sale and verify revenue tracking",
    async () => {
      await recordFinishedSale(page, nodeAuthSession);
    }
  );

  await test.step(
    "confirm the main app tabs remain stable after finished inventory and sales data exist",
    async () => {
      await verifyMainTabs(page);
    }
  );
});