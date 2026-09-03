// tests/unit/postprocessFinalDisposition.test.js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDryLotId,
  buildGrowDryLotLinkUpdate,
  buildHarvestIntakeMovementId,
  canCreateDryLotFromGrow,
  getMaterialLotFinalDispositionState,
  isActiveProcessBatch,
  isArchivedProcessBatch,
  isArchivedOrDepletedMaterialLot,
  isMaterialLotUsableForProcessing,
} from "../../src/lib/postprocess";

const AS_OF = "2026-07-26";

const postProcessManagerSource = readFileSync(
  new URL("../../src/components/postprocess/PostProcessManager.jsx", import.meta.url),
  "utf8"
);

const postprocessLibSource = readFileSync(
  new URL("../../src/lib/postprocess.js", import.meta.url),
  "utf8"
);

const growLifecycleSource = readFileSync(
  new URL("../e2e/grow-lifecycle.spec.ts", import.meta.url),
  "utf8"
);

function activeLot(overrides = {}) {
  return {
    id: "lot-1",
    lotType: "dry_material",
    status: "available",
    initialQuantity: 100,
    remainingQuantity: 80,
    reservations: [],
    ...overrides,
  };
}

describe("post-processing final disposition", () => {

  it("keeps harvested grows eligible for a deterministic, traceable dry-lot intake", () => {
    const grow = {
      id: "grow-harvested-1",
      stage: "Harvested",
      status: "Active",
      dryYield: 42.5,
      stageDates: { Harvested: "2026-07-25" },
    };

    expect(canCreateDryLotFromGrow(grow)).toBe(true);
    expect(buildDryLotId(grow.id)).toBe("dry_grow-harvested-1");
    expect(buildHarvestIntakeMovementId(grow.id)).toBe(
      "harvest_intake_grow-harvested-1"
    );
  });

  it("builds a source-grow link without changing the grow stage or status", () => {
    const linkedAt = { sentinel: "serverTimestamp" };
    const update = buildGrowDryLotLinkUpdate({
      lotId: "dry_grow-harvested-1",
      linkedDate: "2026-07-26",
      linkedAt,
    });

    expect(update).toEqual({
      dryLotId: "dry_grow-harvested-1",
      dryLotLinkedDate: "2026-07-26",
      dryLotLinkedAt: linkedAt,
    });
    expect(update).not.toHaveProperty("stage");
    expect(update).not.toHaveProperty("status");
  });
  it("flags expired inventory for final disposition and blocks normal processing", () => {
    const lot = activeLot({
      shelfLife: { bestBy: "2026-07-20" },
    });

    expect(getMaterialLotFinalDispositionState(lot, AS_OF)).toMatchObject({
      required: true,
      reasonCode: "expired",
      recommendedMethod: "expired",
    });
    expect(isMaterialLotUsableForProcessing(lot, AS_OF)).toBe(false);
  });

  it("flags failed QC inventory and recommends the failed-QC method", () => {
    const lot = activeLot({
      lotType: "capsules",
      qc: { status: "failed" },
    });

    expect(getMaterialLotFinalDispositionState(lot, AS_OF)).toMatchObject({
      required: true,
      reasonCode: "failed_qc",
      recommendedMethod: "failed_qc",
    });
  });

  it("flags recalled inventory but does not force quarantined inventory into final disposition", () => {
    const recalled = activeLot({
      workflow: { recalled: true, recallReason: "Customer recall" },
    });
    const quarantined = activeLot({
      workflow: { quarantined: true, quarantineReason: "Awaiting review" },
    });

    expect(getMaterialLotFinalDispositionState(recalled, AS_OF)).toMatchObject({
      required: true,
      reasonCode: "recall",
      reasonLabel: "Customer recall",
    });
    expect(getMaterialLotFinalDispositionState(quarantined, AS_OF).required).toBe(false);
    expect(isMaterialLotUsableForProcessing(quarantined, AS_OF)).toBe(false);
  });

  it("keeps a normal active lot available for processing", () => {
    const lot = activeLot({
      shelfLife: { bestBy: "2027-07-20" },
      qc: { status: "pass" },
    });

    expect(getMaterialLotFinalDispositionState(lot, AS_OF).required).toBe(false);
    expect(isMaterialLotUsableForProcessing(lot, AS_OF)).toBe(true);
  });

  it("catches terminal-status records that still have remaining quantity", () => {
    const lot = activeLot({ status: "destroyed" });

    expect(getMaterialLotFinalDispositionState(lot, AS_OF)).toMatchObject({
      required: true,
      reasonCode: "destroyed_status_with_remaining",
    });
  });

  it("moves failed, rejected, and cancelled process batches out of active workflows", () => {
    for (const status of ["failed", "rejected", "cancelled", "canceled"]) {
      const batch = {
        id: `batch-${status}`,
        processType: "extraction",
        status,
      };

      expect(isActiveProcessBatch(batch)).toBe(false);
      expect(isArchivedProcessBatch(batch)).toBe(true);
    }
  });
});

describe("post-processing packaged sales regression", () => {
  it("keeps parent finished batches out of Sales until a package child exists", () => {
    expect(postProcessManagerSource).toContain(
      "activeFinishedGoodsLots.filter((lot) => isPackagedForSale(lot))"
    );
    expect(postProcessManagerSource).toContain(
      ".filter((lot) => !isPackagedForSale(lot))"
    );
    expect(postProcessManagerSource).toContain(
      'String(lot?.sourceType || "").trim().toLowerCase() === "finished_package"'
    );
    expect(postProcessManagerSource).toContain(
      "lot?.packageRunId && (lot?.parentLotId || lot?.sourceLotId)"
    );
  });

  it("groups Sales by product first and then exact SKU type plus package size", () => {
    expect(postProcessManagerSource).toContain("function getSalesProductKey(lot = {})");
    expect(postProcessManagerSource).toContain("function getSkuGroupKey(lot = {})");
    expect(postProcessManagerSource).toContain(
      "return [getSkuType(lot), getPackageSizeLabel(lot)]"
    );
    expect(postProcessManagerSource).toContain(
      "const skuKey = getSkuGroupKey(lot);"
    );
  });

  it("keeps sample, promo, and internal inventory separated from retail sales", () => {
    expect(postProcessManagerSource).toContain(
      'const retailSkus = activeSkus.filter((sku) => String(sku?.skuType || "retail") === "retail");'
    );
    expect(postProcessManagerSource).toContain(
      'const sampleSkus = activeSkus.filter((sku) => String(sku?.skuType || "retail") !== "retail");'
    );
    expect(postProcessManagerSource).toContain(
      '<option value="sample">Sample / not for sale</option>'
    );
    expect(postProcessManagerSource).toContain(
      'if (skuType === "sample")'
    );
    expect(postProcessManagerSource).toContain(
      'movementType: "sample", destinationType: "internal"'
    );
  });

  it("uses FEFO inside the exact matching SKU and falls back to inventory age", () => {
    expect(postProcessManagerSource).toContain(
      "const bestByDifference = getLotBestByMs(a) - getLotBestByMs(b);"
    );
    expect(postProcessManagerSource).toContain(
      "const ageDifference = getInventoryAgeMs(a) - getInventoryAgeMs(b);"
    );
    expect(postProcessManagerSource).toContain(
      "getSalesSkuKey(candidate) === key"
    );
    expect(postProcessManagerSource).toContain(
      "compareFefoPriority(candidate, lot) < 0"
    );
    expect(postProcessManagerSource).toContain(
      "samples do not block retail packages"
    );
  });

  it("removes depleted package lots from active Sales while preserving them for History", () => {
    const depletedPackage = activeLot({
      lotType: "capsules",
      sourceType: "finished_package",
      status: "depleted",
      initialQuantity: 12,
      remainingQuantity: 0,
    });

    expect(isArchivedOrDepletedMaterialLot(depletedPackage)).toBe(true);
    expect(postProcessManagerSource).toContain(
      "activeSkus: skus.filter((sku) => sku.activeLots.length > 0)"
    );
    expect(postProcessManagerSource).toContain(
      ".filter((product) => product.activeLots.length > 0);"
    );
    expect(postProcessManagerSource).toContain(
      'title="Depleted / archived lots"'
    );
  });

  it("retains outbound movements in the auditable inventory ledger", () => {
    expect(postProcessManagerSource).toContain(
      'title="Inventory movement ledger"'
    );
    expect(postProcessManagerSource).toContain(
      "movements.map((movement) =>"
    );
    expect(postProcessManagerSource).toContain(
      "recordFinishedInventoryMovement({"
    );
    expect(postprocessLibSource).toContain(
      "movementType: normalizedType"
    );
    expect(postprocessLibSource).toContain(
      'processType: "finished_inventory"'
    );
  });

  it("requires a retail SKU with passed QC before any package can be sold", () => {
    expect(postProcessManagerSource).toContain(
      'if (getSkuType(lot) !== "retail")'
    );
    expect(postProcessManagerSource).toContain(
      'return "Only retail package SKUs can be sold.";'
    );
    expect(postProcessManagerSource).toContain(
      'if (qcStatus !== "pass") return "This package run must pass QC before it can be sold.";'
    );
  });

  it("uses the same QC and SKU eligibility guard before manual sale release", () => {
    const releaseHandlerStart = postProcessManagerSource.indexOf(
      "async function handleReleasePackageForSale(lot)"
    );
    const releaseHandlerEnd = postProcessManagerSource.indexOf(
      "async function handleSaveReservation(lot)",
      releaseHandlerStart
    );
    const releaseHandler = postProcessManagerSource.slice(
      releaseHandlerStart,
      releaseHandlerEnd
    );

    expect(releaseHandler).toContain(
      "getPackageSaleEligibilityBlockReason(lot, today)"
    );
    expect(releaseHandler).toContain("if (eligibilityBlockReason)");
  });

  it("separates active package runs from retail inventory that is actually sale-ready", () => {
    expect(postProcessManagerSource).toContain(
      "const activePackagedFinishedGoodsLots = useMemo("
    );
    expect(postProcessManagerSource).toContain(
      "activePackagedFinishedGoodsLots.filter("
    );
    expect(postProcessManagerSource).toContain(
      "(lot) => getLotAvailableQuantity(lot) > 0 && !getSalesBlockReason(lot, today)"
    );
    expect(postProcessManagerSource).toContain(
      "activePackagedFinishedGoodsLots.forEach((lot) =>"
    );
  });

  it("bases available-package and projected-revenue metrics on sale-ready retail lots", () => {
    expect(postProcessManagerSource).toContain(
      "const totalSaleReadyUnits = saleReadyFinishedGoodsLots.reduce("
    );
    expect(postProcessManagerSource).toContain(
      "const productSaleReadyLots = product.activeLots.filter((lot) => !getSalesBlockReason(lot, today));"
    );
    expect(postProcessManagerSource).toContain(
      "const skuSaleReadyLots = sku.activeLots.filter((lot) => !getSalesBlockReason(lot, today));"
    );
    expect(postProcessManagerSource).toContain(
      'hint="Sellable retail packages × locked price"'
    );
  });
});

describe("packaged sales lifecycle E2E contract", () => {
  it("creates a retail package child before recording the sale", () => {
    const packageStep = growLifecycleSource.indexOf(
      "create a released retail package child from finished inventory"
    );
    const saleStep = growLifecycleSource.indexOf(
      "record a packaged retail sale and verify parent-child inventory tracking"
    );

    expect(packageStep).toBeGreaterThan(-1);
    expect(saleStep).toBeGreaterThan(packageStep);
    expect(growLifecycleSource).toContain(
      "postprocess.createPackagedFinishedLot({"
    );
    expect(growLifecycleSource).toContain(
      "findPackagedRetailSaleLot(lots)"
    );
  });

  it("locks the lifecycle fixture to a packaged retail SKU instead of selling the parent batch", () => {
    expect(growLifecycleSource).toContain('skuType: "retail"');
    expect(growLifecycleSource).toContain('packageSize: "10"');
    expect(growLifecycleSource).toContain('packageSizeUnit: "capsules"');
    expect(growLifecycleSource).toContain('packageCount: "10"');
    expect(growLifecycleSource).toContain('sourceQuantity: "100"');
    expect(growLifecycleSource).toContain('capsulesPerPackage: "10"');
    expect(growLifecycleSource).toContain('remainingAfterSale: "7"');
  });

  it("releases the parent before packaging and preserves the parent-child relationship through sale verification", () => {
    expect(growLifecycleSource).toContain(
      'releaseStatus: "released"'
    );
    expect(growLifecycleSource).toContain(
      'qc: {'
    );
    expect(growLifecycleSource).toContain(
      'status: "pass"'
    );
    expect(growLifecycleSource).toContain(
      "parentRemainingAfterPackaging"
    );
    expect(growLifecycleSource).toContain(
      'String(lot?.parentLotId || lot?.sourceLotId || "")'
    );
  });
});
