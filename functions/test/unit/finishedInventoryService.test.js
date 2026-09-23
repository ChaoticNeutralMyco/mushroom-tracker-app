// functions/test/unit/finishedInventoryService.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  FinishedInventoryServiceError,
  buildTrustedFinishedFinalDisposition,
  compareTrustedFinishedFefoPriority,
  getTrustedFinishedFefoBlocker,
  getTrustedFinishedSalesSkuKey,
  getTrustedFinishedSaleBlockReason,
  hasTrustedFinishedInventoryMovementAccess,
  resolveTrustedFinishedFefoDecision,
} from "../../src/finishedInventoryService.js";
import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_STATUSES,
} from "../../src/subscriptionConfig.js";

const AS_OF = "2026-09-14";

function packagedLot(overrides = {}) {
  return {
    id: "lot-default",
    lotType: "capsules",
    inventoryCategory: "finished_goods",
    sourceType: "finished_package",
    processType: "packaging",
    skuType: "retail",
    packageSkuType: "retail",
    productType: "capsule",
    strain: "Lion's Mane",
    variant: "fruiting-body",
    packageSize: 60,
    packageSizeUnit: "capsules",
    packageSizeLabel: "60 capsules",
    initialQuantity: 10,
    remainingQuantity: 10,
    reservationQuantity: 0,
    reservations: [],
    qc: {
      status: "pass",
      checkedDate: "2026-09-01",
    },
    qcStatus: "pass",
    releaseRequired: true,
    releaseStatus: "released",
    workflow: {
      releaseRequired: true,
      releaseStatus: "released",
    },
    shelfLife: {
      bestBy: "2027-01-01",
    },
    package: {
      isPackaged: true,
      skuType: "retail",
      size: 60,
      unit: "capsules",
      label: "60 capsules",
      packagedDate: "2026-09-01",
    },
    createdDate: "2026-09-01",
    pricePerUnit: 20,
    unitCost: 5,
    ...overrides,
  };
}

test("trusted package final disposition preserves destruction audit parity", () => {
  const partial = buildTrustedFinishedFinalDisposition(
    packagedLot({
      destructionSummary: {
        destroyedQuantity: 2,
      },
    }),
    {
      movementType: "destroy",
      referenceType: "final_disposition",
      referenceId: "failed_qc",
      quantity: 3,
      date: "2026-09-14",
      reason: "Failed package QC.",
      destroyMethod: "discarded",
      note: "Witnessed disposal.",
      nextRemaining: 5,
    }
  );

  assert.deepEqual(partial, {
    type: "destroy",
    trigger: "failed_qc",
    method: "discarded",
    reason: "Failed package QC.",
    note: "Witnessed disposal.",
    lastQuantity: 3,
    totalQuantity: 5,
    lastDate: "2026-09-14",
    completed: false,
    completedAt: "",
  });

  const completed = buildTrustedFinishedFinalDisposition(
    packagedLot({
      finalDisposition: partial,
      destructionSummary: {
        destroyedQuantity: 5,
      },
    }),
    {
      movementType: "destroy",
      referenceType: "final_disposition",
      referenceId: "failed_qc",
      quantity: 5,
      date: "2026-09-15",
      reason: "Failed package QC.",
      destroyMethod: "discarded",
      note: "Remaining packages destroyed.",
      nextRemaining: 0,
    }
  );

  assert.equal(completed.totalQuantity, 10);
  assert.equal(completed.completed, true);
  assert.equal(completed.completedAt, "2026-09-15");

  assert.equal(
    buildTrustedFinishedFinalDisposition(
      packagedLot(),
      {
        movementType: "destroy",
        referenceType: "normal_inventory_movement",
        quantity: 1,
        nextRemaining: 9,
      }
    ),
    null
  );
});
test("trusted FEFO key scopes rotation to the exact package SKU", () => {
  const first = packagedLot({ id: "a" });
  const second = packagedLot({ id: "b" });

  assert.equal(
    getTrustedFinishedSalesSkuKey(first),
    getTrustedFinishedSalesSkuKey(second)
  );

  const differentSize = packagedLot({
    id: "c",
    packageSize: 30,
    packageSizeLabel: "30 capsules",
    package: {
      isPackaged: true,
      skuType: "retail",
      size: 30,
      unit: "capsules",
      label: "30 capsules",
      packagedDate: "2026-09-01",
    },
  });

  assert.notEqual(
    getTrustedFinishedSalesSkuKey(first),
    getTrustedFinishedSalesSkuKey(differentSize)
  );
});

test("earlier best-by package blocks a later exact-SKU sale", () => {
  const earlier = packagedLot({
    id: "earlier",
    lotCode: "LM-EARLY",
    shelfLife: { bestBy: "2026-12-01" },
    createdDate: "2026-08-01",
  });

  const later = packagedLot({
    id: "later",
    lotCode: "LM-LATE",
    shelfLife: { bestBy: "2027-01-01" },
    createdDate: "2026-08-15",
  });

  assert.equal(
    getTrustedFinishedFefoBlocker(
      later,
      [later, earlier],
      AS_OF
    )?.id,
    "earlier"
  );
});

test("different package size does not block FEFO", () => {
  const selected = packagedLot({
    id: "selected",
    shelfLife: { bestBy: "2027-01-01" },
  });

  const otherSize = packagedLot({
    id: "other-size",
    packageSize: 30,
    packageSizeLabel: "30 capsules",
    shelfLife: { bestBy: "2026-10-01" },
    package: {
      isPackaged: true,
      skuType: "retail",
      size: 30,
      unit: "capsules",
      label: "30 capsules",
      packagedDate: "2026-08-01",
    },
  });

  assert.equal(
    getTrustedFinishedFefoBlocker(
      selected,
      [selected, otherSize],
      AS_OF
    ),
    null
  );
});

test("unsellable earlier package does not block the sellable lot", () => {
  const selected = packagedLot({
    id: "selected",
    shelfLife: { bestBy: "2027-01-01" },
  });

  const pendingQc = packagedLot({
    id: "pending-qc",
    shelfLife: { bestBy: "2026-10-01" },
    qc: {
      status: "pending",
      checkedDate: "",
    },
    qcStatus: "pending",
  });

  assert.match(
    getTrustedFinishedSaleBlockReason(
      pendingQc,
      AS_OF
    ),
    /pass QC/i
  );

  assert.equal(
    getTrustedFinishedFefoBlocker(
      selected,
      [selected, pendingQc],
      AS_OF
    ),
    null
  );
});

test("equal best-by dates fall back to oldest package first", () => {
  const older = packagedLot({
    id: "older",
    shelfLife: { bestBy: "2027-01-01" },
    createdDate: "2026-07-01",
    package: {
      isPackaged: true,
      skuType: "retail",
      size: 60,
      unit: "capsules",
      label: "60 capsules",
      packagedDate: "2026-07-01",
    },
  });

  const newer = packagedLot({
    id: "newer",
    shelfLife: { bestBy: "2027-01-01" },
    createdDate: "2026-08-01",
    package: {
      isPackaged: true,
      skuType: "retail",
      size: 60,
      unit: "capsules",
      label: "60 capsules",
      packagedDate: "2026-08-01",
    },
  });

  assert.ok(
    compareTrustedFinishedFefoPriority(
      older,
      newer
    ) < 0
  );

  assert.equal(
    getTrustedFinishedFefoBlocker(
      newer,
      [older, newer],
      AS_OF
    )?.id,
    "older"
  );
});

test("trusted FEFO cannot be bypassed by omitting override metadata", () => {
  const earlier = packagedLot({
    id: "earlier",
    lotCode: "LM-EARLY",
    shelfLife: { bestBy: "2026-12-01" },
  });

  const later = packagedLot({
    id: "later",
    lotCode: "LM-LATE",
    shelfLife: { bestBy: "2027-01-01" },
  });

  assert.throws(
    () =>
      resolveTrustedFinishedFefoDecision({
        selectedLot: later,
        candidateLots: [later, earlier],
        asOfDate: AS_OF,
        fefoOverride: false,
      }),
    (error) =>
      error instanceof FinishedInventoryServiceError &&
      error.code === "failed-precondition" &&
      error.details?.code === "fefo-blocked" &&
      error.details?.blockerLotId === "earlier"
  );
});

test("trusted FEFO override requires a reason and derives the skipped lot server-side", () => {
  const earlier = packagedLot({
    id: "earlier",
    lotCode: "LM-EARLY",
    shelfLife: { bestBy: "2026-12-01" },
  });

  const later = packagedLot({
    id: "later",
    lotCode: "LM-LATE",
    shelfLife: { bestBy: "2027-01-01" },
  });

  assert.throws(
    () =>
      resolveTrustedFinishedFefoDecision({
        selectedLot: later,
        candidateLots: [later, earlier],
        asOfDate: AS_OF,
        fefoOverride: true,
        fefoOverrideReason: "",
      }),
    /override reason/i
  );

  const decision =
    resolveTrustedFinishedFefoDecision({
      selectedLot: later,
      candidateLots: [later, earlier],
      asOfDate: AS_OF,
      fefoOverride: true,
      fefoOverrideReason:
        "Customer specifically requested the later lot.",
    });

  assert.equal(decision.overrideApplied, true);
  assert.equal(decision.blocker?.id, "earlier");
});

test("safety movements remain available while business movements require trusted access", () => {
  const free = {
    planId: SUBSCRIPTION_PLAN_IDS.FREE,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
  };

  const lab = {
    planId: SUBSCRIPTION_PLAN_IDS.LAB,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
  };

  assert.equal(
    hasTrustedFinishedInventoryMovementAccess({
      entitlement: free,
      movementType: "destroy",
    }),
    true
  );

  assert.equal(
    hasTrustedFinishedInventoryMovementAccess({
      entitlement: free,
      movementType: "sell",
    }),
    false
  );

  assert.equal(
    hasTrustedFinishedInventoryMovementAccess({
      entitlement: lab,
      movementType: "sell",
    }),
    true
  );
});

test("trusted feature overrides and active Lab promotions are honored", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  const overrideEntitlement = {
    planId: SUBSCRIPTION_PLAN_IDS.FREE,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
    featureOverrides: {
      salesTracking: true,
    },
  };

  assert.equal(
    hasTrustedFinishedInventoryMovementAccess({
      entitlement: overrideEntitlement,
      movementType: "sell",
      now,
    }),
    true
  );

  const free = {
    planId: SUBSCRIPTION_PLAN_IDS.FREE,
    status: SUBSCRIPTION_STATUSES.ACTIVE,
  };

  const promotion = {
    status: "active",
    planId: SUBSCRIPTION_PLAN_IDS.LAB,
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2026-10-01T00:00:00.000Z"),
  };

  assert.equal(
    hasTrustedFinishedInventoryMovementAccess({
      entitlement: free,
      promotionalGrant: promotion,
      movementType: "sell",
      now,
    }),
    true
  );
});
