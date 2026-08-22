// src/lib/subscriptionLabAccess.js

import { SUBSCRIPTION_FEATURE_KEYS } from "./subscriptionPlans.js";

export const LAB_OPERATION_ACTIONS = Object.freeze({
  CREATE_DRY_LOT: "createDryLot",
  CREATE_EXTRACTION: "createExtraction",
  CREATE_PRODUCTION: "createProduction",
  CREATE_REWORK: "createRework",
  CREATE_PACKAGE_RUN: "createPackageRun",
  ADD_RESERVATION: "addReservation",
  SAVE_LOW_STOCK_THRESHOLD: "saveLowStockThreshold",
  PRINT_POST_PROCESS_LABELS: "printPostProcessLabels",
});

const LAB_OPERATION_REQUIREMENTS = Object.freeze({
  [LAB_OPERATION_ACTIONS.CREATE_DRY_LOT]: Object.freeze({
    featureKey: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING,
    actionLabel: "Create a dry-material intake lot",
    supportingText:
      "Existing Post Processing records remain visible after a downgrade. New intake and manufacturing operations require Lab access.",
  }),
  [LAB_OPERATION_ACTIONS.CREATE_EXTRACTION]: Object.freeze({
    featureKey: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING,
    actionLabel: "Start a new extraction batch",
    supportingText:
      "Existing extraction batches can still be completed, reviewed, and disposed safely after a downgrade.",
  }),
  [LAB_OPERATION_ACTIONS.CREATE_PRODUCTION]: Object.freeze({
    featureKey: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING,
    actionLabel: "Start a new production batch",
    supportingText:
      "Existing production batches can still be completed and reviewed after a downgrade.",
  }),
  [LAB_OPERATION_ACTIONS.CREATE_REWORK]: Object.freeze({
    featureKey: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING,
    actionLabel: "Start a new rework batch",
    supportingText:
      "Existing records stay visible, while new manufacturing and rework operations require Lab access.",
  }),
  [LAB_OPERATION_ACTIONS.CREATE_PACKAGE_RUN]: Object.freeze({
    featureKey: SUBSCRIPTION_FEATURE_KEYS.PACKAGE_RUNS,
    actionLabel: "Create a package run or SKU",
    supportingText:
      "Existing finished inventory and package history remain visible. Creating new packaged inventory requires Lab access.",
  }),
  [LAB_OPERATION_ACTIONS.ADD_RESERVATION]: Object.freeze({
    featureKey: SUBSCRIPTION_FEATURE_KEYS.FINISHED_INVENTORY,
    actionLabel: "Add an inventory reservation",
    supportingText:
      "Existing reservations can still be released so inventory never becomes stuck. Adding new reservations requires Lab access.",
  }),
  [LAB_OPERATION_ACTIONS.SAVE_LOW_STOCK_THRESHOLD]: Object.freeze({
    featureKey: SUBSCRIPTION_FEATURE_KEYS.FINISHED_INVENTORY,
    actionLabel: "Change a finished-inventory threshold",
    supportingText:
      "Existing inventory stays visible after a downgrade. New operational inventory controls require Lab access.",
  }),
  [LAB_OPERATION_ACTIONS.PRINT_POST_PROCESS_LABELS]: Object.freeze({
    featureKey: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS,
    actionLabel: "Preview or print Post Processing labels",
    supportingText:
      "Grow and cultivation labels remain available on every plan. Finished-inventory and packaged-SKU labels require Lab access.",
  }),
});

export const SAFETY_INVENTORY_MOVEMENT_TYPES = Object.freeze([
  "waste",
  "destroy",
]);

export function getLabOperationRequirement(action) {
  return LAB_OPERATION_REQUIREMENTS[action] || null;
}

export function isSafetyInventoryMovementType(movementType = "") {
  return SAFETY_INVENTORY_MOVEMENT_TYPES.includes(
    String(movementType || "").trim().toLowerCase()
  );
}

export function getInventoryMovementRequirement({
  movementType = "",
  fefoOverride = false,
} = {}) {
  const normalizedType = String(movementType || "").trim().toLowerCase();

  if (isSafetyInventoryMovementType(normalizedType)) {
    return null;
  }

  if (normalizedType === "adjustment") {
    return {
      featureKey: SUBSCRIPTION_FEATURE_KEYS.INVENTORY_AUDIT_HISTORY,
      actionLabel: "Record a manual inventory adjustment",
      supportingText:
        "Destruction, waste, recall, and final-disposition actions remain available for safety. Manual inventory adjustments require Lab access.",
    };
  }

  if (normalizedType === "sell" && fefoOverride) {
    return {
      featureKey: SUBSCRIPTION_FEATURE_KEYS.FEFO_CONTROLS,
      actionLabel: "Override FEFO for this sale",
      supportingText:
        "Standard safety actions remain available after a downgrade. FEFO overrides require Lab access and an audit reason.",
    };
  }

  return {
    featureKey: SUBSCRIPTION_FEATURE_KEYS.SALES_TRACKING,
    actionLabel:
      normalizedType === "sample"
        ? "Record a sample movement"
        : normalizedType === "donate"
          ? "Record a donation movement"
          : "Record a sale or outbound business movement",
    supportingText:
      "Existing sales and movement history remain visible and exportable. New sales, samples, donations, promotions, and internal-use movements require Lab access.",
  };
}

export function canPerformLabOperation({
  action,
  hasFeature = () => false,
} = {}) {
  const requirement = getLabOperationRequirement(action);
  if (!requirement) return false;
  return Boolean(hasFeature(requirement.featureKey));
}
