// tests/unit/subscriptionLabGateIntegration.test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativeUrl) =>
  readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");

const appSource = readSource("../../src/App.jsx");
const managerSource = readSource(
  "../../src/components/postprocess/PostProcessManager.jsx"
);
const growDetailSource = readSource(
  "../../src/components/Grow/GrowDetail.jsx"
);
const wrapperSource = readSource(
  "../../src/components/Grow/LabelPrintWrapper.jsx"
);
const labelPrintSource = readSource(
  "../../src/components/Grow/LabelPrint.jsx"
);
const accessSource = readSource("../../src/lib/subscriptionLabAccess.js");

describe("Lab operational gate live integration", () => {
  it("passes configuration-driven Lab permissions from App", () => {
    for (const propName of [
      "canUsePostProcessing",
      "canUseFinishedInventory",
      "canCreatePackageRuns",
      "canUsePostProcessLabels",
      "canRecordSales",
      "canUseFefoControls",
      "canUseInventoryAuditHistory",
    ]) {
      expect(appSource).toContain(`${propName}={subscription.hasFeature(`);
    }
    expect(appSource).toContain(
      "onSubscriptionFeatureBlocked={requestSubscriptionFeature}"
    );
  });

  it("guards the Grow Detail dry-intake shortcut", () => {
    expect(appSource).toContain(
      "canUsePostProcessing={subscription.hasFeature("
    );
    expect(growDetailSource).toContain("if (!canUsePostProcessing)");
    expect(growDetailSource).toContain(
      "SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING"
    );
    expect(growDetailSource).toContain(
      "onSubscriptionFeatureBlocked({"
    );
  });

  it("guards every new intake and manufacturing entry point", () => {
    for (const action of [
      "CREATE_DRY_LOT",
      "CREATE_EXTRACTION",
      "CREATE_PRODUCTION",
      "CREATE_REWORK",
      "CREATE_PACKAGE_RUN",
    ]) {
      expect(managerSource).toContain(`LAB_OPERATION_ACTIONS.${action}`);
    }
    expect(managerSource).toContain("requestLabOperation(");
  });

  it("leaves completion handlers available for already-started batches", () => {
    expect(managerSource).toContain("async function handleFinalizeExtraction(batch)");
    expect(managerSource).toContain(
      "async function handleFinalizeProductionOutput(batch, event = null)"
    );
    expect(managerSource).toContain("finalizeExtractionBatchOutput({");
    expect(managerSource).toContain("finalizeProductBatchOutput({");
  });

  it("separates business movements, FEFO overrides, audit adjustments, and safety", () => {
    expect(managerSource).toContain("getInventoryMovementRequirement({");
    expect(managerSource).toContain("canRecordSales");
    expect(managerSource).toContain("canUseFefoControls");
    expect(managerSource).toContain("canUseInventoryAuditHistory");
    expect(accessSource).toContain('"waste"');
    expect(accessSource).toContain('"destroy"');
    expect(accessSource).toContain("return null;");
  });

  it("blocks new inventory controls but preserves reservation release and final disposition", () => {
    expect(managerSource).toContain("LAB_OPERATION_ACTIONS.ADD_RESERVATION");
    expect(managerSource).toContain(
      "LAB_OPERATION_ACTIONS.SAVE_LOW_STOCK_THRESHOLD"
    );
    expect(managerSource).toContain("async function handleRemoveReservation");
    expect(managerSource).toContain("async function handleFinalDisposition");
    expect(managerSource).toContain("recordMaterialLotFinalDisposition({");
  });

  it("keeps operational records visible with a clear read-only notice", () => {
    expect(managerSource).toContain('data-testid="postprocess-read-only-notice"');
    expect(managerSource).toContain("Existing operational records remain available");
    expect(managerSource).toContain('id: "history"');
    expect(managerSource).toContain('activeTab === "history"');
  });

  it("locks packaged and finished labels while preserving grow labels", () => {
    expect(wrapperSource).toContain('data-testid="postprocess-labels-locked"');
    expect(wrapperSource).toContain("Grow, culture, stored-item");
    expect(wrapperSource).toContain("grows={activeGrows}");
    expect(wrapperSource).toContain(
      "finishedGoods={canUsePostProcessLabels ? finishedGoodsBuckets.active : []}"
    );
  });

  it("prevents direct finished-label selection and printing without Lab access", () => {
    expect(labelPrintSource).toContain(
      'requested === "finished_goods" && !canUsePostProcessLabels'
    );
    expect(labelPrintSource).toContain(
      'source === "finished_goods" && !requestPostProcessLabelAccess()'
    );
    expect(labelPrintSource).toContain(
      'Finished Inventory{canUsePostProcessLabels ? "" : " (Lab)"}'
    );
  });
});
