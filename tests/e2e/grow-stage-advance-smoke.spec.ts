// tests/e2e/grow-stage-advance-smoke.spec.ts
import { expect, test } from "@playwright/test";
import {
  buttonByText,
  confirmDialog,
  controlAfterLabel,
  expectGrowRow,
  gotoDashboard,
  openNewGrow,
  selectOptionByText,
  setDateInput,
} from "./helpers/app";
import { captureNodeAuthSession, setFirestoreDocument } from "./helpers/firestore";
import { resetUserDataDirect } from "./helpers/resetUserData";

const smokeGrow = {
  strainName: "E2E Stage Advance Golden Teacher",
  scientificName: "Psilocybe cubensis",
  libraryId: "e2e-stage-advance-storage",
  storageType: "Spore Syringe",
  storageQty: 10,
  growType: "Agar",
  initialVolume: "1",
  initialUnit: "ml",
  createdDate: "2026-03-03",
};

async function seedMinimumGrowFormData(
  session: Awaited<ReturnType<typeof captureNodeAuthSession>>
) {
  const now = new Date().toISOString();

  await setFirestoreDocument(
    session,
    `users/${session.userId}/library/${smokeGrow.libraryId}`,
    {
      type: smokeGrow.storageType,
      strainName: smokeGrow.strainName,
      scientificName: smokeGrow.scientificName,
      qty: smokeGrow.storageQty,
      unit: "ml",
      volumeMl: smokeGrow.storageQty,
      acquired: "2026-03-01",
      status: "Active",
      archived: false,
      createdAt: now,
      updatedAt: now,
    }
  );
}

function growForm(page: Parameters<typeof openNewGrow>[0]) {
  return page.locator("form.grow-form").first();
}

async function createAgarGrow(page: Parameters<typeof openNewGrow>[0]) {
  await openNewGrow(page);

  const form = growForm(page);
  await buttonByText(form, /Storage Item/i).click();
  await selectOptionByText(
    controlAfterLabel(form, "Storage Item", "select"),
    smokeGrow.strainName
  );
  await controlAfterLabel(form, "Grow Type", "select").selectOption(
    smokeGrow.growType
  );
  await controlAfterLabel(
    form,
    "Initial Volume (each child)",
    "input"
  ).fill(smokeGrow.initialVolume);
  await controlAfterLabel(form, "Unit", "select").selectOption(
    smokeGrow.initialUnit
  );
  await setDateInput(
    controlAfterLabel(form, "Created Date", "input"),
    smokeGrow.createdDate
  );

  await form.getByRole("button", { name: /^Create$/i }).click();
  await confirmDialog(page, /^Continue$/i);

  await expect(form).toBeHidden({ timeout: 20_000 });
  await expectGrowRow(page, {
    strain: smokeGrow.strainName,
    type: smokeGrow.growType,
    stage: "Inoculated",
    status: "Active",
  });
}

test("advances one agar grow from inoculated to colonized", async ({ page }) => {
  await gotoDashboard(page);
  await resetUserDataDirect(page);

  const session = await captureNodeAuthSession(page);
  await seedMinimumGrowFormData(session);
  await gotoDashboard(page);

  await createAgarGrow(page);

  const inoculatedRow = await expectGrowRow(page, {
    strain: smokeGrow.strainName,
    type: smokeGrow.growType,
    stage: "Inoculated",
    status: "Active",
  });
  await inoculatedRow.getByTestId("grow-row-stage-plus").click();
  await confirmDialog(page);

  const colonizingRow = await expectGrowRow(page, {
    strain: smokeGrow.strainName,
    type: smokeGrow.growType,
    stage: "Colonizing",
    status: "Active",
  });
  await colonizingRow.getByTestId("grow-row-stage-plus").click();
  await confirmDialog(page);

  await expectGrowRow(page, {
    strain: smokeGrow.strainName,
    type: smokeGrow.growType,
    stage: "Colonized",
    status: "Active",
  });
});
