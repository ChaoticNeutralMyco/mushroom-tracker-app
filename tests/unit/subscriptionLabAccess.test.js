// tests/unit/subscriptionLabAccess.test.js

import { describe, expect, it } from "vitest";
import {
  LAB_OPERATION_ACTIONS,
  canPerformLabOperation,
  getInventoryMovementRequirement,
  getLabOperationRequirement,
  isSafetyInventoryMovementType,
} from "../../src/lib/subscriptionLabAccess.js";
import { SUBSCRIPTION_FEATURE_KEYS } from "../../src/lib/subscriptionPlans.js";

describe("Lab operational access helpers", () => {
  it("maps new intake and manufacturing actions to Post Processing", () => {
    for (const action of [
      LAB_OPERATION_ACTIONS.CREATE_DRY_LOT,
      LAB_OPERATION_ACTIONS.CREATE_EXTRACTION,
      LAB_OPERATION_ACTIONS.CREATE_PRODUCTION,
      LAB_OPERATION_ACTIONS.CREATE_REWORK,
    ]) {
      expect(getLabOperationRequirement(action)?.featureKey).toBe(
        SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING
      );
    }
  });

  it("maps package-run creation to the package-run feature", () => {
    expect(
      getLabOperationRequirement(LAB_OPERATION_ACTIONS.CREATE_PACKAGE_RUN)
        ?.featureKey
    ).toBe(SUBSCRIPTION_FEATURE_KEYS.PACKAGE_RUNS);
  });

  it("maps new reservations and thresholds to Finished Inventory", () => {
    expect(
      getLabOperationRequirement(LAB_OPERATION_ACTIONS.ADD_RESERVATION)
        ?.featureKey
    ).toBe(SUBSCRIPTION_FEATURE_KEYS.FINISHED_INVENTORY);
    expect(
      getLabOperationRequirement(
        LAB_OPERATION_ACTIONS.SAVE_LOW_STOCK_THRESHOLD
      )?.featureKey
    ).toBe(SUBSCRIPTION_FEATURE_KEYS.FINISHED_INVENTORY);
  });

  it("keeps Post Processing labels separate from grow labels", () => {
    expect(
      getLabOperationRequirement(
        LAB_OPERATION_ACTIONS.PRINT_POST_PROCESS_LABELS
      )?.featureKey
    ).toBe(SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS);
  });

  it("treats waste and destruction as always-available safety movements", () => {
    expect(isSafetyInventoryMovementType("waste")).toBe(true);
    expect(isSafetyInventoryMovementType("destroy")).toBe(true);
    expect(getInventoryMovementRequirement({ movementType: "waste" })).toBeNull();
    expect(
      getInventoryMovementRequirement({ movementType: "destroy" })
    ).toBeNull();
  });

  it("requires Sales Tracking for sales, samples, and donations", () => {
    for (const movementType of ["sell", "sample", "donate"]) {
      expect(
        getInventoryMovementRequirement({ movementType })?.featureKey
      ).toBe(SUBSCRIPTION_FEATURE_KEYS.SALES_TRACKING);
    }
  });

  it("requires audit access for manual adjustments", () => {
    expect(
      getInventoryMovementRequirement({ movementType: "adjustment" })
        ?.featureKey
    ).toBe(SUBSCRIPTION_FEATURE_KEYS.INVENTORY_AUDIT_HISTORY);
  });

  it("requires FEFO controls for a requested FEFO override", () => {
    expect(
      getInventoryMovementRequirement({
        movementType: "sell",
        fefoOverride: true,
      })?.featureKey
    ).toBe(SUBSCRIPTION_FEATURE_KEYS.FEFO_CONTROLS);
  });

  it("uses the entitlement feature resolver instead of plan names", () => {
    const requirement = getLabOperationRequirement(
      LAB_OPERATION_ACTIONS.CREATE_PRODUCTION
    );
    expect(
      canPerformLabOperation({
        action: LAB_OPERATION_ACTIONS.CREATE_PRODUCTION,
        hasFeature: (featureKey) => featureKey === requirement.featureKey,
      })
    ).toBe(true);
  });

  it("fails closed for unknown actions", () => {
    expect(getLabOperationRequirement("unknownAction")).toBeNull();
    expect(
      canPerformLabOperation({
        action: "unknownAction",
        hasFeature: () => true,
      })
    ).toBe(false);
  });
});
