// functions/src/finishedInventoryService.js
// finished-inventory-service-v1-trusted-fefo-authority

import { FieldValue } from "firebase-admin/firestore";
import {
  ADMIN_GRANT_DOCUMENT_ID,
  BILLING_COLLECTION_ID,
  ENTITLEMENT_DOCUMENT_ID,
  SUBSCRIPTION_ACCESS_RANKS,
  SUBSCRIPTION_PLAN_IDS,
} from "./subscriptionConfig.js";
import { asValidDate } from "./entitlementModel.js";
import { resolveEffectiveGrowAccessPlan } from "./growService.js";

const FINISHED_GOODS_LOT_TYPES = new Set([
  "capsules",
  "gummies",
  "chocolates",
  "tinctures",
]);

const OUTBOUND_MOVEMENT_TYPES = new Set([
  "sell",
  "donate",
  "sample",
  "waste",
  "destroy",
  "adjustment",
]);

const SAFETY_MOVEMENT_TYPES = new Set(["waste", "destroy"]);

const FEATURE_KEYS = Object.freeze({
  SALES_TRACKING: "salesTracking",
  FEFO_CONTROLS: "fefoControls",
  INVENTORY_AUDIT_HISTORY: "inventoryAuditHistory",
});

export class FinishedInventoryServiceError extends Error {
  constructor(message, code = "failed-precondition", details = null) {
    super(message);
    this.name = "FinishedInventoryServiceError";
    this.code = code;
    this.details = details;
  }
}

function safeString(value) {
  return String(value || "").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function valueOrFallback(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function roundNumber(value, digits = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function roundCurrency(value) {
  return roundNumber(value, 4);
}

function sanitizePositiveNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return roundNumber(Math.max(0, numeric), 3);
}

function sanitizeCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return roundCurrency(Math.max(0, numeric));
}

function normalizeMovementType(value = "") {
  const normalized = safeString(value).toLowerCase();
  return OUTBOUND_MOVEMENT_TYPES.has(normalized)
    ? normalized
    : "adjustment";
}

function normalizeSkuType(value = "") {
  const normalized = safeString(value).toLowerCase();

  if (["sample", "samples"].includes(normalized)) return "sample";
  if (["promo", "promotion", "event"].includes(normalized)) return "promo";

  if (
    ["internal", "internal_use", "testing", "retention"].includes(normalized)
  ) {
    return "internal";
  }

  return "retail";
}

function normalizePackageUnit(value = "") {
  const raw = safeString(value).toLowerCase();

  if (["g", "gram", "grams"].includes(raw)) return "g";
  if (["oz", "ounce", "ounces"].includes(raw)) return "oz";
  if (["ml", "milliliter", "milliliters"].includes(raw)) return "mL";
  if (["capsule", "capsules", "cap", "caps"].includes(raw)) return "capsules";

  if (
    ["piece", "pieces", "count", "unit", "units"].includes(raw)
  ) {
    return "unit";
  }

  return raw || "unit";
}

function isFinishedGoodsLot(lot = {}) {
  return FINISHED_GOODS_LOT_TYPES.has(
    safeString(lot?.lotType).toLowerCase()
  );
}

function isPackagedFinishedInventoryLot(lot = {}) {
  if (lot?.package?.isPackaged === true) return true;

  if (safeString(lot?.sourceType).toLowerCase() === "finished_package") {
    return true;
  }

  return Boolean(
    lot?.packageRunId &&
      (lot?.parentLotId || lot?.sourceLotId)
  );
}

function isArchivedFinishedInventoryLot(lot = {}) {
  const status = safeString(lot?.status).toLowerCase();

  return Boolean(
    status === "archived" ||
      status === "void" ||
      lot?.archived === true ||
      lot?.isArchived === true ||
      lot?.inArchive === true ||
      lot?.archivedAt ||
      lot?.archivedOn
  );
}

function normalizeFinishedQcStatus(lot = {}) {
  const raw = safeString(
    lot?.qc?.status || lot?.qcStatus
  ).toLowerCase();

  if (["fail", "failed", "rejected"].includes(raw)) return "fail";
  if (["hold", "held", "qc_hold"].includes(raw)) return "hold";

  if (
    ["pass", "passed", "approved", "release", "released"].includes(raw)
  ) {
    return "pass";
  }

  return "pending";
}

function getFinishedReleaseState(
  lot = {},
  { defaultRequired = false } = {}
) {
  const workflow =
    lot?.workflow && typeof lot.workflow === "object"
      ? lot.workflow
      : {};

  const releaseRequired = Boolean(
    workflow?.releaseRequired ??
      lot?.releaseRequired ??
      defaultRequired
  );

  const releaseStatus =
    safeString(
      workflow?.releaseStatus ||
        lot?.releaseStatus ||
        (releaseRequired ? "pending" : "released")
    ).toLowerCase() ||
    (releaseRequired ? "pending" : "released");

  return {
    releaseRequired,
    releaseStatus,
    blocked:
      releaseRequired &&
      releaseStatus !== "released",
  };
}

function getFinishedWorkflowBlockReason(lot = {}) {
  const workflow =
    lot?.workflow && typeof lot.workflow === "object"
      ? lot.workflow
      : {};

  if (Boolean(workflow?.recalled ?? lot?.recalled)) {
    return "This package run is recalled and cannot be sold.";
  }

  if (Boolean(workflow?.quarantined ?? lot?.quarantined)) {
    return "This package run is quarantined and cannot be sold.";
  }

  if (Boolean(workflow?.qcHold ?? lot?.qcHold)) {
    return "This package run is on QC hold and cannot be sold.";
  }

  return "";
}

function getLotBestByValue(lot = {}) {
  return safeString(
    lot?.shelfLife?.bestBy ||
      lot?.shelfLife?.bestByDate ||
      lot?.shelfLife?.expirationDate ||
      lot?.bestBy ||
      lot?.expirationDate ||
      lot?.labelMetadata?.bestBy ||
      lot?.labelMetadata?.bestByDate
  );
}

function getFinishedBestByBlockReason(lot = {}, asOfDate = "") {
  const bestBy = getLotBestByValue(lot);
  const bestByDate = asValidDate(bestBy);
  const currentDate = asValidDate(asOfDate);

  if (!bestByDate || !currentDate) return "";

  const target = new Date(bestByDate);
  const current = new Date(currentDate);

  target.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);

  return target < current
    ? "This package run is past best-by date and cannot be sold."
    : "";
}

export function getTrustedFinishedSaleBlockReason(
  lot = {},
  asOfDate = ""
) {
  if (
    !isFinishedGoodsLot(lot) ||
    !isPackagedFinishedInventoryLot(lot)
  ) {
    return "Only packaged finished inventory can be sold.";
  }

  if (
    normalizeSkuType(
      valueOrFallback(
        lot?.skuType,
        lot?.packageSkuType,
        lot?.package?.skuType,
        lot?.labelMetadata?.skuType
      )
    ) !== "retail"
  ) {
    return "Only retail package SKUs can be sold.";
  }

  if (isArchivedFinishedInventoryLot(lot)) {
    return "This package run is archived and cannot be sold.";
  }

  const workflowBlockReason =
    getFinishedWorkflowBlockReason(lot);

  if (workflowBlockReason) return workflowBlockReason;

  const qcStatus = normalizeFinishedQcStatus(lot);

  if (qcStatus === "fail") {
    return "This package run failed QC and cannot be sold.";
  }

  if (qcStatus === "hold") {
    return "This package run is on QC hold and cannot be sold.";
  }

  if (qcStatus !== "pass") {
    return "This package run must pass QC before it can be sold.";
  }

  const bestByBlockReason =
    getFinishedBestByBlockReason(lot, asOfDate);

  if (bestByBlockReason) return bestByBlockReason;

  const releaseState = getFinishedReleaseState(
    lot,
    { defaultRequired: true }
  );

  if (releaseState.blocked) {
    return "This package run has not been released for sale.";
  }

  return "";
}

function getPackageReleaseEligibilityBlockReason(
  lot = {},
  asOfDate = ""
) {
  if (
    !isFinishedGoodsLot(lot) ||
    !isPackagedFinishedInventoryLot(lot)
  ) {
    return "Only packaged finished inventory can be released.";
  }

  if (isArchivedFinishedInventoryLot(lot)) {
    return "This package run is archived and cannot be distributed.";
  }

  const workflow =
    lot?.workflow && typeof lot.workflow === "object"
      ? lot.workflow
      : {};

  if (Boolean(workflow?.recalled ?? lot?.recalled)) {
    return "This package run is recalled and cannot be released.";
  }

  if (Boolean(workflow?.quarantined ?? lot?.quarantined)) {
    return "This package run is quarantined and cannot be released.";
  }

  if (Boolean(workflow?.qcHold ?? lot?.qcHold)) {
    return "This package run is on QC hold and cannot be released.";
  }

  const qcStatus = normalizeFinishedQcStatus(lot);

  if (qcStatus === "fail") {
    return "This package run failed QC and cannot be released.";
  }

  if (qcStatus === "hold") {
    return "This package run is on QC hold and cannot be released.";
  }

  if (qcStatus !== "pass") {
    return "This package run must pass QC before it can be released.";
  }

  if (getFinishedBestByBlockReason(lot, asOfDate)) {
    return "This package run is past best-by date and cannot be released.";
  }

  return "";
}

function getExternalDistributionBlockReason(
  lot = {},
  {
    movementType = "",
    destinationType = "",
    asOfDate = "",
  } = {}
) {
  const type = normalizeMovementType(movementType);

  if (type !== "donate" && type !== "sample") {
    return "";
  }

  const skuType = normalizeSkuType(
    valueOrFallback(
      lot?.skuType,
      lot?.packageSkuType,
      lot?.package?.skuType,
      lot?.labelMetadata?.skuType
    )
  );

  const destination =
    safeString(destinationType).toLowerCase();

  if (
    type === "sample" &&
    skuType === "internal" &&
    destination === "internal"
  ) {
    return "";
  }

  const eligibility =
    getPackageReleaseEligibilityBlockReason(
      lot,
      asOfDate
    );

  if (eligibility) return eligibility;

  const releaseState = getFinishedReleaseState(
    lot,
    { defaultRequired: true }
  );

  if (releaseState.blocked) {
    return "This package run has not been released for distribution.";
  }

  return "";
}

function getLotReservations(lot = {}) {
  return safeArray(lot?.reservations)
    .map((entry) => ({
      quantity: sanitizePositiveNumber(
        entry?.quantity
      ),
    }))
    .filter((entry) => entry.quantity > 0);
}

function getLotReservedQuantity(lot = {}) {
  const explicit = sanitizePositiveNumber(
    valueOrFallback(
      lot?.reservationQuantity,
      lot?.reservedQuantity,
      lot?.reservedQty
    )
  );

  if (explicit > 0) return explicit;

  return sanitizePositiveNumber(
    getLotReservations(lot).reduce(
      (sum, entry) => sum + entry.quantity,
      0
    )
  );
}

function getLotRemainingQuantity(lot = {}) {
  return sanitizePositiveNumber(
    lot?.remainingQuantity
  );
}

function getLotInitialQuantity(lot = {}) {
  return sanitizePositiveNumber(
    lot?.initialQuantity
  );
}

function getLotAvailableQuantity(lot = {}) {
  return sanitizePositiveNumber(
    getLotRemainingQuantity(lot) -
      getLotReservedQuantity(lot)
  );
}

function getNextLotStatus(nextRemaining, initial) {
  if (nextRemaining <= 0) return "depleted";
  if (nextRemaining < initial) return "partial";
  return "available";
}

function getLotUnitCost(lot = {}) {
  const explicit = sanitizeCurrency(
    valueOrFallback(
      lot?.costs?.unitCost,
      lot?.unitCost,
      lot?.costPerUnit,
      lot?.priceLockedPerUnit,
      lot?.pricing?.unitCost
    )
  );

  if (explicit > 0) return explicit;

  const total = sanitizeCurrency(
    valueOrFallback(
      lot?.costs?.batchTotalCost,
      lot?.batchTotalCost,
      lot?.costs?.totalCost,
      lot?.totalCost,
      lot?.pricing?.batchTotalCost
    )
  );

  const quantity = sanitizePositiveNumber(
    valueOrFallback(
      lot?.initialQuantity,
      lot?.quantity,
      lot?.count
    )
  );

  return total > 0 && quantity > 0
    ? roundCurrency(total / quantity)
    : 0;
}

function getLockedPackagePrice(lot = {}) {
  return sanitizeCurrency(
    valueOrFallback(
      lot?.pricePerUnit,
      lot?.package?.defaultSalePricePerPackage,
      lot?.labelMetadata?.defaultSalePricePerPackage,
      lot?.pricing?.pricePerUnit
    )
  );
}

function resolveSaleAccounting(
  lot = {},
  {
    quantity = 0,
    pricePerUnit = null,
  } = {}
) {
  const defaultPricePerUnit =
    getLockedPackagePrice(lot);

  const requestedPricePerUnit =
    sanitizeCurrency(pricePerUnit);

  const actualPricePerUnit =
    requestedPricePerUnit > 0
      ? requestedPricePerUnit
      : defaultPricePerUnit;

  const normalizedQuantity =
    sanitizePositiveNumber(quantity);

  const packageUnitCost = getLotUnitCost(lot);

  return {
    defaultPricePerUnit,
    actualPricePerUnit,
    packageUnitCost,
    revenue: roundCurrency(
      actualPricePerUnit * normalizedQuantity
    ),
    hasPriceOverride:
      Math.abs(
        actualPricePerUnit -
          defaultPricePerUnit
      ) >= 0.01,
    belowCost:
      packageUnitCost > 0 &&
      actualPricePerUnit > 0 &&
      actualPricePerUnit < packageUnitCost,
  };
}

function buildOutboundSummary(
  previous = {},
  movementType = "",
  quantity = 0,
  revenue = 0
) {
  const next = {
    sold: sanitizePositiveNumber(previous?.sold),
    donated: sanitizePositiveNumber(previous?.donated),
    sampled: sanitizePositiveNumber(previous?.sampled),
    wasted: sanitizePositiveNumber(previous?.wasted),
    destroyed: sanitizePositiveNumber(previous?.destroyed),
    adjustedOut: sanitizePositiveNumber(previous?.adjustedOut),
    adjustedIn: sanitizePositiveNumber(previous?.adjustedIn),
    revenue: sanitizeCurrency(previous?.revenue),
  };

  const type = normalizeMovementType(movementType);
  const qty = sanitizePositiveNumber(quantity);
  const safeRevenue = sanitizeCurrency(revenue);

  if (type === "sell") {
    next.sold =
      sanitizePositiveNumber(next.sold + qty);

    next.revenue =
      roundCurrency(next.revenue + safeRevenue);
  } else if (type === "donate") {
    next.donated =
      sanitizePositiveNumber(next.donated + qty);
  } else if (type === "sample") {
    next.sampled =
      sanitizePositiveNumber(next.sampled + qty);
  } else if (type === "waste") {
    next.wasted =
      sanitizePositiveNumber(next.wasted + qty);
  } else if (type === "destroy") {
    next.destroyed =
      sanitizePositiveNumber(next.destroyed + qty);
  } else {
    next.adjustedOut =
      sanitizePositiveNumber(next.adjustedOut + qty);
  }

  return next;
}

function normalizeSalesKeyPart(value = "") {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPackageSizeLabel(lot = {}) {
  const explicit = safeString(
    lot?.packageSizeLabel ||
      lot?.package?.label ||
      lot?.labelMetadata?.packageSizeLabel
  );

  if (explicit) return explicit;

  const size = Number(
    lot?.packageSize ??
      lot?.package?.size ??
      lot?.labelMetadata?.packageSize ??
      0
  );

  const unit = normalizePackageUnit(
    lot?.packageSizeUnit ??
      lot?.package?.unit ??
      lot?.labelMetadata?.packageSizeUnit
  );

  if (Number.isFinite(size) && size > 0) {
    return `${size} ${unit}`.trim();
  }

  const count = Number(
    lot?.packageCount ??
      lot?.package?.count ??
      lot?.initialQuantity ??
      0
  );

  return count > 0
    ? `${count} sellable units`
    : "Sellable unit";
}

export function getTrustedFinishedSalesSkuKey(
  lot = {}
) {
  const productIdentity =
    lot?.labelMetadata?.productName ||
    lot?.productName ||
    lot?.strainName ||
    lot?.strain ||
    lot?.sourceStrain ||
    lot?.batchName ||
    lot?.name ||
    "finished-product";

  return [
    lot?.productType ||
      lot?.finishedGoodType ||
      lot?.lotType,
    productIdentity,
    lot?.variantTag || lot?.variant,
    normalizeSkuType(
      valueOrFallback(
        lot?.skuType,
        lot?.packageSkuType,
        lot?.package?.skuType,
        lot?.labelMetadata?.skuType
      )
    ),
    getPackageSizeLabel(lot) || "default",
  ]
    .map(normalizeSalesKeyPart)
    .filter(Boolean)
    .join("|");
}

function getInventoryAgeMs(lot = {}) {
  const value =
    lot?.packDate ||
    lot?.labelMetadata?.packDate ||
    lot?.package?.packagedDate ||
    lot?.createdDate ||
    lot?.date ||
    lot?.updatedDate ||
    "";

  const parsed = asValidDate(value);

  return parsed ? parsed.getTime() : 0;
}

function getLotBestByMs(lot = {}) {
  const parsed = asValidDate(
    getLotBestByValue(lot)
  );

  if (!parsed) return Number.POSITIVE_INFINITY;

  const normalized = new Date(parsed);
  normalized.setHours(0, 0, 0, 0);

  return normalized.getTime();
}

export function compareTrustedFinishedFefoPriority(
  a = {},
  b = {}
) {
  const aBestBy = getLotBestByMs(a);
  const bBestBy = getLotBestByMs(b);

  const difference = aBestBy - bBestBy;

  if (
    Number.isFinite(difference) &&
    difference !== 0
  ) {
    return difference;
  }

  if (
    Number.isFinite(aBestBy) &&
    !Number.isFinite(bBestBy)
  ) {
    return -1;
  }

  if (
    !Number.isFinite(aBestBy) &&
    Number.isFinite(bBestBy)
  ) {
    return 1;
  }

  const ageDifference =
    getInventoryAgeMs(a) -
    getInventoryAgeMs(b);

  if (ageDifference !== 0) {
    return ageDifference;
  }

  return safeString(a?.id).localeCompare(
    safeString(b?.id)
  );
}

export function getTrustedFinishedFefoBlocker(
  selectedLot = {},
  candidateLots = [],
  asOfDate = ""
) {
  const selectedKey =
    getTrustedFinishedSalesSkuKey(selectedLot);

  if (!selectedKey || !selectedLot?.id) {
    return null;
  }

  return (
    safeArray(candidateLots)
      .filter(
        (candidate) =>
          candidate?.id &&
          candidate.id !== selectedLot.id
      )
      .filter(
        (candidate) =>
          !isArchivedFinishedInventoryLot(candidate)
      )
      .filter(
        (candidate) =>
          isPackagedFinishedInventoryLot(candidate)
      )
      .filter(
        (candidate) =>
          getLotAvailableQuantity(candidate) > 0
      )
      .filter(
        (candidate) =>
          getTrustedFinishedSalesSkuKey(candidate) ===
          selectedKey
      )
      .filter(
        (candidate) =>
          !getTrustedFinishedSaleBlockReason(
            candidate,
            asOfDate
          )
      )
      .filter(
        (candidate) =>
          compareTrustedFinishedFefoPriority(
            candidate,
            selectedLot
          ) < 0
      )
      .sort(
        compareTrustedFinishedFefoPriority
      )[0] || null
  );
}

export function resolveTrustedFinishedFefoDecision({
  selectedLot = {},
  candidateLots = [],
  asOfDate = "",
  fefoOverride = false,
  fefoOverrideReason = "",
} = {}) {
  const blocker = getTrustedFinishedFefoBlocker(
    selectedLot,
    candidateLots,
    asOfDate
  );

  if (!blocker) {
    return {
      blocker: null,
      overrideApplied: false,
    };
  }

  if (!fefoOverride) {
    throw new FinishedInventoryServiceError(
      `FEFO requires selling the earlier-expiring package lot first: ${
        blocker?.lotCode ||
        blocker?.batchLot ||
        blocker?.name ||
        blocker.id
      } (best by ${
        getLotBestByValue(blocker) || "not set"
      }).`,
      "failed-precondition",
      {
        code: "fefo-blocked",
        blockerLotId: blocker.id,
        blockerLotCode:
          blocker?.lotCode ||
          blocker?.batchLot ||
          blocker?.name ||
          blocker.id,
        blockerBestBy:
          getLotBestByValue(blocker) || null,
      }
    );
  }

  const reason = safeString(
    fefoOverrideReason
  );

  if (!reason) {
    throw new FinishedInventoryServiceError(
      "Enter a FEFO override reason before selling a later-expiring package lot.",
      "failed-precondition",
      {
        code: "fefo-override-reason-required",
        blockerLotId: blocker.id,
      }
    );
  }

  return {
    blocker,
    overrideApplied: true,
  };
}

function getRequiredMovementFeature({
  movementType = "",
  fefoOverride = false,
} = {}) {
  const type = normalizeMovementType(movementType);

  if (SAFETY_MOVEMENT_TYPES.has(type)) {
    return null;
  }

  if (type === "adjustment") {
    return FEATURE_KEYS.INVENTORY_AUDIT_HISTORY;
  }

  if (type === "sell" && fefoOverride) {
    return FEATURE_KEYS.FEFO_CONTROLS;
  }

  return FEATURE_KEYS.SALES_TRACKING;
}

function getActivePromotionPlan(
  grant = null,
  now = new Date()
) {
  if (!grant || typeof grant !== "object") {
    return null;
  }

  if (
    safeString(grant.status).toLowerCase() !==
    "active"
  ) {
    return null;
  }

  const startsAt = asValidDate(grant.startsAt);
  const endsAt = asValidDate(grant.endsAt);
  const current = asValidDate(now) || new Date();
  const planId =
    safeString(grant.planId).toLowerCase();

  if (
    !startsAt ||
    !endsAt ||
    startsAt.getTime() > current.getTime() ||
    endsAt.getTime() <= current.getTime()
  ) {
    return null;
  }

  if (
    ![
      SUBSCRIPTION_PLAN_IDS.HOBBY,
      SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
      SUBSCRIPTION_PLAN_IDS.LAB,
    ].includes(planId)
  ) {
    return null;
  }

  return planId;
}

function resolveMovementAccess({
  entitlement = null,
  promotionalGrant = null,
  now = new Date(),
} = {}) {
  const base =
    resolveEffectiveGrowAccessPlan(
      entitlement,
      now
    );

  let planId = base.planId;
  let useOverrides = base.useOverrides;

  const promotionPlanId =
    getActivePromotionPlan(
      promotionalGrant,
      now
    );

  if (
    promotionPlanId &&
    Number(
      SUBSCRIPTION_ACCESS_RANKS[
        promotionPlanId
      ] ?? -1
    ) >
      Number(
        SUBSCRIPTION_ACCESS_RANKS[
          planId
        ] ?? -1
      )
  ) {
    planId = promotionPlanId;
    useOverrides = false;
  }

  return {
    planId,
    useOverrides,
  };
}

export function hasTrustedFinishedInventoryMovementAccess({
  entitlement = null,
  promotionalGrant = null,
  movementType = "",
  fefoOverride = false,
  now = new Date(),
  internalFullAccess = false,
} = {}) {
  if (internalFullAccess === true) {
    return true;
  }

  const featureKey =
    getRequiredMovementFeature({
      movementType,
      fefoOverride,
    });

  if (!featureKey) {
    return true;
  }

  const access = resolveMovementAccess({
    entitlement,
    promotionalGrant,
    now,
  });

  const overrides =
    entitlement?.featureOverrides &&
    typeof entitlement.featureOverrides === "object"
      ? entitlement.featureOverrides
      : {};

  if (
    access.useOverrides &&
    typeof overrides[featureKey] === "boolean"
  ) {
    return overrides[featureKey];
  }

  return [
    SUBSCRIPTION_PLAN_IDS.TRIAL,
    SUBSCRIPTION_PLAN_IDS.LAB,
    SUBSCRIPTION_PLAN_IDS.ADMIN,
  ].includes(access.planId);
}

function movementLabel(type = "") {
  return {
    sell: "Sold",
    donate: "Donated",
    sample: "Sampled",
    waste: "Wasted",
    destroy: "Destroyed",
    adjustment: "Adjusted",
  }[normalizeMovementType(type)] || "Adjusted";
}

function formatQuantity(value, unit = "count") {
  const numeric = Number(value) || 0;
  return `${roundNumber(numeric, 3)} ${unit}`;
}

export async function recordFinishedInventoryMovementTrusted({
  db,
  uid,
  payload = {},
  now = new Date(),
  internalFullAccess = false,
} = {}) {
  if (!db || typeof db.runTransaction !== "function") {
    throw new FinishedInventoryServiceError(
      "Finished inventory backend is unavailable.",
      "internal"
    );
  }

  const userId = safeString(uid);
  if (!userId) {
    throw new FinishedInventoryServiceError(
      "Missing authenticated user.",
      "unauthenticated"
    );
  }

  const lotId = safeString(payload?.lotId);
  if (!lotId) {
    throw new FinishedInventoryServiceError(
      "Missing lot.",
      "invalid-argument"
    );
  }

  const movementType =
    normalizeMovementType(
      payload?.movementType
    );

  const quantity =
    sanitizePositiveNumber(payload?.quantity);

  if (quantity <= 0) {
    throw new FinishedInventoryServiceError(
      "Enter a quantity greater than zero.",
      "invalid-argument"
    );
  }

  const date =
    safeString(payload?.date) ||
    new Date(now).toISOString().slice(0, 10);

  const note = safeString(payload?.note);
  const counterparty =
    safeString(payload?.counterparty);

  const destinationType =
    safeString(payload?.destinationType);

  const destinationName =
    safeString(payload?.destinationName) ||
    counterparty;

  const destinationLocation =
    safeString(payload?.destinationLocation);

  const referenceType =
    safeString(payload?.referenceType);

  const referenceId =
    safeString(payload?.referenceId);

  const reason = safeString(payload?.reason);
  const destroyMethod =
    safeString(payload?.destroyMethod);

  const priceOverrideType =
    safeString(payload?.priceOverrideType);

  const priceOverrideReason =
    safeString(payload?.priceOverrideReason);

  const requestedFefoOverride =
    movementType === "sell" &&
    payload?.fefoOverride === true;

  const fefoOverrideReason =
    safeString(payload?.fefoOverrideReason);

  if (
    movementType === "destroy" &&
    !reason
  ) {
    throw new FinishedInventoryServiceError(
      "Enter a reason before destroying finished inventory.",
      "invalid-argument"
    );
  }

  const userRef =
    db.collection("users").doc(userId);

  return db.runTransaction(async (tx) => {
    const lotRef =
      userRef
        .collection("materialLots")
        .doc(lotId);

    const lotSnap = await tx.get(lotRef);

    if (!lotSnap.exists) {
      throw new FinishedInventoryServiceError(
        "Finished inventory lot could not be found.",
        "not-found"
      );
    }

    const lot = {
      id: lotSnap.id,
      ...(lotSnap.data() || {}),
    };

    if (!isFinishedGoodsLot(lot)) {
      throw new FinishedInventoryServiceError(
        "Only finished inventory lots can be sold, donated, sampled, wasted, destroyed, or adjusted.",
        "failed-precondition"
      );
    }

    const entitlementRef =
      userRef
        .collection(BILLING_COLLECTION_ID)
        .doc(ENTITLEMENT_DOCUMENT_ID);

    const promotionRef =
      userRef
        .collection(BILLING_COLLECTION_ID)
        .doc(ADMIN_GRANT_DOCUMENT_ID);

    const entitlementSnap =
      await tx.get(entitlementRef);

    const promotionSnap =
      await tx.get(promotionRef);

    const entitlement =
      entitlementSnap.exists
        ? entitlementSnap.data() || {}
        : null;

    const promotionalGrant =
      promotionSnap.exists
        ? promotionSnap.data() || {}
        : null;

    if (
      !hasTrustedFinishedInventoryMovementAccess({
        entitlement,
        promotionalGrant,
        movementType,
        fefoOverride:
          requestedFefoOverride,
        now,
        internalFullAccess,
      })
    ) {
      throw new FinishedInventoryServiceError(
        "Your current plan does not include this finished-inventory action.",
        "permission-denied",
        {
          code: "finished-inventory-feature-required",
          movementType,
          featureKey:
            getRequiredMovementFeature({
              movementType,
              fefoOverride:
                requestedFefoOverride,
            }),
        }
      );
    }

    if (movementType === "sell") {
      const saleBlockReason =
        getTrustedFinishedSaleBlockReason(
          lot,
          date
        );

      if (saleBlockReason) {
        throw new FinishedInventoryServiceError(
          saleBlockReason,
          "failed-precondition"
        );
      }
    }

    const distributionBlockReason =
      getExternalDistributionBlockReason(
        lot,
        {
          movementType,
          destinationType,
          asOfDate: date,
        }
      );

    if (distributionBlockReason) {
      throw new FinishedInventoryServiceError(
        distributionBlockReason,
        "failed-precondition"
      );
    }

    let fefoDecision = {
      blocker: null,
      overrideApplied: false,
    };

    if (movementType === "sell") {
      const finishedGoodsQuery =
        userRef
          .collection("materialLots")
          .where(
            "inventoryCategory",
            "==",
            "finished_goods"
          );

      const finishedGoodsSnap =
        await tx.get(finishedGoodsQuery);

      const candidateLots =
        finishedGoodsSnap.docs.map(
          (snapshot) => ({
            id: snapshot.id,
            ...(snapshot.data() || {}),
          })
        );

      fefoDecision =
        resolveTrustedFinishedFefoDecision({
          selectedLot: lot,
          candidateLots,
          asOfDate: date,
          fefoOverride:
            requestedFefoOverride,
          fefoOverrideReason,
        });
    }

    const remaining =
      getLotRemainingQuantity(lot);

    const available =
      getLotAvailableQuantity(lot);

    if (quantity > available) {
      throw new FinishedInventoryServiceError(
        `${lot?.name || lotId} only has ${formatQuantity(
          available,
          lot?.unit || "count"
        )} available after reservations.`,
        "failed-precondition"
      );
    }

    const nextRemaining =
      sanitizePositiveNumber(
        remaining - quantity
      );

    const nextStatus =
      movementType === "destroy" &&
      nextRemaining <= 0
        ? "destroyed"
        : getNextLotStatus(
            nextRemaining,
            getLotInitialQuantity(lot)
          );

    const saleAccounting =
      resolveSaleAccounting(lot, {
        quantity,
        pricePerUnit:
          payload?.pricePerUnit,
      });

    const packageDefaultPrice =
      saleAccounting.defaultPricePerUnit;

    const packageMsrp =
      sanitizeCurrency(
        valueOrFallback(
          lot?.msrpPerUnit,
          lot?.pricing?.suggestedMsrpPerUnit,
          lot?.package?.suggestedMsrpPerPackage
        )
      );

    const packageUnitCost =
      saleAccounting.packageUnitCost;

    const resolvedPricePerUnit =
      saleAccounting.actualPricePerUnit;

    const hasPriceOverride =
      movementType === "sell" &&
      saleAccounting.hasPriceOverride;

    const belowCost =
      movementType === "sell" &&
      saleAccounting.belowCost;

    const nonRetailSale =
      movementType === "sell" &&
      normalizeSkuType(
        valueOrFallback(
          lot?.skuType,
          lot?.packageSkuType,
          lot?.package?.skuType
        )
      ) !== "retail";

    if (
      (
        hasPriceOverride ||
        belowCost ||
        nonRetailSale
      ) &&
      !priceOverrideReason
    ) {
      throw new FinishedInventoryServiceError(
        "Enter a price override memo before recording this sale.",
        "failed-precondition"
      );
    }

    const resolvedRevenue =
      movementType === "sell"
        ? saleAccounting.revenue
        : 0;

    const outboundSummary =
      buildOutboundSummary(
        lot?.outboundSummary || {},
        movementType,
        quantity,
        resolvedRevenue
      );

    const lotUpdate = {
      remainingQuantity: nextRemaining,
      status: nextStatus,
      outboundSummary,
      lastOutboundMovementType:
        movementType,
      lastOutboundMovementDate: date,
      updatedDate: date,
      updatedAt:
        FieldValue.serverTimestamp(),
    };

    if (movementType === "destroy") {
      lotUpdate.destructionSummary = {
        destroyedQuantity:
          sanitizePositiveNumber(
            (
              lot?.destructionSummary
                ?.destroyedQuantity || 0
            ) + quantity
          ),
        lastDestroyedQuantity: quantity,
        lastDestroyedAt: date,
        lastDestroyReason: reason,
        lastDestroyMethod:
          destroyMethod || null,
      };

      if (nextRemaining <= 0) {
        lotUpdate.destroyedAt = date;
      }
    }

    tx.update(lotRef, lotUpdate);

    const movementRef =
      userRef
        .collection("inventoryMovements")
        .doc();

    const blocker =
      fefoDecision.blocker;

    const blockerCode =
      blocker
        ? safeString(
            blocker?.lotCode ||
              blocker?.batchLot ||
              blocker?.name
          ) || blocker.id
        : null;

    const blockerBestBy =
      blocker
        ? getLotBestByValue(blocker) || null
        : null;

    const selectedBestBy =
      getLotBestByValue(lot) || null;

    tx.set(movementRef, {
      movementType,
      lotId,
      processType: "finished_inventory",
      direction: "out",
      sourceGrowId:
        safeArray(
          lot?.sourceGrowIds
        )[0] || null,
      sourceType: "lot",
      quantity,
      unit: lot?.unit || "count",
      date,
      revenue: resolvedRevenue,
      pricePerUnit:
        resolvedPricePerUnit,
      defaultPricePerUnit:
        packageDefaultPrice,
      msrpPerUnit: packageMsrp,
      priceDifferencePerUnit:
        movementType === "sell"
          ? roundCurrency(
              resolvedPricePerUnit -
                packageDefaultPrice
            )
          : 0,
      priceOverride:
        movementType === "sell"
          ? {
              hasOverride:
                hasPriceOverride,
              belowCost,
              nonRetailSale,
              type:
                priceOverrideType || null,
              reason:
                priceOverrideReason || null,
              defaultPricePerUnit:
                packageDefaultPrice,
              actualPricePerUnit:
                resolvedPricePerUnit,
              msrpPerUnit: packageMsrp,
              packageUnitCost,
              differencePerUnit:
                roundCurrency(
                  resolvedPricePerUnit -
                    packageDefaultPrice
                ),
            }
          : null,
      fefoOverride:
        movementType === "sell"
          ? {
              applied:
                fefoDecision.overrideApplied,
              policy: "FEFO",
              reason:
                fefoDecision.overrideApplied
                  ? fefoOverrideReason
                  : null,
              skippedLotId:
                blocker?.id || null,
              skippedLotCode:
                blockerCode,
              skippedBestBy:
                blockerBestBy,
              selectedLotId: lotId,
              selectedLotCode:
                safeString(
                  lot?.lotCode ||
                    lot?.batchLot ||
                    lot?.name
                ) || lotId,
              selectedBestBy,
            }
          : null,
      inventoryRotation:
        movementType === "sell"
          ? {
              policy: "FEFO",
              overrideApplied:
                fefoDecision.overrideApplied,
              overrideReason:
                fefoDecision.overrideApplied
                  ? fefoOverrideReason
                  : null,
              skippedLotId:
                blocker?.id || null,
              skippedLotCode:
                blockerCode,
              skippedBestBy:
                blockerBestBy,
              selectedLotId: lotId,
              selectedLotCode:
                safeString(
                  lot?.lotCode ||
                    lot?.batchLot ||
                    lot?.name
                ) || lotId,
              selectedBestBy,
            }
          : null,
      destinationType:
        destinationType || null,
      destinationName:
        destinationName || null,
      destinationLocation:
        destinationLocation || null,
      referenceType:
        referenceType || null,
      referenceId:
        referenceId || null,
      reason: reason || null,
      destroyMethod:
        destroyMethod || null,
      counterparty:
        counterparty ||
        destinationName ||
        null,
      note:
        note ||
        `${movementLabel(
          movementType
        )} ${formatQuantity(
          quantity,
          lot?.unit || "count"
        )} from ${
          lot?.name || lotId
        }.`,
      createdAt:
        FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      lotId,
      movementId: movementRef.id,
      remainingQuantity: nextRemaining,
      status: nextStatus,
      fefoOverrideApplied:
        fefoDecision.overrideApplied,
      fefoSkippedLotId:
        blocker?.id || null,
      revenue: resolvedRevenue,
      pricePerUnit:
        resolvedPricePerUnit,
    };
  });
}
