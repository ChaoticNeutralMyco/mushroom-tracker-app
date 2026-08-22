// tests/unit/postprocessFinalDisposition.test.js
import { describe, expect, it } from "vitest";
import {
  buildDryLotId,
  buildGrowDryLotLinkUpdate,
  buildHarvestIntakeMovementId,
  canCreateDryLotFromGrow,
  getMaterialLotFinalDispositionState,
  isActiveProcessBatch,
  isArchivedProcessBatch,
  isMaterialLotUsableForProcessing,
} from "../../src/lib/postprocess";

const AS_OF = "2026-07-26";

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
