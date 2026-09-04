// tests/unit/postprocessFinalDisposition.test.js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDryLotId,
  buildGrowDryLotLinkUpdate,
  buildHarvestIntakeMovementId,
  canCreateDryLotFromGrow,
  getMaterialLotFinalDispositionState,
  getFinishedPackagingSourceBlockReason,
  getFinishedSaleBlockReason,
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

function releasedFinishedParent(overrides = {}) {
  return {
    id: "parent-1",
    lotType: "capsules",
    status: "available",
    initialQuantity: 100,
    remainingQuantity: 100,
    qc: { status: "pass", checkedDate: "2026-03-21" },
    releaseRequired: true,
    releaseStatus: "released",
    workflow: {
      releaseRequired: true,
      releaseStatus: "released",
    },
    shelfLife: {
      madeOn: "2026-03-21",
      bestBy: "2027-03-21",
    },
    ...overrides,
  };
}

function packagedRetailLot(overrides = {}) {
  return {
    id: "package-1",
    lotType: "capsules",
    sourceType: "finished_package",
    sourceLotId: "parent-1",
    parentLotId: "parent-1",
    packageRunId: "package-1",
    skuType: "retail",
    status: "available",
    initialQuantity: 10,
    remainingQuantity: 10,
    qc: { status: "pass", checkedDate: "2026-03-22" },
    qcStatus: "pass",
    releaseRequired: true,
    releaseStatus: "released",
    workflow: {
      releaseRequired: true,
      releaseStatus: "released",
    },
    shelfLife: {
      madeOn: "2026-03-22",
      bestBy: "2027-03-22",
    },
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

  it("enforces the same packaged retail QC and release boundary in the library layer", () => {
    expect(getFinishedSaleBlockReason(packagedRetailLot(), "2026-03-23")).toBe("");
    expect(
      getFinishedSaleBlockReason(
        packagedRetailLot({ skuType: "sample" }),
        "2026-03-23"
      )
    ).toBe("Only retail package SKUs can be sold.");
    expect(
      getFinishedSaleBlockReason(
        packagedRetailLot({
          qc: { status: "pending" },
          qcStatus: "pending",
        }),
        "2026-03-23"
      )
    ).toBe("This package run must pass QC before it can be sold.");
    expect(
      getFinishedSaleBlockReason(
        packagedRetailLot({
          releaseStatus: "pending",
          workflow: {
            releaseRequired: true,
            releaseStatus: "pending",
          },
        }),
        "2026-03-23"
      )
    ).toBe("This package run has not been released for sale.");
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

  it("requires the finished parent to pass QC and release before packaging", () => {
    expect(postProcessManagerSource).toContain(
      'getFinishedPackagingSourceBlockReason(sourceLot, form.date || "")'
    );
    expect(
      getFinishedPackagingSourceBlockReason(releasedFinishedParent(), "2026-03-22")
    ).toBe("");
    expect(
      getFinishedPackagingSourceBlockReason(
        releasedFinishedParent({ qc: { status: "pending" } }),
        "2026-03-22"
      )
    ).toBe("This finished source lot must pass QC before packaging.");
    expect(
      getFinishedPackagingSourceBlockReason(
        releasedFinishedParent({
          releaseStatus: "pending",
          workflow: {
            releaseRequired: true,
            releaseStatus: "pending",
          },
        }),
        "2026-03-22"
      )
    ).toBe("This finished source lot must be released before packaging.");
  });

  it("creates every package child with package-specific QC and release pending", () => {
    expect(postprocessLibSource).toContain(
      'status: "pending",\n      checkedBy: "",\n      checkedDate: "",\n      notes: "Package-specific QC required after packaging."'
    );
    expect(postprocessLibSource).toContain(
      'releaseStatus: "pending",\n      releasedAt: "",\n      releasedBy: ""'
    );
    expect(postprocessLibSource).toContain(
      'notes: "Package run requires package-specific QC and release after package/label review."'
    );
    expect(postprocessLibSource).not.toContain(
      "Package run inherited release from source finished batch."
    );
  });

  it("enforces sale readiness again inside the transactional movement writer", () => {
    const movementStart = postprocessLibSource.indexOf(
      "export async function recordFinishedInventoryMovement"
    );
    const movementEnd = postprocessLibSource.indexOf(
      "function normalizeIngredientLinesForPostProcess",
      movementStart
    );
    const movementSource = postprocessLibSource.slice(movementStart, movementEnd);

    expect(movementSource).toContain('if (normalizedType === "sell")');
    expect(movementSource).toContain(
      "const saleBlockReason = getFinishedSaleBlockReason(lot, normalizedDate);"
    );
    expect(movementSource).toContain(
      "if (saleBlockReason) throw new Error(saleBlockReason);"
    );
  });

  it("keeps package QC separate from the explicit package release action in Sales", () => {
    const saveQualityStart = postProcessManagerSource.indexOf(
      "async function handleSaveQuality(lot)"
    );
    const saveQualityEnd = postProcessManagerSource.indexOf(
      "function applyPackagePreset",
      saveQualityStart
    );
    const saveQualitySource = postProcessManagerSource.slice(
      saveQualityStart,
      saveQualityEnd
    );

    expect(saveQualitySource).toContain(
      "const packageRun = isPackagedForSale(lot);"
    );
    expect(saveQualitySource).toContain(
      'const autoRelease = normalizedQc === "pass" && !packageRun;'
    );
    expect(saveQualitySource).toContain(
      'releaseStatus: autoRelease ? "released" : "pending"'
    );
    expect(postProcessManagerSource).toContain(
      "Complete package/label review, then release it for sale."
    );
    expect(postProcessManagerSource).toContain(
      "<LotQualityPanel"
    );
    expect(postProcessManagerSource).toContain(
      "handleReleasePackageForSale(lot)"
    );
  });
});

describe("packaged sales lifecycle E2E contract", () => {
  it("creates a pending retail package child before any sale attempt", () => {
    const packageStep = growLifecycleSource.indexOf(
      "create a pending retail package child from released finished inventory"
    );
    const blockedSaleStep = growLifecycleSource.indexOf(
      "verify packaged retail sale is blocked before child QC and release"
    );
    const reviewStep = growLifecycleSource.indexOf(
      "review the packaged child QC and release it for sale"
    );
    const saleStep = growLifecycleSource.indexOf(
      "record a packaged retail sale and verify parent-child inventory tracking"
    );

    expect(packageStep).toBeGreaterThan(-1);
    expect(blockedSaleStep).toBeGreaterThan(packageStep);
    expect(reviewStep).toBeGreaterThan(blockedSaleStep);
    expect(saleStep).toBeGreaterThan(reviewStep);
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

  it("expects the new package child to start QC pending and release pending", () => {
    expect(growLifecycleSource).toContain(
      '"pending",\n        "pending",\n        true,'
    );
    expect(growLifecycleSource).toContain(
      "waitForFirestorePackagedRetailChildReleased"
    );
    expect(growLifecycleSource).toContain(
      "assertPackagedRetailSaleBlockedBeforeReview"
    );
    expect(growLifecycleSource).toContain(
      "/must pass QC before it can be sold/i"
    );
  });

  it("reviews and releases the child before the SDK sale and preserves parent-child tracking", () => {
    expect(growLifecycleSource).toContain(
      "reviewAndReleasePackagedRetailChild"
    );
    expect(growLifecycleSource).toContain(
      'qcStatus: "pass"'
    );
    expect(growLifecycleSource).toContain(
      'releaseStatus: "released"'
    );
    expect(growLifecycleSource).toContain(
      "postprocess.recordFinishedInventoryMovement({"
    );
    expect(growLifecycleSource).not.toContain(
      "recordFinishedSaleViaFirestore"
    );
    expect(growLifecycleSource).toContain(
      "parentRemainingAfterPackaging"
    );
    expect(growLifecycleSource).toContain(
      'String(lot?.parentLotId || lot?.sourceLotId || "")'
    );
  });
});
