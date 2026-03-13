// src/lib/postprocess.js
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase-config";


const FINISHED_GOODS_LOT_TYPES = ["capsules", "gummies", "chocolates", "tinctures"];
const OUTBOUND_FINISHED_MOVEMENT_TYPES = ["sell", "donate", "sample", "waste", "adjustment"];
const MSRP_DEFAULT_MARGIN_PERCENT = 60;

function roundNumber(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function roundCurrency(value) {
  return roundNumber(value, 4);
}

function sanitizeCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return roundCurrency(Math.max(0, n));
}

function sanitizeSignedNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return roundNumber(n, 3);
}

function safeString(value) {
  return String(value || "").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function valueOrFallback(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function deriveMsrpFromUnitCost(unitCost, desiredMarginPercent = MSRP_DEFAULT_MARGIN_PERCENT) {
  const normalizedUnitCost = sanitizeCurrency(unitCost);
  const marginPct = Math.min(95, Math.max(1, sanitizePositiveNumber(desiredMarginPercent)));
  if (normalizedUnitCost <= 0) return 0;
  return roundCurrency(normalizedUnitCost / (1 - marginPct / 100));
}

function getLotUnitCost(lot = {}) {
  const explicit = valueOrFallback(
    lot?.costs?.unitCost,
    lot?.unitCost,
    lot?.costPerUnit,
    lot?.priceLockedPerUnit,
    lot?.pricing?.unitCost
  );
  const numericExplicit = sanitizeCurrency(explicit);
  if (numericExplicit > 0) return numericExplicit;

  const total = sanitizeCurrency(
    valueOrFallback(
      lot?.costs?.batchTotalCost,
      lot?.batchTotalCost,
      lot?.costs?.totalCost,
      lot?.totalCost,
      lot?.pricing?.batchTotalCost
    )
  );
  const qty = sanitizePositiveNumber(valueOrFallback(lot?.initialQuantity, lot?.quantity, lot?.count));
  if (total > 0 && qty > 0) return roundCurrency(total / qty);

  return 0;
}

function getGrowBatchTotalCost(grow = {}) {
  return sanitizeCurrency(
    valueOrFallback(
      grow?.postProcessCost,
      grow?.totalCost,
      grow?.accumulatedCost,
      grow?.recipeCost,
      grow?.cost
    )
  );
}

function buildPricingSnapshot({
  unitCost = 0,
  quantity = 0,
  pricePerUnit = 0,
  msrpPerUnit = 0,
  desiredMarginPercent = MSRP_DEFAULT_MARGIN_PERCENT,
} = {}) {
  const normalizedUnitCost = sanitizeCurrency(unitCost);
  const normalizedQuantity = sanitizePositiveNumber(quantity);
  const normalizedPrice = sanitizeCurrency(pricePerUnit);
  const normalizedMsrp =
    sanitizeCurrency(msrpPerUnit) > 0
      ? sanitizeCurrency(msrpPerUnit)
      : deriveMsrpFromUnitCost(normalizedUnitCost, desiredMarginPercent);

  const marginPerUnit =
    normalizedPrice > 0 ? roundCurrency(normalizedPrice - normalizedUnitCost) : 0;
  const marginPercent =
    normalizedPrice > 0 ? roundNumber((marginPerUnit / normalizedPrice) * 100, 2) : 0;
  const projectedRevenue =
    normalizedPrice > 0 && normalizedQuantity > 0
      ? roundCurrency(normalizedPrice * normalizedQuantity)
      : 0;
  const projectedProfit =
    normalizedPrice > 0 && normalizedQuantity > 0
      ? roundCurrency((normalizedPrice - normalizedUnitCost) * normalizedQuantity)
      : 0;

  return {
    unitCost: normalizedUnitCost,
    pricePerUnit: normalizedPrice,
    suggestedMsrpPerUnit: normalizedMsrp,
    marginPerUnit,
    marginPercent,
    projectedRevenue,
    projectedProfit,
  };
}

function normalizeRecipeCosting({
  recipeId,
  recipeName,
  recipeYield,
  recipeItems,
  recipeCost,
  recipeCostBreakdown,
  packagingCost,
  laborCost,
  overheadCost,
  otherCost,
  directCost,
} = {}) {
  const resolvedRecipeCost =
    sanitizeCurrency(recipeCost) > 0
      ? sanitizeCurrency(recipeCost)
      : sanitizeCurrency(valueOrFallback(recipeCostBreakdown?.total, recipeCostBreakdown?.batchTotalCost));

  const normalizedPackagingCost = sanitizeCurrency(packagingCost);
  const normalizedLaborCost = sanitizeCurrency(laborCost);
  const normalizedOverheadCost = sanitizeCurrency(overheadCost);
  const normalizedOtherCost = sanitizeCurrency(otherCost);
  const normalizedDirectCost =
    sanitizeCurrency(directCost) > 0
      ? sanitizeCurrency(directCost)
      : roundCurrency(
          normalizedPackagingCost + normalizedLaborCost + normalizedOverheadCost + normalizedOtherCost
        );

  return {
    recipeId: safeString(recipeId),
    recipeName: safeString(recipeName),
    recipeYield: sanitizePositiveNumber(recipeYield),
    recipeItems: safeArray(recipeItems).map((item) => ({ ...item })),
    recipeCost: resolvedRecipeCost,
    recipeCostBreakdown:
      recipeCostBreakdown && typeof recipeCostBreakdown === "object"
        ? { ...recipeCostBreakdown }
        : null,
    packagingCost: normalizedPackagingCost,
    laborCost: normalizedLaborCost,
    overheadCost: normalizedOverheadCost,
    otherCost: normalizedOtherCost,
    directCost: normalizedDirectCost,
  };
}

function normalizeFinishedMovementType(movementType = "") {
  const normalized = safeString(movementType).toLowerCase();
  if (OUTBOUND_FINISHED_MOVEMENT_TYPES.includes(normalized)) return normalized;
  return "adjustment";
}

function movementLabel(movementType = "") {
  return {
    sell: "Sold",
    donate: "Donated",
    sample: "Sampled",
    waste: "Wasted",
    adjustment: "Adjusted",
  }[normalizeFinishedMovementType(movementType)] || "Adjusted";
}

function buildOutboundSnapshot(previous = {}, movementType = "", direction = "out", quantity = 0, revenue = 0) {
  const next = {
    sold: sanitizePositiveNumber(previous?.sold),
    donated: sanitizePositiveNumber(previous?.donated),
    sampled: sanitizePositiveNumber(previous?.sampled),
    wasted: sanitizePositiveNumber(previous?.wasted),
    adjustedOut: sanitizePositiveNumber(previous?.adjustedOut),
    adjustedIn: sanitizePositiveNumber(previous?.adjustedIn),
    revenue: sanitizeCurrency(previous?.revenue),
  };

  const normalizedType = normalizeFinishedMovementType(movementType);
  const normalizedQty = sanitizePositiveNumber(quantity);
  const normalizedRevenue = sanitizeCurrency(revenue);

  if (normalizedType === "sell" && direction === "out") {
    next.sold = sanitizePositiveNumber(next.sold + normalizedQty);
    next.revenue = roundCurrency(next.revenue + normalizedRevenue);
  } else if (normalizedType === "donate" && direction === "out") {
    next.donated = sanitizePositiveNumber(next.donated + normalizedQty);
  } else if (normalizedType === "sample" && direction === "out") {
    next.sampled = sanitizePositiveNumber(next.sampled + normalizedQty);
  } else if (normalizedType === "waste" && direction === "out") {
    next.wasted = sanitizePositiveNumber(next.wasted + normalizedQty);
  } else if (direction === "in") {
    next.adjustedIn = sanitizePositiveNumber(next.adjustedIn + normalizedQty);
  } else {
    next.adjustedOut = sanitizePositiveNumber(next.adjustedOut + normalizedQty);
  }

  return next;
}

export function parseAnyDate(raw) {
  if (!raw) return null;

  if (raw && typeof raw.toDate === "function") {
    const d = raw.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }

  if (typeof raw === "number") {
    let ms = raw;
    if (ms < 100000000000) ms *= 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toLocalYYYYMMDD(raw = new Date()) {
  const d = raw instanceof Date ? raw : parseAnyDate(raw) || new Date();
  try {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "";
  }
}

export function normalizePostProcessGrowType(type = "") {
  const s = String(type || "").toLowerCase();
  if (s.includes("bulk")) return "Bulk";
  if (s.includes("agar")) return "Agar";
  if (s.includes("lc") || s.includes("liquid")) return "LC";
  if (s.includes("grain")) return "Grain Jar";
  return "Other";
}

export function getFinishedGoodsLotTypes() {
  return [...FINISHED_GOODS_LOT_TYPES];
}

export function isFinishedGoodsLot(lot = {}) {
  return FINISHED_GOODS_LOT_TYPES.includes(String(lot?.lotType || "").trim().toLowerCase());
}

export function isProductionBatch(batch = {}) {
  const processType = String(batch?.processType || "").trim().toLowerCase();
  const processCategory = String(batch?.processCategory || "").trim().toLowerCase();
  return processType === "product" || processType === "production" || processCategory === "production";
}

export function getFinishedInventoryCategory(lot = {}) {
  if (isFinishedGoodsLot(lot)) return "finished_goods";
  const lotType = String(lot?.lotType || "").trim().toLowerCase();
  if (lotType === "extract") return "extract";
  if (lotType === "dry_material") return "dry_material";
  return "other";
}

export function getGrowLabel(grow = {}) {
  return (
    grow?.abbreviation ||
    grow?.abbr ||
    grow?.subName ||
    grow?.name ||
    grow?.strain ||
    grow?.id ||
    "Unknown Grow"
  );
}

export function getGrowFlushes(grow = {}) {
  if (Array.isArray(grow?.flushes)) return grow.flushes;
  if (Array.isArray(grow?.harvest?.flushes)) return grow.harvest.flushes;
  return [];
}

export function getGrowDryTotal(grow = {}) {
  const flushes = getGrowFlushes(grow);
  const flushDry = flushes.reduce((sum, flush) => sum + (Number(flush?.dry) || 0), 0);
  if (flushDry > 0) return Math.round(flushDry * 1000) / 1000;
  return Math.round((Number(grow?.dryYield) || 0) * 1000) / 1000;
}

export function getLatestFlushDate(grow = {}) {
  const flushes = getGrowFlushes(grow);
  let latest = null;

  for (const flush of flushes) {
    const parsed = parseAnyDate(flush?.createdAt ?? flush?.date ?? flush?.when ?? null);
    if (!parsed) continue;
    if (!latest || parsed > latest) latest = parsed;
  }

  return latest ? toLocalYYYYMMDD(latest) : "";
}

export function getGrowHarvestDate(grow = {}) {
  const parsedDirect = parseAnyDate(
    grow?.stageDates?.Harvested ||
      grow?.harvestedDate ||
      grow?.harvestDate ||
      grow?.harvestedAt ||
      grow?.updatedAt ||
      null
  );
  if (parsedDirect) return toLocalYYYYMMDD(parsedDirect);
  const latestFlush = getLatestFlushDate(grow);
  if (latestFlush) return latestFlush;
  return toLocalYYYYMMDD(new Date());
}

export function isHarvestComplete(grow = {}) {
  const stage = String(grow?.stage || "").toLowerCase();
  const status = String(grow?.status || "").toLowerCase();
  const type = normalizePostProcessGrowType(grow?.type || grow?.growType || "");
  const hasHarvestMarker =
    stage === "harvested" || !!grow?.stageDates?.Harvested || !!grow?.harvestedAt;

  if (hasHarvestMarker) return true;
  return type === "Bulk" && status === "archived" && getGrowDryTotal(grow) > 0;
}

export function canCreateDryLotFromGrow(grow = {}) {
  return !!grow?.id && isHarvestComplete(grow) && getGrowDryTotal(grow) > 0;
}

export function buildDryLotId(growId = "") {
  return `dry_${String(growId || "").trim()}`;
}

export function buildDryLotName(grow = {}) {
  const label = getGrowLabel(grow);
  const date = getGrowHarvestDate(grow);
  return `${label} Dry Lot${date ? ` ${date}` : ""}`;
}

export function buildExtractionBatchName({ extractionType = "", date = "", lots = [] } = {}) {
  const typeLabel =
    {
      hot_water: "Hot Water",
      ethanol: "Ethanol",
      dual: "Dual Extract",
      powder: "Powder",
      resin: "Resin",
      other: "Extraction",
    }[String(extractionType || "").trim()] || "Extraction";

  const firstLot = Array.isArray(lots) && lots.length > 0 ? lots[0] : null;
  const sourceLabel =
    firstLot?.growLabel || firstLot?.label || firstLot?.name || firstLot?.strain || "Batch";
  const safeDate = date || toLocalYYYYMMDD(new Date());
  return `${sourceLabel} ${typeLabel} ${safeDate}`.trim();
}

export function buildExtractLotName({ batchName = "", extractionType = "", date = "" } = {}) {
  const safeBatch = String(batchName || "").trim();
  if (safeBatch) return `${safeBatch} Output`;
  const safeDate = date || toLocalYYYYMMDD(new Date());
  return `Extract Lot ${String(extractionType || "Extract")} ${safeDate}`.trim();
}


export function getProductTypeMeta(productType = "") {
  const key = String(productType || "").trim().toLowerCase();
  if (key === "gummy" || key === "gummies") {
    return {
      key: "gummy",
      label: "Gummy",
      pluralLabel: "Gummies",
      lotType: "gummies",
      outputUnit: "count",
      pieceLabel: "gummy",
      pieceLabelPlural: "gummies",
      finishedInventoryLabel: "Gummy Inventory",
    };
  }
  if (key === "chocolate" || key === "chocolates") {
    return {
      key: "chocolate",
      label: "Chocolate",
      pluralLabel: "Chocolates",
      lotType: "chocolates",
      outputUnit: "count",
      pieceLabel: "piece",
      pieceLabelPlural: "pieces",
      finishedInventoryLabel: "Chocolate Inventory",
    };
  }
  if (key === "tincture" || key === "tinctures") {
    return {
      key: "tincture",
      label: "Tincture",
      pluralLabel: "Tinctures",
      lotType: "tinctures",
      outputUnit: "count",
      pieceLabel: "bottle",
      pieceLabelPlural: "bottles",
      finishedInventoryLabel: "Tincture Inventory",
    };
  }
  return {
    key: "capsule",
    label: "Capsule",
    pluralLabel: "Capsules",
    lotType: "capsules",
    outputUnit: "count",
    pieceLabel: "capsule",
    pieceLabelPlural: "capsules",
    finishedInventoryLabel: "Capsule Inventory",
  };
}

export function buildProductBatchName({ productType = "", date = "", lots = [] } = {}) {
  const meta = getProductTypeMeta(productType);
  const firstLot = Array.isArray(lots) && lots.length > 0 ? lots[0] : null;
  const sourceLabel =
    firstLot?.growLabel ||
    firstLot?.label ||
    firstLot?.name ||
    firstLot?.lotName ||
    firstLot?.strain ||
    "Batch";
  const safeDate = date || toLocalYYYYMMDD(new Date());
  return `${sourceLabel} ${meta.label} Batch ${safeDate}`.trim();
}

export function buildProductLotName({ batchName = "", productType = "", date = "" } = {}) {
  const meta = getProductTypeMeta(productType);
  const safeBatch = String(batchName || "").trim();
  if (safeBatch) return `${safeBatch} Output`;
  const safeDate = date || toLocalYYYYMMDD(new Date());
  return `${meta.label} Lot ${safeDate}`.trim();
}

export function formatQty(value, unit = "g", digits = 2) {
  const num = Number(value) || 0;
  return `${num.toFixed(digits).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")} ${unit}`;
}

export function isArchivedPostProcessRecord(record = {}) {
  const status = String(record?.status || "").trim().toLowerCase();
  return (
    status === "archived" ||
    status === "void" ||
    record?.archived === true ||
    record?.isArchived === true ||
    record?.inArchive === true ||
    Boolean(record?.archivedAt) ||
    Boolean(record?.archivedOn)
  );
}

export function getLotReservations(lot = {}) {
  return safeArray(lot?.reservations)
    .map((entry, index) => ({
      id: safeString(entry?.id) || `reservation_${index + 1}`,
      label: safeString(entry?.label || entry?.name || entry?.title) || "Reservation",
      quantity: sanitizePositiveNumber(entry?.quantity),
      date: safeString(entry?.date || entry?.createdDate || entry?.reservedDate),
      note: safeString(entry?.note),
      type: safeString(entry?.type || entry?.reservationType) || "hold",
      status: safeString(entry?.status) || "reserved",
    }))
    .filter((entry) => entry.quantity > 0);
}

export function getLotReservedQuantity(lot = {}) {
  const explicit = sanitizePositiveNumber(
    valueOrFallback(lot?.reservationQuantity, lot?.reservedQuantity, lot?.reservedQty)
  );
  if (explicit > 0) return explicit;
  return sanitizePositiveNumber(
    getLotReservations(lot).reduce((sum, entry) => sum + sanitizePositiveNumber(entry.quantity), 0)
  );
}

export function getLotAvailableQuantity(lot = {}) {
  return sanitizePositiveNumber(lotRemaining(lot) - getLotReservedQuantity(lot));
}

export function getLowStockThreshold(lot = {}) {
  return sanitizePositiveNumber(
    valueOrFallback(lot?.lowStockThreshold, lot?.thresholds?.lowStock, lot?.reorderPoint)
  );
}

export function hasPositiveRemainingQuantity(record = {}) {
  return lotRemaining(record) > 0;
}

export function isLowStockLot(lot = {}) {
  const threshold = getLowStockThreshold(lot);
  if (threshold <= 0) return false;
  if (isArchivedPostProcessRecord(lot)) return false;
  if (!hasPositiveRemainingQuantity(lot)) return false;
  return getLotAvailableQuantity(lot) <= threshold;
}

export function isActiveMaterialLot(record = {}) {
  if (!record || isProductionBatch(record)) return false;
  return !isArchivedPostProcessRecord(record) && hasPositiveRemainingQuantity(record);
}

export function isArchivedOrDepletedMaterialLot(record = {}) {
  if (!record || isProductionBatch(record)) return false;
  return isArchivedPostProcessRecord(record) || !hasPositiveRemainingQuantity(record);
}

export function getLotStatus(lot = {}) {
  if (!lot) return "unknown";
  if (isArchivedPostProcessRecord(lot)) return "archived";

  const remaining = lotRemaining(lot);
  const initial = lotInitial(lot);
  const reserved = getLotReservedQuantity(lot);

  if (remaining <= 0) return "depleted";
  if (reserved >= remaining && remaining > 0) return "reserved";
  if (initial > 0 && remaining < initial) return "partial";

  const explicitStatus = String(lot?.status || "").trim().toLowerCase();
  return explicitStatus || "available";
}

export function getProcessBatchStatus(batch = {}) {
  if (isArchivedPostProcessRecord(batch)) return "archived";

  const explicitStatus = String(batch?.status || "").trim().toLowerCase();
  if (explicitStatus) return explicitStatus;
  if (batch?.outputLotId) return "completed";
  return "planned";
}

export function isActiveProcessBatch(batch = {}) {
  if (!batch || (!isProductionBatch(batch) && !String(batch?.processType || "").trim())) return false;

  const status = getProcessBatchStatus(batch);
  if (status === "archived" || status === "void") return false;
  if (status === "completed" && batch?.outputLotId) return false;

  return true;
}

export function isArchivedProcessBatch(batch = {}) {
  if (!batch) return false;
  if (isArchivedPostProcessRecord(batch)) return true;
  if (!isProductionBatch(batch) && !String(batch?.processType || "").trim()) return false;

  const status = getProcessBatchStatus(batch);
  return status === "archived" || status === "void" || (status === "completed" && Boolean(batch?.outputLotId));
}

export function buildCostRollup(record = {}) {
  if (!record || typeof record !== "object") return null;

  const totalCost = sanitizeCurrency(
    valueOrFallback(
      record?.batchTotalCost,
      record?.totalCost,
      record?.costs?.batchTotalCost,
      record?.costs?.totalCost,
      record?.inputMaterialCostTotal
    )
  );
  const unitCost = sanitizeCurrency(
    valueOrFallback(record?.unitCost, record?.costPerUnit, record?.costs?.unitCost)
  );

  const entries = [
    {
      key: "growCost",
      label: "Grow cost",
      total: sanitizeCurrency(valueOrFallback(record?.sourceBatchTotalCost, record?.costs?.sourceGrowCost)),
    },
    {
      key: "inputMaterial",
      label: "Input material",
      total: sanitizeCurrency(valueOrFallback(record?.inputMaterialCostTotal, record?.costs?.inputMaterialCostTotal)),
    },
    {
      key: "recipe",
      label: "Recipe",
      total: sanitizeCurrency(
        valueOrFallback(
          record?.recipeBatchCostTotal,
          record?.recipeCost,
          record?.costs?.recipeBatchCostTotal,
          record?.costs?.recipeCost
        )
      ),
    },
    {
      key: "direct",
      label: "Direct cost",
      total: sanitizeCurrency(
        valueOrFallback(
          record?.directCostTotal,
          record?.directCost,
          record?.costs?.directCostTotal,
          record?.costs?.directCost
        )
      ),
    },
    {
      key: "packaging",
      label: "Packaging",
      total: sanitizeCurrency(valueOrFallback(record?.packagingCost, record?.costs?.packagingCost)),
    },
    {
      key: "labor",
      label: "Labor",
      total: sanitizeCurrency(valueOrFallback(record?.laborCost, record?.costs?.laborCost)),
    },
    {
      key: "overhead",
      label: "Overhead",
      total: sanitizeCurrency(valueOrFallback(record?.overheadCost, record?.costs?.overheadCost)),
    },
    {
      key: "other",
      label: "Other",
      total: sanitizeCurrency(valueOrFallback(record?.otherCost, record?.costs?.otherCost)),
    },
  ];

  const stage =
    record?.inventoryCategory ||
    record?.manufacturingStage ||
    record?.processCategory ||
    record?.processType ||
    record?.lotType ||
    "postprocess";

  if (totalCost <= 0 && unitCost <= 0 && !entries.some((entry) => entry.total > 0)) return null;

  return {
    stage: safeString(stage) || "postprocess",
    totalCost,
    unitCost,
    entries,
  };
}

export function getRecipeSnapshot(record = {}) {
  if (!record || typeof record !== "object") return null;

  const recipeId = safeString(record?.recipeId);
  const recipeName = safeString(record?.recipeName);
  const recipeItems = safeArray(record?.recipeItems);
  const recipeYield = sanitizePositiveNumber(record?.recipeYield);
  const recipeCost = sanitizeCurrency(valueOrFallback(record?.recipeBatchCostTotal, record?.recipeCost));
  const directCost = sanitizeCurrency(valueOrFallback(record?.directCostTotal, record?.directCost));

  if (!recipeId && !recipeName && recipeItems.length === 0 && recipeCost <= 0 && directCost <= 0) {
    return null;
  }

  return {
    recipeId,
    recipeName,
    recipeYield,
    recipeItems,
    recipeCost,
    directCost,
    lockedDate: safeString(valueOrFallback(record?.createdDate, record?.updatedDate, record?.date)),
  };
}

export function getLotPotency(record = {}) {
  if (!record || typeof record !== "object") return null;

  const potency = record?.potency && typeof record.potency === "object" ? record.potency : {};
  const activeMgPerUnit = sanitizePositiveNumber(
    valueOrFallback(potency?.activeMgPerUnit, potency?.mgPerUnit, record?.mgPerUnit)
  );
  const activeMgPerMl = sanitizePositiveNumber(
    valueOrFallback(potency?.activeMgPerMl, potency?.mgPerMl)
  );
  const activeMgPerGram = sanitizePositiveNumber(
    valueOrFallback(potency?.activeMgPerGram, potency?.mgPerGram)
  );
  const notes = safeString(potency?.notes);
  const updatedDate = safeString(valueOrFallback(potency?.updatedDate, record?.updatedDate, record?.date));

  if (activeMgPerUnit <= 0 && activeMgPerMl <= 0 && activeMgPerGram <= 0 && !notes) {
    return null;
  }

  return {
    activeMgPerUnit,
    activeMgPerMl,
    activeMgPerGram,
    notes,
    updatedDate,
  };
}

export function getLotQc(record = {}) {
  if (!record || typeof record !== "object") return null;

  const qc = record?.qc && typeof record.qc === "object" ? record.qc : {};
  const status = safeString(valueOrFallback(qc?.status, "pending")).toLowerCase() || "pending";
  const checkedBy = safeString(qc?.checkedBy);
  const checkedDate = safeString(qc?.checkedDate);
  const notes = safeString(qc?.notes);

  if (status === "pending" && !checkedBy && !checkedDate && !notes) {
    return null;
  }

  return {
    status,
    checkedBy,
    checkedDate,
    notes,
  };
}

export function getLotShelfLife(record = {}) {
  if (!record || typeof record !== "object") return null;

  const shelfLife = record?.shelfLife && typeof record.shelfLife === "object" ? record.shelfLife : {};
  const madeOn = safeString(valueOrFallback(shelfLife?.madeOn, record?.createdDate, record?.date));
  const bestBy = safeString(valueOrFallback(shelfLife?.bestBy, shelfLife?.bestByDate));
  const expirationDate = safeString(valueOrFallback(shelfLife?.expirationDate, shelfLife?.expiresOn));
  const storageCondition = safeString(shelfLife?.storageCondition);
  const storageNotes = safeString(shelfLife?.storageNotes);

  if (!madeOn && !bestBy && !expirationDate && !storageCondition && !storageNotes) {
    return null;
  }

  return {
    madeOn,
    bestBy,
    expirationDate,
    storageCondition,
    storageNotes,
  };
}

export function isQcPendingLot(record = {}) {
  const qc = getLotQc(record);
  if (!qc) return true;
  return !qc.checkedDate || qc.status === "pending";
}

export function isExpiringSoonLot(record = {}, days = 30) {
  const shelfLife = getLotShelfLife(record);
  if (!shelfLife) return false;

  const target = parseAnyDate(shelfLife.bestBy || shelfLife.expirationDate);
  if (!target) return false;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const targetDate = new Date(target);
  targetDate.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((targetDate.getTime() - now.getTime()) / 86400000);
  return diffDays >= 0 && diffDays <= Math.max(0, Number(days) || 30);
}


function sanitizePositiveNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, n) * 1000) / 1000;
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function lotRemaining(lot = {}) {
  return sanitizePositiveNumber(lot?.remainingQuantity);
}

function lotInitial(lot = {}) {
  return sanitizePositiveNumber(lot?.initialQuantity);
}

function nextLotStatus(nextRemaining, initial) {
  if (nextRemaining <= 0) return "depleted";
  if (nextRemaining < initial) return "partial";
  return "available";
}

function batchStatusValue(status = "") {
  const normalized = String(status || "").trim();
  return ["planned", "in_progress", "completed", "void", "archived"].includes(normalized)
    ? normalized
    : "completed";
}

function extractGrowIdsFromLot(lot = {}) {
  return uniqueStrings([
    ...(Array.isArray(lot?.originGrowIds) ? lot.originGrowIds : []),
    ...(Array.isArray(lot?.sourceGrowIds) ? lot.sourceGrowIds : []),
    lot?.sourceGrowId,
  ]);
}

export async function createDryLotFromGrow({ userId, grow }) {
  if (!userId) throw new Error("Missing user.");
  if (!grow?.id) throw new Error("Missing grow.");
  if (!canCreateDryLotFromGrow(grow)) {
    throw new Error("This grow is not ready for dry-material intake.");
  }

  const dryTotal = getGrowDryTotal(grow);
  if (!(dryTotal > 0)) throw new Error("Dry harvest total must be greater than zero.");

  const lotId = buildDryLotId(grow.id);
  const lotRef = doc(db, "users", userId, "materialLots", lotId);
  const lotSnap = await getDoc(lotRef);

  if (lotSnap.exists()) {
    return { created: false, lotId, lot: { id: lotSnap.id, ...lotSnap.data() } };
  }

  const today = toLocalYYYYMMDD(new Date());
  const harvestedDate = getGrowHarvestDate(grow) || today;
  const label = getGrowLabel(grow);
  const strain = grow?.strain || grow?.strainName || "";
  const sourceBatchTotalCost = getGrowBatchTotalCost(grow);
  const sourceUnitCost = dryTotal > 0 ? roundCurrency(sourceBatchTotalCost / dryTotal) : 0;

  const batch = writeBatch(db);
  batch.set(lotRef, {
    lotType: "dry_material",
    inventoryCategory: "dry_material",
    processType: "harvest_intake",
    processCategory: "intake",
    status: "available",
    sourceType: "grow",
    sourceGrowId: grow.id,
    originGrowIds: [grow.id],
    name: buildDryLotName(grow),
    growLabel: label,
    strain,
    harvestedDate,
    unit: "g",
    initialQuantity: dryTotal,
    allocatedQuantity: 0,
    remainingQuantity: dryTotal,
    dryQuantitySnapshot: dryTotal,
    sourceBatchTotalCost,
    unitCost: sourceUnitCost,
    costPerUnit: sourceUnitCost,
    batchTotalCost: sourceBatchTotalCost,
    costs: {
      sourceGrowCost: sourceBatchTotalCost,
      batchTotalCost: sourceBatchTotalCost,
      unitCost: sourceUnitCost,
    },
    notes: "",
    createdDate: today,
    updatedDate: today,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
  batch.set(movementRef, {
    movementType: "create_lot_from_grow",
    lotId,
    processType: "harvest_intake",
    direction: "in",
    sourceGrowId: grow.id,
    sourceType: "grow",
    quantity: dryTotal,
    unit: "g",
    date: harvestedDate || today,
    note: "Dry material lot created from harvested grow.",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  const createdSnap = await getDoc(lotRef);
  return {
    created: true,
    lotId,
    lot: createdSnap.exists() ? { id: createdSnap.id, ...createdSnap.data() } : null,
  };
}

export async function createExtractionBatch({
  userId,
  name,
  extractionType,
  method,
  notes,
  date,
  status,
  outputAmount,
  outputUnit,
  outputYieldPercent,
  inputLots,
}) {
  if (!userId) throw new Error("Missing user.");

  const normalizedInputs = (Array.isArray(inputLots) ? inputLots : [])
    .map((item) => ({
      lotId: String(item?.lotId || "").trim(),
      quantity: sanitizePositiveNumber(item?.quantity),
    }))
    .filter((item) => item.lotId && item.quantity > 0);

  if (normalizedInputs.length === 0) {
    throw new Error("Select at least one dry-material lot and enter a quantity to consume.");
  }

  const normalizedDate = date || toLocalYYYYMMDD(new Date());
  const normalizedStatus = batchStatusValue(status);
  const normalizedExtractionType = String(extractionType || "other").trim() || "other";
  const normalizedMethod = String(method || "").trim();
  const normalizedNotes = String(notes || "").trim();
  const normalizedOutputAmount = sanitizePositiveNumber(outputAmount);
  const normalizedOutputUnit = String(outputUnit || "mL").trim() || "mL";
  const manualYieldPercent = sanitizePositiveNumber(outputYieldPercent);

  if (normalizedStatus === "completed" && normalizedOutputAmount <= 0) {
    throw new Error("Completed extraction batches need an output amount so an extract lot can be created.");
  }

  return runTransaction(db, async (tx) => {
    const lotSnapshots = [];

    for (const item of normalizedInputs) {
      const lotRef = doc(db, "users", userId, "materialLots", item.lotId);
      const lotSnap = await tx.get(lotRef);
      if (!lotSnap.exists()) throw new Error(`Source lot ${item.lotId} could not be found.`);
      lotSnapshots.push({ ref: lotRef, snap: lotSnap, quantity: item.quantity });
    }

    const enrichedInputs = [];
    const sourceGrowIds = [];
    const originGrowIds = [];
    const sourceStrains = [];
    let inputDryTotal = 0;

    for (const entry of lotSnapshots) {
      const lot = entry.snap.data() || {};
      if (String(lot?.lotType || "") !== "dry_material") {
        throw new Error("Extraction batches can only consume dry-material lots.");
      }

      const remaining = lotRemaining(lot);
      const available = getLotAvailableQuantity(lot);
      if (entry.quantity > available) {
        throw new Error(`${lot?.name || entry.ref.id} only has ${formatQty(available, lot?.unit || "g")} available after reservations.`);
      }

      const nextRemaining = sanitizePositiveNumber(remaining - entry.quantity);
      const nextAllocated = sanitizePositiveNumber((Number(lot?.allocatedQuantity) || 0) + entry.quantity);
      tx.update(entry.ref, {
        remainingQuantity: nextRemaining,
        allocatedQuantity: nextAllocated,
        status: nextLotStatus(nextRemaining, lotInitial(lot)),
        updatedDate: normalizedDate,
        updatedAt: serverTimestamp(),
      });

      const growIds = extractGrowIdsFromLot(lot);
      sourceGrowIds.push(...growIds);
      originGrowIds.push(...growIds);
      if (lot?.strain) sourceStrains.push(String(lot.strain));

      inputDryTotal += entry.quantity;
      const unitCost = getLotUnitCost(lot);
      const inputCostApplied = roundCurrency(unitCost * entry.quantity);

      enrichedInputs.push({
        lotId: entry.ref.id,
        lotType: "dry_material",
        lotName: lot?.name || entry.ref.id,
        growLabel: lot?.growLabel || lot?.name || entry.ref.id,
        strain: lot?.strain || "",
        sourceGrowId: lot?.sourceGrowId || null,
        originGrowIds: growIds,
        quantity: entry.quantity,
        unit: lot?.unit || "g",
        unitCost,
        inputCostApplied,
        remainingBefore: remaining,
        remainingAfter: nextRemaining,
      });
    }

    inputDryTotal = sanitizePositiveNumber(inputDryTotal);
    const finalBatchName =
      String(name || "").trim() ||
      buildExtractionBatchName({
        extractionType: normalizedExtractionType,
        date: normalizedDate,
        lots: enrichedInputs,
      });

    const batchRef = doc(collection(db, "users", userId, "processBatches"));
    const outputLotRef = normalizedOutputAmount > 0 ? doc(collection(db, "users", userId, "materialLots")) : null;

    const computedYieldPercent =
      manualYieldPercent > 0
        ? manualYieldPercent
        : normalizedOutputUnit.toLowerCase() === "g" && inputDryTotal > 0
        ? sanitizePositiveNumber((normalizedOutputAmount / inputDryTotal) * 100)
        : null;

    const inputMaterialCostTotal = roundCurrency(
      enrichedInputs.reduce((sum, input) => sum + sanitizeCurrency(input.inputCostApplied), 0)
    );
    const outputUnitCost =
      normalizedOutputAmount > 0 ? roundCurrency(inputMaterialCostTotal / normalizedOutputAmount) : 0;

    const uniqueGrowIds = uniqueStrings(sourceGrowIds);
    const uniqueOriginGrowIds = uniqueStrings(originGrowIds);
    const uniqueStrains = uniqueStrings(sourceStrains);

    const outputLots = outputLotRef
      ? [{
          lotId: outputLotRef.id,
          lotType: "extract",
          name: buildExtractLotName({
            batchName: finalBatchName,
            extractionType: normalizedExtractionType,
            date: normalizedDate,
          }),
          quantity: normalizedOutputAmount,
          unit: normalizedOutputUnit,
        }]
      : [];

    tx.set(batchRef, {
      processType: "extraction",
      name: finalBatchName,
      status: normalizedStatus,
      date: normalizedDate,
      extractionType: normalizedExtractionType,
      method: normalizedMethod,
      notes: normalizedNotes,
      inputLots: enrichedInputs,
      outputLots,
      sourceGrowIds: uniqueGrowIds,
      originGrowIds: uniqueOriginGrowIds,
      strains: uniqueStrains,
      inputDryTotal,
      inputUnit: "g",
      outputAmount: normalizedOutputAmount,
      outputUnit: normalizedOutputUnit,
      outputYieldPercent: computedYieldPercent,
      inputMaterialCostTotal,
      batchTotalCost: inputMaterialCostTotal,
      unitCost: outputUnitCost,
      costs: {
        inputMaterialCostTotal,
        batchTotalCost: inputMaterialCostTotal,
        unitCost: outputUnitCost,
      },
      outputLotId: outputLotRef?.id || null,
      createdDate: normalizedDate,
      updatedDate: normalizedDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const input of enrichedInputs) {
      const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
      tx.set(movementRef, {
        movementType: "consume_lot",
        lotId: input.lotId,
        batchId: batchRef.id,
        processType: "extraction",
        direction: "out",
        sourceGrowId: input.sourceGrowId || null,
        sourceType: "grow",
        quantity: input.quantity,
        unit: input.unit || "g",
        date: normalizedDate,
        note: `Consumed by extraction batch ${finalBatchName}.`,
        createdAt: serverTimestamp(),
      });
    }

    if (outputLotRef) {
      tx.set(outputLotRef, {
        lotType: "extract",
        inventoryCategory: "extract",
        processType: "extraction",
        processCategory: "manufacturing",
        status: "available",
        sourceType: "batch",
        sourceBatchId: batchRef.id,
        sourceGrowIds: uniqueGrowIds,
        originGrowIds: uniqueOriginGrowIds,
        name: outputLots[0].name,
        batchName: finalBatchName,
        extractionType: normalizedExtractionType,
        method: normalizedMethod,
        strain: uniqueStrains.join(", "),
        unit: normalizedOutputUnit,
        initialQuantity: normalizedOutputAmount,
        allocatedQuantity: 0,
        remainingQuantity: normalizedOutputAmount,
        inputMaterialCostTotal,
        unitCost: outputUnitCost,
        costPerUnit: outputUnitCost,
        batchTotalCost: inputMaterialCostTotal,
        costs: {
          inputMaterialCostTotal,
          batchTotalCost: inputMaterialCostTotal,
          unitCost: outputUnitCost,
        },
        notes: normalizedNotes,
        createdDate: normalizedDate,
        updatedDate: normalizedDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
      tx.set(movementRef, {
        movementType: "produce_lot",
        lotId: outputLotRef.id,
        batchId: batchRef.id,
        processType: "extraction",
        direction: "in",
        sourceGrowId: uniqueGrowIds[0] || null,
        sourceType: "batch",
        quantity: normalizedOutputAmount,
        unit: normalizedOutputUnit,
        date: normalizedDate,
        note: `Extract lot created from extraction batch ${finalBatchName}.`,
        createdAt: serverTimestamp(),
      });
    }

    return {
      created: true,
      batchId: batchRef.id,
      outputLotId: outputLotRef?.id || null,
      name: finalBatchName,
    };
  });
}

export async function finalizeExtractionBatchOutput({
  userId,
  batchId,
  outputAmount,
  outputUnit,
  outputYieldPercent,
  date,
  notes,
}) {
  if (!userId) throw new Error("Missing user.");
  if (!batchId) throw new Error("Missing extraction batch.");

  const normalizedOutputAmount = sanitizePositiveNumber(outputAmount);
  if (normalizedOutputAmount <= 0) {
    throw new Error("Enter an output amount greater than zero to create an extract lot.");
  }

  const normalizedOutputUnit = String(outputUnit || "mL").trim() || "mL";
  const normalizedDate = date || toLocalYYYYMMDD(new Date());
  const manualYieldPercent = sanitizePositiveNumber(outputYieldPercent);
  const normalizedNotes = String(notes || "").trim();

  return runTransaction(db, async (tx) => {
    const batchRef = doc(db, "users", userId, "processBatches", batchId);
    const batchSnap = await tx.get(batchRef);
    if (!batchSnap.exists()) throw new Error("Extraction batch could not be found.");

    const batch = batchSnap.data() || {};
    if (String(batch?.processType || "") !== "extraction") {
      throw new Error("Only extraction batches can create extract lots.");
    }
    if (batch?.outputLotId) {
      throw new Error("This extraction batch already has an extract lot.");
    }

    const inputDryTotal = sanitizePositiveNumber(batch?.inputDryTotal);
    const computedYieldPercent =
      manualYieldPercent > 0
        ? manualYieldPercent
        : normalizedOutputUnit.toLowerCase() === "g" && inputDryTotal > 0
        ? sanitizePositiveNumber((normalizedOutputAmount / inputDryTotal) * 100)
        : null;

    const outputLotRef = doc(collection(db, "users", userId, "materialLots"));
    const inputMaterialCostTotal = sanitizeCurrency(
      valueOrFallback(batch?.inputMaterialCostTotal, batch?.batchTotalCost, batch?.costs?.inputMaterialCostTotal)
    );
    const outputUnitCost =
      normalizedOutputAmount > 0 ? roundCurrency(inputMaterialCostTotal / normalizedOutputAmount) : 0;
    const outputLotName = buildExtractLotName({
      batchName: batch?.name || "",
      extractionType: batch?.extractionType || "extract",
      date: normalizedDate,
    });

    tx.update(batchRef, {
      status: "completed",
      outputAmount: normalizedOutputAmount,
      outputUnit: normalizedOutputUnit,
      outputYieldPercent: computedYieldPercent,
      inputMaterialCostTotal,
      batchTotalCost: inputMaterialCostTotal,
      unitCost: outputUnitCost,
      costs: {
        inputMaterialCostTotal,
        batchTotalCost: inputMaterialCostTotal,
        unitCost: outputUnitCost,
      },
      outputLotId: outputLotRef.id,
      outputLots: [{
        lotId: outputLotRef.id,
        lotType: "extract",
        name: outputLotName,
        quantity: normalizedOutputAmount,
        unit: normalizedOutputUnit,
      }],
      notes: normalizedNotes
        ? [String(batch?.notes || "").trim(), normalizedNotes].filter(Boolean).join("\n\n")
        : batch?.notes || "",
      updatedDate: normalizedDate,
      updatedAt: serverTimestamp(),
    });

    tx.set(outputLotRef, {
      lotType: "extract",
      inventoryCategory: "extract",
      processType: "extraction",
      processCategory: "manufacturing",
      status: "available",
      sourceType: "batch",
      sourceBatchId: batchRef.id,
      sourceGrowIds: Array.isArray(batch?.sourceGrowIds) ? batch.sourceGrowIds : [],
      originGrowIds: Array.isArray(batch?.originGrowIds) ? batch.originGrowIds : [],
      name: outputLotName,
      batchName: batch?.name || outputLotName,
      extractionType: batch?.extractionType || "other",
      method: batch?.method || "",
      strain: Array.isArray(batch?.strains) ? batch.strains.join(", ") : String(batch?.strain || ""),
      unit: normalizedOutputUnit,
      initialQuantity: normalizedOutputAmount,
      allocatedQuantity: 0,
      remainingQuantity: normalizedOutputAmount,
      inputMaterialCostTotal,
      unitCost: outputUnitCost,
      costPerUnit: outputUnitCost,
      batchTotalCost: inputMaterialCostTotal,
      costs: {
        inputMaterialCostTotal,
        batchTotalCost: inputMaterialCostTotal,
        unitCost: outputUnitCost,
      },
      notes: normalizedNotes || batch?.notes || "",
      createdDate: normalizedDate,
      updatedDate: normalizedDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
    tx.set(movementRef, {
      movementType: "produce_lot",
      lotId: outputLotRef.id,
      batchId: batchRef.id,
      processType: "extraction",
      direction: "in",
      sourceGrowId: (Array.isArray(batch?.sourceGrowIds) ? batch.sourceGrowIds : [])[0] || null,
      sourceType: "batch",
      quantity: normalizedOutputAmount,
      unit: normalizedOutputUnit,
      date: normalizedDate,
      note: `Extract lot created from extraction batch ${batch?.name || batchRef.id}.`,
      createdAt: serverTimestamp(),
    });

    return {
      created: true,
      batchId: batchRef.id,
      outputLotId: outputLotRef.id,
      name: batch?.name || outputLotName,
    };
  });
}


export async function createProductBatch({
  userId,
  name,
  productType,
  method,
  notes,
  date,
  status,
  outputCount,
  expectedOutputCount,
  wasteQuantity,
  wasteUnit,
  wasteReason,
  wasteNotes,
  mgPerUnit,
  variant,
  inputLots,
  recipeId,
  recipeName,
  recipeYield,
  recipeItems,
  recipeCost,
  recipeCostBreakdown,
  packagingCost,
  laborCost,
  overheadCost,
  otherCost,
  directCost,
  pricePerUnit,
  msrpPerUnit,
  desiredMarginPercent,
  bottleSize,
  bottleSizeUnit,
}) {
  if (!userId) throw new Error("Missing user.");

  const meta = getProductTypeMeta(productType);
  const normalizedInputs = (Array.isArray(inputLots) ? inputLots : [])
    .map((item) => ({
      lotId: safeString(item?.lotId),
      quantity: sanitizePositiveNumber(item?.quantity),
    }))
    .filter((item) => item.lotId && item.quantity > 0);

  if (normalizedInputs.length === 0) {
    throw new Error("Select at least one source lot and enter a quantity to consume.");
  }

  const normalizedDate = date || toLocalYYYYMMDD(new Date());
  const normalizedStatus = batchStatusValue(status);
  const normalizedMethod = safeString(method);
  const normalizedNotes = safeString(notes);
  const normalizedVariant = safeString(variant);
  const normalizedOutputCount = Math.max(0, Math.floor(Number(outputCount) || 0));
  const normalizedExpectedOutputCount = Math.max(
    normalizedOutputCount,
    Math.floor(Number(expectedOutputCount) || 0)
  ) || normalizedOutputCount;
  const normalizedWasteQuantity = sanitizePositiveNumber(wasteQuantity);
  const normalizedWasteUnit = safeString(wasteUnit || meta.outputUnit) || meta.outputUnit;
  const normalizedWasteReason = safeString(wasteReason);
  const normalizedWasteNotes = safeString(wasteNotes);
  const normalizedMgPerUnit = sanitizePositiveNumber(mgPerUnit);
  const normalizedBottleSize = sanitizePositiveNumber(bottleSize);
  const normalizedBottleSizeUnit = safeString(bottleSizeUnit || "mL") || "mL";
  const normalizedDesiredMarginPercent =
    sanitizePositiveNumber(desiredMarginPercent) || MSRP_DEFAULT_MARGIN_PERCENT;

  const costing = normalizeRecipeCosting({
    recipeId,
    recipeName,
    recipeYield,
    recipeItems,
    recipeCost,
    recipeCostBreakdown,
    packagingCost,
    laborCost,
    overheadCost,
    otherCost,
    directCost,
  });

  if (normalizedStatus === "completed" && normalizedOutputCount <= 0) {
    throw new Error(`Completed ${meta.pluralLabel.toLowerCase()} batches need an output count.`);
  }

  return runTransaction(db, async (tx) => {
    const lotSnapshots = [];
    for (const item of normalizedInputs) {
      const lotRef = doc(db, "users", userId, "materialLots", item.lotId);
      const lotSnap = await tx.get(lotRef);
      if (!lotSnap.exists()) throw new Error(`Source lot ${item.lotId} could not be found.`);
      lotSnapshots.push({ ref: lotRef, snap: lotSnap, quantity: item.quantity });
    }

    const enrichedInputs = [];
    const sourceGrowIds = [];
    const originGrowIds = [];
    const sourceStrains = [];
    let totalInputQuantity = 0;
    let inputMaterialCostTotal = 0;

    for (const entry of lotSnapshots) {
      const lot = entry.snap.data() || {};
      const lotType = String(lot?.lotType || "").trim().toLowerCase();
      if (lotType !== "dry_material" && lotType !== "extract") {
        throw new Error("Production batches can only consume dry material or extract lots.");
      }

      const remaining = lotRemaining(lot);
      const available = getLotAvailableQuantity(lot);
      if (entry.quantity > available) {
        throw new Error(`${lot?.name || entry.ref.id} only has ${formatQty(available, lot?.unit || "g")} available after reservations.`);
      }

      const nextRemaining = sanitizePositiveNumber(remaining - entry.quantity);
      const nextAllocated = sanitizePositiveNumber((Number(lot?.allocatedQuantity) || 0) + entry.quantity);
      tx.update(entry.ref, {
        remainingQuantity: nextRemaining,
        allocatedQuantity: nextAllocated,
        status: nextLotStatus(nextRemaining, lotInitial(lot)),
        updatedDate: normalizedDate,
        updatedAt: serverTimestamp(),
      });

      const growIds = extractGrowIdsFromLot(lot);
      sourceGrowIds.push(...growIds);
      originGrowIds.push(...growIds);
      if (lot?.strain) sourceStrains.push(String(lot.strain));

      totalInputQuantity += entry.quantity;
      const unitCost = getLotUnitCost(lot);
      const inputCostApplied = roundCurrency(unitCost * entry.quantity);
      inputMaterialCostTotal = roundCurrency(inputMaterialCostTotal + inputCostApplied);

      enrichedInputs.push({
        lotId: entry.ref.id,
        lotType,
        lotName: lot?.name || entry.ref.id,
        growLabel: lot?.growLabel || lot?.name || entry.ref.id,
        strain: lot?.strain || "",
        sourceGrowId: lot?.sourceGrowId || null,
        originGrowIds: growIds,
        quantity: entry.quantity,
        unit: lot?.unit || (lotType === "extract" ? "mL" : "g"),
        unitCost,
        inputCostApplied,
        remainingBefore: remaining,
        remainingAfter: nextRemaining,
      });
    }

    const uniqueGrowIds = uniqueStrings(sourceGrowIds);
    const uniqueOriginGrowIds = uniqueStrings(originGrowIds);
    const uniqueStrains = uniqueStrings(sourceStrains);

    const finalBatchName =
      safeString(name) ||
      buildProductBatchName({
        productType: meta.key,
        date: normalizedDate,
        lots: enrichedInputs,
      });

    const batchRef = doc(collection(db, "users", userId, "processBatches"));
    const outputLotRef = normalizedOutputCount > 0 ? doc(collection(db, "users", userId, "materialLots")) : null;
    const finalLotName = buildProductLotName({
      batchName: finalBatchName,
      productType: meta.key,
      date: normalizedDate,
    });

    const supplyPlan = await buildRecipeSupplyUsagePlanFromTransaction({
      tx,
      userId,
      recipeItems: costing.recipeItems,
      recipeYield: costing.recipeYield || normalizedOutputCount || 1,
      outputCount: normalizedOutputCount || 1,
    });
    if (supplyPlan.shortages.length > 0) {
      const labels = supplyPlan.shortages
        .slice(0, 4)
        .map((entry) => `${entry.supplyName} (${formatQty(entry.shortageQuantity, entry.unit, getQtyDigitsForUnit(entry.unit))} short)`)
        .join(", ");
      throw new Error(`Not enough supply inventory for this batch: ${labels}.`);
    }
    applyRecipeSupplyUsagePlan({
      tx,
      userId,
      batchId: batchRef.id,
      processType: "production",
      processCategory: "production",
      date: normalizedDate,
      recipeId: costing.recipeId,
      recipeName: costing.recipeName,
      batchName: finalBatchName,
      plan: supplyPlan,
    });

    const normalizedRecipeYield = sanitizePositiveNumber(costing.recipeYield) || 1;
    const recipeBatchCost = sanitizeCurrency(costing.recipeCost);
    const directCostApplied = sanitizeCurrency(costing.directCost);
    const packagingCostApplied = sanitizeCurrency(costing.packagingCost);
    const laborCostApplied = sanitizeCurrency(costing.laborCost);
    const overheadCostApplied = sanitizeCurrency(costing.overheadCost);
    const otherCostApplied = sanitizeCurrency(costing.otherCost);

    const totalBatchCost = roundCurrency(inputMaterialCostTotal + recipeBatchCost + directCostApplied);
    const outputUnitCost =
      normalizedOutputCount > 0 ? roundCurrency(totalBatchCost / normalizedOutputCount) : 0;
    const yieldMetrics = buildYieldMetricsSnapshot({
      expectedQuantity: normalizedExpectedOutputCount,
      expectedUnit: meta.outputUnit,
      actualQuantity: normalizedOutputCount,
      actualUnit: meta.outputUnit,
      wasteQuantity:
        normalizedWasteQuantity > 0
          ? normalizedWasteQuantity
          : normalizedExpectedOutputCount > normalizedOutputCount
          ? sanitizePositiveNumber(normalizedExpectedOutputCount - normalizedOutputCount)
          : 0,
      wasteUnit: normalizedWasteUnit || meta.outputUnit,
      wasteReason: normalizedWasteReason,
      wasteNotes: normalizedWasteNotes,
    });

    const pricing = buildPricingSnapshot({
      unitCost: outputUnitCost,
      quantity: normalizedOutputCount,
      pricePerUnit,
      msrpPerUnit,
      desiredMarginPercent: normalizedDesiredMarginPercent,
    });

    tx.set(batchRef, {
      processType: "production",
      processCategory: "production",
      manufacturingStage: "production",
      name: finalBatchName,
      status: normalizedStatus,
      date: normalizedDate,
      productType: meta.key,
      variant: normalizedVariant,
      method: normalizedMethod,
      notes: normalizedNotes,
      mgPerUnit: normalizedMgPerUnit,
      bottleSize: normalizedBottleSize,
      bottleSizeUnit: normalizedBottleSizeUnit,
      inputLots: enrichedInputs,
      outputLots: outputLotRef
        ? [{
            lotId: outputLotRef.id,
            lotType: meta.lotType,
            name: finalLotName,
            quantity: normalizedOutputCount,
            unit: meta.outputUnit,
          }]
        : [],
      sourceGrowIds: uniqueGrowIds,
      originGrowIds: uniqueOriginGrowIds,
      strains: uniqueStrains,
      inputQuantityTotal: sanitizePositiveNumber(totalInputQuantity),
      expectedOutputCount: normalizedExpectedOutputCount,
      actualOutputCount: normalizedOutputCount,
      outputCount: normalizedOutputCount,
      outputUnit: meta.outputUnit,
      yieldMetrics,
      batchTotalCost: totalBatchCost,
      unitCost: outputUnitCost,
      recipeId: costing.recipeId || null,
      recipeName: costing.recipeName || null,
      recipeYield: normalizedRecipeYield,
      recipeItems: costing.recipeItems,
      recipeCost: recipeBatchCost,
      recipeCostBreakdown: costing.recipeCostBreakdown,
      recipeSupplyUsage: supplyPlan.rows,
      recipeSupplySummary: buildRecipeSupplySummaryFromPlan(supplyPlan),
      packagingCost: packagingCostApplied,
      laborCost: laborCostApplied,
      overheadCost: overheadCostApplied,
      otherCost: otherCostApplied,
      directCost: directCostApplied,
      pricing,
      traceability: buildTraceabilitySnapshot({
        sourceLotIds: enrichedInputs.map((input) => input.lotId),
        derivedLotIds: outputLotRef ? [outputLotRef.id] : [],
        sourceBatchIds: [batchRef.id],
        sourceGrowIds: uniqueGrowIds,
        originGrowIds: uniqueOriginGrowIds,
        operationType: "production",
        processType: "production",
      }),
      costs: {
        inputMaterialCostTotal,
        recipeCost: recipeBatchCost,
        directCost: directCostApplied,
        packagingCost: packagingCostApplied,
        laborCost: laborCostApplied,
        overheadCost: overheadCostApplied,
        otherCost: otherCostApplied,
        batchTotalCost: totalBatchCost,
        unitCost: outputUnitCost,
      },
      outputLotId: outputLotRef?.id || null,
      createdDate: normalizedDate,
      updatedDate: normalizedDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const input of enrichedInputs) {
      const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
      tx.set(movementRef, {
        movementType: "consume_lot",
        lotId: input.lotId,
        batchId: batchRef.id,
        processType: "production",
        direction: "out",
        sourceGrowId: input.sourceGrowId || null,
        sourceType: "batch",
        quantity: input.quantity,
        unit: input.unit || "g",
        date: normalizedDate,
        note: `Consumed by ${meta.label.toLowerCase()} batch ${finalBatchName}.`,
        createdAt: serverTimestamp(),
      });
    }

    if (outputLotRef) {
      tx.set(outputLotRef, {
        lotType: meta.lotType,
        inventoryCategory: "finished_goods",
        processType: "production",
        processCategory: "production",
        manufacturingStage: "production",
        status: "available",
        sourceType: "batch",
        sourceBatchId: batchRef.id,
        sourceGrowIds: uniqueGrowIds,
        originGrowIds: uniqueOriginGrowIds,
        name: finalLotName,
        batchName: finalBatchName,
        productType: meta.key,
        variant: normalizedVariant,
        method: normalizedMethod,
        strain: uniqueStrains.join(", "),
        unit: meta.outputUnit,
        initialQuantity: normalizedOutputCount,
        allocatedQuantity: 0,
        remainingQuantity: normalizedOutputCount,
        yieldMetrics,
        mgPerUnit: normalizedMgPerUnit,
        bottleSize: normalizedBottleSize,
        bottleSizeUnit: normalizedBottleSizeUnit,
        pricing,
        unitCost: outputUnitCost,
        costPerUnit: outputUnitCost,
        batchTotalCost: totalBatchCost,
        inputMaterialCostTotal,
        recipeId: costing.recipeId || null,
        recipeName: costing.recipeName || null,
        recipeYield: normalizedRecipeYield,
        recipeItems: costing.recipeItems,
        recipeCost: recipeBatchCost,
        recipeCostBreakdown: costing.recipeCostBreakdown,
        recipeSupplyUsage: supplyPlan.rows,
        recipeSupplySummary: buildRecipeSupplySummaryFromPlan(supplyPlan),
        packagingCost: packagingCostApplied,
        laborCost: laborCostApplied,
        overheadCost: overheadCostApplied,
        otherCost: otherCostApplied,
        directCost: directCostApplied,
        traceability: buildTraceabilitySnapshot({
          sourceLotIds: enrichedInputs.map((input) => input.lotId),
          sourceBatchIds: [batchRef.id],
          sourceGrowIds: uniqueGrowIds,
          originGrowIds: uniqueOriginGrowIds,
          rootLotId: outputLotRef.id,
          operationType: "production_output",
          processType: "production",
        }),
        costs: {
          inputMaterialCostTotal,
          recipeCost: recipeBatchCost,
          directCost: directCostApplied,
          packagingCost: packagingCostApplied,
          laborCost: laborCostApplied,
          overheadCost: overheadCostApplied,
          otherCost: otherCostApplied,
          batchTotalCost: totalBatchCost,
          unitCost: outputUnitCost,
        },
        notes: normalizedNotes,
        createdDate: normalizedDate,
        updatedDate: normalizedDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
      tx.set(movementRef, {
        movementType: "produce_lot",
        lotId: outputLotRef.id,
        batchId: batchRef.id,
        processType: "production",
        direction: "in",
        sourceGrowId: uniqueGrowIds[0] || null,
        sourceType: "batch",
        quantity: normalizedOutputCount,
        unit: meta.outputUnit,
        date: normalizedDate,
        note: `${meta.label} lot created from production batch ${finalBatchName}.`,
        createdAt: serverTimestamp(),
      });
    }

    return {
      created: true,
      batchId: batchRef.id,
      outputLotId: outputLotRef?.id || null,
      name: finalBatchName,
    };
  });
}

export async function recordFinishedInventoryMovement({
  userId,
  lotId,
  movementType,
  quantity,
  date,
  note,
  revenue,
  pricePerUnit,
  counterparty,
  destinationType,
  destinationName,
  destinationLocation,
  referenceType,
  referenceId,
  reason,
}) {
  if (!userId) throw new Error("Missing user.");
  if (!lotId) throw new Error("Missing lot.");
  const normalizedQuantity = sanitizePositiveNumber(quantity);
  if (normalizedQuantity <= 0) {
    throw new Error("Enter a quantity greater than zero.");
  }

  const normalizedDate = date || toLocalYYYYMMDD(new Date());
  const normalizedNote = safeString(note);
  const normalizedType = normalizeFinishedMovementType(movementType);
  const normalizedCounterparty = safeString(counterparty);
  const normalizedDestinationType = safeString(destinationType);
  const normalizedDestinationName = safeString(destinationName) || normalizedCounterparty;
  const normalizedDestinationLocation = safeString(destinationLocation);
  const normalizedReferenceType = safeString(referenceType);
  const normalizedReferenceId = safeString(referenceId);
  const normalizedReason = safeString(reason);

  return runTransaction(db, async (tx) => {
    const lotRef = doc(db, "users", userId, "materialLots", lotId);
    const lotSnap = await tx.get(lotRef);
    if (!lotSnap.exists()) throw new Error("Finished inventory lot could not be found.");

    const lot = lotSnap.data() || {};
    if (!isFinishedGoodsLot(lot)) {
      throw new Error("Only finished inventory lots can be sold, donated, sampled, or wasted.");
    }

    const remaining = lotRemaining(lot);
    const available = getLotAvailableQuantity(lot);
    if (normalizedQuantity > available) {
      throw new Error(`${lot?.name || lotId} only has ${formatQty(available, lot?.unit || "count", 0)} available after reservations.`);
    }

    const nextRemaining = sanitizePositiveNumber(remaining - normalizedQuantity);
    const nextStatus = nextLotStatus(nextRemaining, lotInitial(lot));

    const resolvedPricePerUnit =
      sanitizeCurrency(pricePerUnit) > 0
        ? sanitizeCurrency(pricePerUnit)
        : sanitizeCurrency(valueOrFallback(lot?.pricing?.pricePerUnit, lot?.pricePerUnit));

    const resolvedRevenue =
      normalizedType === "sell"
        ? roundCurrency(
            sanitizeCurrency(revenue) > 0
              ? sanitizeCurrency(revenue)
              : resolvedPricePerUnit * normalizedQuantity
          )
        : 0;

    const outboundSummary = buildOutboundSnapshot(
      lot?.outboundSummary || {},
      normalizedType,
      "out",
      normalizedQuantity,
      resolvedRevenue
    );

    tx.update(lotRef, {
      remainingQuantity: nextRemaining,
      status: nextStatus,
      outboundSummary,
      updatedDate: normalizedDate,
      updatedAt: serverTimestamp(),
    });

    const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
    tx.set(movementRef, {
      movementType: normalizedType,
      lotId,
      processType: "finished_inventory",
      direction: "out",
      sourceGrowId: (Array.isArray(lot?.sourceGrowIds) ? lot.sourceGrowIds : [])[0] || null,
      sourceType: "lot",
      quantity: normalizedQuantity,
      unit: lot?.unit || "count",
      date: normalizedDate,
      revenue: resolvedRevenue,
      pricePerUnit: resolvedPricePerUnit,
      destinationType: normalizedDestinationType || null,
      destinationName: normalizedDestinationName || null,
      destinationLocation: normalizedDestinationLocation || null,
      referenceType: normalizedReferenceType || null,
      referenceId: normalizedReferenceId || null,
      reason: normalizedReason || null,
      counterparty: normalizedCounterparty || normalizedDestinationName || null,
      note:
        normalizedNote ||
        `${movementLabel(normalizedType)} ${formatQty(normalizedQuantity, lot?.unit || "count", 0)} from ${lot?.name || lotId}.`,
      createdAt: serverTimestamp(),
    });

    return {
      success: true,
      lotId,
      remainingQuantity: nextRemaining,
      status: nextStatus,
    };
  });
}


function normalizeIngredientLinesForPostProcess(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => safeString(entry)).filter(Boolean);
  }
  return safeString(value)
    .split(/\r?\n|,/)
    .map((entry) => safeString(entry))
    .filter(Boolean);
}

function getQtyDigitsForUnit(unit = "") {
  const normalized = safeString(unit).toLowerCase();
  return normalized === "count" || normalized === "piece" || normalized === "capsule" || normalized === "bottle" ? 0 : 2;
}

function isReusableSupplyRecord(supply = {}) {
  const type = safeString(supply?.type).toLowerCase();
  const unit = safeString(supply?.unit).toLowerCase();
  return (type === "container" || type === "tool") && (unit === "count" || unit === "piece");
}

function shouldConsumeSupplyInventory(supply = {}) {
  const type = safeString(supply?.type).toLowerCase();
  if (type === "labor") return false;
  if (isReusableSupplyRecord(supply)) return false;
  return true;
}

function normalizeScaledSupplyAmount(amount = 0, unit = "") {
  const normalized = sanitizePositiveNumber(amount);
  const digits = getQtyDigitsForUnit(unit);
  return digits === 0 ? Math.ceil(normalized) : roundNumber(normalized, 3);
}

function buildRecipeSupplySummaryFromPlan(plan = {}) {
  const rows = safeArray(plan?.rows);
  const byType = {};
  rows.forEach((row) => {
    const key = safeString(row?.supplyType || "other") || "other";
    if (!byType[key]) {
      byType[key] = { supplyType: key, quantity: 0, totalCost: 0, consumedFromInventory: 0 };
    }
    byType[key].quantity = roundNumber(byType[key].quantity + sanitizePositiveNumber(row?.requiredQuantity), 3);
    byType[key].totalCost = roundCurrency(byType[key].totalCost + sanitizeCurrency(row?.totalCost));
    if (row?.consumeFromInventory) byType[key].consumedFromInventory += 1;
  });
  return {
    rowCount: rows.length,
    consumedRowCount: rows.filter((row) => row?.consumeFromInventory).length,
    shortageCount: safeArray(plan?.shortages).length,
    totalRequiredCost: sanitizeCurrency(plan?.totalRequiredCost),
    totalConsumedCost: sanitizeCurrency(plan?.totalConsumedCost),
    packagingRequiredQuantity: sanitizePositiveNumber(plan?.packagingRequiredQuantity),
    packagingConsumedCost: sanitizeCurrency(plan?.packagingConsumedCost),
    byType: Object.values(byType).sort((a, b) => b.totalCost - a.totalCost),
  };
}

async function buildRecipeSupplyUsagePlanFromTransaction({
  tx,
  userId,
  recipeItems = [],
  recipeYield = 1,
  outputCount = 1,
}) {
  const normalizedItems = safeArray(recipeItems).filter((item) => safeString(item?.supplyId));
  const normalizedYield = sanitizePositiveNumber(recipeYield) || 1;
  const normalizedOutputCount = sanitizePositiveNumber(outputCount) || normalizedYield;
  const factor = normalizedOutputCount > 0 ? normalizedOutputCount / normalizedYield : 1;
  const rows = [];
  const shortages = [];
  const supplyCache = new Map();
  let totalRequiredCost = 0;
  let totalConsumedCost = 0;
  let packagingRequiredQuantity = 0;
  let packagingConsumedCost = 0;

  for (const item of normalizedItems) {
    const supplyId = safeString(item?.supplyId);
    if (!supplyId) continue;
    let entry = supplyCache.get(supplyId);
    if (!entry) {
      const ref = doc(db, "users", userId, "supplies", supplyId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(`Supply ${supplyId} could not be found for recipe inventory usage.`);
      entry = { ref, snap, supply: { id: snap.id, ...snap.data() } };
      supplyCache.set(supplyId, entry);
    }

    const supply = entry.supply || {};
    const unit = safeString(supply?.unit || item?.unit) || "count";
    const requiredQuantity = normalizeScaledSupplyAmount((Number(item?.amount || 0) || 0) * factor, unit);
    const onHand = sanitizePositiveNumber(valueOrFallback(supply?.quantity, supply?.qty, supply?.q));
    const consumeFromInventory = shouldConsumeSupplyInventory(supply) && requiredQuantity > 0;
    const shortageQuantity = consumeFromInventory ? sanitizePositiveNumber(requiredQuantity - onHand) : 0;
    const unitCost = sanitizeCurrency(valueOrFallback(supply?.cost, item?.cost));
    const totalCost = roundCurrency(unitCost * requiredQuantity);
    const supplyType = safeString(supply?.type || item?.type || "other") || "other";

    if (shortageQuantity > 0) {
      shortages.push({
        supplyId,
        supplyName: safeString(supply?.name) || supplyId,
        supplyType,
        requiredQuantity,
        onHand,
        shortageQuantity,
        unit,
      });
    }

    if (supplyType === "packaging") {
      packagingRequiredQuantity = roundNumber(packagingRequiredQuantity + requiredQuantity, 3);
      packagingConsumedCost = roundCurrency(packagingConsumedCost + totalCost);
    }

    totalRequiredCost = roundCurrency(totalRequiredCost + totalCost);
    if (consumeFromInventory) totalConsumedCost = roundCurrency(totalConsumedCost + totalCost);

    rows.push({
      supplyId,
      supplyName: safeString(supply?.name) || supplyId,
      supplyType,
      unit,
      requiredQuantity,
      onHand,
      shortageQuantity,
      factor: roundNumber(factor, 4),
      unitCost,
      totalCost,
      consumeFromInventory,
      reusable: isReusableSupplyRecord(supply),
    });
  }

  return { rows, shortages, factor: roundNumber(factor, 4), totalRequiredCost, totalConsumedCost, packagingRequiredQuantity, packagingConsumedCost };
}

function applyRecipeSupplyUsagePlan({
  tx,
  userId,
  batchId,
  processType,
  processCategory,
  date,
  recipeId,
  recipeName,
  batchName,
  plan,
}) {
  safeArray(plan?.rows)
    .filter((row) => row?.consumeFromInventory && sanitizePositiveNumber(row?.requiredQuantity) > 0)
    .forEach((row) => {
      const supplyRef = doc(db, "users", userId, "supplies", row.supplyId);
      tx.update(supplyRef, {
        quantity: sanitizePositiveNumber(row.onHand - row.requiredQuantity),
        lastUpdatedAt: serverTimestamp(),
      });

      const auditRef = doc(collection(db, "users", userId, "supply_audits"));
      tx.set(auditRef, {
        supplyId: row.supplyId,
        supplyName: row.supplyName,
        action: "consume",
        amount: row.requiredQuantity,
        unit: row.unit,
        unitCostApplied: row.unitCost,
        totalCostApplied: row.totalCost,
        recipeId: safeString(recipeId) || null,
        recipeName: safeString(recipeName) || null,
        batchId: safeString(batchId) || null,
        processType: safeString(processType) || null,
        processCategory: safeString(processCategory) || null,
        note: `${batchName || processType || "post process"} recipe supply consumption`,
        timestamp: safeString(date) || toLocalYYYYMMDD(new Date()),
        createdAt: serverTimestamp(),
      });
    });
}

export function buildSupplyRequirementSnapshot({
  recipeItems = [],
  recipeYield = 1,
  outputCount = 1,
  supplies = [],
}) {
  const supplyMap = new Map(safeArray(supplies).map((supply) => [safeString(supply?.id), supply]));
  const normalizedYield = sanitizePositiveNumber(recipeYield) || 1;
  const normalizedOutputCount = sanitizePositiveNumber(outputCount) || normalizedYield;
  const factor = normalizedOutputCount > 0 ? normalizedOutputCount / normalizedYield : 1;
  const rows = safeArray(recipeItems)
    .map((item) => {
      const supplyId = safeString(item?.supplyId);
      if (!supplyId) return null;
      const supply = supplyMap.get(supplyId) || {};
      const unit = safeString(supply?.unit || item?.unit) || "count";
      const requiredQuantity = normalizeScaledSupplyAmount((Number(item?.amount || 0) || 0) * factor, unit);
      const onHand = sanitizePositiveNumber(valueOrFallback(supply?.quantity, supply?.qty, supply?.q));
      const consumeFromInventory = shouldConsumeSupplyInventory(supply) && requiredQuantity > 0;
      const shortageQuantity = consumeFromInventory ? sanitizePositiveNumber(requiredQuantity - onHand) : 0;
      const unitCost = sanitizeCurrency(valueOrFallback(supply?.cost, item?.cost));
      const totalCost = roundCurrency(unitCost * requiredQuantity);
      return {
        supplyId,
        supplyName: safeString(supply?.name) || supplyId,
        supplyType: safeString(supply?.type || item?.type || "other") || "other",
        unit,
        requiredQuantity,
        onHand,
        shortageQuantity,
        factor: roundNumber(factor, 4),
        unitCost,
        totalCost,
        consumeFromInventory,
        reusable: isReusableSupplyRecord(supply),
      };
    })
    .filter(Boolean);
  const shortages = rows.filter((row) => row.shortageQuantity > 0);
  return {
    factor: roundNumber(factor, 4),
    rows,
    shortages,
    blockingShortages: shortages.filter((row) => row.consumeFromInventory),
    totalRequiredCost: roundCurrency(rows.reduce((sum, row) => sum + sanitizeCurrency(row.totalCost), 0)),
    totalConsumedCost: roundCurrency(rows.filter((row) => row.consumeFromInventory).reduce((sum, row) => sum + sanitizeCurrency(row.totalCost), 0)),
    packagingRows: rows.filter((row) => row.supplyType === "packaging"),
  };
}
export function getYieldMetrics(record = {}) {
  if (!record || typeof record !== "object") return null;

  const nested = record?.yieldMetrics && typeof record.yieldMetrics === "object" ? record.yieldMetrics : {};

  return buildYieldMetricsSnapshot({
    expectedQuantity: valueOrFallback(
      nested?.expectedQuantity,
      record?.expectedOutputAmount,
      record?.expectedOutputCount,
      record?.plannedOutputAmount,
      record?.plannedOutputCount,
      record?.targetOutputAmount,
      record?.targetOutputCount,
      record?.outputAmount,
      record?.outputCount
    ),
    expectedUnit: valueOrFallback(
      nested?.expectedUnit,
      record?.expectedOutputUnit,
      record?.plannedOutputUnit,
      record?.targetOutputUnit,
      record?.outputUnit,
      record?.unit
    ),
    actualQuantity: valueOrFallback(
      nested?.actualQuantity,
      record?.actualOutputAmount,
      record?.actualOutputCount,
      record?.outputAmount,
      record?.outputCount
    ),
    actualUnit: valueOrFallback(
      nested?.actualUnit,
      record?.actualOutputUnit,
      record?.outputUnit,
      record?.unit
    ),
    wasteQuantity: valueOrFallback(
      nested?.wasteQuantity,
      record?.wasteQuantity,
      record?.shrinkQuantity,
      record?.lossQuantity
    ),
    wasteUnit: valueOrFallback(
      nested?.wasteUnit,
      record?.wasteUnit,
      record?.shrinkUnit,
      record?.lossUnit,
      record?.outputUnit,
      record?.unit
    ),
    wasteReason: valueOrFallback(
      nested?.wasteReason,
      record?.wasteReason,
      record?.shrinkReason,
      record?.lossReason
    ),
    wasteNotes: valueOrFallback(
      nested?.wasteNotes,
      record?.wasteNotes,
      record?.shrinkNotes,
      record?.lossNotes
    ),
    varianceQuantity: valueOrFallback(
      nested?.varianceQuantity,
      record?.outputVarianceAmount,
      record?.varianceAmount
    ),
    variancePercent: valueOrFallback(
      nested?.variancePercent,
      record?.outputVariancePercent,
      record?.variancePercent
    ),
  });
}

function buildTraceabilitySnapshot({
  sourceLotIds = [],
  derivedLotIds = [],
  sourceBatchIds = [],
  outputBatchIds = [],
  sourceGrowIds = [],
  originGrowIds = [],
  parentLotId = "",
  rootLotId = "",
  operationType = "",
  processType = "",
} = {}) {
  const snapshot = {
    sourceLotIds: uniqueStrings(sourceLotIds),
    derivedLotIds: uniqueStrings(derivedLotIds),
    sourceBatchIds: uniqueStrings(sourceBatchIds),
    outputBatchIds: uniqueStrings(outputBatchIds),
    sourceGrowIds: uniqueStrings(sourceGrowIds),
    originGrowIds: uniqueStrings(originGrowIds),
    parentLotId: safeString(parentLotId),
    rootLotId: safeString(rootLotId),
    operationType: safeString(operationType),
    processType: safeString(processType),
  };

  if (
    snapshot.sourceLotIds.length === 0 &&
    snapshot.derivedLotIds.length === 0 &&
    snapshot.sourceBatchIds.length === 0 &&
    snapshot.outputBatchIds.length === 0 &&
    snapshot.sourceGrowIds.length === 0 &&
    snapshot.originGrowIds.length === 0 &&
    !snapshot.parentLotId &&
    !snapshot.rootLotId &&
    !snapshot.operationType &&
    !snapshot.processType
  ) {
    return null;
  }

  return snapshot;
}

export function getTraceabilitySnapshot(record = {}) {
  if (!record || typeof record !== "object") return null;

  const nested = record?.traceability && typeof record.traceability === "object" ? record.traceability : {};
  const inputLots = safeArray(record?.inputLots).map((item) => item?.lotId).filter(Boolean);
  const outputLots = safeArray(record?.outputLots).map((item) => item?.lotId).filter(Boolean);
  const mergedLots = safeArray(record?.mergedFromLots).map((item) => item?.lotId).filter(Boolean);

  const snapshot = buildTraceabilitySnapshot({
    sourceLotIds: [
      ...safeArray(nested?.sourceLotIds),
      ...safeArray(record?.sourceLotIds),
      record?.sourceLotId,
      record?.splitFromLotId,
      record?.mergedIntoLotId,
      ...safeArray(record?.derivedFromLotIds),
      ...inputLots,
      ...mergedLots,
    ],
    derivedLotIds: [
      ...safeArray(nested?.derivedLotIds),
      ...outputLots,
      record?.outputLotId,
      record?.relatedLotId,
      record?.childLotId,
      record?.mergedLotId,
    ],
    sourceBatchIds: [
      ...safeArray(nested?.sourceBatchIds),
      record?.sourceBatchId,
      record?.batchId,
      record?.relatedBatchId,
      ...safeArray(record?.upstreamBatchIds),
    ],
    outputBatchIds: [
      ...safeArray(nested?.outputBatchIds),
      record?.outputBatchId,
      ...safeArray(record?.downstreamBatchIds),
    ],
    sourceGrowIds: [
      ...safeArray(nested?.sourceGrowIds),
      ...safeArray(record?.sourceGrowIds),
      record?.sourceGrowId,
    ],
    originGrowIds: [
      ...safeArray(nested?.originGrowIds),
      ...safeArray(record?.originGrowIds),
    ],
    parentLotId: valueOrFallback(
      nested?.parentLotId,
      record?.parentLotId,
      record?.sourceLotId,
      record?.splitFromLotId
    ),
    rootLotId: valueOrFallback(
      nested?.rootLotId,
      record?.rootLotId,
      record?.parentLotId,
      record?.sourceLotId,
      record?.splitFromLotId
    ),
    operationType: valueOrFallback(
      nested?.operationType,
      record?.derivedFromOperation,
      record?.movementType
    ),
    processType: valueOrFallback(nested?.processType, record?.processType, record?.processCategory),
  });

  if (!snapshot) return null;

  const lineageLotIds = uniqueStrings([
    ...snapshot.sourceLotIds,
    ...snapshot.derivedLotIds,
    snapshot.parentLotId,
    snapshot.rootLotId,
  ]);

  const lineageBatchIds = uniqueStrings([
    ...snapshot.sourceBatchIds,
    ...snapshot.outputBatchIds,
  ]);

  return {
    ...snapshot,
    lineageLotIds,
    lineageBatchIds,
    sourceLotCount: snapshot.sourceLotIds.length,
    derivedLotCount: snapshot.derivedLotIds.length,
    sourceBatchCount: snapshot.sourceBatchIds.length,
    outputBatchCount: snapshot.outputBatchIds.length,
    originGrowCount: snapshot.originGrowIds.length,
    hasLineage: lineageLotIds.length > 0 || lineageBatchIds.length > 0,
  };
}

export function buildProductionPlanningSnapshot({
  sourceLots = [],
  requestedInputs = [],
  targetOutputQuantity = 0,
  outputUnit = "",
} = {}) {
  const activeLots = safeArray(sourceLots).filter((lot) => isActiveMaterialLot(lot));
  const requested = safeArray(requestedInputs)
    .map((item) => ({
      lotId: safeString(item?.lotId),
      quantity: sanitizePositiveNumber(item?.quantity),
    }))
    .filter((item) => item.lotId && item.quantity > 0);

  const availableByUnitMap = {};
  activeLots.forEach((lot) => {
    const unit = safeString(lot?.unit) || "units";
    const availableQuantity = roundNumber(getLotAvailableQuantity(lot), 3);
    availableByUnitMap[unit] = roundNumber((availableByUnitMap[unit] || 0) + availableQuantity, 3);
  });

  const requestedDetailed = requested.map((item) => {
    const lot = activeLots.find((entry) => entry?.id === item.lotId);
    const availableQuantity = lot ? getLotAvailableQuantity(lot) : 0;
    const shortageQuantity = sanitizePositiveNumber(item.quantity - availableQuantity);
    const unit = safeString(lot?.unit) || "units";
    const coveragePercent =
      item.quantity > 0
        ? roundNumber((Math.min(item.quantity, availableQuantity) / item.quantity) * 100, 2)
        : 0;

    return {
      lotId: item.lotId,
      lotName: lot?.name || item.lotId,
      requestedQuantity: item.quantity,
      availableQuantity,
      shortageQuantity,
      coveragePercent,
      unit,
      lotType: lot?.lotType || "",
      strain: lot?.strain || lot?.variant || "",
      status: lot ? getLotStatus(lot) : "missing",
    };
  });

  const requestedByUnitMap = {};
  requestedDetailed.forEach((entry) => {
    requestedByUnitMap[entry.unit] = roundNumber(
      (requestedByUnitMap[entry.unit] || 0) + entry.requestedQuantity,
      3
    );
  });

  const requestedByUnit = Object.entries(requestedByUnitMap).map(([unit, requestedQuantity]) => {
    const availableQuantity = roundNumber(availableByUnitMap[unit] || 0, 3);
    const shortageQuantity = sanitizePositiveNumber(requestedQuantity - availableQuantity);
    const coveragePercent =
      requestedQuantity > 0
        ? roundNumber((Math.min(requestedQuantity, availableQuantity) / requestedQuantity) * 100, 2)
        : 0;

    return {
      unit,
      requestedQuantity,
      availableQuantity,
      shortageQuantity,
      coveragePercent,
    };
  });

  const shortages = requestedDetailed.filter((entry) => entry.shortageQuantity > 0);

  const totalRequestedQuantity = roundNumber(
    requested.reduce((sum, entry) => sum + sanitizePositiveNumber(entry.quantity), 0),
    3
  );
  const totalAvailableQuantity = roundNumber(
    activeLots.reduce((sum, lot) => sum + getLotAvailableQuantity(lot), 0),
    3
  );
  const totalAvailableForRequestedUnits = roundNumber(
    requestedByUnit.reduce((sum, entry) => sum + Math.min(entry.availableQuantity, entry.requestedQuantity), 0),
    3
  );

  const coveragePercent =
    totalRequestedQuantity > 0
      ? roundNumber((totalAvailableForRequestedUnits / totalRequestedQuantity) * 100, 2)
      : 0;

  let maxBatchMultiplier = 0;
  if (requestedDetailed.length > 0) {
    const ratios = requestedDetailed
      .map((entry) => (entry.requestedQuantity > 0 ? entry.availableQuantity / entry.requestedQuantity : null))
      .filter((value) => Number.isFinite(value));
    maxBatchMultiplier = ratios.length ? roundNumber(Math.min(...ratios), 3) : 0;
  }

  const normalizedTargetOutputQuantity = sanitizePositiveNumber(targetOutputQuantity);
  const estimatedMaxOutputQuantity =
    normalizedTargetOutputQuantity > 0
      ? roundNumber(normalizedTargetOutputQuantity * maxBatchMultiplier, 3)
      : 0;

  return {
    targetOutputQuantity: normalizedTargetOutputQuantity,
    outputUnit: safeString(outputUnit),
    totalRequestedQuantity,
    totalAvailableQuantity,
    totalAvailableForRequestedUnits,
    availableByUnit: Object.entries(availableByUnitMap).map(([unit, quantity]) => ({
      unit,
      quantity,
    })),
    requestedByUnit,
    requestedLots: requestedDetailed,
    shortages,
    canStartBatch: shortages.length === 0,
    coveragePercent,
    maxBatchMultiplier,
    estimatedMaxOutputQuantity,
    limitingLots: requestedDetailed.filter((entry) => {
      if (!(entry.requestedQuantity > 0) || maxBatchMultiplier <= 0) return false;
      return Math.abs(entry.availableQuantity / entry.requestedQuantity - maxBatchMultiplier) < 0.0005;
    }),
  };
}

export function buildFinishedInventoryValuationSnapshot(lots = []) {
  const activeLots = safeArray(lots).filter((lot) => isFinishedGoodsLot(lot) && isActiveMaterialLot(lot));
  const categories = {};
  let totalUnits = 0;
  let totalCostValue = 0;
  let totalProjectedRevenue = 0;
  let totalProjectedProfit = 0;

  activeLots.forEach((lot) => {
    const category = getFinishedInventoryCategory(lot) || "other";
    const availableQuantity = sanitizePositiveNumber(getLotAvailableQuantity(lot));
    const unitCost = getLotUnitCost(lot);
    const pricing = buildPricingSnapshot({
      unitCost,
      quantity: availableQuantity,
      pricePerUnit: valueOrFallback(lot?.pricePerUnit, lot?.pricing?.pricePerUnit),
      msrpPerUnit: valueOrFallback(lot?.msrpPerUnit, lot?.pricing?.suggestedMsrpPerUnit),
    });

    if (!categories[category]) {
      categories[category] = {
        category,
        lotCount: 0,
        units: 0,
        costValue: 0,
        projectedRevenue: 0,
        projectedProfit: 0,
      };
    }

    categories[category].lotCount += 1;
    categories[category].units = roundNumber(categories[category].units + availableQuantity, 3);
    categories[category].costValue = roundCurrency(categories[category].costValue + unitCost * availableQuantity);
    categories[category].projectedRevenue = roundCurrency(
      categories[category].projectedRevenue + pricing.projectedRevenue
    );
    categories[category].projectedProfit = roundCurrency(
      categories[category].projectedProfit + pricing.projectedProfit
    );

    totalUnits = roundNumber(totalUnits + availableQuantity, 3);
    totalCostValue = roundCurrency(totalCostValue + unitCost * availableQuantity);
    totalProjectedRevenue = roundCurrency(totalProjectedRevenue + pricing.projectedRevenue);
    totalProjectedProfit = roundCurrency(totalProjectedProfit + pricing.projectedProfit);
  });

  return {
    lotCount: activeLots.length,
    totalUnits,
    totalCostValue,
    totalProjectedRevenue,
    totalProjectedProfit,
    byCategory: Object.values(categories).sort((a, b) => b.projectedRevenue - a.projectedRevenue),
  };
}

export function buildFinishedInventorySalesSnapshot({
  lots = [],
  movements = [],
} = {}) {
  const finishedLots = safeArray(lots).filter((lot) => isFinishedGoodsLot(lot));
  const finishedLotIdSet = new Set(finishedLots.map((lot) => safeString(lot?.id)).filter(Boolean));
  const relevantMovements = safeArray(movements).filter((movement) => finishedLotIdSet.has(safeString(movement?.lotId)));

  const totals = {
    soldUnits: 0,
    donatedUnits: 0,
    sampledUnits: 0,
    wastedUnits: 0,
    adjustedInUnits: 0,
    adjustedOutUnits: 0,
    realizedRevenue: 0,
    projectedRevenue: 0,
    projectedProfit: 0,
  };

  const byDestination = {};
  relevantMovements.forEach((movement) => {
    const movementType = normalizeFinishedMovementType(movement?.movementType);
    const direction = safeString(movement?.direction).toLowerCase() || "out";
    const quantity = sanitizePositiveNumber(movement?.quantity);
    const revenue = sanitizeCurrency(valueOrFallback(movement?.totalValue, movement?.revenue));
    const destinationKey = safeString(
      valueOrFallback(movement?.destinationName, movement?.counterparty, movement?.destinationType, "Unspecified")
    );

    if (!byDestination[destinationKey]) {
      byDestination[destinationKey] = {
        destination: destinationKey,
        soldUnits: 0,
        donatedUnits: 0,
        sampledUnits: 0,
        wastedUnits: 0,
        adjustedInUnits: 0,
        adjustedOutUnits: 0,
        realizedRevenue: 0,
      };
    }

    if (movementType === "sell" && direction === "out") {
      totals.soldUnits = roundNumber(totals.soldUnits + quantity, 3);
      totals.realizedRevenue = roundCurrency(totals.realizedRevenue + revenue);
      byDestination[destinationKey].soldUnits = roundNumber(byDestination[destinationKey].soldUnits + quantity, 3);
      byDestination[destinationKey].realizedRevenue = roundCurrency(byDestination[destinationKey].realizedRevenue + revenue);
    } else if (movementType === "donate" && direction === "out") {
      totals.donatedUnits = roundNumber(totals.donatedUnits + quantity, 3);
      byDestination[destinationKey].donatedUnits = roundNumber(byDestination[destinationKey].donatedUnits + quantity, 3);
    } else if (movementType === "sample" && direction === "out") {
      totals.sampledUnits = roundNumber(totals.sampledUnits + quantity, 3);
      byDestination[destinationKey].sampledUnits = roundNumber(byDestination[destinationKey].sampledUnits + quantity, 3);
    } else if (movementType === "waste" && direction === "out") {
      totals.wastedUnits = roundNumber(totals.wastedUnits + quantity, 3);
      byDestination[destinationKey].wastedUnits = roundNumber(byDestination[destinationKey].wastedUnits + quantity, 3);
    } else if (direction === "in") {
      totals.adjustedInUnits = roundNumber(totals.adjustedInUnits + quantity, 3);
      byDestination[destinationKey].adjustedInUnits = roundNumber(byDestination[destinationKey].adjustedInUnits + quantity, 3);
    } else {
      totals.adjustedOutUnits = roundNumber(totals.adjustedOutUnits + quantity, 3);
      byDestination[destinationKey].adjustedOutUnits = roundNumber(byDestination[destinationKey].adjustedOutUnits + quantity, 3);
    }
  });

  const valuation = buildFinishedInventoryValuationSnapshot(finishedLots);
  totals.projectedRevenue = valuation.totalProjectedRevenue;
  totals.projectedProfit = valuation.totalProjectedProfit;

  return {
    ...totals,
    byDestination: Object.values(byDestination).sort((a, b) => b.realizedRevenue - a.realizedRevenue),
    valuation,
  };
}

export function buildPostProcessReportRows({
  materialLots = [],
  processBatches = [],
  movements = [],
} = {}) {
  const rows = [];

  safeArray(materialLots).forEach((lot) => {
    const yieldMetrics = getYieldMetrics(lot);
    const traceability = getTraceabilitySnapshot(lot);
    rows.push({
      recordType: "lot",
      id: safeString(lot?.id),
      name: safeString(lot?.name),
      lotType: safeString(lot?.lotType),
      status: getLotStatus(lot),
      archived: isArchivedOrDepletedMaterialLot(lot),
      availableQuantity: sanitizePositiveNumber(getLotAvailableQuantity(lot)),
      reservedQuantity: sanitizePositiveNumber(getLotReservedQuantity(lot)),
      unit: safeString(lot?.unit),
      unitCost: getLotUnitCost(lot),
      batchTotalCost: sanitizeCurrency(valueOrFallback(lot?.batchTotalCost, lot?.costs?.batchTotalCost)),
      expectedQuantity: yieldMetrics?.expectedQuantity || 0,
      actualQuantity: yieldMetrics?.actualQuantity || 0,
      wasteQuantity: yieldMetrics?.wasteQuantity || 0,
      varianceQuantity: yieldMetrics?.varianceQuantity || 0,
      variancePercent: yieldMetrics?.variancePercent || 0,
      sourceLotIds: safeArray(traceability?.sourceLotIds).join(", "),
      derivedLotIds: safeArray(traceability?.derivedLotIds).join(", "),
      sourceBatchIds: safeArray(traceability?.sourceBatchIds).join(", "),
      outputBatchIds: safeArray(traceability?.outputBatchIds).join(", "),
      sourceGrowIds: safeArray(traceability?.sourceGrowIds).join(", "),
      originGrowIds: safeArray(traceability?.originGrowIds).join(", "),
      createdDate: safeString(lot?.createdDate),
      updatedDate: safeString(lot?.updatedDate),
    });
  });

  safeArray(processBatches).forEach((batch) => {
    const yieldMetrics = getYieldMetrics(batch);
    const traceability = getTraceabilitySnapshot(batch);
    rows.push({
      recordType: "batch",
      id: safeString(batch?.id),
      name: safeString(batch?.name),
      processType: safeString(batch?.processType),
      status: getProcessBatchStatus(batch),
      archived: isArchivedProcessBatch(batch),
      expectedQuantity: yieldMetrics?.expectedQuantity || 0,
      actualQuantity: yieldMetrics?.actualQuantity || 0,
      wasteQuantity: yieldMetrics?.wasteQuantity || 0,
      varianceQuantity: yieldMetrics?.varianceQuantity || 0,
      variancePercent: yieldMetrics?.variancePercent || 0,
      outputUnit: safeString(valueOrFallback(batch?.outputUnit, yieldMetrics?.actualUnit, yieldMetrics?.expectedUnit)),
      batchTotalCost: sanitizeCurrency(valueOrFallback(batch?.batchTotalCost, batch?.costs?.batchTotalCost)),
      sourceLotIds: safeArray(traceability?.sourceLotIds).join(", "),
      derivedLotIds: safeArray(traceability?.derivedLotIds).join(", "),
      sourceBatchIds: safeArray(traceability?.sourceBatchIds).join(", "),
      outputBatchIds: safeArray(traceability?.outputBatchIds).join(", "),
      sourceGrowIds: safeArray(traceability?.sourceGrowIds).join(", "),
      originGrowIds: safeArray(traceability?.originGrowIds).join(", "),
      createdDate: safeString(batch?.createdDate),
      updatedDate: safeString(batch?.updatedDate),
      date: safeString(batch?.date),
    });
  });

  safeArray(movements).forEach((movement) => {
    rows.push({
      recordType: "movement",
      id: safeString(movement?.id),
      movementType: safeString(movement?.movementType),
      processType: safeString(movement?.processType),
      processCategory: safeString(movement?.processCategory),
      direction: safeString(movement?.direction),
      lotId: safeString(movement?.lotId),
      relatedLotId: safeString(movement?.relatedLotId),
      batchId: safeString(movement?.batchId),
      operationId: safeString(movement?.operationId),
      destinationType: safeString(movement?.destinationType),
      destinationName: safeString(valueOrFallback(movement?.destinationName, movement?.counterparty)),
      quantity: sanitizePositiveNumber(movement?.quantity),
      unit: safeString(movement?.unit),
      totalValue: sanitizeCurrency(valueOrFallback(movement?.totalValue, movement?.revenue)),
      date: safeString(movement?.date),
      note: safeString(movement?.note),
      reason: safeString(movement?.reason),
    });
  });

  return rows;
}




export function getLotMergeCompatibility(baseLot = {}, candidateLot = {}) {
  if (!baseLot?.id || !candidateLot?.id) {
    return { compatible: false, reason: "Select valid lots to merge." };
  }

  const baseType = normalizeLotFingerprintValue(baseLot?.lotType);
  const candidateType = normalizeLotFingerprintValue(candidateLot?.lotType);
  if (!baseType || !candidateType || baseType !== candidateType) {
    return { compatible: false, reason: "Only lots with the same lot type can be merged." };
  }

  const baseUnit = normalizeLotFingerprintValue(baseLot?.unit);
  const candidateUnit = normalizeLotFingerprintValue(candidateLot?.unit);
  if (baseUnit !== candidateUnit) {
    return { compatible: false, reason: "Only lots with the same unit can be merged." };
  }

  if (baseType === "extract") {
    const baseExtractionType = normalizeLotFingerprintValue(baseLot?.extractionType);
    const candidateExtractionType = normalizeLotFingerprintValue(candidateLot?.extractionType);
    if (baseExtractionType !== candidateExtractionType) {
      return {
        compatible: false,
        reason: "Only extract lots with the same extraction type can be merged.",
      };
    }
  }

  if (FINISHED_GOODS_LOT_TYPES.includes(baseType)) {
    const baseProductType = getProductTypeMeta(
      baseLot?.productType || baseLot?.finishedGoodType || baseLot?.lotType
    ).key;
    const candidateProductType = getProductTypeMeta(
      candidateLot?.productType || candidateLot?.finishedGoodType || candidateLot?.lotType
    ).key;

    if (baseProductType !== candidateProductType) {
      return {
        compatible: false,
        reason: "Only finished goods with the same product type can be merged.",
      };
    }

    if (
      normalizeLotFingerprintValue(baseLot?.variant) !==
      normalizeLotFingerprintValue(candidateLot?.variant)
    ) {
      return {
        compatible: false,
        reason: "Only finished goods with the same variant can be merged.",
      };
    }

    if (!compareLotNumericValue(baseLot?.mgPerUnit, candidateLot?.mgPerUnit)) {
      return {
        compatible: false,
        reason: "Only finished goods with the same potency per unit can be merged.",
      };
    }

    if (!compareLotNumericValue(baseLot?.bottleSize, candidateLot?.bottleSize)) {
      return {
        compatible: false,
        reason: "Only tinctures with the same bottle size can be merged.",
      };
    }

    if (
      normalizeLotFingerprintValue(baseLot?.bottleSizeUnit) !==
      normalizeLotFingerprintValue(candidateLot?.bottleSizeUnit)
    ) {
      return {
        compatible: false,
        reason: "Only tinctures with the same bottle size unit can be merged.",
      };
    }
  }

  return { compatible: true, reason: "" };
}

export async function splitMaterialLot({
  userId,
  lotId,
  quantity,
  name,
  date,
  note,
}) {
  if (!userId) throw new Error("Missing user.");
  if (!lotId) throw new Error("Missing lot.");

  const normalizedQuantity = sanitizePositiveNumber(quantity);
  if (normalizedQuantity <= 0) {
    throw new Error("Enter a split quantity greater than zero.");
  }

  const normalizedDate = safeString(date) || toLocalYYYYMMDD(new Date());
  const normalizedName = safeString(name);
  const normalizedNote = safeString(note);

  return runTransaction(db, async (tx) => {
    const lotRef = doc(db, "users", userId, "materialLots", lotId);
    const lotSnap = await tx.get(lotRef);
    if (!lotSnap.exists()) throw new Error("Source lot could not be found.");

    const lot = lotSnap.data() || {};
    if (!isActiveMaterialLot(lot)) {
      throw new Error("Only active lots can be split.");
    }

    const available = getLotAvailableQuantity(lot);
    if (normalizedQuantity > available) {
      throw new Error(
        `${lot?.name || lotId} only has ${formatQty(
          available,
          lot?.unit || "g",
          String(lot?.unit || "").trim().toLowerCase() === "count" ? 0 : 2
        )} available after reservations.`
      );
    }

    const remainingBefore = lotRemaining(lot);
    const nextRemaining = sanitizePositiveNumber(remainingBefore - normalizedQuantity);
    const splitOperationId = buildPostProcessOperationId("split");
    const childLotRef = doc(collection(db, "users", userId, "materialLots"));
    const childName =
      normalizedName ||
      buildLotOperationName(lot?.name || lotId, "Split", normalizedDate);

    const sourceScaledCosts = buildScaledCostPatch(lot, nextRemaining, remainingBefore);
    const childScaledCosts = buildScaledCostPatch(lot, normalizedQuantity, remainingBefore);

    tx.update(lotRef, {
      remainingQuantity: nextRemaining,
      status: nextLotStatus(nextRemaining, lotInitial(lot)),
      ...sourceScaledCosts,
      updatedDate: normalizedDate,
      updatedAt: serverTimestamp(),
    });

    const childSourceGrowIds = uniqueStrings([
      ...safeArray(lot?.sourceGrowIds),
      ...extractGrowIdsFromLot(lot),
    ]);
    const childOriginGrowIds = uniqueStrings([
      ...safeArray(lot?.originGrowIds),
      ...extractGrowIdsFromLot(lot),
    ]);

    const childLot = {
      ...lot,
      ...childScaledCosts,
      name: childName,
      status: "available",
      sourceType: "lot_split",
      sourceLotId: lotId,
      parentLotId: lotId,
      rootLotId: safeString(valueOrFallback(lot?.rootLotId, lot?.parentLotId, lotId)) || lotId,
      splitFromLotId: lotId,
      splitOperationId,
      derivedFromOperation: "split",
      sourceLotIds: uniqueStrings([lotId, ...safeArray(lot?.sourceLotIds)]),
      derivedFromLotIds: uniqueStrings([lotId, ...safeArray(lot?.derivedFromLotIds)]),
      sourceGrowId: childSourceGrowIds[0] || lot?.sourceGrowId || null,
      sourceGrowIds: childSourceGrowIds,
      originGrowIds: childOriginGrowIds,
      initialQuantity: normalizedQuantity,
      allocatedQuantity: 0,
      remainingQuantity: normalizedQuantity,
      reservations: [],
      reservationQuantity: 0,
      outboundSummary: {},
      splitNote: normalizedNote || "",
      createdDate: normalizedDate,
      updatedDate: normalizedDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    tx.set(childLotRef, childLot);

    const sourceMovementRef = doc(collection(db, "users", userId, "inventoryMovements"));
    tx.set(sourceMovementRef, {
      movementType: "split_out",
      lotId,
      relatedLotId: childLotRef.id,
      operationId: splitOperationId,
      processType: "lot_split",
      processCategory: "inventory",
      direction: "out",
      sourceType: "lot",
      quantity: normalizedQuantity,
      unit: lot?.unit || "g",
      date: normalizedDate,
      note:
        normalizedNote ||
        `Split ${formatQty(normalizedQuantity, lot?.unit || "g")} from ${lot?.name || lotId} into ${childName}.`,
      createdAt: serverTimestamp(),
    });

    const childMovementRef = doc(collection(db, "users", userId, "inventoryMovements"));
    tx.set(childMovementRef, {
      movementType: "split_in",
      lotId: childLotRef.id,
      relatedLotId: lotId,
      operationId: splitOperationId,
      processType: "lot_split",
      processCategory: "inventory",
      direction: "in",
      sourceType: "lot",
      quantity: normalizedQuantity,
      unit: lot?.unit || "g",
      date: normalizedDate,
      note:
        normalizedNote ||
        `Created split lot ${childName} from ${lot?.name || lotId}.`,
      createdAt: serverTimestamp(),
    });

    return {
      success: true,
      operationId: splitOperationId,
      sourceLotId: lotId,
      childLotId: childLotRef.id,
      childName,
    };
  });
}

export async function mergeMaterialLots({
  userId,
  lotInputs,
  name,
  date,
  note,
}) {
  if (!userId) throw new Error("Missing user.");

  const normalizedInputs = safeArray(lotInputs)
    .map((item) => ({
      lotId: safeString(item?.lotId),
      quantity: sanitizePositiveNumber(item?.quantity),
    }))
    .filter((item) => item.lotId && item.quantity > 0);

  if (normalizedInputs.length < 2) {
    throw new Error("Select at least two lot quantities to merge.");
  }

  const normalizedDate = safeString(date) || toLocalYYYYMMDD(new Date());
  const normalizedName = safeString(name);
  const normalizedNote = safeString(note);

  return runTransaction(db, async (tx) => {
    const entries = [];
    for (const item of normalizedInputs) {
      const lotRef = doc(db, "users", userId, "materialLots", item.lotId);
      const lotSnap = await tx.get(lotRef);
      if (!lotSnap.exists()) throw new Error(`Source lot ${item.lotId} could not be found.`);
      entries.push({
        ref: lotRef,
        snap: lotSnap,
        quantity: item.quantity,
      });
    }

    const lots = entries.map((entry) => ({ id: entry.ref.id, ...(entry.snap.data() || {}) }));
    const baseLot = lots[0];

    if (!isActiveMaterialLot(baseLot)) {
      throw new Error("Only active lots can be merged.");
    }

    for (let i = 0; i < entries.length; i += 1) {
      const lot = lots[i];
      const quantity = normalizedInputs[i].quantity;

      if (!isActiveMaterialLot(lot)) {
        throw new Error(`${lot?.name || entries[i].ref.id} is not an active lot.`);
      }

      const available = getLotAvailableQuantity(lot);
      if (quantity > available) {
        throw new Error(
          `${lot?.name || entries[i].ref.id} only has ${formatQty(
            available,
            lot?.unit || "g",
            String(lot?.unit || "").trim().toLowerCase() === "count" ? 0 : 2
          )} available after reservations.`
        );
      }

      const compatibility = getLotMergeCompatibility(baseLot, lot);
      if (!compatibility.compatible) {
        throw new Error(compatibility.reason || "These lots cannot be merged.");
      }
    }

    const mergeOperationId = buildPostProcessOperationId("merge");
    const outputLotRef = doc(collection(db, "users", userId, "materialLots"));
    const totalQuantity = sanitizePositiveNumber(
      normalizedInputs.reduce((sum, item) => sum + sanitizePositiveNumber(item.quantity), 0)
    );

    const mergedSourceGrowIds = uniqueStrings(
      lots.flatMap((lot) => [
        ...safeArray(lot?.sourceGrowIds),
        ...extractGrowIdsFromLot(lot),
      ])
    );

    const mergedOriginGrowIds = uniqueStrings(
      lots.flatMap((lot) => [
        ...safeArray(lot?.originGrowIds),
        ...extractGrowIdsFromLot(lot),
      ])
    );

    const mergedStrain = uniqueStrings(lots.map((lot) => lot?.strain)).join(", ");
    const mergedName =
      normalizedName ||
      buildLotOperationName(baseLot?.name || baseLot?.id || "Lot", "Merged", normalizedDate);

    let totalBatchCost = 0;
    entries.forEach((entry) => {
      const lot = entry.snap.data() || {};
      totalBatchCost = roundCurrency(totalBatchCost + getLotUnitCost(lot) * entry.quantity);
    });

    for (const entry of entries) {
      const lot = entry.snap.data() || {};
      const remainingBefore = lotRemaining(lot);
      const nextRemaining = sanitizePositiveNumber(remainingBefore - entry.quantity);
      const scaledCosts = buildScaledCostPatch(lot, nextRemaining, remainingBefore);

      tx.update(entry.ref, {
        remainingQuantity: nextRemaining,
        status: nextLotStatus(nextRemaining, lotInitial(lot)),
        ...scaledCosts,
        updatedDate: normalizedDate,
        updatedAt: serverTimestamp(),
      });

      const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
      tx.set(movementRef, {
        movementType: "merge_out",
        lotId: entry.ref.id,
        relatedLotId: outputLotRef.id,
        operationId: mergeOperationId,
        processType: "lot_merge",
        processCategory: "inventory",
        direction: "out",
        sourceType: "lot",
        quantity: entry.quantity,
        unit: lot?.unit || baseLot?.unit || "g",
        date: normalizedDate,
        note:
          normalizedNote ||
          `Merged ${formatQty(entry.quantity, lot?.unit || "g")} from ${lot?.name || entry.ref.id} into ${mergedName}.`,
        createdAt: serverTimestamp(),
      });
    }

    const unitCost = totalQuantity > 0 ? roundCurrency(totalBatchCost / totalQuantity) : 0;
    const pricing = buildPricingSnapshot({
      unitCost,
      quantity: totalQuantity,
      pricePerUnit: sanitizeCurrency(
        valueOrFallback(baseLot?.pricePerUnit, baseLot?.pricing?.pricePerUnit)
      ),
      msrpPerUnit: sanitizeCurrency(
        valueOrFallback(baseLot?.msrpPerUnit, baseLot?.pricing?.suggestedMsrpPerUnit)
      ),
    });

    const mergedPotency = buildMergedPotencySnapshot(lots);
    const mergedQc = buildMergedQcSnapshot(lots, normalizedDate);
    const mergedShelfLife = buildMergedShelfLifeSnapshot(lots, normalizedDate);

    const mergedLot = {
      ...baseLot,
      name: mergedName,
      status: "available",
      sourceType: "lot_merge",
      sourceLotIds: uniqueStrings(lots.map((lot) => lot.id)),
      derivedFromLotIds: uniqueStrings(
        lots.flatMap((lot) => [lot.id, ...safeArray(lot?.derivedFromLotIds)])
      ),
      derivedFromOperation: "merge",
      mergeOperationId,
      mergeSourceCount: lots.length,
      mergedFromLots: entries.map((entry) => {
        const lot = entry.snap.data() || {};
        return {
          lotId: entry.ref.id,
          lotName: lot?.name || entry.ref.id,
          quantity: entry.quantity,
          unit: lot?.unit || baseLot?.unit || "g",
        };
      }),
      sourceGrowId: mergedSourceGrowIds[0] || baseLot?.sourceGrowId || null,
      sourceGrowIds: mergedSourceGrowIds,
      originGrowIds: mergedOriginGrowIds,
      strain: mergedStrain || baseLot?.strain || "",
      initialQuantity: totalQuantity,
      allocatedQuantity: 0,
      remainingQuantity: totalQuantity,
      reservationQuantity: 0,
      reservations: [],
      outboundSummary: {},
      batchTotalCost: totalBatchCost,
      totalCost: totalBatchCost,
      unitCost,
      costPerUnit: unitCost,
      pricing,
      potency: mergedPotency || null,
      qc: mergedQc || null,
      shelfLife: mergedShelfLife || null,
      mergeNote: normalizedNote || "",
      createdDate: normalizedDate,
      updatedDate: normalizedDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const mergedCosts = baseLot?.costs && typeof baseLot.costs === "object" ? { ...baseLot.costs } : {};
    mergedCosts.batchTotalCost = totalBatchCost;
    mergedCosts.totalCost = totalBatchCost;
    mergedCosts.unitCost = unitCost;
    mergedLot.costs = mergedCosts;

    tx.set(outputLotRef, mergedLot);

    const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
    tx.set(movementRef, {
      movementType: "merge_in",
      lotId: outputLotRef.id,
      operationId: mergeOperationId,
      processType: "lot_merge",
      processCategory: "inventory",
      direction: "in",
      sourceType: "lot",
      quantity: totalQuantity,
      unit: baseLot?.unit || "g",
      date: normalizedDate,
      note:
        normalizedNote ||
        `Created merged lot ${mergedName} from ${lots.length} source lots.`,
      createdAt: serverTimestamp(),
    });

    return {
      success: true,
      operationId: mergeOperationId,
      mergedLotId: outputLotRef.id,
      mergedName,
      lotCount: lots.length,
    };
  });
}


function buildPostProcessOperationId(prefix = "ppop") {
  return `${String(prefix || "ppop").trim()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildLotOperationName(baseName = "", suffix = "", date = "") {
  const safeBase = safeString(baseName) || "Lot";
  const safeSuffix = safeString(suffix);
  const safeDate = safeString(date) || toLocalYYYYMMDD(new Date());
  return [safeBase, safeSuffix, safeDate].filter(Boolean).join(" ").trim();
}

function buildScaledCostPatch(record = {}, targetQuantity = 0, baseQuantity = null) {
  const normalizedTargetQuantity = sanitizePositiveNumber(targetQuantity);
  const normalizedBaseQuantity =
    sanitizePositiveNumber(baseQuantity) > 0
      ? sanitizePositiveNumber(baseQuantity)
      : sanitizePositiveNumber(lotRemaining(record));

  const unitCost = getLotUnitCost(record);
  const totalCost = roundCurrency(unitCost * normalizedTargetQuantity);
  const ratio = normalizedBaseQuantity > 0 ? normalizedTargetQuantity / normalizedBaseQuantity : 0;

  const scaled = {};
  [
    "sourceBatchTotalCost",
    "inputMaterialCostTotal",
    "recipeBatchCostTotal",
    "recipeCost",
    "packagingCost",
    "laborCost",
    "overheadCost",
    "otherCost",
    "directCost",
    "directCostTotal",
    "batchTotalCost",
    "totalCost",
  ].forEach((key) => {
    if (record?.[key] !== undefined && record?.[key] !== null && record?.[key] !== "") {
      scaled[key] = roundCurrency(sanitizeCurrency(record[key]) * ratio);
    }
  });

  scaled.batchTotalCost = totalCost;
  scaled.totalCost = totalCost;
  scaled.unitCost = unitCost;
  scaled.costPerUnit = unitCost;

  const nextCosts = record?.costs && typeof record.costs === "object" ? { ...record.costs } : {};
  [
    "sourceGrowCost",
    "inputMaterialCostTotal",
    "recipeCost",
    "recipeBatchCostTotal",
    "directCost",
    "directCostTotal",
    "packagingCost",
    "laborCost",
    "overheadCost",
    "otherCost",
    "batchTotalCost",
    "totalCost",
  ].forEach((key) => {
    if (nextCosts[key] !== undefined && nextCosts[key] !== null && nextCosts[key] !== "") {
      nextCosts[key] = roundCurrency(sanitizeCurrency(nextCosts[key]) * ratio);
    }
  });
  nextCosts.batchTotalCost = totalCost;
  nextCosts.totalCost = totalCost;
  nextCosts.unitCost = unitCost;
  scaled.costs = nextCosts;

  const resolvedPricePerUnit = sanitizeCurrency(
    valueOrFallback(record?.pricePerUnit, record?.pricing?.pricePerUnit)
  );
  const resolvedMsrpPerUnit = sanitizeCurrency(
    valueOrFallback(record?.msrpPerUnit, record?.pricing?.suggestedMsrpPerUnit)
  );

  scaled.pricing = buildPricingSnapshot({
    unitCost,
    quantity: normalizedTargetQuantity,
    pricePerUnit: resolvedPricePerUnit,
    msrpPerUnit: resolvedMsrpPerUnit,
  });

  return scaled;
}

function objectsAreDeepEqual(a, b) {
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

function earliestDateString(values = []) {
  const parsed = (Array.isArray(values) ? values : [])
    .map((value) => parseAnyDate(value))
    .filter(Boolean)
    .sort((a, b) => a - b);

  return parsed.length > 0 ? toLocalYYYYMMDD(parsed[0]) : "";
}

function buildMergedShelfLifeSnapshot(lots = [], fallbackDate = "") {
  const shelfLives = safeArray(lots)
    .map((lot) => getLotShelfLife(lot))
    .filter(Boolean);

  if (shelfLives.length === 0) return null;
  if (shelfLives.every((entry) => objectsAreDeepEqual(entry, shelfLives[0]))) {
    return { ...shelfLives[0] };
  }

  return {
    madeOn: fallbackDate || earliestDateString(shelfLives.map((entry) => entry?.madeOn)),
    bestBy: earliestDateString(shelfLives.map((entry) => entry?.bestBy)),
    expirationDate: earliestDateString(shelfLives.map((entry) => entry?.expirationDate)),
    storageCondition: "",
    storageNotes: "Merged from multiple lots. Reconfirm shelf-life handling for the combined lot.",
  };
}

function buildMergedQcSnapshot(lots = [], fallbackDate = "") {
  const qcList = safeArray(lots)
    .map((lot) => getLotQc(lot))
    .filter(Boolean);

  if (qcList.length === 0) return null;
  if (qcList.every((entry) => objectsAreDeepEqual(entry, qcList[0]))) {
    return { ...qcList[0] };
  }

  return {
    status: "pending",
    checkedBy: "",
    checkedDate: fallbackDate || "",
    notes: "Merged from multiple lots. Re-run QC for the merged lot.",
  };
}

function buildMergedPotencySnapshot(lots = []) {
  const potencyList = safeArray(lots)
    .map((lot) => getLotPotency(lot))
    .filter(Boolean);

  if (potencyList.length === 0) return null;
  if (potencyList.every((entry) => objectsAreDeepEqual(entry, potencyList[0]))) {
    return { ...potencyList[0] };
  }

  return {
    activeMgPerUnit: 0,
    activeMgPerMl: 0,
    activeMgPerGram: 0,
    notes: "Merged from multiple lots. Reconfirm potency for the merged lot.",
    updatedDate: "",
  };
}

function normalizeLotFingerprintValue(value) {
  return safeString(value).toLowerCase();
}

function compareLotNumericValue(a, b) {
  return sanitizePositiveNumber(a) === sanitizePositiveNumber(b);
}


export function summarizePostProcessChecklist(items = []) {
  const normalized = safeArray(items).map((item, index) => ({
    id: safeString(item?.id) || `check_${index + 1}`,
    label: safeString(item?.label || item?.name || item?.title),
    complete: Boolean(item?.complete || item?.completed),
    required: item?.required !== false,
    completedAt: safeString(item?.completedAt),
    completedBy: safeString(item?.completedBy),
    note: safeString(item?.note),
  })).filter((item) => item.label);
  return {
    total: normalized.length,
    completed: normalized.filter((item) => item.complete).length,
    items: normalized,
  };
}

export function getLotWorkflowState(record = {}) {
  const workflow = record?.workflow && typeof record.workflow === "object" ? record.workflow : {};
  const releaseRequired = Boolean(workflow?.releaseRequired ?? record?.releaseRequired ?? isFinishedGoodsLot(record));
  const releaseStatus = safeString(workflow?.releaseStatus || record?.releaseStatus || (releaseRequired ? "pending" : "released")).toLowerCase() || (releaseRequired ? "pending" : "released");
  const recalled = Boolean(workflow?.recalled ?? record?.recalled);
  const quarantined = Boolean(workflow?.quarantined ?? record?.quarantined);
  const qcHold = Boolean(workflow?.qcHold ?? record?.qcHold);
  const holdReason = safeString(workflow?.holdReason || record?.holdReason);
  const recallReason = safeString(workflow?.recallReason || record?.recallReason);
  const quarantineReason = safeString(workflow?.quarantineReason || record?.quarantineReason);
  const approvedBy = safeString(workflow?.approvedBy || record?.approvedBy);
  const releasedBy = safeString(workflow?.releasedBy || record?.releasedBy);
  const releasedAt = safeString(workflow?.releasedAt || record?.releasedAt);
  const notes = safeString(workflow?.notes || record?.workflowNotes);
  const blocked = recalled || quarantined || qcHold || (releaseRequired && releaseStatus !== "released");
  const blockReason = recalled
    ? recallReason || "Recalled"
    : quarantined
    ? quarantineReason || "Quarantined"
    : qcHold
    ? holdReason || "On hold"
    : releaseRequired && releaseStatus !== "released"
    ? "Pending release"
    : "";
  return {
    releaseRequired,
    releaseStatus,
    recalled,
    quarantined,
    qcHold,
    holdReason,
    recallReason,
    quarantineReason,
    approvedBy,
    releasedBy,
    releasedAt,
    notes,
    blocked,
    blockReason,
    sellable: !blocked,
  };
}

export function isLotBlockedForUse(record = {}, mode = "general") {
  const workflow = getLotWorkflowState(record);
  if (workflow.recalled || workflow.quarantined || workflow.qcHold) return true;
  if ((mode === "sale" || mode === "label" || mode === "shipment") && workflow.releaseRequired && workflow.releaseStatus !== "released") {
    return true;
  }
  return false;
}

export function getShelfLifeAction(record = {}) {
  const shelfLife = getLotShelfLife(record);
  const workflow = getLotWorkflowState(record);
  if (workflow.recalled) return "do_not_sell";
  if (workflow.quarantined || workflow.qcHold) return "hold";
  if (!shelfLife) return "normal";
  const target = parseAnyDate(shelfLife.expirationDate || shelfLife.bestBy);
  if (!target) return "normal";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const test = new Date(target);
  test.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((test.getTime() - now.getTime()) / 86400000);
  if (diffDays < 0) return "expired";
  if (diffDays <= 7) return "do_not_sell";
  if (diffDays <= 21) return "discount_candidate";
  if (diffDays <= 45) return "donation_priority";
  return "normal";
}

export function buildLotCode({ prefix = "CNM", productType = "", date = "", variant = "", lotId = "" } = {}) {
  const safePrefix = safeString(prefix || "CNM") || "CNM";
  const key = safeString(productType).toLowerCase();
  const productCode = {
    capsule: "CAP",
    capsules: "CAP",
    gummy: "GUM",
    gummies: "GUM",
    chocolate: "CHO",
    chocolates: "CHO",
    tincture: "TIN",
    tinctures: "TIN",
    extract: "EXT",
    dry_material: "DRY",
  }[key] || (key ? key.slice(0, 3).toUpperCase() : "LOT");
  const safeDate = safeString(date || toLocalYYYYMMDD(new Date())).replaceAll("-", "");
  const variantCode = safeString(variant).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
  const suffix = safeString(lotId).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(-6) || Math.random().toString(36).slice(2, 8).toUpperCase();
  return [safePrefix, productCode, safeDate, variantCode, suffix].filter(Boolean).join("-");
}

export function getLabelMetadataSnapshot(record = {}) {
  const nested = record?.labelMetadata && typeof record.labelMetadata === "object" ? record.labelMetadata : {};
  const snapshot = {
    lotCode: safeString(nested?.lotCode || record?.lotCode),
    packDate: safeString(nested?.packDate || record?.packDate || record?.createdDate),
    ingredients: normalizeIngredientLinesForPostProcess(nested?.ingredients || record?.ingredients),
    allergens: normalizeIngredientLinesForPostProcess(nested?.allergens || record?.allergens),
    warnings: normalizeIngredientLinesForPostProcess(nested?.warnings || record?.warnings),
    footer: safeString(nested?.footer || record?.labelFooter),
    storage: safeString(nested?.storage || record?.storageLabel),
    bestBy: safeString(nested?.bestBy || record?.shelfLife?.bestBy),
    expirationDate: safeString(nested?.expirationDate || record?.shelfLife?.expirationDate),
  };
  if (!snapshot.lotCode && !snapshot.packDate && snapshot.ingredients.length === 0 && snapshot.allergens.length === 0 && snapshot.warnings.length === 0 && !snapshot.footer && !snapshot.storage && !snapshot.bestBy && !snapshot.expirationDate) {
    return null;
  }
  return snapshot;
}

export function buildPostProcessWasteAnalytics({ materialLots = [], processBatches = [] } = {}) {
  const records = [...safeArray(materialLots), ...safeArray(processBatches)];
  const byReason = {};
  const byStage = {};
  let totalWasteQuantity = 0;
  let totalVarianceQuantity = 0;
  records.forEach((record) => {
    const metrics = getYieldMetrics(record);
    if (!metrics) return;
    totalWasteQuantity = roundNumber(totalWasteQuantity + sanitizePositiveNumber(metrics.wasteQuantity), 3);
    totalVarianceQuantity = roundNumber(totalVarianceQuantity + sanitizeSignedNumber(metrics.varianceQuantity), 3);
    const reason = safeString(metrics.wasteReason || "Unspecified") || "Unspecified";
    const stage = safeString(record?.processType || record?.processCategory || record?.lotType || "other") || "other";
    byReason[reason] = roundNumber((byReason[reason] || 0) + sanitizePositiveNumber(metrics.wasteQuantity), 3);
    byStage[stage] = roundNumber((byStage[stage] || 0) + sanitizePositiveNumber(metrics.wasteQuantity), 3);
  });
  return {
    totalWasteQuantity,
    totalVarianceQuantity,
    byReason: Object.entries(byReason).map(([reason, quantity]) => ({ reason, quantity })).sort((a, b) => b.quantity - a.quantity),
    byStage: Object.entries(byStage).map(([stage, quantity]) => ({ stage, quantity })).sort((a, b) => b.quantity - a.quantity),
  };
}

export function buildPostProcessEfficiencyAnalytics({ processBatches = [] } = {}) {
  return {
    rows: safeArray(processBatches)
      .map((batch) => {
        const metrics = getYieldMetrics(batch);
        if (!metrics) return null;
        return {
          batchId: safeString(batch?.id),
          name: safeString(batch?.name),
          processType: safeString(batch?.processType || batch?.processCategory),
          expectedQuantity: sanitizePositiveNumber(metrics.expectedQuantity),
          actualQuantity: sanitizePositiveNumber(metrics.actualQuantity),
          varianceQuantity: sanitizeSignedNumber(metrics.varianceQuantity),
          variancePercent: roundNumber(metrics.variancePercent, 2),
          wasteQuantity: sanitizePositiveNumber(metrics.wasteQuantity),
          unit: safeString(metrics.actualUnit || metrics.expectedUnit || batch?.outputUnit || batch?.unit),
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.variancePercent) - Math.abs(a.variancePercent)),
  };
}

export function buildPostProcessReworkAnalytics({ processBatches = [] } = {}) {
  const rows = safeArray(processBatches)
    .filter((batch) => safeString(batch?.processType) === "rework" || safeString(batch?.processCategory) === "rework")
    .map((batch) => {
      const metrics = getYieldMetrics(batch);
      return {
        batchId: safeString(batch?.id),
        name: safeString(batch?.name),
        reworkType: safeString(batch?.reworkType || batch?.reworkReason || "rework") || "rework",
        outputCount: sanitizePositiveNumber(valueOrFallback(batch?.actualOutputCount, batch?.outputCount)),
        wasteQuantity: sanitizePositiveNumber(metrics?.wasteQuantity),
        variancePercent: roundNumber(metrics?.variancePercent, 2),
      };
    });
  return {
    totalBatches: rows.length,
    totalOutputCount: rows.reduce((sum, row) => sum + sanitizePositiveNumber(row.outputCount), 0),
    totalWasteQuantity: rows.reduce((sum, row) => sum + sanitizePositiveNumber(row.wasteQuantity), 0),
    rows,
  };
}

export function buildSupplyInventoryAnalytics({ supplies = [] } = {}) {
  const rows = safeArray(supplies).map((supply) => {
    const quantity = sanitizePositiveNumber(valueOrFallback(supply?.quantity, supply?.qty, supply?.q));
    const lowStockThreshold = sanitizePositiveNumber(valueOrFallback(supply?.lowStockThreshold, supply?.reorderPoint));
    const unitCost = sanitizeCurrency(supply?.cost);
    return {
      supplyId: safeString(supply?.id),
      name: safeString(supply?.name),
      type: safeString(supply?.type),
      unit: safeString(supply?.unit),
      quantity,
      lowStockThreshold,
      low: lowStockThreshold > 0 && quantity <= lowStockThreshold,
      inventoryValue: roundCurrency(quantity * unitCost),
    };
  });
  return {
    totalSupplies: rows.length,
    lowCount: rows.filter((row) => row.low).length,
    packagingLowCount: rows.filter((row) => row.low && row.type === "packaging").length,
    inventoryValue: roundCurrency(rows.reduce((sum, row) => sum + sanitizeCurrency(row.inventoryValue), 0)),
    rows,
  };
}

export async function createReworkBatch({
  userId,
  name,
  reworkType,
  date,
  notes,
  outputCount,
  expectedOutputCount,
  wasteQuantity,
  wasteUnit,
  wasteReason,
  wasteNotes,
  productType,
  variant,
  mgPerUnit,
  bottleSize,
  bottleSizeUnit,
  inputLots,
  recipeId,
  recipeName,
  recipeYield,
  recipeItems,
  recipeCost,
  recipeCostBreakdown,
  packagingCost,
  laborCost,
  overheadCost,
  otherCost,
  directCost,
  pricePerUnit,
  msrpPerUnit,
  desiredMarginPercent,
  releaseRequired,
  releaseStatus,
}) {
  if (!userId) throw new Error("Missing user.");
  const meta = getProductTypeMeta(productType);
  const normalizedInputs = safeArray(inputLots)
    .map((item) => ({ lotId: safeString(item?.lotId), quantity: sanitizePositiveNumber(item?.quantity) }))
    .filter((item) => item.lotId && item.quantity > 0);
  if (normalizedInputs.length === 0) throw new Error("Select at least one finished lot and quantity to rework.");

  const normalizedDate = safeString(date) || toLocalYYYYMMDD(new Date());
  const normalizedNotes = safeString(notes);
  const normalizedReworkType = safeString(reworkType || "rework") || "rework";
  const normalizedVariant = safeString(variant);
  const normalizedOutputCount = Math.max(0, Math.floor(Number(outputCount) || 0));
  const normalizedExpectedOutputCount = Math.max(normalizedOutputCount, Math.floor(Number(expectedOutputCount) || 0)) || normalizedOutputCount;
  const normalizedWasteQuantity = sanitizePositiveNumber(wasteQuantity);
  const normalizedWasteUnit = safeString(wasteUnit || meta.outputUnit) || meta.outputUnit;
  const normalizedWasteReason = safeString(wasteReason);
  const normalizedWasteNotes = safeString(wasteNotes);
  const normalizedMgPerUnit = sanitizePositiveNumber(mgPerUnit);
  const normalizedBottleSize = sanitizePositiveNumber(bottleSize);
  const normalizedBottleSizeUnit = safeString(bottleSizeUnit || "mL") || "mL";
  const normalizedDesiredMarginPercent = sanitizePositiveNumber(desiredMarginPercent) || MSRP_DEFAULT_MARGIN_PERCENT;

  const costing = normalizeRecipeCosting({ recipeId, recipeName, recipeYield, recipeItems, recipeCost, recipeCostBreakdown, packagingCost, laborCost, overheadCost, otherCost, directCost });

  return runTransaction(db, async (tx) => {
    const lotSnapshots = [];
    for (const item of normalizedInputs) {
      const lotRef = doc(db, "users", userId, "materialLots", item.lotId);
      const lotSnap = await tx.get(lotRef);
      if (!lotSnap.exists()) throw new Error(`Source lot ${item.lotId} could not be found.`);
      lotSnapshots.push({ ref: lotRef, snap: lotSnap, quantity: item.quantity });
    }

    const enrichedInputs = [];
    const sourceGrowIds = [];
    const originGrowIds = [];
    const sourceStrains = [];
    let totalInputQuantity = 0;
    let inputMaterialCostTotal = 0;

    for (const entry of lotSnapshots) {
      const lot = entry.snap.data() || {};
      if (!isFinishedGoodsLot(lot)) throw new Error("Rework batches can only consume finished goods lots.");
      const available = getLotAvailableQuantity(lot);
      if (entry.quantity > available) {
        throw new Error(`${lot?.name || entry.ref.id} only has ${formatQty(available, lot?.unit || "count", getQtyDigitsForUnit(lot?.unit || "count"))} available after reservations.`);
      }
      const remaining = lotRemaining(lot);
      const nextRemaining = sanitizePositiveNumber(remaining - entry.quantity);
      const nextAllocated = sanitizePositiveNumber((Number(lot?.allocatedQuantity) || 0) + entry.quantity);
      tx.update(entry.ref, {
        remainingQuantity: nextRemaining,
        allocatedQuantity: nextAllocated,
        status: nextLotStatus(nextRemaining, lotInitial(lot)),
        updatedDate: normalizedDate,
        updatedAt: serverTimestamp(),
      });
      const growIds = extractGrowIdsFromLot(lot);
      sourceGrowIds.push(...growIds);
      originGrowIds.push(...growIds);
      if (lot?.strain) sourceStrains.push(String(lot.strain));
      totalInputQuantity += entry.quantity;
      const unitCost = getLotUnitCost(lot);
      const inputCostApplied = roundCurrency(unitCost * entry.quantity);
      inputMaterialCostTotal = roundCurrency(inputMaterialCostTotal + inputCostApplied);
      enrichedInputs.push({
        lotId: entry.ref.id,
        lotType: safeString(lot?.lotType),
        lotName: lot?.name || entry.ref.id,
        growLabel: lot?.growLabel || lot?.name || entry.ref.id,
        strain: lot?.strain || "",
        sourceGrowId: growIds[0] || null,
        originGrowIds: growIds,
        quantity: entry.quantity,
        unit: safeString(lot?.unit) || meta.outputUnit,
        unitCost,
        inputCostApplied,
        remainingBefore: remaining,
        remainingAfter: nextRemaining,
      });
    }

    const uniqueGrowIds = uniqueStrings(sourceGrowIds);
    const uniqueOriginGrowIds = uniqueStrings(originGrowIds);
    const uniqueStrains = uniqueStrings(sourceStrains);
    const finalBatchName = safeString(name) || `${normalizedReworkType.replace(/_/g, " ")} ${meta.label} ${normalizedDate}`;
    const batchRef = doc(collection(db, "users", userId, "processBatches"));
    const outputLotRef = normalizedOutputCount > 0 ? doc(collection(db, "users", userId, "materialLots")) : null;
    const finalLotName = buildProductLotName({ batchName: finalBatchName, productType: meta.key, date: normalizedDate });

    const supplyPlan = await buildRecipeSupplyUsagePlanFromTransaction({
      tx,
      userId,
      recipeItems: costing.recipeItems,
      recipeYield: costing.recipeYield || normalizedOutputCount || 1,
      outputCount: normalizedOutputCount || 1,
    });
    if (supplyPlan.shortages.length > 0) {
      const labels = supplyPlan.shortages.slice(0, 4).map((entry) => `${entry.supplyName} (${formatQty(entry.shortageQuantity, entry.unit, getQtyDigitsForUnit(entry.unit))} short)`).join(", ");
      throw new Error(`Not enough packaging or ingredient inventory for this rework batch: ${labels}.`);
    }
    applyRecipeSupplyUsagePlan({ tx, userId, batchId: batchRef.id, processType: "rework", processCategory: "rework", date: normalizedDate, recipeId: costing.recipeId, recipeName: costing.recipeName, batchName: finalBatchName, plan: supplyPlan });

    const recipeBatchCost = sanitizeCurrency(costing.recipeCost);
    const directCostApplied = sanitizeCurrency(costing.directCost);
    const packagingCostApplied = sanitizeCurrency(costing.packagingCost);
    const laborCostApplied = sanitizeCurrency(costing.laborCost);
    const overheadCostApplied = sanitizeCurrency(costing.overheadCost);
    const otherCostApplied = sanitizeCurrency(costing.otherCost);
    const totalBatchCost = roundCurrency(inputMaterialCostTotal + recipeBatchCost + directCostApplied);
    const outputUnitCost = normalizedOutputCount > 0 ? roundCurrency(totalBatchCost / normalizedOutputCount) : 0;
    const yieldMetrics = buildYieldMetricsSnapshot({
      expectedQuantity: normalizedExpectedOutputCount,
      expectedUnit: meta.outputUnit,
      actualQuantity: normalizedOutputCount,
      actualUnit: meta.outputUnit,
      wasteQuantity: normalizedWasteQuantity > 0 ? normalizedWasteQuantity : normalizedExpectedOutputCount > normalizedOutputCount ? sanitizePositiveNumber(normalizedExpectedOutputCount - normalizedOutputCount) : 0,
      wasteUnit: normalizedWasteUnit || meta.outputUnit,
      wasteReason: normalizedWasteReason || normalizedReworkType,
      wasteNotes: normalizedWasteNotes,
    });
    const pricing = buildPricingSnapshot({ unitCost: outputUnitCost, quantity: normalizedOutputCount, pricePerUnit, msrpPerUnit, desiredMarginPercent: normalizedDesiredMarginPercent });

    tx.set(batchRef, {
      processType: "rework",
      processCategory: "rework",
      manufacturingStage: "rework",
      name: finalBatchName,
      status: "completed",
      date: normalizedDate,
      reworkType: normalizedReworkType,
      productType: meta.key,
      variant: normalizedVariant,
      notes: normalizedNotes,
      mgPerUnit: normalizedMgPerUnit,
      bottleSize: normalizedBottleSize,
      bottleSizeUnit: normalizedBottleSizeUnit,
      inputLots: enrichedInputs,
      outputLots: outputLotRef ? [{ lotId: outputLotRef.id, lotType: meta.lotType, name: finalLotName, quantity: normalizedOutputCount, unit: meta.outputUnit }] : [],
      sourceGrowIds: uniqueGrowIds,
      originGrowIds: uniqueOriginGrowIds,
      strains: uniqueStrains,
      inputQuantityTotal: sanitizePositiveNumber(totalInputQuantity),
      expectedOutputCount: normalizedExpectedOutputCount,
      actualOutputCount: normalizedOutputCount,
      outputCount: normalizedOutputCount,
      outputUnit: meta.outputUnit,
      yieldMetrics,
      batchTotalCost: totalBatchCost,
      unitCost: outputUnitCost,
      recipeId: costing.recipeId || null,
      recipeName: costing.recipeName || null,
      recipeYield: sanitizePositiveNumber(costing.recipeYield) || 1,
      recipeItems: costing.recipeItems,
      recipeCost: recipeBatchCost,
      recipeCostBreakdown: costing.recipeCostBreakdown,
      recipeSupplyUsage: supplyPlan.rows,
      recipeSupplySummary: buildRecipeSupplySummaryFromPlan(supplyPlan),
      packagingCost: packagingCostApplied,
      laborCost: laborCostApplied,
      overheadCost: overheadCostApplied,
      otherCost: otherCostApplied,
      directCost: directCostApplied,
      pricing,
      traceability: buildTraceabilitySnapshot({
        sourceLotIds: enrichedInputs.map((input) => input.lotId),
        derivedLotIds: outputLotRef ? [outputLotRef.id] : [],
        sourceBatchIds: [batchRef.id],
        sourceGrowIds: uniqueGrowIds,
        originGrowIds: uniqueOriginGrowIds,
        operationType: normalizedReworkType,
        processType: "rework",
      }),
      costs: { inputMaterialCostTotal, recipeCost: recipeBatchCost, directCost: directCostApplied, packagingCost: packagingCostApplied, laborCost: laborCostApplied, overheadCost: overheadCostApplied, otherCost: otherCostApplied, batchTotalCost: totalBatchCost, unitCost: outputUnitCost },
      outputLotId: outputLotRef?.id || null,
      createdDate: normalizedDate,
      updatedDate: normalizedDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const input of enrichedInputs) {
      const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
      tx.set(movementRef, {
        movementType: "consume_lot",
        lotId: input.lotId,
        batchId: batchRef.id,
        processType: "rework",
        direction: "out",
        sourceGrowId: input.sourceGrowId || null,
        sourceType: "lot",
        quantity: input.quantity,
        unit: input.unit || meta.outputUnit,
        date: normalizedDate,
        note: `Consumed by rework batch ${finalBatchName}.`,
        createdAt: serverTimestamp(),
      });
    }

    if (outputLotRef) {
      tx.set(outputLotRef, {
        lotType: meta.lotType,
        inventoryCategory: "finished_goods",
        processType: "rework",
        processCategory: "rework",
        manufacturingStage: "rework",
        status: "available",
        sourceType: "batch",
        sourceBatchId: batchRef.id,
        sourceGrowIds: uniqueGrowIds,
        originGrowIds: uniqueOriginGrowIds,
        name: finalLotName,
        batchName: finalBatchName,
        productType: meta.key,
        variant: normalizedVariant,
        strain: uniqueStrains.join(", "),
        unit: meta.outputUnit,
        initialQuantity: normalizedOutputCount,
        allocatedQuantity: 0,
        remainingQuantity: normalizedOutputCount,
        yieldMetrics,
        mgPerUnit: normalizedMgPerUnit,
        bottleSize: normalizedBottleSize,
        bottleSizeUnit: normalizedBottleSizeUnit,
        pricing,
        unitCost: outputUnitCost,
        costPerUnit: outputUnitCost,
        batchTotalCost: totalBatchCost,
        inputMaterialCostTotal,
        recipeId: costing.recipeId || null,
        recipeName: costing.recipeName || null,
        recipeYield: sanitizePositiveNumber(costing.recipeYield) || 1,
        recipeItems: costing.recipeItems,
        recipeCost: recipeBatchCost,
        recipeCostBreakdown: costing.recipeCostBreakdown,
        recipeSupplyUsage: supplyPlan.rows,
        recipeSupplySummary: buildRecipeSupplySummaryFromPlan(supplyPlan),
        packagingCost: packagingCostApplied,
        laborCost: laborCostApplied,
        overheadCost: overheadCostApplied,
        otherCost: otherCostApplied,
        directCost: directCostApplied,
        reworkType: normalizedReworkType,
        reworkOfLotIds: enrichedInputs.map((input) => input.lotId),
        workflow: {
          releaseRequired: releaseRequired !== false,
          releaseStatus: safeString(releaseStatus || "pending") || "pending",
        },
        traceability: buildTraceabilitySnapshot({
          sourceLotIds: enrichedInputs.map((input) => input.lotId),
          sourceBatchIds: [batchRef.id],
          sourceGrowIds: uniqueGrowIds,
          originGrowIds: uniqueOriginGrowIds,
          rootLotId: outputLotRef.id,
          operationType: normalizedReworkType,
          processType: "rework",
        }),
        costs: { inputMaterialCostTotal, recipeCost: recipeBatchCost, directCost: directCostApplied, packagingCost: packagingCostApplied, laborCost: laborCostApplied, overheadCost: overheadCostApplied, otherCost: otherCostApplied, batchTotalCost: totalBatchCost, unitCost: outputUnitCost },
        notes: normalizedNotes,
        createdDate: normalizedDate,
        updatedDate: normalizedDate,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const movementRef = doc(collection(db, "users", userId, "inventoryMovements"));
      tx.set(movementRef, {
        movementType: "produce_lot",
        lotId: outputLotRef.id,
        batchId: batchRef.id,
        processType: "rework",
        direction: "in",
        sourceGrowId: uniqueGrowIds[0] || null,
        sourceType: "batch",
        quantity: normalizedOutputCount,
        unit: meta.outputUnit,
        date: normalizedDate,
        note: `${meta.label} lot created from rework batch ${finalBatchName}.`,
        createdAt: serverTimestamp(),
      });
    }

    return { created: true, batchId: batchRef.id, outputLotId: outputLotRef?.id || null, name: finalBatchName };
  });
}
