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

async function addSupply(page: Page, supply: (typeof e2eData.supplies)[number]) {
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

async function addRecipe(page: Page, recipe: (typeof e2eData.recipes)[number]) {
  await clickAppTab(page, "Recipes");
  await expect(page.getByText(/Recipes/i).first()).toBeVisible();
  await page.getByRole("button", { name: /New Recipe/i }).click();
  await expect(
    page.getByRole("heading", { name: /New Recipe/i })
  ).toBeVisible();

  await page.getByPlaceholder("Recipe name").fill(recipe.name);
  await page.getByPlaceholder("Tags (comma-separated)").fill(recipe.tags);
  await page.getByPlaceholder(/Serving label/i).fill(recipe.servingLabel);
  await page.getByLabel(/Recipe yield/i).fill(recipe.yield);

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

  await expect(page.getByText(recipe.name)).toBeVisible({ timeout: 20_000 });
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

async function fillControlledInput(input: Locator, value: string) {
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.click();
  await input.press("Control+A").catch(() => {});
  await input.fill("");
  await input.fill(value);
  await input.blur();
  await expect(input).toHaveValue(value, { timeout: 10_000 });
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
  const section = harvestSection(page);
  const totals = expectedFlushTotals();
  const wetPattern = new RegExp(`${totals.wet}\\s*g`, "i");
  const dryPattern = new RegExp(`${totals.dry}\\s*g`, "i");

  await expect
    .poll(
      async () => {
        const text = (await section.textContent()) || "";
        return text.replace(/\s+/g, " ").trim();
      },
      {
        timeout: 20_000,
        intervals: [200, 400, 600, 800, 1000],
      }
    )
    .toMatch(wetPattern);

  await expect
    .poll(
      async () => {
        const text = (await section.textContent()) || "";
        return text.replace(/\s+/g, " ").trim();
      },
      {
        timeout: 20_000,
        intervals: [200, 400, 600, 800, 1000],
      }
    )
    .toMatch(dryPattern);
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

test.describe.configure({ mode: "serial" });

test("full generic grow lifecycle stays stable", async ({ page }) => {
  await gotoDashboard(page);

  await test.step("reset the dedicated e2e account to a clean state", async () => {
    await resetUserDataViaSettings(page);
    await gotoDashboard(page);
  });

  await test.step("create supporting supplies", async () => {
    for (const supply of e2eData.supplies) {
      await addSupply(page, supply);
    }
  });

  await test.step("create supporting recipes", async () => {
    for (const recipe of e2eData.recipes) {
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
    "confirm the main app tabs remain stable after lifecycle data exists",
    async () => {
      await verifyMainTabs(page);
    }
  );
});