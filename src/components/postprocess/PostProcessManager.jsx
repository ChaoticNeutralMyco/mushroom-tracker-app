// src/components/postprocess/PostProcessManager.jsx
// postprocess-v44-harvest-closure-traceability
// postprocess-v43-final-disposition-consistency
// postprocess-v42-collapsible-postprocess-sales-focus
// postprocess-v41-active-sales-with-historical-rollups
// postprocess-v40-fefo-rotation-and-audit
// postprocess-v39-sales-reporting-and-history-clarity
// postprocess-v38-sales-package-dose-and-label-link
// postprocess-v30-capsule-packaging-cards-and-costing
// postprocess-v28-capsule-package-dose-clarity
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import {
  Package,
  FlaskConical,
  Factory,
  Archive,
  History,
  ArrowRight,
  Sparkles,
  DollarSign,
  AlertTriangle,
  BadgeDollarSign,
  Tags,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { auth, db } from "../../firebase-config";
import {
  buildCostRollup,
  buildProductionPlanningSnapshot,
  buildSupplyRequirementSnapshot,
  canCreateDryLotFromGrow,
  createDryLotFromGrow,
  createExtractionBatch,
  createProductBatch,
  finalizeProductBatchOutput,
  createReworkBatch,
  finalizeExtractionBatchOutput,
  formatQty,
  getFinishedGoodsLotTypes,
  getGrowDryTotal,
  getGrowHarvestDate,
  getGrowLabel,
  getLotAvailableQuantity,
  getLotReservations,
  getLotReservedQuantity,
  getLotStatus,
  getLowStockThreshold,
  getMaterialLotFinalDispositionState,
  getProcessBatchStatus,
  getProductTypeMeta,
  getRecipeSnapshot,
  isActiveMaterialLot,
  isActiveProcessBatch,
  isArchivedOrDepletedMaterialLot,
  isMaterialLotUsableForProcessing,
  isFinishedGoodsLot,
  isLowStockLot,
  parseAnyDate,
  createPackagedFinishedLot,
  recordFinishedInventoryMovement,
  recordMaterialLotFinalDisposition,
  toLocalYYYYMMDD,
} from "../../lib/postprocess";
import {
  LAB_OPERATION_ACTIONS,
  getInventoryMovementRequirement,
  getLabOperationRequirement,
} from "../../lib/subscriptionLabAccess.js";
import { SUBSCRIPTION_FEATURE_KEYS } from "../../lib/subscriptionPlans.js";

function sortByNewest(items = []) {
  return items.slice().sort((a, b) => {
    const aDate =
      parseAnyDate(a?.updatedAt || a?.createdAt || a?.date || a?.createdDate) ||
      new Date(0);
    const bDate =
      parseAnyDate(b?.updatedAt || b?.createdAt || b?.date || b?.createdDate) ||
      new Date(0);
    return bDate - aDate;
  });
}

function money(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sanitizeNumber(value, allowNegative = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return allowNegative
    ? Math.round(n * 1000) / 1000
    : Math.round(Math.max(0, n) * 1000) / 1000;
}

function clampQuantityToAvailable(rawValue, available, { integer = false } = {}) {
  if (rawValue === "") return { value: "", warning: "", capped: false };
  const maxAvailable = Math.max(0, Number(available) || 0);
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return { value: "", warning: "Enter a valid quantity.", capped: false };
  const normalized = integer ? Math.max(0, Math.floor(parsed)) : Math.max(0, Math.round(parsed * 1000) / 1000);
  if (normalized > maxAvailable) {
    const capped = integer ? Math.floor(maxAvailable) : Math.round(maxAvailable * 1000) / 1000;
    return {
      value: String(capped),
      warning: `Only ${capped} available. Quantity was capped to the maximum available.`,
      capped: true,
    };
  }
  return { value: String(normalized), warning: "", capped: false };
}

function chipClass(active) {
  return `chip ${active ? "chip--active" : ""}`;
}

function formatBatchStatus(status) {
  return String(status || "planned").replace(/_/g, " ");
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
  collapsible = true,
  defaultOpen = true,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setIsOpen((current) => !current)}
            className="min-w-0 flex-1 text-left rounded-xl focus:outline-hidden focus:ring-2 focus:ring-purple-500/70"
            aria-expanded={isOpen}
          >
            <div className="flex items-start gap-2">
              {isOpen ? (
                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div className="min-w-0">
                <h3 className="text-base font-semibold">{title}</h3>
                {subtitle ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>
                ) : null}
              </div>
            </div>
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">{title}</h3>
            {subtitle ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {action}
          {collapsible ? (
            <button
              type="button"
              onClick={() => setIsOpen((current) => !current)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${title}`}
            >
              {isOpen ? "Collapse" : "Expand"}
            </button>
          ) : null}
        </div>
      </div>

      {isOpen || !collapsible ? (
        <div className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function SummaryCard({ label, value, hint, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>
      ) : null}
    </div>
  );
}

function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-sm text-zinc-600 dark:text-zinc-400 space-y-3">
      <div>
        <div className="font-medium text-zinc-800 dark:text-zinc-100">{title}</div>
        <div className="mt-1">{body}</div>
      </div>
      {action}
    </div>
  );
}

function workflowStepToneClasses(tone = "empty") {
  if (tone === "good") {
    return {
      card: "border-emerald-300/80 dark:border-emerald-800/70 bg-emerald-50/80 dark:bg-emerald-950/20",
      badge: "bg-emerald-600 text-white",
      pill: "text-emerald-700 dark:text-emerald-300",
    };
  }

  if (tone === "warn") {
    return {
      card: "border-amber-300/80 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/20",
      badge: "bg-amber-500 text-zinc-950",
      pill: "text-amber-700 dark:text-amber-300",
    };
  }

  return {
    card: "border-purple-300/70 dark:border-purple-800/60 bg-purple-50/70 dark:bg-purple-950/15",
    badge: "bg-purple-600 text-white",
    pill: "text-purple-700 dark:text-purple-300",
  };
}

function WorkflowStep({ number, title, body, statusText = "Empty", tone = "empty", next }) {
  const classes = workflowStepToneClasses(tone);

  return (
    <div className={`rounded-2xl border p-4 ${classes.card}`}>
      <div className="flex items-start gap-3">
        <div
          className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold ${classes.badge}`}
        >
          {number}
        </div>
        <div>
          <div className="font-semibold flex flex-wrap items-center gap-2">
            <span>{title}</span>
            <span className={`text-xs font-semibold ${classes.pill}`}>{statusText}</span>
            {next ? <span className="text-xs accent-text">Next</span> : null}
          </div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{body}</div>
        </div>
      </div>
    </div>
  );
}

function DetailStat({ label, value }) {
  return (
    <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950/60 p-3">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function CollapsibleGroup({
  title,
  count = 0,
  subtitle,
  isOpen,
  onToggle,
  children,
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <div className="font-semibold flex items-center gap-2">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span>{title}</span>
            <span className="text-xs rounded-full bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 text-zinc-700 dark:text-zinc-300">
              {count}
            </span>
          </div>
          {subtitle ? (
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</div>
          ) : null}
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {isOpen ? "Collapse" : "Expand"}
        </div>
      </button>

      {isOpen ? (
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">{children}</div>
      ) : null}
    </div>
  );
}

function InlineDetails({ title = "Details", subtitle = "", children, defaultOpen = false }) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30">
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold flex items-center justify-between gap-3">
        <span>{title}</span>
        {subtitle ? <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{subtitle}</span> : null}
      </summary>
      <div className="border-t border-zinc-200 dark:border-zinc-800 p-3 space-y-3">
        {children}
      </div>
    </details>
  );
}


function PostProcessDetailModal({ title, subtitle, onClose, children, maxWidth = "max-w-6xl" }) {
  return (
    <div
      className="fixed inset-0 z-[100] p-3 sm:p-6 overflow-y-auto backdrop-blur-xs"
      role="presentation"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.82)" }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`mx-auto ${maxWidth} rounded-2xl border shadow-2xl dark`}
        style={{
          borderColor: "rgba(var(--accent-rgb), 0.45)",
          backgroundColor: "rgba(8, 10, 18, 0.97)",
          color: "#f4f4f5",
          boxShadow: "0 24px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(var(--accent-rgb),0.18)",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b backdrop-blur px-4 py-4 sm:px-5"
          style={{
            borderColor: "rgba(var(--accent-rgb), 0.35)",
            background: "linear-gradient(135deg, rgba(var(--accent-rgb), 0.26), rgba(8, 10, 18, 0.98))",
          }}
        >
          <div className="min-w-0">
            <div className="text-xl font-semibold break-words" style={{ color: "var(--accent-200)" }}>
              {title}
            </div>
            {subtitle ? <div className="mt-1 text-sm text-zinc-300">{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="btn text-sm shrink-0">
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-5">{children}</div>
      </div>
    </div>
  );
}

function DetailNameButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left text-lg font-semibold text-purple-700 dark:text-purple-300 hover:underline focus:outline-hidden focus:ring-2 focus:ring-purple-500/70 rounded-md"
    >
      {children}
    </button>
  );
}

function formatTotalsByUnit(items = []) {
  const totals = {};
  (Array.isArray(items) ? items : []).forEach((item) => {
    const unit = String(item?.unit || "").trim() || "units";
    const value = Number(item?.selectedQuantity ?? item?.total ?? item?.quantity ?? 0) || 0;
    totals[unit] = (totals[unit] || 0) + value;
  });

  const parts = Object.entries(totals).map(([unit, total]) => {
    const digits = unit === "count" ? 0 : 2;
    return formatQty(total, unit, digits);
  });

  return parts.join(" · ");
}

function getDefaultExtractionOutputUnit(extractionType = "") {
  const type = String(extractionType || "").trim().toLowerCase();
  if (["powder", "dry_powder", "dry powder", "resin"].includes(type)) return "g";
  if (["dual", "dual_extract", "hot_water", "hot water", "ethanol", "tincture", "liquid"].includes(type)) return "mL";
  return "mL";
}

function getExtractionInputTotalForUnit(items = [], unit = "g") {
  const targetUnit = normalizePackageUnit(unit);
  return Math.round(
    (Array.isArray(items) ? items : []).reduce((sum, item) => {
      const itemUnit = normalizePackageUnit(item?.unit || "g");
      if (itemUnit !== targetUnit) return sum;
      return sum + (Number(item?.selectedQuantity ?? item?.total ?? item?.quantity ?? 0) || 0);
    }, 0) * 1000
  ) / 1000;
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function buildPricingPreview({
  unitCost = 0,
  pricePerUnit = 0,
  msrpPerUnit = 0,
  quantity = 0,
}) {
  const normalizedUnitCost = Math.max(0, Number(unitCost) || 0);
  const normalizedPrice = Math.max(0, Number(pricePerUnit) || 0);
  const normalizedMsrp = Math.max(0, Number(msrpPerUnit) || 0);
  const normalizedQty = Math.max(0, Number(quantity) || 0);
  const marginPerUnit = roundCurrency(normalizedPrice - normalizedUnitCost);
  const marginPercent = normalizedPrice > 0 ? (marginPerUnit / normalizedPrice) * 100 : 0;
  return {
    unitCost: roundCurrency(normalizedUnitCost),
    pricePerUnit: roundCurrency(normalizedPrice),
    suggestedMsrpPerUnit: roundCurrency(normalizedMsrp),
    marginPerUnit: roundCurrency(marginPerUnit),
    marginPercent: Math.round(marginPercent * 100) / 100,
    projectedRevenue: roundCurrency(normalizedPrice * normalizedQty),
    projectedProfit: roundCurrency((normalizedPrice - normalizedUnitCost) * normalizedQty),
  };
}

function msrpSuggestion(unitCost, desiredMarginPercent = 60) {
  const normalizedUnitCost = Math.max(0, Number(unitCost) || 0);
  const marginPct = Math.min(95, Math.max(1, Number(desiredMarginPercent) || 60));
  if (normalizedUnitCost <= 0) return 0;
  return roundCurrency(normalizedUnitCost / (1 - marginPct / 100));
}

function getLotUnitCost(lot = {}) {
  const explicit =
    lot?.costs?.unitCost ??
    lot?.unitCost ??
    lot?.costPerUnit ??
    lot?.pricing?.unitCost ??
    0;
  const normalizedExplicit = Math.max(0, Number(explicit) || 0);
  if (normalizedExplicit > 0) return roundCurrency(normalizedExplicit);

  const batchTotal =
    lot?.costs?.batchTotalCost ??
    lot?.batchTotalCost ??
    lot?.costs?.totalCost ??
    lot?.totalCost ??
    0;
  const quantity = Number(lot?.initialQuantity || lot?.quantity || 0) || 0;
  if (quantity > 0 && Number(batchTotal) > 0) {
    return roundCurrency(Number(batchTotal) / quantity);
  }
  return 0;
}


function inferCapsuleFillWeightGFromText(...values) {
  const text = values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  if (!text) return 0;

  const explicitMgMatch = text.match(/(?:^|[^0-9])([1-9][0-9]{1,3})\s*(?:mg|milligrams?)\b/i);
  if (explicitMgMatch) {
    const mg = Math.max(0, Number(explicitMgMatch[1]) || 0);
    if (mg >= 25 && mg <= 1500) return Math.round((mg / 1000) * 10000) / 10000;
  }

  const gramsMatch = text.match(/(?:^|[^0-9])([0-9]+(?:\.[0-9]+)?)\s*g(?:ram|rams)?\b/i);
  if (gramsMatch) {
    const grams = Math.max(0, Number(gramsMatch[1]) || 0);
    if (grams > 0 && grams <= 2) return Math.round(grams * 10000) / 10000;
  }

  const codeMatch = text.match(/(?:^|[-_\s])([1-9][0-9]{2,3})(?:mg)?(?:$|[-_\s])/i);
  if (codeMatch) {
    const mg = Math.max(0, Number(codeMatch[1]) || 0);
    if (mg >= 100 && mg <= 1500) return Math.round((mg / 1000) * 10000) / 10000;
  }

  return 0;
}

function calculateCapsuleAverageFromTotals(totalPowderUsedG = 0, capsulesMade = 0) {
  const total = Math.max(0, Number(totalPowderUsedG) || 0);
  const capsules = Math.max(0, Math.floor(Number(capsulesMade) || 0));
  if (total <= 0 || capsules <= 0) return 0;
  return Math.round((total / capsules) * 10000) / 10000;
}

function roundCapsuleAverageG(value = 0) {
  const n = Math.max(0, Number(value) || 0);
  return n > 0 ? Math.round(n * 10000) / 10000 : 0;
}

function capsuleMgToGrams(value = 0) {
  const mg = Math.max(0, Number(value) || 0);
  if (mg >= 25 && mg <= 1500) return roundCapsuleAverageG(mg / 1000);
  return 0;
}

function getExplicitCapsuleFillWeightG(lot = {}) {
  const targetFill = Number(
    lot?.targetCapsuleFillG ??
      lot?.productionMetrics?.targetCapsuleFillG ??
      lot?.formulaTotals?.targetCapsuleFillG ??
      lot?.labelMetadata?.targetCapsuleFillG ??
      0
  );
  if (Number.isFinite(targetFill) && targetFill > 0) return roundCapsuleAverageG(targetFill);

  const mgFill = capsuleMgToGrams(
    lot?.mgPerUnit ??
      lot?.capsuleFillMg ??
      lot?.productionMetrics?.mgPerUnit ??
      lot?.labelMetadata?.mgPerUnit ??
      lot?.labelMetadata?.capsuleFillMg ??
      0
  );
  if (mgFill > 0) return mgFill;

  return inferCapsuleFillWeightGFromText(
    lot?.perCapsule,
    lot?.labelMetadata?.perCapsule,
    lot?.labelMetadata?.averageWeightPerCapsuleG,
    lot?.name,
    lot?.batchName,
    lot?.lotCode,
    lot?.batchLot,
    lot?.variant,
    lot?.variantTag,
    lot?.labelMetadata?.productName
  );
}

function resolveCapsuleAverageForPackagingG(candidateAverageG = 0, lot = {}) {
  const candidate = roundCapsuleAverageG(candidateAverageG);
  const explicitFill = getExplicitCapsuleFillWeightG(lot);

  // Legacy/seeded records can carry a stale calculated average while the actual
  // capsule fill is encoded as 500 mg / target fill / per-capsule label. When
  // that explicit fill is higher, use it for package-count math so 3.5 g at
  // 0.5 g/cap recommends 7 capsules instead of 12.
  if (explicitFill > 0 && (candidate <= 0 || explicitFill > candidate + 0.049)) {
    return explicitFill;
  }

  return candidate;
}

function getAverageSourceItemWeightG(lot = {}) {
  const direct = Number(
    lot?.actualAverageCapsuleWeightG ??
      lot?.actualAverageWeightPerCapsuleG ??
      lot?.productionMetrics?.actualAverageCapsuleWeightG ??
      lot?.labelMetadata?.actualAverageCapsuleWeightG ??
      lot?.package?.actualAverageCapsuleWeightG ??
      lot?.package?.averageWeightPerItemG ??
      lot?.package?.averageWeightPerCapsuleG ??
      lot?.gramsPerUnit ??
      lot?.labelMetadata?.averageWeightPerCapsuleG ??
      lot?.labelMetadata?.perUnitGrams ??
      0
  );
  if (Number.isFinite(direct) && direct > 0) return resolveCapsuleAverageForPackagingG(direct, lot);

  const fromProductionTotals = calculateCapsuleAverageFromTotals(
    lot?.totalPowderUsedG ?? lot?.productionMetrics?.totalPowderUsedG ?? 0,
    lot?.capsulesMade ?? lot?.actualOutputCount ?? lot?.outputCount ?? lot?.initialQuantity ?? 0
  );
  if (fromProductionTotals > 0) return resolveCapsuleAverageForPackagingG(fromProductionTotals, lot);

  const formulaAverage = Number(
    lot?.formulaTotals?.gramsPerCapsule ??
      lot?.productionMetrics?.formulaTotalGramsPerCapsule ??
      lot?.targetCapsuleFillG ??
      lot?.productionMetrics?.targetCapsuleFillG ??
      lot?.labelMetadata?.targetCapsuleFillG ??
      0
  );
  if (Number.isFinite(formulaAverage) && formulaAverage > 0) return resolveCapsuleAverageForPackagingG(formulaAverage, lot);

  const inferredFromText = getExplicitCapsuleFillWeightG(lot);
  if (inferredFromText > 0) return inferredFromText;

  const totalWeightRaw = String(lot?.totalWeight || lot?.labelMetadata?.totalWeight || "").trim();
  const totalMatch = totalWeightRaw.match(/([0-9]+(?:\.[0-9]+)?)/);
  const capsulesRaw = String(lot?.capsuleCount || lot?.labelMetadata?.capsuleCount || lot?.initialQuantity || "").trim();
  const capsuleMatch = capsulesRaw.match(/([0-9]+(?:\.[0-9]+)?)/);
  const totalWeight = totalMatch ? Number(totalMatch[1]) : 0;
  const capsuleCount = capsuleMatch ? Number(capsuleMatch[1]) : 0;
  const fromLabelTotals = calculateCapsuleAverageFromTotals(totalWeight, capsuleCount);
  if (fromLabelTotals > 0) return resolveCapsuleAverageForPackagingG(fromLabelTotals, lot);

  return 0;
}

function formatWeightG(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0 g";
  const rounded = Math.round(n * 1000) / 1000;
  return `${rounded} g`;
}

function formatMg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0 mg";
  const rounded = Math.round(n * 100) / 100;
  return `${String(rounded).replace(/\.00?$/, "")} mg`;
}

function readNestedNumber(record = {}, paths = []) {
  for (const path of paths) {
    const value = String(path || "").split(".").reduce((current, key) => current?.[key], record);
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function getRecipeBatchCostDefaults(recipe = {}) {
  return {
    packagingCost: readNestedNumber(recipe, ["packagingCost", "packagingCostPerBatch", "packagingCostPerRun", "costs.packagingCost", "costing.packagingCost"]),
    laborCost: readNestedNumber(recipe, ["laborCost", "laborCostPerBatch", "laborCostPerRun", "costs.laborCost", "costing.laborCost"]),
    overheadCost: readNestedNumber(recipe, ["overheadCost", "overheadCostPerBatch", "costs.overheadCost", "costing.overheadCost"]),
    otherCost: readNestedNumber(recipe, ["otherCost", "otherCostPerBatch", "costs.otherCost", "costing.otherCost"]),
  };
}


function formatCleanWeightG(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0 g";
  const factor = 10 ** digits;
  const rounded = Math.round(n * factor) / factor;
  return `${String(rounded).replace(/\.0$/, "")} g`;
}

function getRecommendedCapsulesForTargetWeight(targetWeightG = 0, actualAverageCapsuleWeightG = 0) {
  const target = Math.max(0, Number(targetWeightG) || 0);
  const actualAverage = Math.max(0, Number(actualAverageCapsuleWeightG) || 0);
  if (target <= 0 || actualAverage <= 0) return 0;
  return Math.max(1, Math.round(target / actualAverage));
}

function getConservativeDisplayCapsuleWeightG(actualAverageCapsuleWeightG = 0) {
  const actualAverage = Math.max(0, Number(actualAverageCapsuleWeightG) || 0);
  if (actualAverage <= 0) return 0;
  const commonCleanWeights = [1, 0.9, 0.8, 0.75, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05];
  const cleanWeight = commonCleanWeights.find((candidate) => candidate <= actualAverage + 1e-9);
  if (cleanWeight) return Math.round(cleanWeight * 100) / 100;
  return Math.round(actualAverage * 1000) / 1000;
}

function buildCapsuleDisplayDose({ actualAverageCapsuleWeightG = 0, capsulesPerPackage = 0 } = {}) {
  const actualAverage = Math.round(Math.max(0, Number(actualAverageCapsuleWeightG) || 0) * 10000) / 10000;
  const capsuleCount = Math.max(0, Math.floor(Number(capsulesPerPackage) || 0));
  const displayAverage = getConservativeDisplayCapsuleWeightG(actualAverage);
  const displayTotal = displayAverage > 0 && capsuleCount > 0
    ? Math.round(displayAverage * capsuleCount * 10) / 10
    : 0;
  return {
    actualAverageCapsuleWeightG: actualAverage,
    displayAverageCapsuleWeightG: displayAverage,
    displayTotalWeightG: displayTotal,
    perCapsuleLabel: displayAverage > 0 ? `≈ ${formatCleanWeightG(displayAverage, displayAverage < 0.1 ? 3 : 1)}` : "Not set",
    totalWeightLabel: displayTotal > 0 ? `≈ ${formatCleanWeightG(displayTotal, 1)}` : "Not set",
  };
}

function getProductionFormulaConfig(productType = "capsule") {
  const key = String(productType || "capsule").trim().toLowerCase();
  if (key === "gummy" || key === "gummies") {
    return {
      key: "gummy",
      title: "Gummy formula calculator",
      outputLabel: "Gummies made",
      unitLabel: "gummy",
      unitLabelPlural: "gummies",
      amountLabel: "source qty / gummy",
      presets: [25, 50, 75, 100],
      presetSuffix: "gummies",
    };
  }
  if (key === "chocolate" || key === "chocolates") {
    return {
      key: "chocolate",
      title: "Chocolate formula calculator",
      outputLabel: "Chocolate pieces made",
      unitLabel: "piece",
      unitLabelPlural: "pieces",
      amountLabel: "source qty / piece",
      presets: [12, 24, 48, 96],
      presetSuffix: "pieces",
    };
  }
  if (key === "tincture" || key === "tinctures") {
    return {
      key: "tincture",
      title: "Tincture formula calculator",
      outputLabel: "Finished tincture volume (mL)",
      unitLabel: "mL",
      unitLabelPlural: "mL",
      amountLabel: "source qty / finished mL",
      presets: [30, 60, 120, 240],
      presetSuffix: "mL",
    };
  }
  return {
    key: "capsule",
    title: "Capsule goal-weight / formula calculator",
    outputLabel: "Capsules made",
    unitLabel: "capsule",
    unitLabelPlural: "capsules",
    amountLabel: "source qty / capsule",
    presets: [25, 50, 75, 100],
    presetSuffix: "caps",
  };
}

function formatFormulaQuantity(value = 0, unit = "g") {
  const normalizedUnit = normalizePackageUnit(unit || "g");
  const digits = normalizedUnit === "g" || normalizedUnit === "mL" ? 3 : 2;
  return formatQty(value, unit || normalizedUnit || "unit", digits);
}

function buildCapsuleFormulaPlan(form = {}, sourceLots = []) {
  const config = getProductionFormulaConfig(form.productType);
  const outputQuantity = Math.max(0, Number(form.outputCount) || 0);
  const sourceById = new Map((Array.isArray(sourceLots) ? sourceLots : []).map((lot) => [lot.id, lot]));
  const rawRows = Array.isArray(form.formulaRows) ? form.formulaRows : [];

  const rows = rawRows
    .map((row, index) => {
      const sourceLot = sourceById.get(row?.sourceLotId) || null;
      const sourceUnit = sourceLot?.unit || row?.sourceUnit || "g";
      const normalizedSourceUnit = normalizePackageUnit(sourceUnit);
      const amountPerUnit = Math.max(0, Number(row?.amountPerUnit ?? row?.gramsPerCapsule) || 0);
      const totalRequired = Math.round(amountPerUnit * outputQuantity * 1000) / 1000;
      const available = sourceLot ? getLotAvailableQuantity(sourceLot) : 0;
      const shortage = sourceLot ? Math.max(0, Math.round((totalRequired - available) * 1000) / 1000) : 0;
      return {
        id: row?.id || `formula_${index + 1}`,
        ingredientName: String(row?.ingredientName || row?.name || "").trim(),
        sourceLotId: row?.sourceLotId || "",
        sourceLotName: sourceLot?.name || "",
        sourceUnit,
        normalizedSourceUnit,
        amountPerUnit: Math.round(amountPerUnit * 100000) / 100000,
        gramsPerCapsule: config.key === "capsule" && normalizedSourceUnit === "g" ? Math.round(amountPerUnit * 100000) / 100000 : 0,
        percent: 0,
        totalRequired,
        totalPowderG: normalizedSourceUnit === "g" ? totalRequired : 0,
        available,
        shortage,
        unit: sourceUnit,
      };
    })
    .filter((row) => row.ingredientName || row.sourceLotId || row.amountPerUnit > 0);

  const perUnitTotals = {};
  const batchTotals = {};
  rows.forEach((row) => {
    const unit = row.sourceUnit || "g";
    perUnitTotals[unit] = Math.round(((perUnitTotals[unit] || 0) + row.amountPerUnit) * 100000) / 100000;
    batchTotals[unit] = Math.round(((batchTotals[unit] || 0) + row.totalRequired) * 1000) / 1000;
  });

  const totalPerCapsuleG = Math.round(rows.filter((row) => row.normalizedSourceUnit === "g").reduce((sum, row) => sum + row.amountPerUnit, 0) * 100000) / 100000;
  const totalPowderNeededG = Math.round(rows.filter((row) => row.normalizedSourceUnit === "g").reduce((sum, row) => sum + row.totalRequired, 0) * 1000) / 1000;
  const totalLiquidNeededMl = Math.round(rows.filter((row) => row.normalizedSourceUnit === "mL").reduce((sum, row) => sum + row.totalRequired, 0) * 1000) / 1000;
  const inventoryGuards = rows.filter((row) => row.sourceLotId && row.shortage > 0);
  const displayDose = buildCapsuleDisplayDose({ actualAverageCapsuleWeightG: totalPerCapsuleG, capsulesPerPackage: outputQuantity });
  const perUnitSummary = Object.entries(perUnitTotals).map(([unit, total]) => `${formatFormulaQuantity(total, unit)} / ${config.unitLabel}`).join(" · ") || "Build formula";
  const batchTotalSummary = Object.entries(batchTotals).map(([unit, total]) => formatFormulaQuantity(total, unit)).join(" · ") || "0";

  const rowsWithShares = rows.map((row) => {
    const unitTotal = perUnitTotals[row.sourceUnit] || 0;
    return {
      ...row,
      percent: unitTotal > 0 ? Math.round((row.amountPerUnit / unitTotal) * 10000) / 100 : 0,
    };
  });

  return {
    config,
    capsuleCount: outputQuantity,
    outputQuantity,
    targetFillG: totalPerCapsuleG,
    rows: rowsWithShares,
    totalPerCapsuleG,
    totalPowderNeededG,
    totalLiquidNeededMl,
    perUnitTotals,
    batchTotals,
    perUnitSummary,
    batchTotalSummary,
    targetDeltaG: 0,
    formulaMatchesTarget: rows.length === 0 || rows.some((row) => row.amountPerUnit > 0),
    inventoryGuards,
    displayDose,
  };
}

function getDuplicateFormulaLabels(rows = []) {
  const seenNames = new Map();
  const seenSources = new Map();
  const duplicates = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const name = String(row?.ingredientName || row?.name || "").trim().toLowerCase();
    if (name) {
      if (seenNames.has(name)) duplicates.add(String(row?.ingredientName || row?.name || name));
      seenNames.set(name, true);
    }
    const source = String(row?.sourceLotId || "").trim();
    if (source) {
      if (seenSources.has(source)) duplicates.add(row?.ingredientName || row?.sourceLotName || "same source lot");
      seenSources.set(source, true);
    }
  });
  return Array.from(duplicates);
}

function suggestedRetailPrice(unitCost = 0, desiredMarginPercent = 60) {
  const cost = Math.max(0, Number(unitCost) || 0);
  const margin = Math.min(95, Math.max(1, Number(desiredMarginPercent) || 60));
  if (cost <= 0) return 0;
  return Math.round((cost / (1 - margin / 100)) * 100) / 100;
}

function getLockedPackageCost(lot = {}) {
  return roundCurrency(
    lot?.package?.costPerPackage ??
      lot?.package?.totalCostPerPackage ??
      lot?.pricing?.unitCost ??
      lot?.unitCost ??
      lot?.costPerUnit ??
      0
  );
}

function getLockedPackageMsrp(lot = {}) {
  return roundCurrency(
    lot?.suggestedMsrpPerPackage ??
      lot?.package?.suggestedMsrpPerPackage ??
      lot?.labelMetadata?.suggestedMsrpPerPackage ??
      lot?.msrpPerUnit ??
      lot?.pricing?.suggestedMsrpPerUnit ??
      0
  );
}

function getLockedPackagePrice(lot = {}) {
  const explicit = roundCurrency(
    lot?.pricePerUnit ??
      lot?.package?.defaultSalePricePerPackage ??
      lot?.labelMetadata?.defaultSalePricePerPackage ??
      lot?.pricing?.pricePerUnit ??
      0
  );
  if (explicit > 0) return explicit;
  return getSkuType(lot) === "retail" ? getLockedPackageMsrp(lot) : 0;
}

function getOutboundQuantity(lot = {}, key = "") {
  const value = Number(lot?.outboundSummary?.[key] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getRemainingProjectedRevenue(lot = {}) {
  const available = Math.max(0, Number(getLotAvailableQuantity(lot)) || 0);
  const lockedPrice = Math.max(0, Number(getLockedPackagePrice(lot)) || 0);
  return roundCurrency(available * lockedPrice);
}

function pricesDiffer(a = 0, b = 0) {
  return Math.abs(roundCurrency(a) - roundCurrency(b)) >= 0.01;
}

function getDefaultMovementFormForLot(lot = {}, today = "") {
  const skuType = getSkuType(lot);
  const base = normalizeMovementForm(today);
  const defaultPrice = getLockedPackagePrice(lot);
  const unitPrice = defaultPrice > 0 ? String(defaultPrice) : "";
  const priceDefaults = {
    unitPrice,
    priceManuallyChanged: false,
    priceOverrideType: "",
    priceOverrideReason: "",
  };

  if (skuType === "sample") {
    return { ...base, ...priceDefaults, movementType: "sample", destinationType: "internal" };
  }
  if (skuType === "promo") {
    return { ...base, ...priceDefaults, movementType: "sample", destinationType: "event" };
  }
  if (skuType === "internal") {
    return { ...base, ...priceDefaults, movementType: "sample", destinationType: "internal" };
  }
  return { ...base, ...priceDefaults, movementType: "sell", destinationType: "customer" };
}

function getDefaultFinalDispositionForm(lot = {}, today = "") {
  const state = getMaterialLotFinalDispositionState(lot, today);
  return {
    quantity: String(getLotAvailableQuantity(lot) || ""),
    date: today,
    method: state.recommendedMethod || "discarded",
    reason: state.reasonLabel || "",
    note: "",
  };
}

function getSalePriceOverrideState(lot = {}, form = {}) {
  const defaultPrice = getLockedPackagePrice(lot);
  const actualPrice = roundCurrency(form?.unitPrice === "" || form?.unitPrice === undefined ? defaultPrice : Number(form?.unitPrice) || 0);
  const unitCost = getLockedPackageCost(lot);
  const isSell = String(form?.movementType || "").toLowerCase() === "sell";
  const priceManuallyChanged = Boolean(form?.priceManuallyChanged);
  const override = isSell && priceManuallyChanged && pricesDiffer(actualPrice, defaultPrice);
  const belowCost = isSell && priceManuallyChanged && actualPrice > 0 && unitCost > 0 && actualPrice < unitCost;
  const requiresMemo = override || belowCost;
  return {
    defaultPrice,
    actualPrice,
    unitCost,
    override,
    belowCost,
    nonRetailSale: isSell && getSkuType(lot) !== "retail",
    requiresMemo,
    priceManuallyChanged,
    difference: roundCurrency(actualPrice - defaultPrice),
  };
}

function getReleaseStateForSales(lot = {}) {
  const workflow = lot?.workflow && typeof lot.workflow === "object" ? lot.workflow : {};
  const releaseRequired = Boolean(workflow?.releaseRequired ?? lot?.releaseRequired ?? false);
  const releaseStatus = String(workflow?.releaseStatus || lot?.releaseStatus || (releaseRequired ? "pending" : "released")).trim().toLowerCase() || (releaseRequired ? "pending" : "released");
  return {
    releaseRequired,
    releaseStatus,
    blocked: releaseRequired && releaseStatus !== "released",
  };
}

function getSalesBlockReason(lot = {}, today = "") {
  const workflow = lot?.workflow && typeof lot.workflow === "object" ? lot.workflow : {};
  const recalled = Boolean(workflow?.recalled ?? lot?.recalled);
  const quarantined = Boolean(workflow?.quarantined ?? lot?.quarantined);
  const qcHold = Boolean(workflow?.qcHold ?? lot?.qcHold);
  if (recalled) return "This package run is recalled and cannot be sold.";
  if (quarantined) return "This package run is quarantined and cannot be sold.";
  if (qcHold) return "This package run is on QC hold and cannot be sold.";

  const releaseState = getReleaseStateForSales(lot);
  if (releaseState.blocked) {
    return "This package run has not been released for sale.";
  }

  const qcStatus = String(lot?.qc?.status || lot?.qcStatus || "").trim().toLowerCase();
  if (["fail", "failed", "rejected"].includes(qcStatus)) return "This package run failed QC and cannot be sold.";

  const shelfLife = lot?.shelfLife && typeof lot.shelfLife === "object" ? lot.shelfLife : {};
  const bestBy = shelfLife?.bestBy || shelfLife?.expirationDate || lot?.bestBy || lot?.expirationDate || "";
  const bestByDate = parseAnyDate(bestBy);
  const todayDate = parseAnyDate(today || toLocalYYYYMMDD(new Date()));
  if (bestByDate && todayDate) {
    const target = new Date(bestByDate);
    const current = new Date(todayDate);
    target.setHours(0, 0, 0, 0);
    current.setHours(0, 0, 0, 0);
    if (target < current) return "This package run is past best-by date and cannot be sold.";
  }

  return "";
}

function normalizePackageUnit(unit = "") {
  const raw = String(unit || "").trim().toLowerCase();
  if (!raw) return "unit";
  if (["g", "gram", "grams"].includes(raw)) return "g";
  if (["oz", "ounce", "ounces"].includes(raw)) return "oz";
  if (["ml", "milliliter", "milliliters"].includes(raw)) return "mL";
  if (["capsule", "capsules", "cap", "caps"].includes(raw)) return "capsules";
  if (["piece", "pieces", "count", "unit", "units"].includes(raw)) return "unit";
  return raw;
}

function getPackageCapsulesPerPackage(lot = {}) {
  const n = Number(
    lot?.capsulesPerPackage ??
      lot?.package?.capsulesPerPackage ??
      lot?.labelMetadata?.capsulesPerPackage ??
      0
  );
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function getPackageActualWeightG(lot = {}) {
  const direct = Number(
    lot?.actualPackageWeightG ??
      lot?.package?.actualWeightG ??
      lot?.labelMetadata?.actualPackageWeightG ??
      0
  );
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct * 1000) / 1000;

  const totalWeight = String(
    lot?.totalWeight ?? lot?.labelMetadata?.totalWeight ?? ""
  ).trim();
  const parsed = Number(totalWeight.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1] || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getPackageWeightLabel(lot = {}) {
  const weight = getPackageActualWeightG(lot);
  if (weight <= 0) return "Not set";
  return `≈ ${formatCleanWeightG(weight, weight < 1 ? 3 : 1)}`;
}

function getPackagePerCapsuleLabel(lot = {}) {
  const direct = String(
    lot?.perCapsule ?? lot?.labelMetadata?.perCapsule ?? ""
  ).trim();
  if (direct) return direct;

  const grams = Number(
    lot?.averageWeightPerCapsuleG ??
      lot?.package?.averageWeightPerCapsuleG ??
      lot?.labelMetadata?.averageWeightPerCapsuleG ??
      0
  );
  if (!Number.isFinite(grams) || grams <= 0) return "Not set";
  return `≈ ${formatCleanWeightG(grams, grams < 0.1 ? 3 : 1)}`;
}

function getPackageTargetSizeLabel(lot = {}) {
  const size = Number(
    lot?.targetPackageSize ??
      lot?.package?.targetSize ??
      lot?.labelMetadata?.targetPackageSize ??
      0
  );
  const unit = normalizePackageUnit(
    lot?.targetPackageSizeUnit ??
      lot?.package?.targetUnit ??
      lot?.labelMetadata?.targetPackageSizeUnit ??
      ""
  );
  if (!Number.isFinite(size) || size <= 0) return "Not set";
  return `${size} ${unit}`.trim();
}

function getPackageSizeLabel(lot = {}) {
  const size = lot?.packageSize ?? lot?.package?.size ?? lot?.labelMetadata?.packageSize ?? "";
  const unit = normalizePackageUnit(
    lot?.packageSizeUnit ?? lot?.package?.unit ?? lot?.labelMetadata?.packageSizeUnit ?? ""
  );
  const count = Number(lot?.packageCount ?? lot?.package?.count ?? lot?.initialQuantity ?? 0) || 0;
  const explicit = String(lot?.packageSizeLabel || lot?.package?.label || lot?.labelMetadata?.packageSizeLabel || "").trim();
  if (explicit) return explicit;

  const capsulesPerPackage = getPackageCapsulesPerPackage(lot);
  const actualWeightG = getPackageActualWeightG(lot);
  if (capsulesPerPackage > 0 && actualWeightG > 0) {
    return `${capsulesPerPackage} capsules · ≈ ${formatCleanWeightG(actualWeightG, actualWeightG < 1 ? 3 : 1)}`;
  }

  if (size !== "" && size !== null && size !== undefined && Number(size) > 0) return `${size} ${unit}`.trim();
  return count > 0 ? `${count} sellable units` : "Sellable unit";
}

function getPackageUnitName(lot = {}, meta = {}) {
  const unit = String(lot?.packageUnitLabel || lot?.sellableUnitLabel || "").trim();
  if (unit) return unit;
  return meta?.pieceLabelPlural || "units";
}

function getSkuType(lot = {}) {
  const raw = String(
    lot?.skuType ||
      lot?.packageSkuType ||
      lot?.package?.skuType ||
      lot?.labelMetadata?.skuType ||
      "retail"
  )
    .trim()
    .toLowerCase();
  if (["sample", "samples"].includes(raw)) return "sample";
  if (["promo", "promotion", "event"].includes(raw)) return "promo";
  if (["internal", "internal_use", "testing", "retention"].includes(raw)) return "internal";
  return "retail";
}

function getSkuTypeLabel(value = "") {
  const key = String(value || "retail").trim().toLowerCase();
  if (key === "sample") return "Sample";
  if (key === "promo") return "Promo / event";
  if (key === "internal") return "Internal / testing";
  return "Retail";
}

function getSalesProductKey(lot = {}) {
  return [
    lot?.productType || lot?.finishedGoodType || lot?.lotType,
    lot?.strainName || lot?.strain || lot?.sourceStrain,
    lot?.variantTag || lot?.variant,
    lot?.batchName || lot?.sourceBatchId || lot?.sourceLotId || "batch",
  ]
    .map(normalizeSalesKeyPart)
    .filter(Boolean)
    .join("|");
}

function getSalesProductLabel(lot = {}) {
  return (
    String(lot?.strainName || lot?.strain || lot?.sourceStrain || "").trim() ||
    String(lot?.batchName || lot?.name || "Finished product").trim() ||
    "Finished product"
  );
}

function getSkuGroupKey(lot = {}) {
  return [getSkuType(lot), getPackageSizeLabel(lot)]
    .map(normalizeSalesKeyPart)
    .filter(Boolean)
    .join("|");
}

function getSkuGroupLabel(lot = {}) {
  return `${getSkuTypeLabel(getSkuType(lot))} · ${getPackageSizeLabel(lot)}`;
}

function isPackagedForSale(lot = {}) {
  if (lot?.package?.isPackaged === true) return true;
  if (String(lot?.sourceType || "").trim().toLowerCase() === "finished_package") return true;
  if (lot?.packageRunId && (lot?.parentLotId || lot?.sourceLotId)) return true;
  return false;
}

function normalizePackageForm(today, sourceLotId = "") {
  return {
    sourceLotId,
    packageRecipeId: "",
    skuType: "retail",
    packageSize: "",
    packageSizeUnit: "g",
    packageCount: "",
    sourceQuantity: "",
    capsulesPerPackage: "",
    packageUnitLabel: "packages",
    lotCode: "",
    pricePerUnit: "",
    msrpPerUnit: "",
    desiredMarginPercent: "60",
    packagingCostPerPackage: "",
    laborCostPerPackage: "",
    otherCostPerPackage: "",
    date: today,
    notes: "",
  };
}

function isCountBasedSource(sourceLot = {}) {
  const sourceUnit = normalizePackageUnit(sourceLot?.unit || "count");
  const meta = getProductTypeMeta(sourceLot?.productType || sourceLot?.finishedGoodType || sourceLot?.lotType);
  return sourceUnit === "unit" || sourceUnit === "capsules" || meta.key === "capsule";
}

function getSourceUnitText(sourceLot = {}, meta = {}) {
  return sourceLot?.unitLabel || sourceLot?.unit || meta.pieceLabelPlural || "units";
}

function buildPackagePreview(form = {}, sourceLot = {}) {
  const packageCount = Math.max(0, Math.floor(Number(form.packageCount) || 0));
  const packageSize = Math.max(0, Number(form.packageSize) || 0);
  const rawCapsulesPerPackage = Math.max(0, Math.floor(Number(form.capsulesPerPackage) || 0));
  const explicitSourceQuantity = Number(form.sourceQuantity);
  const available = getLotAvailableQuantity(sourceLot);
  const unit = normalizePackageUnit(form.packageSizeUnit || "g");
  const sourceUnit = normalizePackageUnit(sourceLot?.unit || "count");
  const countBasedSource = isCountBasedSource(sourceLot);
  const averageItemWeightG = getAverageSourceItemWeightG(sourceLot);
  const hasExplicitSourceQuantity = Number.isFinite(explicitSourceQuantity) && explicitSourceQuantity > 0;
  const recommendedCapsulesPerPackage = unit === "g" && countBasedSource && averageItemWeightG > 0
    ? getRecommendedCapsulesForTargetWeight(packageSize, averageItemWeightG)
    : (unit === "capsules" || unit === "unit")
      ? Math.max(0, Math.floor(packageSize))
      : 0;
  const estimatedCapsulesPerPackage = rawCapsulesPerPackage > 0
    ? rawCapsulesPerPackage
    : recommendedCapsulesPerPackage;
  const manualCapsuleOverride = unit === "g" && rawCapsulesPerPackage > 0 && (recommendedCapsulesPerPackage <= 0 || rawCapsulesPerPackage !== recommendedCapsulesPerPackage);

  let sourceQuantity = 0;

  if (countBasedSource) {
    sourceQuantity = estimatedCapsulesPerPackage > 0 ? packageCount * estimatedCapsulesPerPackage : 0;
  } else if (hasExplicitSourceQuantity) {
    sourceQuantity = explicitSourceQuantity;
  } else if (unit === "g" && sourceUnit === "g") {
    sourceQuantity = packageCount * packageSize;
  } else {
    sourceQuantity = packageCount * packageSize;
  }

  const displayDose = buildCapsuleDisplayDose({
    actualAverageCapsuleWeightG: averageItemWeightG,
    capsulesPerPackage: estimatedCapsulesPerPackage,
  });
  const actualWeightPerPackageG = estimatedCapsulesPerPackage > 0 && averageItemWeightG > 0
    ? Math.round(estimatedCapsulesPerPackage * averageItemWeightG * 1000) / 1000
    : unit === "g" && !countBasedSource
      ? packageSize
      : 0;
  const totalWeightPerPackageG = displayDose.displayTotalWeightG || (unit === "g" ? packageSize : actualWeightPerPackageG);

  const roundedSourceQuantity = Math.round(Math.max(0, sourceQuantity) * 1000) / 1000;
  const sourceUnitCost = getLotUnitCost(sourceLot);
  const totalMaterialCost = Math.round(roundedSourceQuantity * sourceUnitCost * 10000) / 10000;
  const materialCostPerPackage = packageCount > 0 ? Math.round((totalMaterialCost / packageCount) * 10000) / 10000 : 0;
  const packagingCostPerPackage = roundCurrency(Math.max(0, Number(form.packagingCostPerPackage) || 0));
  const laborCostPerPackage = roundCurrency(Math.max(0, Number(form.laborCostPerPackage) || 0));
  const otherCostPerPackage = roundCurrency(Math.max(0, Number(form.otherCostPerPackage) || 0));
  const packageRecipeCostPerPackage = roundCurrency(Math.max(0, Number(form.packageRecipeCostPerPackage) || 0));
  const extraCostPerPackage = roundCurrency(packagingCostPerPackage + laborCostPerPackage + otherCostPerPackage + packageRecipeCostPerPackage);
  const costPerPackage = roundCurrency(materialCostPerPackage + extraCostPerPackage);
  const suggestedMsrp = suggestedRetailPrice(costPerPackage, Number(form.desiredMarginPercent) || 60);

  let guardMessage = "";
  if (packageCount <= 0) guardMessage = "Enter the number of packages to create.";
  else if (packageSize <= 0) guardMessage = "Enter the target weight or capsule count per package.";
  else if (countBasedSource && unit === "g" && averageItemWeightG <= 0) guardMessage = "Set the finished batch average capsule weight before creating gram-target package runs.";
  else if (countBasedSource && estimatedCapsulesPerPackage <= 0) guardMessage = "Enter a target weight or capsule count so source capsules can be calculated.";
  else if (manualCapsuleOverride && !String(form.notes || "").trim()) guardMessage = `Manual capsule override needs a package note. Recommended ${recommendedCapsulesPerPackage} capsules/package from actual batch average.`;
  else if (roundedSourceQuantity <= 0) guardMessage = "Enter package count and package size so the source usage can be calculated.";
  else if (roundedSourceQuantity > available) guardMessage = `Not enough source inventory. This package run needs ${roundedSourceQuantity}, but only ${available} is available.`;

  return {
    packageCount,
    packageSize,
    capsulesPerPackage: estimatedCapsulesPerPackage,
    recommendedCapsulesPerPackage,
    manualCapsuleOverride,
    sourceQuantity: roundedSourceQuantity,
    available,
    remainingAfter: Math.round(Math.max(0, available - Math.max(0, roundedSourceQuantity)) * 1000) / 1000,
    sourceUnitCost,
    totalMaterialCost,
    materialCostPerPackage,
    packagingCostPerPackage,
    laborCostPerPackage,
    otherCostPerPackage,
    packageRecipeCostPerPackage,
    extraCostPerPackage,
    costPerPackage,
    suggestedMsrp,
    averageItemWeightG,
    actualWeightPerPackageG,
    totalWeightPerPackageG,
    averageWeightPerCapsuleG: displayDose.displayAverageCapsuleWeightG || averageItemWeightG,
    displayDose,
    countBasedSource,
    guardMessage,
    canCreate: !guardMessage,
  };
}

function normalizeSalesKeyPart(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getSalesSkuKey(lot = {}) {
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
    lot?.productType || lot?.finishedGoodType || lot?.lotType,
    productIdentity,
    lot?.variantTag || lot?.variant,
    getSkuType(lot),
    getPackageSizeLabel(lot) || "default",
  ]
    .map(normalizeSalesKeyPart)
    .filter(Boolean)
    .join("|");
}

function getInventoryAgeMs(lot = {}) {
  const source =
    lot?.packDate ||
    lot?.labelMetadata?.packDate ||
    lot?.package?.packagedDate ||
    lot?.createdDate ||
    lot?.date ||
    lot?.updatedDate ||
    "";
  const parsed = parseAnyDate(source);
  return parsed ? parsed.getTime() : 0;
}

function getLotBestByValue(lot = {}) {
  return String(
    lot?.shelfLife?.bestBy ||
      lot?.shelfLife?.bestByDate ||
      lot?.shelfLife?.expirationDate ||
      lot?.bestBy ||
      lot?.expirationDate ||
      lot?.labelMetadata?.bestBy ||
      lot?.labelMetadata?.bestByDate ||
      ""
  ).trim();
}

function getLotBestByMs(lot = {}) {
  const parsed = parseAnyDate(getLotBestByValue(lot));
  if (!parsed) return Number.POSITIVE_INFINITY;
  const normalized = new Date(parsed);
  normalized.setHours(0, 0, 0, 0);
  return normalized.getTime();
}

function compareFefoPriority(a = {}, b = {}) {
  const bestByDifference = getLotBestByMs(a) - getLotBestByMs(b);
  if (Number.isFinite(bestByDifference) && bestByDifference !== 0) return bestByDifference;
  if (Number.isFinite(getLotBestByMs(a)) && !Number.isFinite(getLotBestByMs(b))) return -1;
  if (!Number.isFinite(getLotBestByMs(a)) && Number.isFinite(getLotBestByMs(b))) return 1;

  const ageDifference = getInventoryAgeMs(a) - getInventoryAgeMs(b);
  if (ageDifference !== 0) return ageDifference;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function getFefoBlockingLot(lot = {}, activeLots = [], today = "") {
  const key = getSalesSkuKey(lot);
  if (!key || !lot?.id) return null;

  return (
    (Array.isArray(activeLots) ? activeLots : [])
      .filter((candidate) => candidate?.id !== lot.id)
      .filter((candidate) => getLotAvailableQuantity(candidate) > 0)
      .filter((candidate) => getSalesSkuKey(candidate) === key)
      .filter((candidate) => !getSalesBlockReason(candidate, today))
      .filter((candidate) => compareFefoPriority(candidate, lot) < 0)
      .sort(compareFefoPriority)[0] || null
  );
}

function computeRecipeCost(recipe, outputCount, supplyById) {
  if (!recipe) {
    return {
      recipeId: "",
      recipeName: "",
      recipeYield: 0,
      recipeItems: [],
      factor: 1,
      totalCost: 0,
      breakdown: [],
    };
  }

  const baseYield = Math.max(1, Number(recipe?.yield) || 1);
  const targetYield = Math.max(1, Number(outputCount) || baseYield);
  const factor = targetYield / baseYield;

  const breakdown = (Array.isArray(recipe?.items) ? recipe.items : []).map((item) => {
    const supply = supplyById.get(item?.supplyId) || null;
    const supplyType = String(supply?.type || "").toLowerCase();
    const supplyUnit = String(supply?.unit || item?.unit || "").toLowerCase();
    const reusable =
      (supplyType === "container" || supplyType === "tool") &&
      (supplyUnit === "count" || supplyUnit === "piece");
    const unitCost = Math.max(0, Number(supply?.cost || 0) || 0);
    const baseAmount = Math.max(0, Number(item?.amount || 0) || 0);
    const scaledAmount = baseAmount * factor;
    const totalCost = reusable ? 0 : roundCurrency(unitCost * scaledAmount);

    return {
      supplyId: item?.supplyId || "",
      supplyName: supply?.name || item?.supplyName || "Unknown supply",
      baseAmount,
      scaledAmount: Math.round(scaledAmount * 1000) / 1000,
      unit: supply?.unit || item?.unit || "",
      unitCost: roundCurrency(unitCost),
      totalCost,
      reusable,
    };
  });

  return {
    recipeId: recipe?.id || "",
    recipeName: recipe?.name || "",
    recipeYield: baseYield,
    recipeItems: Array.isArray(recipe?.items) ? recipe.items : [],
    factor,
    totalCost: roundCurrency(
      breakdown.reduce((sum, item) => sum + (Number(item.totalCost) || 0), 0)
    ),
    breakdown,
  };
}

function getQtyDigits(unit = "") {
  return String(unit || "").trim().toLowerCase() === "count" ? 0 : 2;
}

function buildReservationEntryId() {
  return `reservation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sumReservationEntries(entries = []) {
  return Math.round(
    (Array.isArray(entries) ? entries : []).reduce(
      (sum, entry) => sum + (Number(entry?.quantity) || 0),
      0
    ) * 1000
  ) / 1000;
}

function normalizeReservationForm(today) {
  return {
    label: "",
    quantity: "",
    date: today,
    note: "",
  };
}

function LotInventoryControls({
  lot,
  today,
  reservationForm,
  onReservationChange,
  onSaveReservation,
  onRemoveReservation,
  thresholdValue,
  onThresholdChange,
  onSaveThreshold,
  reservationBusyId,
  thresholdBusyId,
}) {
  const unit = lot?.displayUnitLabel || lot?.unit || (isFinishedGoodsLot(lot) ? "count" : "g");
  const digits = getQtyDigits(unit);
  const reservations = getLotReservations(lot);
  const reservedQty = getLotReservedQuantity(lot);
  const availableQty = getLotAvailableQuantity(lot);
  const lowStockThreshold = getLowStockThreshold(lot);
  const lowStock = isLowStockLot(lot);
  const thresholdDraft = thresholdValue ?? (lowStockThreshold > 0 ? String(lowStockThreshold) : "");

  return (
    <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">Reservation and stock controls</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Reservations are soft holds that reduce available inventory inside Post Processing without touching the ledger.
          </div>
        </div>
        {lowStock ? (
          <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-3 py-1 text-xs font-medium">
            Low stock
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
        <DetailStat label="Available to use" value={formatQty(availableQty, unit, digits)} />
        <DetailStat label="Reserved" value={formatQty(reservedQty, unit, digits)} />
        <DetailStat
          label="Low-stock threshold"
          value={lowStockThreshold > 0 ? formatQty(lowStockThreshold, unit, digits) : "Disabled"}
        />
        <DetailStat label="Open holds" value={String(reservations.length)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.85fr_0.85fr_auto] gap-3">
        <label className="space-y-1 text-sm block">
          <span className="text-zinc-600 dark:text-zinc-400">Reservation label</span>
          <input
            type="text"
            value={reservationForm.label}
            onChange={(e) => onReservationChange({ ...reservationForm, label: e.target.value })}
            placeholder="Order, event, donation, recipe"
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm block">
          <span className="text-zinc-600 dark:text-zinc-400">Reserve qty</span>
          <input
            type="number"
            min="0"
            step={digits === 0 ? "1" : "0.01"}
            value={reservationForm.quantity}
            onChange={(e) => onReservationChange({ ...reservationForm, quantity: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm block">
          <span className="text-zinc-600 dark:text-zinc-400">Hold date</span>
          <input
            type="date"
            value={reservationForm.date || today}
            onChange={(e) => onReservationChange({ ...reservationForm, date: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={onSaveReservation}
            disabled={reservationBusyId === lot.id}
            className="w-full btn btn-accent disabled:opacity-60 text-sm justify-center"
          >
            {reservationBusyId === lot.id ? "Saving..." : "Add Hold"}
          </button>
        </div>
      </div>

      <label className="space-y-1 text-sm block">
        <span className="text-zinc-600 dark:text-zinc-400">Reservation note</span>
        <input
          type="text"
          value={reservationForm.note}
          onChange={(e) => onReservationChange({ ...reservationForm, note: e.target.value })}
          placeholder="Optional note"
          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
        />
      </label>

      <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_auto] gap-3 items-end">
        <label className="space-y-1 text-sm block">
          <span className="text-zinc-600 dark:text-zinc-400">Low-stock threshold</span>
          <input
            type="number"
            min="0"
            step={digits === 0 ? "1" : "0.01"}
            value={thresholdDraft}
            onChange={(e) => onThresholdChange(e.target.value)}
            placeholder={`0 ${unit} disables alerts`}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>

        <button
          type="button"
          onClick={onSaveThreshold}
          disabled={thresholdBusyId === lot.id}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
        >
          {thresholdBusyId === lot.id ? "Saving..." : "Save Threshold"}
        </button>
      </div>

      {reservations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-sm text-zinc-600 dark:text-zinc-400">
          No active reservations on this lot.
        </div>
      ) : (
        <div className="space-y-2">
          {reservations.map((entry) => (
            <div
              key={`${lot.id}-${entry.id}`}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 flex flex-wrap items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm">{entry.label || "Reservation"}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formatQty(entry.quantity, unit, digits)}
                  {entry.date ? ` · ${entry.date}` : ""}
                  {entry.note ? ` · ${entry.note}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveReservation(entry.id)}
                disabled={reservationBusyId === lot.id}
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
              >
                Release
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

function normalizeMovementForm(today) {
  return {
    movementType: "sell",
    direction: "out",
    quantity: "",
    unitPrice: "",
    date: today,
    note: "",
    counterparty: "",
    destinationType: "customer",
    destinationName: "",
    destinationLocation: "",
    reason: "",
    priceOverrideType: "",
    priceOverrideReason: "",
    priceManuallyChanged: false,
    fefoOverride: false,
    fefoOverrideReason: "",
    destroyMethod: "discarded",
  };
}

function normalizeReworkForm(today) {
  return {
    name: "",
    reworkType: "rework",
    productType: "capsule",
    variant: "",
    date: today,
    outputCount: "",
    expectedOutputCount: "",
    wasteQuantity: "",
    wasteUnit: "count",
    wasteReason: "",
    wasteNotes: "",
    mgPerUnit: "",
    recipeId: "",
    packagingCost: "",
    laborCost: "",
    overheadCost: "",
    otherCost: "",
    pricePerUnit: "",
    desiredMarginPercent: "60",
    msrpPerUnit: "",
    bottleSize: "",
    bottleSizeUnit: "mL",
    notes: "",
    lotQuantities: {},
  };
}

function formatMovementType(type = "") {
  return String(type || "").replace(/_/g, " ");
}

function formatDestinationType(type = "") {
  const normalized = String(type || "").trim().toLowerCase();
  return {
    customer: "Customer",
    donation: "Donation target",
    event: "Event",
    wholesale: "Wholesale",
    internal: "Internal use",
    other: "Other",
  }[normalized] || "Destination";
}

function CostRollupPanel({ record, title = "COG rollup" }) {
  const rollup = buildCostRollup(record);
  if (!rollup) return null;
  const entries = Array.isArray(rollup.entries) ? rollup.entries.filter((entry) => Number(entry?.total || 0) > 0) : [];

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
      <div className="font-medium">{title}</div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
        {entries.length > 0 ? (
          entries.map((entry) => (
            <DetailStat key={`${rollup.stage}-${entry.key || entry.label}`} label={entry.label || entry.key} value={money(entry.total || 0)} />
          ))
        ) : (
          <DetailStat label="Total cost" value={money(rollup.totalCost || 0)} />
        )}
        <DetailStat label="Batch total" value={money(rollup.totalCost || 0)} />
        <DetailStat label="Unit cost" value={money(rollup.unitCost || 0)} />
      </div>
    </div>
  );
}


function SupplyRequirementPanel({ snapshot, title = "Supply requirements", emptyMessage = "No recipe-linked supply requirements." }) {
  if (!snapshot || !Array.isArray(snapshot.rows) || snapshot.rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-sm text-zinc-600 dark:text-zinc-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {snapshot.blockingShortages?.length > 0
              ? `${snapshot.blockingShortages.length} blocking shortage${snapshot.blockingShortages.length === 1 ? "" : "s"} must be resolved before batch creation.`
              : "Inventory-backed recipe and packaging items are available for this run."}
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{money(snapshot.totalRequiredCost || 0)}</div>
          <div className="text-zinc-500 dark:text-zinc-400">Required supply cost</div>
        </div>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {snapshot.rows.map((row) => (
          <div key={`${row.supplyId}-${row.unit}`} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{row.supplyName}</div>
                <div className="text-zinc-500 dark:text-zinc-400">
                  {row.supplyType || "supply"} · need {formatQty(row.requiredQuantity, row.unit, row.unit === "count" ? 0 : 2)} · on hand {formatQty(row.onHand, row.unit, row.unit === "count" ? 0 : 2)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{money(row.totalCost || 0)}</div>
                <div className={`text-xs ${row.shortageQuantity > 0 ? "text-rose-600 dark:text-rose-400" : "accent-text"}`}>
                  {row.shortageQuantity > 0
                    ? `${formatQty(row.shortageQuantity, row.unit, row.unit === "count" ? 0 : 2)} short`
                    : row.reusable
                    ? "Reusable / non-depleting"
                    : row.consumeFromInventory
                    ? "Inventory OK"
                    : "Cost only"}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecipeSnapshotPanel({ record, title = "Locked recipe snapshot" }) {
  const snapshot = getRecipeSnapshot(record);
  if (!snapshot) return null;
  const items = Array.isArray(snapshot.recipeItems) ? snapshot.recipeItems : [];

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">Locked {snapshot.lockedDate || "—"}</div>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
        <DetailStat label="Recipe" value={snapshot.recipeName || snapshot.recipeId || "—"} />
        <DetailStat label="Yield base" value={String(snapshot.recipeYield || 0)} />
        <DetailStat label="Recipe cost" value={money(snapshot.recipeCost || 0)} />
        <DetailStat label="Direct cost" value={money(snapshot.directCost || 0)} />
      </div>
      {items.length > 0 ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {items.length} ingredient{items.length === 1 ? "" : "s"} locked into this batch snapshot.
        </div>
      ) : null}
    </div>
  );
}


function parseDateValue(value) {
  if (!value) return null;
  const parsed = parseAnyDate(value);
  if (!parsed) return null;
  return parsed;
}

function addYearsToLocalDate(value, years = 1) {
  const parsed = parseDateValue(value);
  if (!parsed) return "";
  const next = new Date(parsed);
  next.setFullYear(next.getFullYear() + years);
  return toLocalYYYYMMDD(next);
}

function getDefaultBestByDate(madeOn = "", fallbackDate = "") {
  return addYearsToLocalDate(madeOn || fallbackDate, 1);
}

function normalizeQcStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();
  if (["pass", "fail", "hold", "pending"].includes(normalized)) return normalized;
  return "pending";
}

function getLotPotencySummary(lot = {}) {
  const potency = lot?.potency || {};
  const mgPerUnit = Number(potency?.activeMgPerUnit || potency?.mgPerUnit || 0) || 0;
  const mgPerMl = Number(potency?.activeMgPerMl || potency?.mgPerMl || 0) || 0;
  const mgPerGram = Number(potency?.activeMgPerGram || potency?.mgPerGram || 0) || 0;

  if (mgPerUnit > 0) return `${mgPerUnit} mg per unit`;
  if (mgPerMl > 0) return `${mgPerMl} mg per mL`;
  if (mgPerGram > 0) return `${mgPerGram} mg per g`;
  return "Not set";
}

function getLotQcSummary(lot = {}) {
  const qc = lot?.qc || {};
  const status = normalizeQcStatus(qc?.status);
  return {
    status,
    checkedBy: qc?.checkedBy || "",
    checkedDate: qc?.checkedDate || "",
    notes: qc?.notes || "",
  };
}

function getShelfLifeSummary(lot = {}) {
  const shelfLife = lot?.shelfLife || {};
  const madeOn = shelfLife?.madeOn || lot?.createdDate || lot?.date || "";
  const legacyExpiration = shelfLife?.expirationDate || shelfLife?.expiresOn || "";
  const bestBy = shelfLife?.bestBy || shelfLife?.bestByDate || legacyExpiration || getDefaultBestByDate(madeOn, lot?.createdDate || lot?.date || "");
  const expirationDate = bestBy;
  const storageCondition = shelfLife?.storageCondition || "";
  const storageNotes = shelfLife?.storageNotes || "";

  return {
    madeOn,
    bestBy,
    expirationDate,
    storageCondition,
    storageNotes,
  };
}

function isQcPendingLot(lot = {}) {
  const qc = getLotQcSummary(lot);
  return !qc.checkedDate || qc.status === "pending";
}

function isExpiringSoonLot(lot = {}, days = 30) {
  const shelf = getShelfLifeSummary(lot);
  const target = parseDateValue(shelf.bestBy || shelf.expirationDate);
  if (!target) return false;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / 86400000);
  return diffDays >= 0 && diffDays <= days;
}

function getExpiringSoonLabel(lot = {}) {
  const shelf = getShelfLifeSummary(lot);
  return shelf.bestBy || shelf.expirationDate || "—";
}

function normalizeQualityForm(lot = {}, today = "") {
  const potency = lot?.potency || {};
  const qc = lot?.qc || {};
  const shelf = getShelfLifeSummary(lot);

  return {
    activeMgPerUnit: String(potency?.activeMgPerUnit ?? potency?.mgPerUnit ?? ""),
    activeMgPerMl: String(potency?.activeMgPerMl ?? potency?.mgPerMl ?? ""),
    activeMgPerGram: String(potency?.activeMgPerGram ?? potency?.mgPerGram ?? ""),
    potencyNotes: potency?.notes || "",
    qcStatus: normalizeQcStatus(qc?.status),
    qcCheckedBy: qc?.checkedBy || "",
    qcCheckedDate: qc?.checkedDate || today,
    qcNotes: qc?.notes || "",
    madeOn: shelf.madeOn || today,
    bestBy: shelf.bestBy || getDefaultBestByDate(shelf.madeOn || today, today),
    expirationDate: shelf.bestBy || getDefaultBestByDate(shelf.madeOn || today, today),
    storageCondition: shelf.storageCondition || "",
    storageNotes: shelf.storageNotes || "",
  };
}

function LotQualityPanel({ lot, form, onChange, onSave, busy }) {
  const isExtract = String(lot?.lotType || "") === "extract";
  const potencySummary = getLotPotencySummary(lot);
  const qcSummary = getLotQcSummary(lot);
  const shelfSummary = getShelfLifeSummary(lot);

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">Potency, QC, and shelf life</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Track potency estimates, QC checkpoints, and storage life for active lots.
          </div>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400 text-right">
          <div>Potency: {potencySummary}</div>
          <div>QC: {qcSummary.status}</div>
          <div>Best by: {shelfSummary.bestBy || "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-3 text-sm">
        {isExtract ? (
          <>
            <label className="space-y-1 block">
              <span className="text-zinc-600 dark:text-zinc-400">mg per mL</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.activeMgPerMl}
                onChange={(e) => onChange({ ...form, activeMgPerMl: e.target.value })}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-zinc-600 dark:text-zinc-400">mg per g</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.activeMgPerGram}
                onChange={(e) => onChange({ ...form, activeMgPerGram: e.target.value })}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
              />
            </label>
          </>
        ) : (
          <label className="space-y-1 block xl:col-span-2">
            <span className="text-zinc-600 dark:text-zinc-400">mg per unit</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.activeMgPerUnit}
              onChange={(e) => onChange({ ...form, activeMgPerUnit: e.target.value })}
              className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
            />
          </label>
        )}
        <label className="space-y-1 block xl:col-span-2">
          <span className="text-zinc-600 dark:text-zinc-400">Potency notes</span>
          <input
            type="text"
            value={form.potencyNotes}
            onChange={(e) => onChange({ ...form, potencyNotes: e.target.value })}
            placeholder="Estimate method, assay note, source"
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-3 text-sm">
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">QC status</span>
          <select
            value={form.qcStatus}
            onChange={(e) => onChange({ ...form, qcStatus: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          >
            <option value="pending">Pending</option>
            <option value="pass">Pass</option>
            <option value="hold">Hold</option>
            <option value="fail">Fail</option>
          </select>
        </label>
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">Checked by</span>
          <input
            type="text"
            value={form.qcCheckedBy}
            onChange={(e) => onChange({ ...form, qcCheckedBy: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">Checked date</span>
          <input
            type="date"
            value={form.qcCheckedDate}
            onChange={(e) => onChange({ ...form, qcCheckedDate: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="space-y-1 block xl:col-span-1">
          <span className="text-zinc-600 dark:text-zinc-400">QC notes</span>
          <input
            type="text"
            value={form.qcNotes}
            onChange={(e) => onChange({ ...form, qcNotes: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-3 text-sm">
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">Made on</span>
          <input
            type="date"
            value={form.madeOn}
            onChange={(e) => {
              const nextMadeOn = e.target.value;
              const previousDefault = getDefaultBestByDate(form.madeOn, today);
              const shouldAutoBestBy = !form.bestBy || form.bestBy === previousDefault || form.bestBy === form.expirationDate;
              const nextBestBy = shouldAutoBestBy ? getDefaultBestByDate(nextMadeOn, today) : form.bestBy;
              onChange({ ...form, madeOn: nextMadeOn, bestBy: nextBestBy, expirationDate: nextBestBy });
            }}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">Best by</span>
          <input
            type="date"
            value={form.bestBy}
            onChange={(e) => onChange({ ...form, bestBy: e.target.value, expirationDate: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">Storage</span>
          <input
            type="text"
            value={form.storageCondition}
            onChange={(e) => onChange({ ...form, storageCondition: e.target.value })}
            placeholder="Cool dark place, refrigerated, frozen"
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">Storage notes</span>
          <input
            type="text"
            value={form.storageNotes}
            onChange={(e) => onChange({ ...form, storageNotes: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save potency and QC"}
        </button>
      </div>
    </div>
  );
}

export default function PostProcessManager({
  grows = [],
  canUsePostProcessing = true,
  canUseFinishedInventory = true,
  canCreatePackageRuns = true,
  canUsePostProcessLabels = true,
  canRecordSales = true,
  canUseFefoControls = true,
  canUseInventoryAuditHistory = true,
  onSubscriptionFeatureBlocked = () => false,
}) {
  const location = useLocation();

  const focusGrowId = useMemo(() => {
    try {
      return new URLSearchParams(location.search || "").get("ppgrow") || "";
    } catch {
      return "";
    }
  }, [location.search]);

  const focusFinishedLotId = useMemo(() => {
    try {
      return new URLSearchParams(location.search || "").get("finished") || "";
    } catch {
      return "";
    }
  }, [location.search]);

  const userId = auth.currentUser?.uid || "";
  const today = useMemo(() => toLocalYYYYMMDD(new Date()), []);

  function requestFeatureAccess({
    allowed = false,
    featureKey,
    actionLabel,
    supportingText = "",
  } = {}) {
    if (allowed) return true;
    onSubscriptionFeatureBlocked({ featureKey, actionLabel, supportingText });
    return false;
  }

  function requestLabOperation(action, allowed) {
    const requirement = getLabOperationRequirement(action);
    if (!requirement) return false;
    return requestFeatureAccess({ allowed, ...requirement });
  }

  function requestPostProcessLabelAccess() {
    return requestLabOperation(
      LAB_OPERATION_ACTIONS.PRINT_POST_PROCESS_LABELS,
      canUsePostProcessLabels
    );
  }

  const [activeTab, setActiveTab] = useState(focusFinishedLotId ? "finished" : "dry");
  const [materialLots, setMaterialLots] = useState([]);
  const [processBatches, setProcessBatches] = useState([]);
  const [movements, setMovements] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [supplies, setSupplies] = useState([]);
  const [message, setMessage] = useState("");
  const [busyGrowId, setBusyGrowId] = useState("");
  const [extractionBusy, setExtractionBusy] = useState(false);
  const [productionBusy, setProductionBusy] = useState(false);
  const [reworkBusy, setReworkBusy] = useState(false);
  const [finalizeBusyId, setFinalizeBusyId] = useState("");
  const [productionActionMessage, setProductionActionMessage] = useState("");
  const [movementBusyId, setMovementBusyId] = useState("");
  const [packageBusy, setPackageBusy] = useState(false);
  const [reservationBusyId, setReservationBusyId] = useState("");
  const [thresholdBusyId, setThresholdBusyId] = useState("");
  const [qualityBusyId, setQualityBusyId] = useState("");
  const [releaseBusyId, setReleaseBusyId] = useState("");
  const [selectedDryLotId, setSelectedDryLotId] = useState("");
  const [selectedExtractLotId, setSelectedExtractLotId] = useState("");
  const [selectedExtractionBatchId, setSelectedExtractionBatchId] = useState("");
  const [selectedProductionBatchId, setSelectedProductionBatchId] = useState("");
  const [selectedSalesProductKey, setSelectedSalesProductKey] = useState("");
  const [selectedFinishedLotId, setSelectedFinishedLotId] = useState(focusFinishedLotId || "");
  const [createExtractionModalOpen, setCreateExtractionModalOpen] = useState(false);
  const [extractionOutputEdited, setExtractionOutputEdited] = useState(false);
  const [createProductionModalOpen, setCreateProductionModalOpen] = useState(false);

  const [extractionForm, setExtractionForm] = useState({
    name: "",
    extractionType: "dual",
    method: "",
    date: today,
    status: "completed",
    outputAmount: "",
    outputUnit: "mL",
    outputYieldPercent: "",
    notes: "",
    lotQuantities: {},
  });

  const [productionForm, setProductionForm] = useState({
    name: "",
    productType: "capsule",
    method: "",
    variant: "",
    date: today,
    status: "completed",
    outputCount: "100",
    targetCapsuleFillG: "0.5",
    formulaRows: [
      { id: "formula_1", ingredientName: "", sourceLotId: "", amountPerUnit: "", gramsPerCapsule: "", percent: "" },
    ],
    mgPerUnit: "",
    packageSize: "",
    packageSizeUnit: "capsules",
    packageCount: "",
    packageUnitLabel: "",
    recipeId: "",
    packagingCost: "",
    laborCost: "",
    overheadCost: "",
    otherCost: "",
    pricePerUnit: "",
    desiredMarginPercent: "60",
    msrpPerUnit: "",
    bottleSize: "",
    bottleSizeUnit: "mL",
    notes: "",
    lotQuantities: {},
  });


  const [reworkForm, setReworkForm] = useState(() => normalizeReworkForm(today));

  const [finalizeForms, setFinalizeForms] = useState({});
  const [movementForms, setMovementForms] = useState({});
  const [movementWarnings, setMovementWarnings] = useState({});
  const [consumptionWarnings, setConsumptionWarnings] = useState({});
  const [salesProductModes, setSalesProductModes] = useState({});
  const [packageForm, setPackageForm] = useState(() => normalizePackageForm(today));
  const [packageCreatorOpenLotId, setPackageCreatorOpenLotId] = useState("");
  const [reservationForms, setReservationForms] = useState({});
  const [thresholdForms, setThresholdForms] = useState({});
  const [qualityForms, setQualityForms] = useState({});
  const [finalDispositionForms, setFinalDispositionForms] = useState({});
  const [finalDispositionBusyId, setFinalDispositionBusyId] = useState("");

  useEffect(() => {
    if (focusFinishedLotId) {
      setActiveTab("finished");
      setSelectedFinishedLotId(focusFinishedLotId);
      return;
    }
    if (focusGrowId) {
      setActiveTab("dry");
    }
  }, [focusFinishedLotId, focusGrowId]);


  const hasPostProcessModalOpen = Boolean(
    selectedDryLotId ||
      selectedExtractLotId ||
      selectedExtractionBatchId ||
      selectedProductionBatchId ||
      selectedFinishedLotId ||
      selectedSalesProductKey ||
      createExtractionModalOpen ||
      createProductionModalOpen
  );

  function closePostProcessDetail() {
    setSelectedDryLotId("");
    setSelectedExtractLotId("");
    setSelectedExtractionBatchId("");
    setSelectedProductionBatchId("");
    setSelectedFinishedLotId("");
    setSelectedSalesProductKey("");
    setPackageCreatorOpenLotId("");
    setProductionActionMessage("");
    setCreateExtractionModalOpen(false);
    setCreateProductionModalOpen(false);
  }

  useEffect(() => {
    if (!hasPostProcessModalOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closePostProcessDetail();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasPostProcessModalOpen]);

  useEffect(() => {
    if (!selectedFinishedLotId) {
      setPackageCreatorOpenLotId("");
    }
  }, [selectedFinishedLotId]);

  useEffect(() => {
    const nextUnit = getDefaultExtractionOutputUnit(extractionForm.extractionType);
    if (extractionForm.outputUnit !== nextUnit) {
      setExtractionForm((prev) => ({ ...prev, outputUnit: nextUnit }));
    }
  }, [extractionForm.extractionType, extractionForm.outputUnit]);

  useEffect(() => {
    setProductionActionMessage("");
  }, [selectedProductionBatchId, createProductionModalOpen]);

  useEffect(() => {
    const root = document.getElementById("root");
    const targets = [document.documentElement, document.body, root].filter(Boolean);
    targets.forEach((target) => target.classList.toggle("modal-open", hasPostProcessModalOpen));

    return () => {
      targets.forEach((target) => target.classList.remove("modal-open"));
    };
  }, [hasPostProcessModalOpen]);

  useEffect(() => {
    if (!userId) return undefined;

    const unsubLots = onSnapshot(
      collection(db, "users", userId, "materialLots"),
      (snap) => setMaterialLots(sortByNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
      (error) => setMessage(error?.message || "Failed to load post-processing lots.")
    );

    const unsubBatches = onSnapshot(
      collection(db, "users", userId, "processBatches"),
      (snap) => setProcessBatches(sortByNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    );

    const unsubMoves = onSnapshot(
      collection(db, "users", userId, "inventoryMovements"),
      (snap) => setMovements(sortByNewest(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    );

    const unsubRecipes = onSnapshot(
      collection(db, "users", userId, "recipes"),
      (snap) => setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    const unsubSupplies = onSnapshot(
      collection(db, "users", userId, "supplies"),
      (snap) => setSupplies(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    return () => {
      unsubLots();
      unsubBatches();
      unsubMoves();
      unsubRecipes();
      unsubSupplies();
    };
  }, [userId]);

  const finishedTypes = useMemo(() => getFinishedGoodsLotTypes(), []);

  const dryLots = useMemo(
    () => materialLots.filter((lot) => String(lot?.lotType || "") === "dry_material"),
    [materialLots]
  );

  const extractLots = useMemo(
    () => materialLots.filter((lot) => String(lot?.lotType || "") === "extract"),
    [materialLots]
  );

  const finishedGoodsLots = useMemo(
    () =>
      materialLots.filter(
        (lot) => isFinishedGoodsLot(lot) || finishedTypes.includes(String(lot?.lotType || ""))
      ),
    [finishedTypes, materialLots]
  );

  const materialLotById = useMemo(() => {
    const map = new Map();
    materialLots.forEach((lot) => {
      if (lot?.id) map.set(lot.id, lot);
    });
    return map;
  }, [materialLots]);

  const activeDryLots = useMemo(
    () => dryLots.filter((lot) => isActiveMaterialLot(lot)),
    [dryLots]
  );

  const activeExtractLots = useMemo(
    () => extractLots.filter((lot) => isActiveMaterialLot(lot)),
    [extractLots]
  );

  const activeFinishedGoodsLots = useMemo(
    () => finishedGoodsLots.filter((lot) => isActiveMaterialLot(lot)),
    [finishedGoodsLots]
  );

  const finalDispositionRequiredLots = useMemo(
    () =>
      materialLots.filter(
        (lot) => getMaterialLotFinalDispositionState(lot, today).required
      ),
    [materialLots, today]
  );

  const selectedDryLot = useMemo(
    () => activeDryLots.find((lot) => lot.id === selectedDryLotId) || null,
    [activeDryLots, selectedDryLotId]
  );

  const selectedExtractLot = useMemo(
    () => activeExtractLots.find((lot) => lot.id === selectedExtractLotId) || null,
    [activeExtractLots, selectedExtractLotId]
  );


  const saleReadyFinishedGoodsLots = useMemo(
    () => activeFinishedGoodsLots.filter((lot) => isPackagedForSale(lot)),
    [activeFinishedGoodsLots]
  );

  const salesExpiringSoonLots = useMemo(
    () => saleReadyFinishedGoodsLots.filter((lot) => isExpiringSoonLot(lot)),
    [saleReadyFinishedGoodsLots]
  );

  const packageSourceLots = useMemo(
    () =>
      activeFinishedGoodsLots.filter(
        (lot) =>
          getLotAvailableQuantity(lot) > 0 &&
          !isPackagedForSale(lot) &&
          isMaterialLotUsableForProcessing(lot, today)
      ),
    [activeFinishedGoodsLots, today]
  );

  const finishedBatchCards = useMemo(() => {
    return finishedGoodsLots
      .filter((lot) => !isPackagedForSale(lot))
      .filter(
        (lot) =>
          isActiveMaterialLot(lot) &&
          getLotAvailableQuantity(lot) > 0 &&
          isMaterialLotUsableForProcessing(lot, today)
      )
      .sort((a, b) => getInventoryAgeMs(b) - getInventoryAgeMs(a));
  }, [finishedGoodsLots, today]);

  const selectedFinishedLot = useMemo(
    () => finishedBatchCards.find((lot) => lot.id === selectedFinishedLotId) || null,
    [finishedBatchCards, selectedFinishedLotId]
  );


  useEffect(() => {
    if (!selectedFinishedLotId || selectedFinishedLot || finishedBatchCards.length === 0) return;
    setSelectedFinishedLotId("");
  }, [finishedBatchCards.length, selectedFinishedLot, selectedFinishedLotId]);

  const depletedOrArchivedMaterialLots = useMemo(
    () => materialLots.filter((lot) => isArchivedOrDepletedMaterialLot(lot)),
    [materialLots]
  );

  const depletedDryLots = useMemo(
    () => depletedOrArchivedMaterialLots.filter((lot) => String(lot?.lotType || "") === "dry_material"),
    [depletedOrArchivedMaterialLots]
  );

  const depletedExtractLots = useMemo(
    () => depletedOrArchivedMaterialLots.filter((lot) => String(lot?.lotType || "") === "extract"),
    [depletedOrArchivedMaterialLots]
  );

  const depletedFinishedGoodsLots = useMemo(
    () => depletedOrArchivedMaterialLots.filter((lot) => isFinishedGoodsLot(lot)),
    [depletedOrArchivedMaterialLots]
  );

  const extractionBatches = useMemo(
    () => processBatches.filter((batch) => String(batch?.processType || "") === "extraction"),
    [processBatches]
  );

  const productionBatches = useMemo(
    () =>
      processBatches.filter(
        (batch) =>
          String(batch?.processType || "") === "product" ||
          String(batch?.processCategory || "") === "production"
      ),
    [processBatches]
  );

  const activeExtractionBatches = useMemo(
    () => extractionBatches.filter((batch) => isActiveProcessBatch(batch)),
    [extractionBatches]
  );

  const activeProductionBatches = useMemo(
    () => productionBatches.filter((batch) => isActiveProcessBatch(batch)),
    [productionBatches]
  );

  const pendingExtractionOutputs = useMemo(
    () => activeExtractionBatches.filter((batch) => !batch?.outputLotId),
    [activeExtractionBatches]
  );

  const selectedExtractionBatch = useMemo(
    () =>
      activeExtractionBatches.find((batch) => batch.id === selectedExtractionBatchId) || null,
    [activeExtractionBatches, selectedExtractionBatchId]
  );

  const selectedProductionBatch = useMemo(
    () => activeProductionBatches.find((batch) => batch.id === selectedProductionBatchId) || null,
    [activeProductionBatches, selectedProductionBatchId]
  );


  const availableDryLots = useMemo(
    () =>
      activeDryLots.filter(
        (lot) =>
          getLotAvailableQuantity(lot) > 0 &&
          isMaterialLotUsableForProcessing(lot, today)
      ),
    [activeDryLots, today]
  );

  const availableProductionSourceLots = useMemo(
    () =>
      [...activeDryLots, ...activeExtractLots].filter(
        (lot) =>
          getLotAvailableQuantity(lot) > 0 &&
          isMaterialLotUsableForProcessing(lot, today)
      ),
    [activeDryLots, activeExtractLots, today]
  );

  const dryLotByGrowId = useMemo(() => {
    const map = new Map();
    dryLots.forEach((lot) => {
      if (lot?.sourceGrowId && !map.has(lot.sourceGrowId)) {
        map.set(lot.sourceGrowId, lot);
      }
    });
    return map;
  }, [dryLots]);

  const harvestedEligibleGrows = useMemo(() => {
    const filtered = (Array.isArray(grows) ? grows : []).filter(
      (grow) => canCreateDryLotFromGrow(grow) && !dryLotByGrowId.has(grow.id)
    );

    filtered.sort((a, b) => {
      if (focusGrowId) {
        if (a.id === focusGrowId) return -1;
        if (b.id === focusGrowId) return 1;
      }
      const aDate = parseAnyDate(a?.harvestedAt || a?.updatedAt || a?.createdAt) || new Date(0);
      const bDate = parseAnyDate(b?.harvestedAt || b?.updatedAt || b?.createdAt) || new Date(0);
      return bDate - aDate;
    });

    return filtered;
  }, [grows, dryLotByGrowId, focusGrowId]);

  const selectedExtractionLots = useMemo(
    () =>
      availableDryLots
        .map((lot) => ({
          ...lot,
          selectedQuantity: Number(extractionForm.lotQuantities?.[lot.id]) || 0,
        }))
        .filter((lot) => lot.selectedQuantity > 0),
    [availableDryLots, extractionForm.lotQuantities]
  );

  const extractionPreview = useMemo(() => {
    const outputUnit = getDefaultExtractionOutputUnit(extractionForm.extractionType);
    const selectedInputLabel = formatTotalsByUnit(selectedExtractionLots) || "None";
    const sameUnitInput = getExtractionInputTotalForUnit(selectedExtractionLots, outputUnit);
    const outputAmount = Number(extractionForm.outputAmount) || 0;
    const outputLabel = outputAmount > 0 ? formatQty(outputAmount, outputUnit, outputUnit === "g" ? 2 : 1) : "Not set";
    const yieldPercent = sameUnitInput > 0 && outputAmount > 0 ? Math.round((outputAmount / sameUnitInput) * 10000) / 100 : 0;
    return { outputUnit, selectedInputLabel, sameUnitInput, outputAmount, outputLabel, yieldPercent };
  }, [extractionForm.extractionType, extractionForm.outputAmount, selectedExtractionLots]);

  useEffect(() => {
    const nextUnit = getDefaultExtractionOutputUnit(extractionForm.extractionType);
    if (nextUnit !== "g" || extractionOutputEdited) return;
    const inputTotal = getExtractionInputTotalForUnit(selectedExtractionLots, "g");
    const nextAmount = inputTotal > 0 ? String(Math.round(inputTotal * 1000) / 1000) : "";
    if (String(extractionForm.outputAmount || "") !== nextAmount) {
      setExtractionForm((prev) => ({
        ...prev,
        outputAmount: nextAmount,
        outputYieldPercent: inputTotal > 0 ? "100" : prev.outputYieldPercent,
      }));
    }
  }, [extractionForm.extractionType, extractionForm.outputAmount, extractionOutputEdited, selectedExtractionLots]);

  const selectedProductionLots = useMemo(
    () =>
      availableProductionSourceLots
        .map((lot) => ({
          ...lot,
          selectedQuantity: Number(productionForm.lotQuantities?.[lot.id]) || 0,
        }))
        .filter((lot) => lot.selectedQuantity > 0),
    [availableProductionSourceLots, productionForm.lotQuantities]
  );

  const recipeById = useMemo(() => {
    const map = new Map();
    recipes.forEach((recipe) => map.set(recipe.id, recipe));
    return map;
  }, [recipes]);

  const supplyById = useMemo(() => {
    const map = new Map();
    supplies.forEach((supply) => map.set(supply.id, supply));
    return map;
  }, [supplies]);

  const selectedRecipe = useMemo(
    () => recipeById.get(productionForm.recipeId) || null,
    [productionForm.recipeId, recipeById]
  );

  const selectedRecipeCosting = useMemo(
    () => computeRecipeCost(selectedRecipe, Number(productionForm.outputCount) || 0, supplyById),
    [selectedRecipe, productionForm.outputCount, supplyById]
  );

  const packageRecipeById = recipeById;

  const selectedPackageRecipe = useMemo(
    () => packageRecipeById.get(packageForm.packageRecipeId) || null,
    [packageForm.packageRecipeId, packageRecipeById]
  );

  const selectedPackageRecipeCosting = useMemo(
    () => computeRecipeCost(selectedPackageRecipe, Number(packageForm.packageCount) || 0, supplyById),
    [selectedPackageRecipe, packageForm.packageCount, supplyById]
  );

  const packageCostedForm = useMemo(() => {
    const packageCount = Math.max(0, Math.floor(Number(packageForm.packageCount) || 0));
    const recipeCostPerPackage = packageCount > 0 ? roundCurrency((Number(selectedPackageRecipeCosting.totalCost) || 0) / packageCount) : 0;
    return {
      ...packageForm,
      packageRecipeCostPerPackage: recipeCostPerPackage,
      packageRecipeCostTotal: roundCurrency(selectedPackageRecipeCosting.totalCost || 0),
      packageRecipeName: selectedPackageRecipeCosting.recipeName || "",
    };
  }, [packageForm, selectedPackageRecipeCosting]);

  const defaultPackageRecipeId = useMemo(() => {
    const candidates = recipes.filter((recipe) => /packag|label|bag|jar|bottle|capsule/i.test(String(recipe?.name || "")));
    return candidates[0]?.id || "";
  }, [recipes]);

  useEffect(() => {
    if (!packageCreatorOpenLotId || packageForm.packageRecipeId || !defaultPackageRecipeId) return;
    setPackageForm((prev) => ({ ...prev, packageRecipeId: defaultPackageRecipeId }));
  }, [defaultPackageRecipeId, packageCreatorOpenLotId, packageForm.packageRecipeId]);

  const productionInputTotals = useMemo(() => {
    const totals = {};
    selectedProductionLots.forEach((lot) => {
      const unit = lot?.unit || "units";
      totals[unit] = (totals[unit] || 0) + (Number(lot?.selectedQuantity) || 0);
    });
    return Object.entries(totals).map(([unit, total]) => ({ unit, total }));
  }, [selectedProductionLots]);

  const productionInputMaterialCostTotal = useMemo(
    () =>
      roundCurrency(
        selectedProductionLots.reduce((sum, lot) => {
          const unitCost = getLotUnitCost(lot);
          return sum + unitCost * (Number(lot?.selectedQuantity) || 0);
        }, 0)
      ),
    [selectedProductionLots]
  );

  const productionDirectCost = useMemo(() => {
    const packagingCost = sanitizeNumber(productionForm.packagingCost);
    const laborCost = sanitizeNumber(productionForm.laborCost);
    const overheadCost = sanitizeNumber(productionForm.overheadCost);
    const otherCost = sanitizeNumber(productionForm.otherCost);
    return roundCurrency(packagingCost + laborCost + overheadCost + otherCost);
  }, [
    productionForm.laborCost,
    productionForm.otherCost,
    productionForm.overheadCost,
    productionForm.packagingCost,
  ]);

  const productionBatchCostPreview = useMemo(
    () =>
      roundCurrency(
        productionInputMaterialCostTotal + selectedRecipeCosting.totalCost + productionDirectCost
      ),
    [productionDirectCost, productionInputMaterialCostTotal, selectedRecipeCosting.totalCost]
  );

  const productionUnitCostPreview = useMemo(() => {
    const outputCount = Math.max(0, Number(productionForm.outputCount) || 0);
    return outputCount > 0 ? roundCurrency(productionBatchCostPreview / outputCount) : 0;
  }, [productionBatchCostPreview, productionForm.outputCount]);

  const productionMsrpSuggestion = useMemo(
    () =>
      msrpSuggestion(
        productionUnitCostPreview,
        Number(productionForm.desiredMarginPercent) || 60
      ),
    [productionForm.desiredMarginPercent, productionUnitCostPreview]
  );

  const productionPricingPreview = useMemo(
    () =>
      buildPricingPreview({
        unitCost: productionUnitCostPreview,
        pricePerUnit: Number(productionForm.pricePerUnit) || 0,
        msrpPerUnit: Number(productionForm.msrpPerUnit) || productionMsrpSuggestion,
        quantity: Number(productionForm.outputCount) || 0,
      }),
    [
      productionForm.msrpPerUnit,
      productionForm.outputCount,
      productionForm.pricePerUnit,
      productionMsrpSuggestion,
      productionUnitCostPreview,
    ]
  );


  const productionPlanningSnapshot = useMemo(
    () =>
      buildProductionPlanningSnapshot({
        sourceLots: availableProductionSourceLots,
        requestedInputs: selectedProductionLots.map((lot) => ({
          lotId: lot.id,
          quantity: lot.selectedQuantity,
        })),
        targetOutputQuantity: Number(productionForm.outputCount) || 0,
        outputUnit: getProductTypeMeta(productionForm.productType).outputUnit,
      }),
    [availableProductionSourceLots, selectedProductionLots, productionForm.outputCount, productionForm.productType]
  );

  const productionCapsulePlan = useMemo(
    () => buildCapsuleFormulaPlan(productionForm, availableProductionSourceLots),
    [availableProductionSourceLots, productionForm]
  );

  const productionAutoMgPerUnit = useMemo(() => {
    const outputQuantity = Math.max(0, Number(productionForm.outputCount) || 0);
    if (outputQuantity <= 0) return 0;
    if (productionCapsulePlan.totalPowderNeededG > 0) {
      return Math.round((productionCapsulePlan.totalPowderNeededG * 1000 / outputQuantity) * 100) / 100;
    }
    const gramsSelected = selectedProductionLots
      .filter((lot) => normalizePackageUnit(lot?.unit || "g") === "g")
      .reduce((sum, lot) => sum + (Number(lot?.selectedQuantity) || 0), 0);
    return gramsSelected > 0 ? Math.round((gramsSelected * 1000 / outputQuantity) * 100) / 100 : 0;
  }, [productionCapsulePlan.totalPowderNeededG, productionForm.outputCount, selectedProductionLots]);

  const productionSupplySnapshot = useMemo(
    () =>
      buildSupplyRequirementSnapshot({
        recipeItems: selectedRecipeCosting.recipeItems,
        recipeYield: selectedRecipeCosting.recipeYield || 1,
        outputCount: Number(productionForm.outputCount) || selectedRecipeCosting.recipeYield || 1,
        supplies,
      }),
    [selectedRecipeCosting.recipeItems, selectedRecipeCosting.recipeYield, productionForm.outputCount, supplies]
  );

  const reworkSelectedRecipe = useMemo(
    () => recipeById.get(reworkForm.recipeId) || null,
    [reworkForm.recipeId, recipeById]
  );

  const reworkRecipeCosting = useMemo(
    () => computeRecipeCost(reworkSelectedRecipe, Number(reworkForm.outputCount) || 0, supplyById),
    [reworkSelectedRecipe, reworkForm.outputCount, supplyById]
  );

  const reworkSelectedLots = useMemo(
    () =>
      activeFinishedGoodsLots
        .map((lot) => ({
          ...lot,
          selectedQuantity: Number(reworkForm.lotQuantities?.[lot.id]) || 0,
        }))
        .filter((lot) => lot.selectedQuantity > 0),
    [activeFinishedGoodsLots, reworkForm.lotQuantities]
  );

  const reworkSupplySnapshot = useMemo(
    () =>
      buildSupplyRequirementSnapshot({
        recipeItems: reworkRecipeCosting.recipeItems,
        recipeYield: reworkRecipeCosting.recipeYield || 1,
        outputCount: Number(reworkForm.outputCount) || reworkRecipeCosting.recipeYield || 1,
        supplies,
      }),
    [reworkRecipeCosting.recipeItems, reworkRecipeCosting.recipeYield, reworkForm.outputCount, supplies]
  );

  const totalRemainingDry = activeDryLots.reduce(
    (sum, lot) => sum + getLotAvailableQuantity(lot),
    0
  );
  const totalAllocatedDry = dryLots.reduce(
    (sum, lot) => sum + (Number(lot?.allocatedQuantity) || 0),
    0
  );
  const totalUnpackagedFinishedUnits = packageSourceLots.reduce(
    (sum, lot) => sum + getLotAvailableQuantity(lot),
    0
  );
  const totalSaleReadyUnits = saleReadyFinishedGoodsLots.reduce(
    (sum, lot) => sum + getLotAvailableQuantity(lot),
    0
  );
  const packagedFinishedGoodsLots = useMemo(
    () => finishedGoodsLots.filter((lot) => isPackagedForSale(lot)),
    [finishedGoodsLots]
  );
  const totalSoldUnits = packagedFinishedGoodsLots.reduce(
    (sum, lot) => sum + getOutboundQuantity(lot, "sold"),
    0
  );
  const totalDestroyedUnits = packagedFinishedGoodsLots.reduce(
    (sum, lot) => sum + getOutboundQuantity(lot, "destroyed"),
    0
  );
  const totalSampledUnits = packagedFinishedGoodsLots.reduce(
    (sum, lot) => sum + getOutboundQuantity(lot, "sampled"),
    0
  );
  const totalProjectedRevenue = roundCurrency(
    saleReadyFinishedGoodsLots.reduce(
      (sum, lot) => sum + getRemainingProjectedRevenue(lot),
      0
    )
  );
  const packageSourceLot = packageSourceLots.find((lot) => lot.id === packageForm.sourceLotId) || packageSourceLots[0] || null;
  const packagePreview = buildPackagePreview(packageCostedForm, packageSourceLot || {});

  const packageRunsBySourceLotId = useMemo(() => {
    const map = new Map();
    saleReadyFinishedGoodsLots.forEach((lot) => {
      const sourceId = String(lot?.sourceLotId || lot?.parentLotId || lot?.package?.sourceLotId || "");
      if (!sourceId) return;
      if (!map.has(sourceId)) map.set(sourceId, []);
      map.get(sourceId).push(lot);
    });
    map.forEach((rows) => rows.sort(compareFefoPriority));
    return map;
  }, [saleReadyFinishedGoodsLots]);

  const salesProductGroups = useMemo(() => {
    const productMap = new Map();

    packagedFinishedGoodsLots.forEach((lot) => {
      const productKey = getSalesProductKey(lot);
      const active = isActiveMaterialLot(lot) && getLotAvailableQuantity(lot) > 0;

      if (!productMap.has(productKey)) {
        productMap.set(productKey, {
          key: productKey,
          label: getSalesProductLabel(lot),
          variant: lot?.variant || lot?.variantTag || "",
          lots: [],
          activeLots: [],
          skuMap: new Map(),
        });
      }

      const product = productMap.get(productKey);
      product.lots.push(lot);
      if (active) product.activeLots.push(lot);

      const skuKey = getSkuGroupKey(lot);
      if (!product.skuMap.has(skuKey)) {
        product.skuMap.set(skuKey, {
          key: skuKey,
          label: getSkuGroupLabel(lot),
          skuType: getSkuType(lot),
          lots: [],
          activeLots: [],
        });
      }

      const sku = product.skuMap.get(skuKey);
      sku.lots.push(lot);
      if (active) sku.activeLots.push(lot);
    });

    return Array.from(productMap.values())
      .map((product) => {
        const skus = Array.from(product.skuMap.values()).map((sku) => ({
          ...sku,
          lots: sku.lots.slice().sort(compareFefoPriority),
          activeLots: sku.activeLots.slice().sort(compareFefoPriority),
        }));

        return {
          ...product,
          lots: product.lots.slice().sort(compareFefoPriority),
          activeLots: product.activeLots.slice().sort(compareFefoPriority),
          skus,
          activeSkus: skus.filter((sku) => sku.activeLots.length > 0),
        };
      })
      .filter((product) => product.activeLots.length > 0);
  }, [packagedFinishedGoodsLots]);

  const selectedSalesProductGroup = useMemo(
    () => salesProductGroups.find((product) => product.key === selectedSalesProductKey) || null,
    [salesProductGroups, selectedSalesProductKey]
  );

  useEffect(() => {
    if (selectedDryLotId && !selectedDryLot) setSelectedDryLotId("");
    if (selectedExtractLotId && !selectedExtractLot) setSelectedExtractLotId("");
    if (selectedExtractionBatchId && !selectedExtractionBatch) setSelectedExtractionBatchId("");
    if (selectedProductionBatchId && !selectedProductionBatch) setSelectedProductionBatchId("");
    if (selectedFinishedLotId && !selectedFinishedLot) setSelectedFinishedLotId("");
    if (selectedSalesProductKey && !selectedSalesProductGroup) setSelectedSalesProductKey("");
  }, [
    selectedDryLotId,
    selectedDryLot,
    selectedExtractLotId,
    selectedExtractLot,
    selectedExtractionBatchId,
    selectedExtractionBatch,
    selectedProductionBatchId,
    selectedProductionBatch,
    selectedFinishedLotId,
    selectedFinishedLot,
    selectedSalesProductKey,
    selectedSalesProductGroup,
  ]);

  const totalRealizedRevenue = finishedGoodsLots.reduce(
    (sum, lot) => sum + (Number(lot?.outboundSummary?.revenue || 0) || 0),
    0
  );

  const reservedLots = useMemo(
    () => [...activeDryLots, ...activeExtractLots, ...activeFinishedGoodsLots].filter(
      (lot) => getLotReservedQuantity(lot) > 0
    ),
    [activeDryLots, activeExtractLots, activeFinishedGoodsLots]
  );

  const lowStockLots = useMemo(
    () => [...activeDryLots, ...activeExtractLots, ...activeFinishedGoodsLots].filter((lot) => isLowStockLot(lot)),
    [activeDryLots, activeExtractLots, activeFinishedGoodsLots]
  );

  const qualityTrackedLots = useMemo(
    () => [...activeExtractLots, ...activeFinishedGoodsLots],
    [activeExtractLots, activeFinishedGoodsLots]
  );

  const qcPendingLots = useMemo(
    () => qualityTrackedLots.filter((lot) => isQcPendingLot(lot)),
    [qualityTrackedLots]
  );

  const expiringSoonLots = useMemo(
    () => qualityTrackedLots.filter((lot) => isExpiringSoonLot(lot)),
    [qualityTrackedLots]
  );

  const reservedSummary = useMemo(() => {
    const totals = {};
    reservedLots.forEach((lot) => {
      const unit = String(lot?.displayUnitLabel || lot?.unit || (isFinishedGoodsLot(lot) ? "count" : "g")) || "units";
      totals[unit] = (totals[unit] || 0) + getLotReservedQuantity(lot);
    });
    return Object.entries(totals).map(([unit, total]) => ({ unit, total }));
  }, [reservedLots]);

  const activeProductionAttentionCount = activeProductionBatches.filter((batch) => {
    const status = getProcessBatchStatus(batch);
    return status === "planned" || status === "in_progress";
  }).length;

  const batchesNeedingAttention = pendingExtractionOutputs.length + activeProductionAttentionCount;

  const buildStageStatus = ({ activeCount = 0, pendingCount = 0, qcCount = 0, activeLabel = "active" } = {}) => {
    if (qcCount > 0) return { text: `${qcCount} QC`, tone: "warn" };
    if (pendingCount > 0) return { text: `${pendingCount} pending`, tone: "warn" };
    if (activeCount > 0) return { text: `${activeCount} ${activeLabel}`, tone: "good" };
    return { text: "Empty", tone: "empty" };
  };

  const stageStatuses = {
    dry: buildStageStatus({
      activeCount: activeDryLots.length,
      activeLabel: "active",
    }),
    extraction: buildStageStatus({
      activeCount: activeExtractionBatches.length,
      pendingCount: pendingExtractionOutputs.length,
      activeLabel: "active",
    }),
    extractOutput: buildStageStatus({
      activeCount: activeExtractLots.length,
      activeLabel: "active",
    }),
    production: buildStageStatus({
      activeCount: activeProductionBatches.length,
      pendingCount: activeProductionAttentionCount,
      activeLabel: "active",
    }),
    finished: buildStageStatus({
      activeCount: packageSourceLots.length,
      qcCount: qcPendingLots.length,
      activeLabel: "active",
    }),
    sales: buildStageStatus({
      activeCount: saleReadyFinishedGoodsLots.length,
      activeLabel: "active",
    }),
  };

  const nextAction = harvestedEligibleGrows.length > 0
    ? "dry"
    : pendingExtractionOutputs.length > 0
      ? "extraction"
      : availableDryLots.length > 0
        ? "extraction"
        : availableProductionSourceLots.length > 0
          ? "production"
          : packageSourceLots.length > 0
            ? "finished"
            : saleReadyFinishedGoodsLots.length > 0
              ? "sales"
              : null;

  function resetExtractionForm() {
    setExtractionOutputEdited(false);
    setExtractionForm({
      name: "",
      extractionType: "dual",
      method: "",
      date: today,
      status: "completed",
      outputAmount: "",
      outputUnit: "mL",
      outputYieldPercent: "",
      notes: "",
      lotQuantities: {},
    });
  }

  function resetProductionForm() {
    setProductionForm({
      name: "",
      productType: "capsule",
      method: "",
      variant: "",
      date: today,
      status: "completed",
      outputCount: "100",
      targetCapsuleFillG: "0.5",
      formulaRows: [
        { id: "formula_1", ingredientName: "", sourceLotId: "", amountPerUnit: "", gramsPerCapsule: "", percent: "" },
      ],
      mgPerUnit: "",
      packageSize: "",
      packageSizeUnit: "capsules",
      packageCount: "",
      packageUnitLabel: "",
      recipeId: "",
      packagingCost: "",
      laborCost: "",
      overheadCost: "",
      otherCost: "",
      pricePerUnit: "",
      desiredMarginPercent: "60",
      msrpPerUnit: "",
      bottleSize: "",
      bottleSizeUnit: "mL",
      notes: "",
      lotQuantities: {},
    });
  }


  function resetReworkForm() {
    setReworkForm(normalizeReworkForm(today));
  }

  async function handleCreateDryLot(grow) {
    if (!userId || !grow?.id) return;
    if (
      !requestLabOperation(
        LAB_OPERATION_ACTIONS.CREATE_DRY_LOT,
        canUsePostProcessing
      )
    ) return;
    try {
      setBusyGrowId(grow.id);
      setMessage("");
      const result = await createDryLotFromGrow({ userId, grow });
      setMessage(
        result?.created
          ? `Created and linked dry lot ${result.lotId} for ${getGrowLabel(grow)}.`
          : `Dry lot ${result.lotId} already exists and is linked to ${getGrowLabel(grow)}.`
      );
    } catch (error) {
      setMessage(error?.message || "Failed to create dry lot.");
    } finally {
      setBusyGrowId("");
    }
  }

  function setConsumptionWarning(key, warning = "") {
    setConsumptionWarnings((prev) => {
      if (!warning && !prev[key]) return prev;
      const next = { ...prev };
      if (warning) next[key] = warning;
      else delete next[key];
      return next;
    });
  }

  function handleExtractionLotQuantityChange(lot, rawValue) {
    const available = Number(getLotAvailableQuantity(lot)) || 0;
    const result = clampQuantityToAvailable(rawValue, available);
    setExtractionForm((prev) => ({
      ...prev,
      lotQuantities: { ...prev.lotQuantities, [lot.id]: result.value },
    }));
    setConsumptionWarning(`extraction:${lot.id}`, result.warning);
  }

  function handleProductionLotQuantityChange(lot, rawValue) {
    const available = Number(getLotAvailableQuantity(lot)) || 0;
    const result = clampQuantityToAvailable(rawValue, available);
    setProductionForm((prev) => ({
      ...prev,
      lotQuantities: { ...prev.lotQuantities, [lot.id]: result.value },
    }));
    setConsumptionWarning(`production:${lot.id}`, result.warning);
  }

  function handleReworkLotQuantityChange(lot, rawValue) {
    const available = Number(getLotAvailableQuantity(lot)) || 0;
    const result = clampQuantityToAvailable(rawValue, available, { integer: true });
    setReworkForm((prev) => ({
      ...prev,
      lotQuantities: { ...prev.lotQuantities, [lot.id]: result.value },
    }));
    setConsumptionWarning(`rework:${lot.id}`, result.warning);
  }

  function updatePackageFormWithInventoryGuard(sourceLot, patch, warningLabel = "Package quantity") {
    const candidate = { ...packageForm, ...patch };
    const preview = buildPackagePreview(candidate, sourceLot);
    const available = Number(getLotAvailableQuantity(sourceLot)) || 0;
    let next = candidate;
    let warning = "";

    if (preview.sourceQuantity > available && preview.packageCount > 0) {
      const sourcePerPackage = preview.sourceQuantity / preview.packageCount;
      const maxPackages = sourcePerPackage > 0 ? Math.max(0, Math.floor(available / sourcePerPackage)) : 0;

      if (Object.prototype.hasOwnProperty.call(patch, "capsulesPerPackage")) {
        const packageCount = Math.max(1, Math.floor(Number(candidate.packageCount) || 1));
        const maxPerPackage = Math.max(0, Math.floor(available / packageCount));
        next = { ...candidate, capsulesPerPackage: String(maxPerPackage) };
        warning = `Only ${available} source units are available. Capsules per package was capped at ${maxPerPackage}.`;
      } else if (Object.prototype.hasOwnProperty.call(patch, "sourceQuantity")) {
        next = { ...candidate, sourceQuantity: String(available) };
        warning = `Only ${available} source units are available. Source quantity was capped to the maximum available.`;
      } else {
        next = { ...candidate, packageCount: String(maxPackages) };
        warning = `${warningLabel} would over-consume the source lot. Number of packages was capped at ${maxPackages}.`;
      }
    }

    setPackageForm(next);
    setConsumptionWarning(`package:${sourceLot.id}`, warning);
  }

  async function handleCreateExtraction() {
    if (!userId) return;
    if (
      !requestLabOperation(
        LAB_OPERATION_ACTIONS.CREATE_EXTRACTION,
        canUsePostProcessing
      )
    ) return;
    try {
      setExtractionBusy(true);
      setMessage("");
      const result = await createExtractionBatch({
        userId,
        name: extractionForm.name,
        extractionType: extractionForm.extractionType,
        method: extractionForm.method,
        notes: extractionForm.notes,
        date: extractionForm.date,
        status: extractionForm.status,
        outputAmount: extractionForm.outputAmount,
        outputUnit: extractionForm.outputUnit,
        outputYieldPercent: extractionForm.outputYieldPercent,
        inputLots: selectedExtractionLots.map((lot) => ({
          lotId: lot.id,
          quantity: lot.selectedQuantity,
        })),
      });
      setMessage(`Created extraction batch ${result?.name || ""}.`.trim());
      resetExtractionForm();
      setActiveTab("extractions");
      setCreateExtractionModalOpen(false);
      closePostProcessDetail();
    } catch (error) {
      setMessage(error?.message || "Failed to create extraction batch.");
    } finally {
      setExtractionBusy(false);
    }
  }

  async function handleFinalizeExtraction(batch) {
    if (!userId || !batch?.id) return;
    const form = finalizeForms[batch.id] || {
      outputAmount: "",
      outputUnit: "mL",
      outputYieldPercent: "",
      date: today,
      notes: "",
    };

    try {
      setFinalizeBusyId(batch.id);
      setMessage("");
      const result = await finalizeExtractionBatchOutput({
        userId,
        batchId: batch.id,
        outputAmount: form.outputAmount,
        outputUnit: form.outputUnit,
        outputYieldPercent: form.outputYieldPercent,
        date: form.date,
        notes: form.notes,
      });
      setMessage(`Recorded extract output for ${result?.name || batch?.name || "batch"}.`);
      setFinalizeForms((prev) => ({
        ...prev,
        [batch.id]: {
          outputAmount: "",
          outputUnit: "mL",
          outputYieldPercent: "",
          date: today,
          notes: "",
        },
      }));
    } catch (error) {
      setMessage(error?.message || "Failed to finalize extract output.");
    } finally {
      setFinalizeBusyId("");
    }
  }

  function updateFormulaRow(index, patch) {
    setProductionForm((prev) => {
      const rows = Array.isArray(prev.formulaRows) && prev.formulaRows.length > 0
        ? prev.formulaRows
        : [{ id: "formula_1", ingredientName: "", sourceLotId: "", amountPerUnit: "", gramsPerCapsule: "", percent: "" }];
      const currentRow = rows[index] || {};
      const rowKey = currentRow.id || `formula_${index + 1}`;
      const nextPatch = { ...patch };

      if (Object.prototype.hasOwnProperty.call(nextPatch, "ingredientName")) {
        const normalizedName = String(nextPatch.ingredientName || "").trim().toLowerCase();
        const duplicate = normalizedName && rows.some((row, rowIndex) => rowIndex !== index && String(row?.ingredientName || "").trim().toLowerCase() === normalizedName);
        if (duplicate) {
          setConsumptionWarning(`formula:${rowKey}`, "That ingredient is already in this formula. Each ingredient can only be added once.");
          return prev;
        }
      }

      if (nextPatch?.sourceLotId) {
        const alreadyUsed = rows.some((row, rowIndex) => rowIndex !== index && String(row?.sourceLotId || "") === String(nextPatch.sourceLotId));
        if (alreadyUsed) {
          setConsumptionWarning(`formula:${rowKey}`, "That source lot is already linked to another formula row.");
          return prev;
        }
      }

      let candidateRow = { ...currentRow, ...nextPatch };
      const amountRaw = candidateRow.amountPerUnit ?? candidateRow.gramsPerCapsule ?? "";
      const sourceLot = availableProductionSourceLots.find((lot) => String(lot.id) === String(candidateRow.sourceLotId || ""));
      const outputQuantity = Math.max(0, Number(prev.outputCount) || 0);
      let warning = "";

      if (sourceLot && outputQuantity > 0 && amountRaw !== "") {
        const available = Number(getLotAvailableQuantity(sourceLot)) || 0;
        const amountPerUnit = Math.max(0, Number(amountRaw) || 0);
        if (amountPerUnit * outputQuantity > available) {
          const cappedAmount = Math.floor((available / outputQuantity) * 100000) / 100000;
          candidateRow = {
            ...candidateRow,
            amountPerUnit: String(cappedAmount),
            gramsPerCapsule: String(cappedAmount),
          };
          warning = `Only ${formatFormulaQuantity(available, sourceLot?.unit || "g")} is available. Amount per ${getProductionFormulaConfig(prev.productType).unitLabel} was capped at ${cappedAmount}.`;
        }
      }

      if (Object.prototype.hasOwnProperty.call(nextPatch, "gramsPerCapsule") || Object.prototype.hasOwnProperty.call(nextPatch, "amountPerUnit")) {
        const resolved = candidateRow.amountPerUnit ?? candidateRow.gramsPerCapsule ?? "";
        candidateRow.amountPerUnit = resolved;
        candidateRow.gramsPerCapsule = resolved;
      }

      setConsumptionWarning(`formula:${rowKey}`, warning);
      return {
        ...prev,
        formulaRows: rows.map((row, rowIndex) => (rowIndex === index ? candidateRow : row)),
      };
    });
  }

  function addFormulaRow() {
    setProductionForm((prev) => {
      const rows = Array.isArray(prev.formulaRows) ? prev.formulaRows : [];
      const hasBlankRow = rows.some((row) => !String(row?.ingredientName || "").trim() && !String(row?.sourceLotId || "").trim());
      const duplicateLabels = getDuplicateFormulaLabels(rows);
      if (duplicateLabels.length > 0) {
        setMessage(`Remove duplicate formula rows before adding another ingredient: ${duplicateLabels.join(", ")}.`);
        return prev;
      }
      if (hasBlankRow) {
        setMessage("Finish the blank formula row before adding another ingredient.");
        return prev;
      }
      return {
        ...prev,
        formulaRows: [
          ...rows,
          { id: `formula_${Date.now()}`, ingredientName: "", sourceLotId: "", amountPerUnit: "", gramsPerCapsule: "", percent: "" },
        ],
      };
    });
  }

  function removeFormulaRow(index) {
    setProductionForm((prev) => {
      const rows = (Array.isArray(prev.formulaRows) ? prev.formulaRows : []).filter((_, rowIndex) => rowIndex !== index);
      return {
        ...prev,
        formulaRows: rows.length > 0 ? rows : [{ id: "formula_1", ingredientName: "", sourceLotId: "", amountPerUnit: "", gramsPerCapsule: "", percent: "" }],
      };
    });
  }

  function applyFormulaToSourceLots() {
    setProductionForm((prev) => {
      const duplicateLabels = getDuplicateFormulaLabels(prev.formulaRows);
      if (duplicateLabels.length > 0) {
        setMessage(`Remove duplicate formula rows before applying source quantities: ${duplicateLabels.join(", ")}.`);
        return prev;
      }
      const plan = buildCapsuleFormulaPlan(prev, availableProductionSourceLots);
      const nextLotQuantities = { ...prev.lotQuantities };
      const nextRows = (Array.isArray(prev.formulaRows) ? prev.formulaRows : []).map((row) => ({ ...row }));
      let applied = 0;
      let capped = 0;

      plan.rows.forEach((row) => {
        if (!row.sourceLotId || row.totalRequired <= 0) return;
        const safeTotal = Math.min(row.totalRequired, row.available);
        nextLotQuantities[row.sourceLotId] = String(Math.round(safeTotal * 1000) / 1000);
        applied += 1;
        if (row.totalRequired > row.available && plan.outputQuantity > 0) {
          const cappedPerUnit = Math.floor((row.available / plan.outputQuantity) * 100000) / 100000;
          const rowIndex = nextRows.findIndex((entry) => String(entry?.id) === String(row.id));
          if (rowIndex >= 0) {
            nextRows[rowIndex].amountPerUnit = String(cappedPerUnit);
            nextRows[rowIndex].gramsPerCapsule = String(cappedPerUnit);
          }
          setConsumptionWarning(`formula:${row.id}`, `Formula exceeded available inventory and was capped to ${formatFormulaQuantity(row.available, row.sourceUnit)} total.`);
          capped += 1;
        }
      });

      setMessage(
        applied > 0
          ? `Applied formula totals to ${applied} source lot${applied === 1 ? "" : "s"}${capped > 0 ? `; ${capped} row${capped === 1 ? " was" : "s were"} capped to available inventory` : ""}.`
          : "Link formula rows to source lots and enter an amount per output unit before applying totals."
      );
      return { ...prev, formulaRows: nextRows, lotQuantities: nextLotQuantities };
    });
  }

  function applyProductionRecipe(recipeId) {
    const recipe = recipeById.get(recipeId) || null;
    const defaults = getRecipeBatchCostDefaults(recipe || {});
    setProductionForm((prev) => ({
      ...prev,
      recipeId,
      packagingCost: defaults.packagingCost > 0 ? String(defaults.packagingCost) : prev.packagingCost,
      laborCost: defaults.laborCost > 0 ? String(defaults.laborCost) : prev.laborCost,
      overheadCost: defaults.overheadCost > 0 ? String(defaults.overheadCost) : prev.overheadCost,
      otherCost: defaults.otherCost > 0 ? String(defaults.otherCost) : prev.otherCost,
    }));
    setMessage(
      recipe
        ? `Applied recipe/BOM: ${recipe.name || recipeId}. Its supply costs are included in Recipe/BOM cost; manual fields are extra costs only.`
        : "Recipe/BOM cleared."
    );
  }

  function buildProductionInputLotsForSubmit() {
    const merged = new Map();
    productionCapsulePlan.rows.forEach((row) => {
      if (row.sourceLotId && row.totalRequired > 0) {
        merged.set(row.sourceLotId, (merged.get(row.sourceLotId) || 0) + row.totalRequired);
      }
    });
    selectedProductionLots.forEach((lot) => {
      const value = Number(lot.selectedQuantity) || 0;
      if (lot.id && value > 0 && !merged.has(lot.id)) {
        merged.set(lot.id, value);
      }
    });
    return Array.from(merged.entries()).map(([lotId, quantity]) => ({
      lotId,
      quantity: Math.round((Number(quantity) || 0) * 1000) / 1000,
    })).filter((entry) => entry.lotId && entry.quantity > 0);
  }

  async function handleCreateProduction() {
    if (!userId) return;
    if (
      !requestLabOperation(
        LAB_OPERATION_ACTIONS.CREATE_PRODUCTION,
        canUsePostProcessing
      )
    ) return;
    const capsuleRunCounts = [25, 50, 75, 100];
    const requestedCapsules = Math.floor(Number(productionForm.outputCount) || 0);
    if (productionForm.productType === "capsule" && !capsuleRunCounts.includes(requestedCapsules)) {
      setMessage("Capsule production runs must be 25, 50, 75, or 100 capsules for the current capsule machine workflow.");
      return;
    }
    const formulaDuplicateLabels = getDuplicateFormulaLabels(productionForm.formulaRows);
    if (formulaDuplicateLabels.length > 0) {
      setMessage(`Each formula ingredient/source can only be added once. Remove duplicates: ${formulaDuplicateLabels.join(", ")}.`);
      return;
    }
    if (productionCapsulePlan.rows.length > 0 && !productionCapsulePlan.rows.some((row) => row.amountPerUnit > 0)) {
      setMessage(`Enter a source amount per ${productionCapsulePlan.config.unitLabel} so the formula and source usage can be calculated.`);
      return;
    }
    if (productionCapsulePlan.inventoryGuards.length > 0) {
      const labels = productionCapsulePlan.inventoryGuards
        .slice(0, 4)
        .map((entry) => `${entry.sourceLotName || entry.sourceLotId} (${formatFormulaQuantity(entry.shortage, entry.sourceUnit)} short)`)
        .join(", ");
      setMessage(`Resolve formula source-lot shortages before creating this batch: ${labels}.`);
      return;
    }
    if (productionSupplySnapshot?.blockingShortages?.length > 0) {
      const labels = productionSupplySnapshot.blockingShortages
        .slice(0, 4)
        .map((entry) => `${entry.supplyName} (${formatQty(entry.shortageQuantity, entry.unit, entry.unit === "count" ? 0 : 2)} short)`)
        .join(", ");
      setMessage(`Resolve recipe or ingredient shortages before creating this batch: ${labels}.`);
      return;
    }
    const submitInputLots = buildProductionInputLotsForSubmit();
    if (submitInputLots.length === 0) {
      setMessage("Select source lots or link formula rows to source lots before creating this production batch.");
      return;
    }
    const resolvedMgPerUnit = Number(productionForm.mgPerUnit) || productionAutoMgPerUnit || 0;
    const productMeta = getProductTypeMeta(productionForm.productType);
    const resolvedPackageSize = "";
    const resolvedPackageSizeUnit = productMeta.outputUnit;
    const resolvedPackageUnitLabel = productMeta.pieceLabelPlural;
    try {
      setProductionBusy(true);
      setMessage("");
      const result = await createProductBatch({
        userId,
        name: productionForm.name,
        productType: productionForm.productType,
        method: productionForm.method,
        variant: productionForm.variant,
        notes: productionForm.notes,
        date: productionForm.date,
        status: productionForm.status,
        outputCount: productionForm.outputCount,
        mgPerUnit: resolvedMgPerUnit,
        packageSize: resolvedPackageSize,
        packageSizeUnit: resolvedPackageSizeUnit,
        packageCount: "",
        packageUnitLabel: resolvedPackageUnitLabel,
        totalPowderUsedG: productionCapsulePlan.totalPowderNeededG || selectedProductionLots.filter((lot) => normalizePackageUnit(lot?.unit || "g") === "g").reduce((sum, lot) => sum + (Number(lot.selectedQuantity) || 0), 0),
        targetCapsuleFillG: productionForm.productType === "capsule" ? (productionCapsulePlan.totalPerCapsuleG || productionAutoMgPerUnit / 1000 || 0) : 0,
        formulaIngredients: productionCapsulePlan.rows,
        inputLots: submitInputLots,
        recipeId: selectedRecipeCosting.recipeId,
        recipeName: selectedRecipeCosting.recipeName,
        recipeYield: selectedRecipeCosting.recipeYield,
        recipeItems: selectedRecipeCosting.recipeItems,
        recipeCost: selectedRecipeCosting.totalCost,
        recipeCostBreakdown: {
          total: selectedRecipeCosting.totalCost,
          factor: selectedRecipeCosting.factor,
          items: selectedRecipeCosting.breakdown,
        },
        packagingCost: productionForm.packagingCost,
        laborCost: productionForm.laborCost,
        overheadCost: productionForm.overheadCost,
        otherCost: productionForm.otherCost,
        directCost: productionDirectCost,
        pricePerUnit: "",
        msrpPerUnit: "",
        desiredMarginPercent: "60",
        bottleSize: productionForm.bottleSize,
        bottleSizeUnit: productionForm.bottleSizeUnit,
      });
      const meta = getProductTypeMeta(result?.productType || productionForm.productType);
      setMessage(
        `Created ${meta.label.toLowerCase()} production batch ${result?.name || ""}.`.trim()
      );
      resetProductionForm();
      setActiveTab("finished");
      setCreateProductionModalOpen(false);
      closePostProcessDetail();
    } catch (error) {
      setMessage(error?.message || "Failed to create production batch.");
    } finally {
      setProductionBusy(false);
    }
  }



  async function handleFinalizeProductionOutput(batch, event = null) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (!userId) {
      setProductionActionMessage("Sign in before creating finished output.");
      setMessage("Sign in before creating finished output.");
      return;
    }
    if (!batch?.id) {
      setProductionActionMessage("Missing production batch id. Refresh and try again.");
      setMessage("Missing production batch id. Refresh and try again.");
      return;
    }

    const parsedNameCount = Math.floor(
      Number(String(batch?.name || "").match(/(\d+)\s*(?:count|capsule|capsules)/i)?.[1]) || 0
    );
    const fallbackOutputCount = Math.floor(
      Number(batch?.outputCount) ||
        Number(batch?.actualOutputCount) ||
        Number(batch?.capsulesMade) ||
        Number(batch?.expectedOutputCount) ||
        Number(batch?.yieldMetrics?.actualQuantity) ||
        Number(batch?.yieldMetrics?.expectedQuantity) ||
        parsedNameCount ||
        0
    );
    const fallbackPowderG =
      Number(batch?.totalPowderUsedG) ||
      (batch?.inputLots || [])
        .filter((lot) => normalizePackageUnit(lot?.unit || "g") === "g")
        .reduce((sum, lot) => sum + (Number(lot?.quantity) || 0), 0);
    const fallbackTargetFillG =
      Number(batch?.targetCapsuleFillG) ||
      (fallbackOutputCount > 0 && fallbackPowderG > 0 ? fallbackPowderG / fallbackOutputCount : 0);
    const form = finalizeForms[batch.id] || {};
    const outputCount = Math.floor(Number(form.outputCount) || fallbackOutputCount || 0);
    const totalPowderUsedG = Number(form.totalPowderUsedG) || fallbackPowderG || 0;
    const targetCapsuleFillG = Number(form.targetCapsuleFillG) || fallbackTargetFillG || 0;
    const mgPerUnit =
      Number(form.mgPerUnit) ||
      (outputCount > 0 && totalPowderUsedG > 0 ? (totalPowderUsedG * 1000) / outputCount : 0);

    if (outputCount <= 0) {
      const errorMessage = "Enter the finished output count before creating finished inventory output.";
      setProductionActionMessage(errorMessage);
      setMessage(errorMessage);
      return;
    }

    try {
      setFinalizeBusyId(batch.id);
      setProductionActionMessage("Creating parent finished inventory output...");
      setMessage("Creating parent finished inventory output...");

      const result = await finalizeProductBatchOutput({
        userId,
        batchId: batch.id,
        date: form.date || today,
        outputCount,
        totalPowderUsedG,
        targetCapsuleFillG,
        mgPerUnit,
        notes: form.notes || "Finished output created from active production batch.",
      });

      setMessage(`Created finished inventory output for ${result?.name || batch?.name || "production batch"}. Package/SKU it from Finished Inventory.`);
      setProductionActionMessage("");
      setFinalizeForms((prev) => ({
        ...prev,
        [batch.id]: {
          outputCount: "",
          totalPowderUsedG: "",
          targetCapsuleFillG: "",
          mgPerUnit: "",
          date: today,
          notes: "",
        },
      }));
      setSelectedDryLotId("");
      setSelectedExtractLotId("");
      setSelectedExtractionBatchId("");
      setSelectedProductionBatchId("");
      setSelectedSalesProductKey("");
      setPackageCreatorOpenLotId("");
      setCreateExtractionModalOpen(false);
      setCreateProductionModalOpen(false);
      setActiveTab("finished");
      setSelectedFinishedLotId(result?.outputLotId || "");
    } catch (error) {
      const errorMessage = error?.message || "Failed to create finished inventory output from this production batch.";
      setProductionActionMessage(errorMessage);
      setMessage(errorMessage);
    } finally {
      setFinalizeBusyId("");
    }
  }

  async function handleCreateRework() {
    if (!userId) return;
    if (
      !requestLabOperation(
        LAB_OPERATION_ACTIONS.CREATE_REWORK,
        canUsePostProcessing
      )
    ) return;
    if (reworkSelectedLots.length === 0) {
      setMessage("Select at least one finished lot and quantity to rework.");
      return;
    }
    if (reworkSupplySnapshot?.blockingShortages?.length > 0) {
      const labels = reworkSupplySnapshot.blockingShortages
        .slice(0, 4)
        .map((entry) => `${entry.supplyName} (${formatQty(entry.shortageQuantity, entry.unit, entry.unit === "count" ? 0 : 2)} short)`)
        .join(", ");
      setMessage(`Resolve packaging or ingredient shortages before creating this rework batch: ${labels}.`);
      return;
    }
    try {
      setReworkBusy(true);
      setMessage("");
      const result = await createReworkBatch({
        userId,
        name: reworkForm.name,
        reworkType: reworkForm.reworkType,
        date: reworkForm.date,
        notes: reworkForm.notes,
        outputCount: reworkForm.outputCount,
        expectedOutputCount: reworkForm.expectedOutputCount,
        wasteQuantity: reworkForm.wasteQuantity,
        wasteUnit: reworkForm.wasteUnit,
        wasteReason: reworkForm.wasteReason,
        wasteNotes: reworkForm.wasteNotes,
        productType: reworkForm.productType,
        variant: reworkForm.variant,
        mgPerUnit: reworkForm.mgPerUnit,
        bottleSize: reworkForm.bottleSize,
        bottleSizeUnit: reworkForm.bottleSizeUnit,
        inputLots: reworkSelectedLots.map((lot) => ({ lotId: lot.id, quantity: lot.selectedQuantity })),
        recipeId: reworkRecipeCosting.recipeId,
        recipeName: reworkRecipeCosting.recipeName,
        recipeYield: reworkRecipeCosting.recipeYield,
        recipeItems: reworkRecipeCosting.recipeItems,
        recipeCost: reworkRecipeCosting.totalCost,
        recipeCostBreakdown: {
          total: reworkRecipeCosting.totalCost,
          factor: reworkRecipeCosting.factor,
          items: reworkRecipeCosting.breakdown,
        },
        packagingCost: reworkForm.packagingCost,
        laborCost: reworkForm.laborCost,
        overheadCost: reworkForm.overheadCost,
        otherCost: reworkForm.otherCost,
        directCost:
          sanitizeNumber(reworkForm.packagingCost) +
          sanitizeNumber(reworkForm.laborCost) +
          sanitizeNumber(reworkForm.overheadCost) +
          sanitizeNumber(reworkForm.otherCost),
        pricePerUnit: reworkForm.pricePerUnit,
        msrpPerUnit: Number(reworkForm.msrpPerUnit) || 0,
        desiredMarginPercent: reworkForm.desiredMarginPercent,
      });
      setMessage(`Created rework batch ${result?.name || ""}.`.trim());
      resetReworkForm();
      setActiveTab("production");
    } catch (error) {
      setMessage(error?.message || "Failed to create rework batch.");
    } finally {
      setReworkBusy(false);
    }
  }

  async function handleCreatePackageRun() {
    if (!userId) return;
    if (
      !requestLabOperation(
        LAB_OPERATION_ACTIONS.CREATE_PACKAGE_RUN,
        canCreatePackageRuns
      )
    ) return;
    const sourceLot = packageSourceLots.find((lot) => lot.id === packageForm.sourceLotId) || packageSourceLot;
    if (!sourceLot?.id) {
      setMessage("Select a finished lot before creating packages.");
      return;
    }

    const packagePreview = buildPackagePreview(packageCostedForm, sourceLot);
    if (!packagePreview.canCreate) {
      setMessage(packagePreview.guardMessage || "Fix the package run before creating packages.");
      return;
    }

    try {
      setPackageBusy(true);
      setMessage("");
      const result = await createPackagedFinishedLot({
        userId,
        sourceLotId: sourceLot.id,
        skuType: packageForm.skuType,
        packageSize: packageForm.packageSize,
        packageSizeUnit: packageForm.packageSizeUnit,
        packageCount: packageForm.packageCount,
        sourceQuantity: packagePreview.sourceQuantity || packageForm.sourceQuantity,
        capsulesPerPackage: packagePreview.capsulesPerPackage || packageForm.capsulesPerPackage,
        packageUnitLabel: packageForm.packageUnitLabel,
        lotCode: packageForm.lotCode,
        pricePerUnit: packageForm.pricePerUnit,
        msrpPerUnit: packageForm.msrpPerUnit,
        desiredMarginPercent: packageForm.desiredMarginPercent,
        packageRecipeId: packageCostedForm.packageRecipeId,
        packageRecipeName: packageCostedForm.packageRecipeName,
        packageRecipeCostPerPackage: packageCostedForm.packageRecipeCostPerPackage,
        packageRecipeCostTotal: packageCostedForm.packageRecipeCostTotal,
        packagingCostPerPackage: packageForm.packagingCostPerPackage,
        laborCostPerPackage: packageForm.laborCostPerPackage,
        otherCostPerPackage: packageForm.otherCostPerPackage,
        date: packageForm.date,
        notes: packageForm.notes,
      });
      setMessage(`Created packaged inventory ${result?.name || result?.lotId || ""}.`.trim());
      setPackageForm(normalizePackageForm(today));
      setPackageCreatorOpenLotId("");
    } catch (error) {
      setMessage(error?.message || "Failed to create packaged inventory.");
    } finally {
      setPackageBusy(false);
    }
  }

  function handleMovementQuantityChange(lot, form, rawValue) {
    if (!lot?.id) return;
    const available = Number(getLotAvailableQuantity(lot)) || 0;
    const entered = Number(rawValue);
    const normalizedForm = form || getDefaultMovementFormForLot(lot, today);

    if (rawValue === "") {
      setMovementWarnings((prev) => ({ ...prev, [lot.id]: "" }));
      setMovementForms((prev) => ({
        ...prev,
        [lot.id]: { ...normalizedForm, quantity: "" },
      }));
      return;
    }

    if (Number.isFinite(entered) && entered > available) {
      setMovementWarnings((prev) => ({
        ...prev,
        [lot.id]: `Only ${available} available. Quantity was capped to the maximum available.`,
      }));
      setMovementForms((prev) => ({
        ...prev,
        [lot.id]: { ...normalizedForm, quantity: String(available) },
      }));
      return;
    }

    setMovementWarnings((prev) => ({ ...prev, [lot.id]: "" }));
    setMovementForms((prev) => ({
      ...prev,
      [lot.id]: { ...normalizedForm, quantity: rawValue },
    }));
  }

  async function handleFinishedMovement(lot) {
    if (!userId || !lot?.id) return;
    const form = movementForms[lot.id] || getDefaultMovementFormForLot(lot, today);
    const movementRequirement = getInventoryMovementRequirement({
      movementType: form.movementType,
      fefoOverride: false,
    });

    if (movementRequirement) {
      const movementAllowed =
        movementRequirement.featureKey === SUBSCRIPTION_FEATURE_KEYS.INVENTORY_AUDIT_HISTORY
          ? canUseInventoryAuditHistory
          : canRecordSales;
      if (!requestFeatureAccess({ allowed: movementAllowed, ...movementRequirement })) return;
    }

    if (String(form.movementType || "").toLowerCase() === "sell" && form.fefoOverride) {
      const fefoRequirement = getInventoryMovementRequirement({
        movementType: "sell",
        fefoOverride: true,
      });
      if (!requestFeatureAccess({ allowed: canUseFefoControls, ...fefoRequirement })) return;
    }

    try {
      setMovementBusyId(lot.id);
      setMessage("");
      const defaultPrice = getLockedPackagePrice(lot);
      const pricePerUnit = form.movementType === "sell" ? (form.unitPrice === "" || form.unitPrice === undefined ? defaultPrice : sanitizeNumber(form.unitPrice)) : 0;
      const priceAudit = getSalePriceOverrideState(lot, { ...form, unitPrice: pricePerUnit });
      if (priceAudit.requiresMemo && !String(form.priceOverrideReason || "").trim()) {
        if (priceAudit.belowCost) throw new Error("Selling below package cost requires a price override memo.");
        throw new Error("Changing the locked package price requires a price override memo.");
      }
      const available = Number(getLotAvailableQuantity(lot)) || 0;
      const enteredQuantity = sanitizeNumber(form.quantity);
      const quantity = enteredQuantity > available ? available : enteredQuantity;
      if (enteredQuantity > available) {
        setMovementWarnings((prev) => ({
          ...prev,
          [lot.id]: `Only ${available} available. Quantity was capped to the maximum available.`,
        }));
        setMovementForms((prev) => ({
          ...prev,
          [lot.id]: { ...form, quantity: String(available) },
        }));
      }
      const fefoBlocker = getFefoBlockingLot(lot, saleReadyFinishedGoodsLots, today);
      const fefoOverrideApplied =
        form.movementType === "sell" && Boolean(fefoBlocker) && Boolean(form.fefoOverride);
      if (form.movementType === "sell" && fefoBlocker && !fefoOverrideApplied) {
        throw new Error(
          `FEFO requires selling the earlier-expiring ${getPackageSizeLabel(fefoBlocker)} lot first: ${fefoBlocker?.lotCode || fefoBlocker?.batchLot || fefoBlocker?.name || fefoBlocker.id} (best by ${getLotBestByValue(fefoBlocker) || "not set"}).`
        );
      }
      if (fefoOverrideApplied && !String(form.fefoOverrideReason || "").trim()) {
        throw new Error("Enter a FEFO override reason before selling a later-expiring package lot.");
      }
      const salesBlockReason = getSalesBlockReason(lot, today);
      if (form.movementType === "sell" && salesBlockReason) {
        throw new Error(salesBlockReason);
      }
      if (form.movementType === "destroy" && !String(form.reason || "").trim()) {
        throw new Error("Enter a reason before destroying finished inventory.");
      }
      await recordFinishedInventoryMovement({
        userId,
        lotId: lot.id,
        movementType: form.movementType,
        quantity,
        date: form.date,
        note: form.note,
        revenue: form.movementType === "sell" ? pricePerUnit * quantity : 0,
        pricePerUnit,
        defaultPricePerUnit: priceAudit.defaultPrice,
        priceOverrideType: form.priceOverrideType,
        priceOverrideReason: form.priceOverrideReason,
        fefoOverride: fefoOverrideApplied,
        fefoOverrideReason: fefoOverrideApplied ? form.fefoOverrideReason : "",
        fefoSkippedLotId: fefoOverrideApplied ? fefoBlocker?.id || "" : "",
        fefoSkippedLotCode: fefoOverrideApplied
          ? fefoBlocker?.lotCode || fefoBlocker?.batchLot || fefoBlocker?.name || ""
          : "",
        fefoSkippedBestBy: fefoOverrideApplied ? getLotBestByValue(fefoBlocker) : "",
        fefoSelectedBestBy: fefoOverrideApplied ? getLotBestByValue(lot) : "",
        counterparty: form.destinationName || form.counterparty,
        reason: form.reason,
        destinationType: form.destinationType,
        destinationName: form.destinationName,
        destinationLocation: form.destinationLocation,
        destroyMethod: form.destroyMethod,
      });
      setMessage(`${formatMovementType(form.movementType)} recorded for ${lot?.name || lot.id}.`);
      setMovementForms((prev) => ({
        ...prev,
        [lot.id]: getDefaultMovementFormForLot(lot, today),
      }));
      setMovementWarnings((prev) => ({ ...prev, [lot.id]: "" }));
      if (form.movementType === "sell") {
        setActiveTab("sales");
        setSelectedSalesProductKey("");
      }
    } catch (error) {
      setMessage(error?.message || "Failed to record finished inventory movement.");
    } finally {
      setMovementBusyId("");
    }
  }

  async function handleFinalDisposition(lot) {
    if (!userId || !lot?.id) return;

    const dispositionState = getMaterialLotFinalDispositionState(lot, today);
    const form = finalDispositionForms[lot.id] || getDefaultFinalDispositionForm(lot, today);
    const quantity = sanitizeNumber(form.quantity);
    const available = getLotAvailableQuantity(lot);

    if (!(quantity > 0)) {
      setMessage("Enter a final-disposition quantity greater than zero.");
      return;
    }
    if (quantity > available) {
      setMessage(
        `${lot?.name || lot.id} only has ${formatQty(available, lot?.unit || "units", getQtyDigits(lot?.unit || "units"))} available after reservations.`
      );
      return;
    }
    if (!String(form.reason || "").trim()) {
      setMessage("Enter a reason before completing final disposition.");
      return;
    }

    const confirmed = window.confirm(
      `Destroy ${formatQty(quantity, lot?.unit || "units", getQtyDigits(lot?.unit || "units"))} from ${lot?.name || lot.id}? This preserves the history but cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setFinalDispositionBusyId(lot.id);
      setMessage("");
      const result = await recordMaterialLotFinalDisposition({
        userId,
        lotId: lot.id,
        quantity,
        date: form.date || today,
        reason: form.reason,
        method: form.method,
        note: form.note,
        trigger: dispositionState.reasonCode || "manual_disposition",
      });

      setFinalDispositionForms((prev) => {
        const next = { ...prev };
        delete next[lot.id];
        return next;
      });
      setMessage(
        result?.archived
          ? `${lot?.name || lot.id} was fully disposed and moved to history.`
          : `${formatQty(quantity, lot?.unit || "units", getQtyDigits(lot?.unit || "units"))} was removed from ${lot?.name || lot.id}.`
      );
      setActiveTab("history");
    } catch (error) {
      setMessage(error?.message || "Failed to complete final disposition.");
    } finally {
      setFinalDispositionBusyId("");
    }
  }

  async function handleReleasePackageForSale(lot) {
    if (!userId || !lot?.id) return;

    const qcStatus = String(lot?.qc?.status || lot?.qcStatus || "").trim().toLowerCase();
    if (["fail", "failed", "rejected"].includes(qcStatus)) {
      setMessage("This package failed QC and cannot be released for sale.");
      return;
    }

    const shelfLife = lot?.shelfLife && typeof lot.shelfLife === "object" ? lot.shelfLife : {};
    const bestBy = shelfLife?.bestBy || shelfLife?.expirationDate || lot?.bestBy || lot?.expirationDate || "";
    const bestByDate = parseAnyDate(bestBy);
    const todayDate = parseAnyDate(today);
    if (bestByDate && todayDate) {
      const target = new Date(bestByDate);
      const current = new Date(todayDate);
      target.setHours(0, 0, 0, 0);
      current.setHours(0, 0, 0, 0);
      if (target < current) {
        setMessage("This package is past its best-by date and cannot be released for sale.");
        return;
      }
    }

    try {
      setReleaseBusyId(lot.id);
      setMessage("");
      const existingWorkflow = lot?.workflow && typeof lot.workflow === "object" ? lot.workflow : {};
      const releasedBy = auth?.currentUser?.email || auth?.currentUser?.uid || "App user";
      await updateDoc(doc(db, "users", userId, "materialLots", lot.id), {
        releaseRequired: true,
        releaseStatus: "released",
        releasedAt: today,
        releasedBy,
        workflow: {
          ...existingWorkflow,
          releaseRequired: true,
          releaseStatus: "released",
          releasedAt: today,
          releasedBy,
          notes: existingWorkflow?.notes || "Released from Sales after package/QC review.",
        },
        updatedDate: today,
      });
      setMessage(`Released ${lot?.lotCode || lot?.batchLot || lot?.name || "package run"} for sale.`);
    } catch (error) {
      setMessage(error?.message || "Failed to release package for sale.");
    } finally {
      setReleaseBusyId("");
    }
  }


  async function handleSaveReservation(lot) {
    if (!userId || !lot?.id) return;
    if (
      !requestLabOperation(
        LAB_OPERATION_ACTIONS.ADD_RESERVATION,
        canUseFinishedInventory
      )
    ) return;
    const draft = reservationForms[lot.id] || normalizeReservationForm(today);
    const quantity = sanitizeNumber(draft.quantity);
    const available = getLotAvailableQuantity(lot);

    if (!(quantity > 0)) {
      setMessage("Enter a reservation quantity greater than zero.");
      return;
    }

    if (quantity > available) {
      setMessage(
        `${lot?.name || lot.id} only has ${formatQty(available, lot?.displayUnitLabel || lot?.unit || "g", getQtyDigits(lot?.displayUnitLabel || lot?.unit || "g"))} available after current reservations.`
      );
      return;
    }

    const nextReservations = [
      ...getLotReservations(lot),
      {
        id: buildReservationEntryId(),
        label: draft.label || "Reservation",
        quantity,
        date: draft.date || today,
        note: draft.note || "",
        status: "reserved",
        type: "hold",
      },
    ];

    try {
      setReservationBusyId(lot.id);
      setMessage("");
      await updateDoc(doc(db, "users", userId, "materialLots", lot.id), {
        reservations: nextReservations,
        reservationQuantity: sumReservationEntries(nextReservations),
        updatedDate: today,
      });
      setReservationForms((prev) => ({
        ...prev,
        [lot.id]: normalizeReservationForm(today),
      }));
      setMessage(`Added reservation for ${lot?.name || lot.id}.`);
    } catch (error) {
      setMessage(error?.message || "Failed to save reservation.");
    } finally {
      setReservationBusyId("");
    }
  }

  async function handleRemoveReservation(lot, reservationId) {
    if (!userId || !lot?.id) return;
    const nextReservations = getLotReservations(lot).filter((entry) => entry.id !== reservationId);

    try {
      setReservationBusyId(lot.id);
      setMessage("");
      await updateDoc(doc(db, "users", userId, "materialLots", lot.id), {
        reservations: nextReservations,
        reservationQuantity: sumReservationEntries(nextReservations),
        updatedDate: today,
      });
      setMessage(`Released reservation on ${lot?.name || lot.id}.`);
    } catch (error) {
      setMessage(error?.message || "Failed to release reservation.");
    } finally {
      setReservationBusyId("");
    }
  }

  async function handleSaveThreshold(lot) {
    if (!userId || !lot?.id) return;
    if (
      !requestLabOperation(
        LAB_OPERATION_ACTIONS.SAVE_LOW_STOCK_THRESHOLD,
        canUseFinishedInventory
      )
    ) return;
    const threshold = sanitizeNumber(thresholdForms[lot.id], false);

    try {
      setThresholdBusyId(lot.id);
      setMessage("");
      await updateDoc(doc(db, "users", userId, "materialLots", lot.id), {
        lowStockThreshold: threshold,
        updatedDate: today,
      });
      setMessage(
        threshold > 0
          ? `Saved low-stock threshold for ${lot?.name || lot.id}.`
          : `Disabled low-stock alerts for ${lot?.name || lot.id}.`
      );
    } catch (error) {
      setMessage(error?.message || "Failed to save low-stock threshold.");
    } finally {
      setThresholdBusyId("");
    }
  }


  async function handleSaveQuality(lot) {
    if (!userId || !lot?.id) return;
    const form = qualityForms[lot.id] || normalizeQualityForm(lot, today);
    const resolvedMadeOn = form.madeOn || today;
    const resolvedBestBy = form.bestBy || getDefaultBestByDate(resolvedMadeOn, today);

    try {
      setQualityBusyId(lot.id);
      setMessage("");
      await updateDoc(doc(db, "users", userId, "materialLots", lot.id), {
        potency: {
          activeMgPerUnit: sanitizeNumber(form.activeMgPerUnit),
          activeMgPerMl: sanitizeNumber(form.activeMgPerMl),
          activeMgPerGram: sanitizeNumber(form.activeMgPerGram),
          notes: form.potencyNotes || "",
          updatedDate: today,
        },
        qc: {
          status: normalizeQcStatus(form.qcStatus),
          checkedBy: form.qcCheckedBy || "",
          checkedDate: form.qcCheckedDate || "",
          notes: form.qcNotes || "",
        },
        shelfLife: {
          madeOn: resolvedMadeOn,
          bestBy: resolvedBestBy,
          expirationDate: resolvedBestBy,
          storageCondition: form.storageCondition || "",
          storageNotes: form.storageNotes || "",
        },
        releaseRequired: true,
        releaseStatus: normalizeQcStatus(form.qcStatus) === "pass" ? "released" : "pending",
        releasedAt: normalizeQcStatus(form.qcStatus) === "pass" ? today : "",
        releasedBy: normalizeQcStatus(form.qcStatus) === "pass" ? (auth?.currentUser?.email || auth?.currentUser?.uid || "App user") : "",
        workflow: {
          ...(lot?.workflow && typeof lot.workflow === "object" ? lot.workflow : {}),
          releaseRequired: true,
          releaseStatus: normalizeQcStatus(form.qcStatus) === "pass" ? "released" : "pending",
          releasedAt: normalizeQcStatus(form.qcStatus) === "pass" ? today : "",
          releasedBy: normalizeQcStatus(form.qcStatus) === "pass" ? (auth?.currentUser?.email || auth?.currentUser?.uid || "App user") : "",
          notes: form.qcNotes || lot?.workflow?.notes || "",
        },
        updatedDate: today,
      });
      setMessage(`Saved potency, QC, and shelf life for ${lot?.name || lot.id}.`);
    } catch (error) {
      setMessage(error?.message || "Failed to save potency and QC data.");
    } finally {
      setQualityBusyId("");
    }
  }

  function applyPackagePreset(sourceLot, preset) {
    if (
      !requestLabOperation(
        LAB_OPERATION_ACTIONS.CREATE_PACKAGE_RUN,
        canCreatePackageRuns
      )
    ) return;
    setPackageCreatorOpenLotId(sourceLot?.id || "");
    setPackageForm({
      ...normalizePackageForm(today, sourceLot?.id || ""),
      sourceLotId: sourceLot?.id || "",
      skuType: preset.skuType || "retail",
      packageSize: preset.size,
      packageSizeUnit: preset.unit || "g",
      capsulesPerPackage: preset.capsulesPerPackage || "",
      packageUnitLabel: preset.skuType === "sample" ? "samples" : "packages",
      lotCode: "",
      msrpPerUnit: "",
      notes: "",
    });
  }

  function renderPackageRunCreator(sourceLot, meta = {}) {
    const isOpen = packageCreatorOpenLotId === sourceLot.id;
    const localPreview = isOpen ? buildPackagePreview(packageCostedForm, sourceLot) : buildPackagePreview(normalizePackageForm(today, sourceLot.id), sourceLot);
    const sourceRuns = packageRunsBySourceLotId.get(sourceLot.id) || [];
    const sourceAvailable = getLotAvailableQuantity(sourceLot);
    const packageUnit = normalizePackageUnit(packageForm.packageSizeUnit || "g");
    const capsuleSourceWeightPackage = localPreview.countBasedSource && packageUnit === "g";

    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-medium">Package runs / SKUs from this batch</div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Keep the finished batch as the parent. Create retail, sample, promo, or internal SKUs from this source batch.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (
                !requestLabOperation(
                  LAB_OPERATION_ACTIONS.CREATE_PACKAGE_RUN,
                  canCreatePackageRuns
                )
              ) return;
              setPackageForm(normalizePackageForm(today, sourceLot.id));
              setPackageCreatorOpenLotId(sourceLot.id);
            }}
            className="btn btn-accent text-sm"
          >
            Create package run
          </button>
        </div>

        {sourceRuns.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {sourceRuns.map((run) => (
              <div key={`source-run-${run.id}`} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/50 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{getSkuTypeLabel(getSkuType(run))}</div>
                    <div className="text-zinc-500 dark:text-zinc-400">{getPackageSizeLabel(run)}</div>
                  </div>
                  <div className="text-right font-semibold">
                    {getLotAvailableQuantity(run)} {getPackageUnitName(run, meta)}
                  </div>
                </div>
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {run?.lotCode || run?.batchLot || "No lot code"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-sm text-zinc-600 dark:text-zinc-400">
            No package runs created from this batch yet.
          </div>
        )}

        {isOpen ? (
          <div
            className="rounded-2xl border p-4 space-y-4"
            style={{
              borderColor: "rgba(var(--accent-rgb), 0.35)",
              backgroundColor: "rgba(10, 10, 18, 0.72)",
            }}
          >
          <div className="flex flex-wrap gap-2">
            {[
              { label: "1/8 · 3.5 g", size: "3.5", unit: "g", skuType: "retail" },
            { label: "1/4 · 7 g", size: "7", unit: "g", skuType: "retail" },
            { label: "1/2 · 14 g", size: "14", unit: "g", skuType: "retail" },
            { label: "Full · 28 g", size: "28", unit: "g", skuType: "retail" },
            { label: "1 g sample", size: "1", unit: "g", skuType: "sample" },
            { label: "2 cap sample", size: "2", unit: "capsules", skuType: "sample", capsulesPerPackage: "2" },
          ].map((preset) => (
            <button
              key={`${sourceLot.id}-${preset.label}`}
              type="button"
              onClick={() => applyPackagePreset(sourceLot, preset)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {preset.label}
            </button>
          ))}
        </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">SKU type</span>
                <select
                  value={packageForm.skuType}
                  onChange={(e) => setPackageForm((prev) => ({ ...prev, skuType: e.target.value, packageUnitLabel: e.target.value === "sample" ? "samples" : prev.packageUnitLabel || "packages" }))}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                >
                  <option value="retail">Retail</option>
                  <option value="sample">Sample / not for sale</option>
                  <option value="promo">Promo / event</option>
                  <option value="internal">Internal / testing</option>
                </select>
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Total weight / package</span>
                <input type="number" min="0" step="0.001" value={packageForm.packageSize} onChange={(e) => updatePackageFormWithInventoryGuard(sourceLot, { packageSize: e.target.value }, "Package size")} placeholder="label weight, usually grams" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Size unit</span>
                <select value={packageForm.packageSizeUnit} onChange={(e) => updatePackageFormWithInventoryGuard(sourceLot, { packageSizeUnit: e.target.value }, "Package unit")} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                  <option value="g">g</option>
                  <option value="capsules">capsules</option>
                  <option value="mL">mL</option>
                  <option value="unit">unit</option>
                </select>
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Number of packages</span>
                <input type="number" min="0" step="1" value={packageForm.packageCount} onChange={(e) => updatePackageFormWithInventoryGuard(sourceLot, { packageCount: e.target.value }, "Number of packages")} placeholder="How many packages" className={`w-full rounded-xl border bg-white dark:bg-zinc-900 px-3 py-2 ${consumptionWarnings[`package:${sourceLot.id}`] ? "border-rose-400 text-rose-900 dark:text-rose-100" : "border-zinc-300 dark:border-zinc-700"}`} />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Unit label</span>
                <input type="text" value={packageForm.packageUnitLabel} onChange={(e) => setPackageForm((prev) => ({ ...prev, packageUnitLabel: e.target.value }))} placeholder="packages or samples" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Capsules / package override</span>
                <input type="number" min="0" step="1" value={packageForm.capsulesPerPackage} onChange={(e) => updatePackageFormWithInventoryGuard(sourceLot, { capsulesPerPackage: e.target.value }, "Capsules per package")} placeholder={localPreview.recommendedCapsulesPerPackage ? `Recommended ${localPreview.recommendedCapsulesPerPackage}` : "Auto from batch avg"} className={`w-full rounded-xl border bg-white dark:bg-zinc-900 px-3 py-2 ${consumptionWarnings[`package:${sourceLot.id}`] ? "border-rose-400 text-rose-900 dark:text-rose-100" : "border-zinc-300 dark:border-zinc-700"}`} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">{capsuleSourceWeightPackage ? "Source capsules consumed" : "Source units consumed"}</span>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={capsuleSourceWeightPackage ? localPreview.sourceQuantity || "" : packageForm.sourceQuantity}
                  onChange={(e) => updatePackageFormWithInventoryGuard(sourceLot, { sourceQuantity: e.target.value }, "Source quantity")}
                  placeholder={localPreview.sourceQuantity ? String(localPreview.sourceQuantity) : capsuleSourceWeightPackage ? "package count × capsules/package" : "Auto from source units"}
                  disabled={capsuleSourceWeightPackage}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-80"
                />
                <div className="text-[11px] text-zinc-500 dark:text-zinc-500">{capsuleSourceWeightPackage ? "Auto-calculated from number of packages × capsules/package." : "Leave blank unless you need a manual override."}</div>
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Package lot code</span>
                <input type="text" value={packageForm.lotCode} onChange={(e) => setPackageForm((prev) => ({ ...prev, lotCode: e.target.value }))} placeholder="Optional auto code" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Packaging recipe / BOM</span>
                <select value={packageForm.packageRecipeId || ""} onChange={(e) => setPackageForm((prev) => ({ ...prev, packageRecipeId: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                  <option value="">No packaging recipe</option>
                  {recipes.map((recipe) => (
                    <option key={`package-recipe-${recipe.id}`} value={recipe.id}>{recipe.name || recipe.id}</option>
                  ))}
                </select>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-500">{selectedPackageRecipeCosting.totalCost > 0 ? `${money(selectedPackageRecipeCosting.totalCost)} recipe cost for this run · ${money(packageCostedForm.packageRecipeCostPerPackage)} per package` : "Auto-selects a packaging/label recipe when one exists."}</div>
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Extra packaging cost / package</span>
                <input type="number" min="0" step="0.01" value={packageForm.packagingCostPerPackage} onChange={(e) => setPackageForm((prev) => ({ ...prev, packagingCostPerPackage: e.target.value }))} placeholder="bags, labels, jars" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Extra labor / package</span>
                <input type="number" min="0" step="0.01" value={packageForm.laborCostPerPackage} onChange={(e) => setPackageForm((prev) => ({ ...prev, laborCostPerPackage: e.target.value }))} placeholder="optional" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Extra other cost / package</span>
                <input type="number" min="0" step="0.01" value={packageForm.otherCostPerPackage} onChange={(e) => setPackageForm((prev) => ({ ...prev, otherCostPerPackage: e.target.value }))} placeholder="optional" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Target margin %</span>
                <input type="number" min="1" max="95" step="1" value={packageForm.desiredMarginPercent} onChange={(e) => setPackageForm((prev) => ({ ...prev, desiredMarginPercent: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Suggested MSRP override</span>
                <input type="number" min="0" step="0.01" value={packageForm.msrpPerUnit} onChange={(e) => setPackageForm((prev) => ({ ...prev, msrpPerUnit: e.target.value }))} placeholder={localPreview.suggestedMsrp ? String(localPreview.suggestedMsrp) : "Auto from cost"} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Default sale price</span>
                <input type="number" min="0" step="0.01" value={packageForm.pricePerUnit} onChange={(e) => setPackageForm((prev) => ({ ...prev, pricePerUnit: e.target.value }))} placeholder="auto from MSRP if blank" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
              <label className="space-y-1 text-sm block">
                <span className="text-zinc-600 dark:text-zinc-400">Package date</span>
                <input type="date" value={packageForm.date} onChange={(e) => setPackageForm((prev) => ({ ...prev, date: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
              </label>
            </div>
            <label className="space-y-1 text-sm block">
              <span className="text-zinc-600 dark:text-zinc-400">Package notes</span>
              <input type="text" value={packageForm.notes} onChange={(e) => setPackageForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Optional packaging note" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 text-sm">
              <DetailStat label="Source available" value={`${sourceAvailable} ${getSourceUnitText(sourceLot, meta)}`} />
              <DetailStat label="Will consume" value={`${localPreview.sourceQuantity} ${getSourceUnitText(sourceLot, meta)}`} />
              <DetailStat label="Remaining source" value={`${localPreview.remainingAfter} ${getSourceUnitText(sourceLot, meta)}`} />
              <DetailStat label="Package run" value={`${localPreview.packageCount} ${packageForm.packageUnitLabel || "packages"} × ${packageForm.packageSize || "?"} ${normalizePackageUnit(packageForm.packageSizeUnit || "g")}`} />
              <DetailStat label="Capsule avg used" value={localPreview.averageItemWeightG ? formatWeightG(localPreview.averageItemWeightG) : "Not set"} />
              <DetailStat label="Recommended caps" value={localPreview.recommendedCapsulesPerPackage ? `${localPreview.recommendedCapsulesPerPackage}` : "Not set"} />
              <DetailStat label="Capsules / package" value={localPreview.capsulesPerPackage ? `${localPreview.capsulesPerPackage}` : "Required for capsules"} />
              <DetailStat label="Actual/package" value={localPreview.actualWeightPerPackageG ? formatWeightG(localPreview.actualWeightPerPackageG) : "Not set"} />
              <DetailStat label="Label total" value={localPreview.displayDose?.totalWeightLabel || "Not set"} />
              <DetailStat label="Label per capsule" value={localPreview.displayDose?.perCapsuleLabel || "Not set"} />
              <DetailStat label="Material cost / package" value={money(localPreview.materialCostPerPackage)} />
              <DetailStat label="Packaging recipe / package" value={money(localPreview.packageRecipeCostPerPackage || 0)} />
              <DetailStat label="Extra cost / package" value={money(localPreview.extraCostPerPackage)} />
              <DetailStat label="Total cost / package" value={money(localPreview.costPerPackage)} />
              <DetailStat label="Suggested MSRP" value={localPreview.suggestedMsrp ? money(localPreview.suggestedMsrp) : "Set cost first"} />
              <DetailStat label="Default sale price" value={packageForm.pricePerUnit ? money(packageForm.pricePerUnit) : localPreview.suggestedMsrp ? money(localPreview.suggestedMsrp) : "Auto from MSRP"} />
            </div>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-950/40 p-3 text-xs text-zinc-600 dark:text-zinc-400">
              Package creation locks material, packaging, labor, other cost, target margin, suggested MSRP, and default sale price for Sales and future Analytics. Sales can only override a one-time sale price with a required memo.
            </div>
            {consumptionWarnings[`package:${sourceLot.id}`] ? (
              <div className="rounded-xl border border-rose-400/70 bg-rose-950/25 p-3 text-sm text-rose-200">
                {consumptionWarnings[`package:${sourceLot.id}`]}
              </div>
            ) : null}
            {localPreview.guardMessage ? (
              <div className="rounded-xl border border-amber-300/70 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
                {localPreview.guardMessage}
              </div>
            ) : null}
            <button type="button" onClick={handleCreatePackageRun} disabled={packageBusy || !localPreview.canCreate} className="btn btn-accent disabled:opacity-60 text-sm">
              {packageBusy ? "Creating packages..." : `Create ${getSkuTypeLabel(packageForm.skuType)} Package Run`}
            </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }



  function renderLotDetailPanel(lot, { unitFallback = "g" } = {}) {
    if (!lot) return null;
    const unit = lot?.unit || unitFallback;

    return (
      <>
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-3 text-sm">
          <DetailStat label="Initial qty" value={formatQty(lot?.initialQuantity, unit, getQtyDigits(unit))} />
          <DetailStat label="Available" value={formatQty(getLotAvailableQuantity(lot), unit, getQtyDigits(unit))} />
          <DetailStat label="Allocated" value={formatQty(lot?.allocatedQuantity, unit, getQtyDigits(unit))} />
          <DetailStat label="Reserved" value={formatQty(getLotReservedQuantity(lot), unit, getQtyDigits(unit))} />
          <DetailStat label="Unit cost" value={money(getLotUnitCost(lot))} />
          <DetailStat label="Status" value={getLotStatus(lot)} />
        </div>

        <LotInventoryControls
          lot={lot}
          today={today}
          reservationForm={reservationForms[lot.id] || normalizeReservationForm(today)}
          onReservationChange={(nextForm) =>
            setReservationForms((prev) => ({ ...prev, [lot.id]: nextForm }))
          }
          onSaveReservation={() => handleSaveReservation(lot)}
          onRemoveReservation={(reservationId) => handleRemoveReservation(lot, reservationId)}
          thresholdValue={thresholdForms[lot.id]}
          onThresholdChange={(value) =>
            setThresholdForms((prev) => ({ ...prev, [lot.id]: value }))
          }
          onSaveThreshold={() => handleSaveThreshold(lot)}
          reservationBusyId={reservationBusyId}
          thresholdBusyId={thresholdBusyId}
        />

        <CostRollupPanel record={lot} title="Stage cost rollup" />

        <LotQualityPanel
          lot={lot}
          form={qualityForms[lot.id] || normalizeQualityForm(lot, today)}
          onChange={(nextForm) =>
            setQualityForms((prev) => ({ ...prev, [lot.id]: nextForm }))
          }
          onSave={() => handleSaveQuality(lot)}
          busy={qualityBusyId === lot.id}
        />
      </>
    );
  }

  function renderExtractionBatchDetail(batch) {
    if (!batch) return null;
    const form = finalizeForms[batch.id] || {
      outputAmount: "",
      outputUnit: "mL",
      outputYieldPercent: "",
      date: today,
      notes: "",
    };

    return (
      <>
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
          <DetailStat label="Status" value={formatBatchStatus(getProcessBatchStatus(batch))} />
          <DetailStat label="Date" value={batch?.date || "—"} />
          <DetailStat label="Input" value={formatTotalsByUnit(batch?.inputLots || []) || "—"} />
          <DetailStat label="Batch cost" value={money(batch?.batchTotalCost || batch?.costs?.batchTotalCost || 0)} />
          <DetailStat label="Output lot" value={batch?.outputLotId || "Not created"} />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
          <div>
            <div className="font-semibold">Record extract output</div>
            <div className="text-sm text-zinc-400">
              This opens from the batch card so the list stays clean. Output creates the extract lot for Production.
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            <label className="space-y-1 text-sm block">
              <span className="text-zinc-400">Output amount</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.outputAmount}
                onChange={(e) =>
                  setFinalizeForms((prev) => ({
                    ...prev,
                    [batch.id]: { ...form, outputAmount: e.target.value },
                  }))
                }
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm block">
              <span className="text-zinc-400">Output unit</span>
              <select
                value={form.outputUnit}
                onChange={(e) =>
                  setFinalizeForms((prev) => ({
                    ...prev,
                    [batch.id]: { ...form, outputUnit: e.target.value },
                  }))
                }
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
              >
                <option value="mL">mL</option>
                <option value="g">g</option>
              </select>
            </label>
            <label className="space-y-1 text-sm block">
              <span className="text-zinc-400">Yield percent</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.outputYieldPercent}
                onChange={(e) =>
                  setFinalizeForms((prev) => ({
                    ...prev,
                    [batch.id]: { ...form, outputYieldPercent: e.target.value },
                  }))
                }
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm block">
              <span className="text-zinc-400">Date</span>
              <input
                type="date"
                value={form.date}
                onChange={(e) =>
                  setFinalizeForms((prev) => ({
                    ...prev,
                    [batch.id]: { ...form, date: e.target.value },
                  }))
                }
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => handleFinalizeExtraction(batch)}
                disabled={finalizeBusyId === batch.id}
                className="w-full rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white px-4 py-2 text-sm"
              >
                {finalizeBusyId === batch.id ? "Saving..." : "Create Extract Lot"}
              </button>
            </div>
          </div>
          <label className="space-y-1 text-sm block">
            <span className="text-zinc-400">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) =>
                setFinalizeForms((prev) => ({
                  ...prev,
                  [batch.id]: { ...form, notes: e.target.value },
                }))
              }
              rows={3}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
            />
          </label>
        </div>

        <CostRollupPanel record={batch} title="Extraction cost rollup" />
      </>
    );
  }

  function renderProductionBatchDetail(batch) {
    if (!batch) return null;
    const meta = getProductTypeMeta(batch?.productType);
    const outputLot = batch?.outputLotId
      ? finishedGoodsLots.find((lot) => lot.id === batch.outputLotId) || null
      : null;
    const parsedNameOutputCount = Math.floor(
      Number(String(batch?.name || "").match(/(\d+)\s*(?:count|capsule|capsules)/i)?.[1]) || 0
    );
    const defaultOutputCount = Math.floor(
      Number(batch?.outputCount) ||
        Number(batch?.actualOutputCount) ||
        Number(batch?.capsulesMade) ||
        Number(batch?.expectedOutputCount) ||
        Number(batch?.yieldMetrics?.actualQuantity) ||
        Number(batch?.yieldMetrics?.expectedQuantity) ||
        parsedNameOutputCount ||
        0
    );
    const defaultTotalPowderG =
      Number(batch?.totalPowderUsedG) ||
      (batch?.inputLots || [])
        .filter((lot) => normalizePackageUnit(lot?.unit || "g") === "g")
        .reduce((sum, lot) => sum + (Number(lot?.quantity) || 0), 0);
    const defaultTargetFillG =
      Number(batch?.targetCapsuleFillG) ||
      (defaultOutputCount > 0 && defaultTotalPowderG > 0
        ? Math.round((defaultTotalPowderG / defaultOutputCount) * 1000) / 1000
        : 0);
    const finalizeForm = finalizeForms[batch.id] || {
      outputCount: defaultOutputCount > 0 ? String(defaultOutputCount) : "",
      totalPowderUsedG: defaultTotalPowderG > 0 ? String(Math.round(defaultTotalPowderG * 1000) / 1000) : "",
      targetCapsuleFillG: defaultTargetFillG > 0 ? String(defaultTargetFillG) : "",
      mgPerUnit: "",
      date: today,
      notes: "",
    };
    const finalizeOutputCount = Math.floor(Number(finalizeForm.outputCount) || 0);
    const finalizeTotalPowderG = Number(finalizeForm.totalPowderUsedG) || 0;
    const finalizeAvgMg =
      Number(finalizeForm.mgPerUnit) ||
      (finalizeOutputCount > 0 && finalizeTotalPowderG > 0
        ? Math.round(((finalizeTotalPowderG * 1000) / finalizeOutputCount) * 100) / 100
        : 0);

    return (
      <>
        <div className="grid grid-cols-2 xl:grid-cols-6 gap-3 text-sm">
          <DetailStat label="Status" value={formatBatchStatus(getProcessBatchStatus(batch))} />
          <DetailStat label="Date" value={batch?.date || "—"} />
          <DetailStat label="Output" value={Number(batch?.outputCount) > 0 ? `${Math.floor(Number(batch.outputCount) || 0)} ${meta.pieceLabelPlural}` : "Pending"} />
          <DetailStat label="Input" value={formatTotalsByUnit(batch?.inputTotals || batch?.inputLots || []) || "—"} />
          <DetailStat label="Batch cost" value={money(batch?.batchTotalCost || batch?.costs?.batchTotalCost || 0)} />
          <DetailStat label="Output lot" value={outputLot?.name || "Not created"} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 text-sm">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="font-medium mb-2">Consumed source lots</div>
            <div className="space-y-2">
              {(batch?.inputLots || []).length === 0 ? (
                <div className="text-zinc-400">No source lots recorded.</div>
              ) : (
                (batch?.inputLots || []).map((lot) => (
                  <div key={`${batch.id}-${lot.lotId}`} className="rounded-xl border border-zinc-800 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">{lot?.lotName || lot?.lotId}</div>
                        <div className="text-zinc-400">
                          {String(lot?.lotType || "").replace(/_/g, " ")} · {lot?.growLabel || lot?.sourceBatchId || lot?.sourceGrowId || "Unknown source"}
                        </div>
                      </div>
                      <div className="font-semibold">{formatQty(lot?.quantity, lot?.unit || "g")}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="font-medium mb-2">Cost stack</div>
              <div className="grid grid-cols-2 gap-3">
                <DetailStat label="Source material" value={money(batch?.inputMaterialCostTotal || 0)} />
                <DetailStat label="Recipe / BOM" value={money(batch?.recipeBatchCostTotal || batch?.recipeCost || 0)} />
                <DetailStat label="Direct cost" value={money(batch?.directCostTotal || batch?.directCost || 0)} />
                <DetailStat label="Projected profit" value={money(batch?.pricing?.projectedProfit || 0)} />
              </div>
            </div>
            <CostRollupPanel record={batch} title="Stage cost rollup" />
            <RecipeSnapshotPanel record={batch} />
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="font-medium mb-2">Notes</div>
              <div className="text-zinc-300 whitespace-pre-wrap min-h-[88px]">{batch?.notes || batch?.variant || "No notes recorded."}</div>
            </div>
          </div>
        </div>

        {!outputLot ? (
          <div className="rounded-2xl border border-amber-900/70 bg-amber-950/20 p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-amber-100">Finish this production run</div>
                <div className="text-sm text-amber-100/80">
                  Record the actual output from this run, then create the parent finished batch. Package sizes, samples, MSRP, and sale pricing still happen later from Finished Inventory.
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              <label className="space-y-1 text-sm block">
                <span className="text-amber-100/80">Finished output count</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={finalizeForm.outputCount}
                  onChange={(e) =>
                    setFinalizeForms((prev) => ({
                      ...prev,
                      [batch.id]: { ...finalizeForm, outputCount: e.target.value },
                    }))
                  }
                  placeholder="Example: 100"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
                />
              </label>

              <label className="space-y-1 text-sm block">
                <span className="text-amber-100/80">Total powder used (g)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={finalizeForm.totalPowderUsedG}
                  onChange={(e) =>
                    setFinalizeForms((prev) => ({
                      ...prev,
                      [batch.id]: { ...finalizeForm, totalPowderUsedG: e.target.value },
                    }))
                  }
                  placeholder="Example: 50"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
                />
              </label>

              <label className="space-y-1 text-sm block">
                <span className="text-amber-100/80">Target fill (g)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={finalizeForm.targetCapsuleFillG}
                  onChange={(e) =>
                    setFinalizeForms((prev) => ({
                      ...prev,
                      [batch.id]: { ...finalizeForm, targetCapsuleFillG: e.target.value },
                    }))
                  }
                  placeholder="Example: 0.5"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
                />
              </label>

              <label className="space-y-1 text-sm block">
                <span className="text-amber-100/80">Finished date</span>
                <input
                  type="date"
                  value={finalizeForm.date || today}
                  onChange={(e) =>
                    setFinalizeForms((prev) => ({
                      ...prev,
                      [batch.id]: { ...finalizeForm, date: e.target.value },
                    }))
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
                />
              </label>

              <DetailStat
                label="Auto avg mg / unit"
                value={finalizeAvgMg > 0 ? formatMg(finalizeAvgMg) : "Enter output + powder"}
              />
            </div>

            <label className="space-y-1 text-sm block">
              <span className="text-amber-100/80">Finish notes</span>
              <textarea
                value={finalizeForm.notes || ""}
                onChange={(e) =>
                  setFinalizeForms((prev) => ({
                    ...prev,
                    [batch.id]: { ...finalizeForm, notes: e.target.value },
                  }))
                }
                rows={2}
                placeholder="Actual run notes, capsule machine notes, fill variance, etc."
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
              <DetailStat label="Output units" value={`${finalizeOutputCount || 0} ${meta.pieceLabelPlural}`} />
              <DetailStat label="Actual avg fill" value={finalizeOutputCount > 0 && finalizeTotalPowderG > 0 ? `${Math.round((finalizeTotalPowderG / finalizeOutputCount) * 1000) / 1000} g` : "—"} />
              <DetailStat label="Batch cost" value={money(batch?.batchTotalCost || batch?.costs?.batchTotalCost || 0)} />
              <DetailStat label="Cost / unit" value={finalizeOutputCount > 0 ? money((Number(batch?.batchTotalCost || batch?.costs?.batchTotalCost || 0) || 0) / finalizeOutputCount) : "—"} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-amber-100/75">
                Best by will default to one year after the finished date. This creates parent inventory only, not retail SKUs.
              </div>
              <button
                type="button"
                onClick={(event) => handleFinalizeProductionOutput(batch, event)}
                disabled={finalizeBusyId === batch.id}
                className="btn btn-accent disabled:opacity-60 text-sm"
              >
                {finalizeBusyId === batch.id ? "Creating output..." : "Create Finished Output"}
              </button>
            </div>
            {productionActionMessage ? (
              <div className={`rounded-xl border px-3 py-2 text-sm ${productionActionMessage.toLowerCase().includes("failed") || productionActionMessage.toLowerCase().includes("missing") || productionActionMessage.toLowerCase().includes("sign in") || productionActionMessage.toLowerCase().includes("error") || productionActionMessage.toLowerCase().includes("enter") ? "border-red-800 bg-red-950/30 text-red-100" : "border-violet-800 bg-violet-950/30 text-violet-100"}`}>
                {productionActionMessage}
              </div>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  function renderSalesProductDetail(product) {
    if (!product) return null;
    const activeMode = salesProductModes[product.key] || "retail";
    const activeSkus = Array.isArray(product.activeSkus) ? product.activeSkus : [];
    const retailSkus = activeSkus.filter((sku) => String(sku?.skuType || "retail") === "retail");
    const sampleSkus = activeSkus.filter((sku) => String(sku?.skuType || "retail") !== "retail");
    const visibleSkus = activeMode === "samples" ? sampleSkus : retailSkus;
    const retailCount = retailSkus.reduce((sum, sku) => sum + sku.activeLots.reduce((lotSum, lot) => lotSum + getLotAvailableQuantity(lot), 0), 0);
    const sampleCount = sampleSkus.reduce((sum, sku) => sum + sku.activeLots.reduce((lotSum, lot) => lotSum + getLotAvailableQuantity(lot), 0), 0);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
          <DetailStat
            label="Available packages"
            value={String(product.lots.reduce((sum, lot) => sum + getLotAvailableQuantity(lot), 0))}
          />
          <DetailStat
            label="Sold"
            value={String(product.lots.reduce((sum, lot) => sum + getOutboundQuantity(lot, "sold"), 0))}
          />
          <DetailStat
            label="Sampled"
            value={String(product.lots.reduce((sum, lot) => sum + getOutboundQuantity(lot, "sampled"), 0))}
          />
          <DetailStat
            label="Destroyed"
            value={String(product.lots.reduce((sum, lot) => sum + getOutboundQuantity(lot, "destroyed"), 0))}
          />
          <DetailStat
            label="Remaining projection"
            value={money(product.lots.reduce((sum, lot) => sum + getRemainingProjectedRevenue(lot), 0))}
          />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSalesProductModes((prev) => ({ ...prev, [product.key]: "retail" }))}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold ${activeMode === "retail" ? "border-purple-400 bg-purple-600 text-white" : "border-zinc-700 bg-zinc-900 text-zinc-200"}`}
            >
              Retail sales · {retailCount} available
            </button>
            <button
              type="button"
              onClick={() => setSalesProductModes((prev) => ({ ...prev, [product.key]: "samples" }))}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold ${activeMode === "samples" ? "border-purple-400 bg-purple-600 text-white" : "border-zinc-700 bg-zinc-900 text-zinc-200"}`}
            >
              Samples / promo / internal · {sampleCount} available
            </button>
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            Retail and sample inventory are separated here so sample packages are not accidentally sold as retail SKUs.
          </div>
        </div>

        {visibleSkus.length === 0 ? (
          <EmptyState
            title={activeMode === "samples" ? "No sample, promo, or internal SKUs" : "No retail SKUs"}
            body={activeMode === "samples" ? "Create sample or promo package runs from Finished Inventory to track them separately here." : "Create retail package runs from Finished Inventory before recording retail sales."}
          />
        ) : null}

        {visibleSkus.map((sku) => {
          const skuAvailable = sku.lots.reduce((sum, lot) => sum + getLotAvailableQuantity(lot), 0);
          const skuSold = sku.lots.reduce((sum, lot) => sum + getOutboundQuantity(lot, "sold"), 0);
          const skuDestroyed = sku.lots.reduce((sum, lot) => sum + getOutboundQuantity(lot, "destroyed"), 0);
          const skuProjectedRevenue = sku.lots.reduce((sum, lot) => sum + getRemainingProjectedRevenue(lot), 0);
          return (
            <div key={`sales-modal-sku-${product.key}-${sku.key}`} className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{sku.label}</div>
                  <div className="text-xs text-zinc-400">FEFO applies inside this matching SKU only. Earliest best-by sells first; samples do not block retail packages.</div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold">{skuAvailable} available</div>
                  <div className="text-xs text-zinc-400">
                    {skuSold} sold · {skuDestroyed} destroyed · {money(skuProjectedRevenue)} remaining
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {sku.activeLots.map((lot, index) => {
                  const meta = getProductTypeMeta(lot?.productType || lot?.finishedGoodType || lot?.lotType);
                  const movementForm = movementForms[lot.id] || normalizeMovementForm(today);
                  const outboundSummary = lot?.outboundSummary || {};
                  const available = Number(getLotAvailableQuantity(lot)) || 0;
                  const fefoBlocker = getFefoBlockingLot(lot, saleReadyFinishedGoodsLots, today);
                  const fefoOverrideRequested = Boolean(movementForm.fefoOverride);
                  const fefoOverrideMissingReason =
                    movementForm.movementType === "sell" &&
                    Boolean(fefoBlocker) &&
                    fefoOverrideRequested &&
                    !String(movementForm.fefoOverrideReason || "").trim();
                  const sellBlockedByFefo =
                    movementForm.movementType === "sell" &&
                    Boolean(fefoBlocker) &&
                    (!fefoOverrideRequested || fefoOverrideMissingReason);
                  const salesBlockReason = getSalesBlockReason(lot, today);
                  const releaseState = getReleaseStateForSales(lot);
                  const sellBlockedByQuality = movementForm.movementType === "sell" && Boolean(salesBlockReason);
                  const releaseBlockedOnly = sellBlockedByQuality && releaseState.blocked && salesBlockReason.includes("released");
                  const priceAudit = getSalePriceOverrideState(lot, movementForm);

                  return (
                    <div key={`sales-modal-lot-${lot.id}`} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">Package lot</div>
                          <div className="text-sm text-zinc-300">{lot?.lotCode || lot?.batchLot || lot?.name || lot.id}</div>
                          <div className="text-xs text-zinc-500">Best by {getLotBestByValue(lot) || "Not set"} · Packed {lot?.packDate || lot?.labelMetadata?.packDate || lot?.package?.packagedDate || lot?.createdDate || lot?.date || "Not set"}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/?tab=labels&labelSource=finished_goods&labelLotId=${encodeURIComponent(lot.id)}`}
                            className="rounded-lg border border-purple-400/60 bg-purple-500/10 px-3 py-2 text-xs font-semibold text-purple-100 hover:bg-purple-500/20"
                          >
                            View label preview
                          </Link>
                          <div className="text-right text-sm">
                            <div className="font-semibold">{available} {getPackageUnitName(lot, meta)}</div>
                            <div className="text-zinc-400 capitalize">{getLotStatus(lot)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-3 text-sm">
                        <DetailStat label="SKU type" value={getSkuTypeLabel(getSkuType(lot))} />
                        <DetailStat label="Sellable package" value={getPackageSizeLabel(lot)} />
                        <DetailStat label="Actual weight" value={getPackageWeightLabel(lot)} />
                        <DetailStat label="Capsules / package" value={getPackageCapsulesPerPackage(lot) > 0 ? String(getPackageCapsulesPerPackage(lot)) : "Not set"} />
                        <DetailStat label="Per capsule" value={getPackagePerCapsuleLabel(lot)} />
                        <DetailStat label="Target entered" value={getPackageTargetSizeLabel(lot)} />
                        <DetailStat label="Price / package" value={money(lot?.pricePerUnit || lot?.pricing?.pricePerUnit || 0)} />
                        <DetailStat label="Sold / destroyed" value={`${outboundSummary?.sold || 0} / ${outboundSummary?.destroyed || 0}`} />
                        <DetailStat label="Revenue" value={money(outboundSummary?.revenue || 0)} />
                      </div>

                      <div className="rounded-xl border border-zinc-800 p-3 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-sm">Locked package pricing</div>
                            <div className="text-xs text-zinc-500">Set when the package/SKU run was created. Sales can override a single sale price only with a required memo.</div>
                          </div>
                          <span className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-400">Read only</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                          <DetailStat label="Package cost" value={money(getLockedPackageCost(lot))} />
                          <DetailStat label="Default sale price" value={money(getLockedPackagePrice(lot))} />
                          <DetailStat label="MSRP / suggested" value={money(getLockedPackageMsrp(lot))} />
                          <DetailStat label="Projected margin" value={money(getLockedPackagePrice(lot) - getLockedPackageCost(lot))} />
                        </div>
                      </div>

                      {movementForm.movementType === "sell" && fefoBlocker ? (
                        <div className="rounded-xl border border-amber-300/70 bg-amber-950/30 p-3 text-sm text-amber-100 space-y-3">
                          <div>
                            <div className="font-semibold">FEFO priority</div>
                            <div className="mt-1">
                              An earlier-expiring matching package remains: {fefoBlocker?.lotCode || fefoBlocker?.batchLot || fefoBlocker?.name || fefoBlocker.id} · best by {getLotBestByValue(fefoBlocker) || "not set"}. This package is best by {getLotBestByValue(lot) || "not set"}.
                            </div>
                          </div>
                          <label className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-zinc-950/40 p-3">
                            <input
                              type="checkbox"
                              checked={Boolean(movementForm.fefoOverride)}
                              onChange={(e) =>
                                setMovementForms((prev) => ({
                                  ...prev,
                                  [lot.id]: {
                                    ...movementForm,
                                    fefoOverride: e.target.checked,
                                    fefoOverrideReason: e.target.checked ? movementForm.fefoOverrideReason : "",
                                  },
                                }))
                              }
                              className="mt-0.5"
                            />
                            <span>
                              <span className="font-medium">Override FEFO for this sale</span>
                              <span className="block text-xs text-amber-100/80">The skipped lot, both best-by dates, and the required reason will be retained in History.</span>
                            </span>
                          </label>
                          {movementForm.fefoOverride ? (
                            <label className="space-y-1 block">
                              <span className="font-medium">FEFO override reason *</span>
                              <input
                                type="text"
                                value={movementForm.fefoOverrideReason}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: { ...movementForm, fefoOverrideReason: e.target.value },
                                  }))
                                }
                                placeholder="Required reason for skipping the earlier-expiring matching lot"
                                className="w-full rounded-xl border border-amber-400/70 bg-zinc-950 px-3 py-2 text-zinc-100"
                              />
                            </label>
                          ) : null}
                          <div className="text-xs text-amber-100/80">Destroy and other non-sale movements are not blocked by FEFO.</div>
                        </div>
                      ) : null}

                      {sellBlockedByQuality ? (
                        <div className="rounded-xl border border-red-400/80 bg-red-950/30 p-3 text-sm text-red-100 space-y-3">
                          <div>Sale blocked: {salesBlockReason} Destroy, waste, sample, or adjustment actions are still available when appropriate.</div>
                          {releaseBlockedOnly ? (
                            <div className="rounded-lg border border-purple-400/60 bg-purple-950/30 p-3 text-purple-100">
                              <div className="font-medium">Release path</div>
                              <div className="mt-1 text-xs text-purple-100/80">Use this only after the package run has passed QC, shelf-life, and label/package review. Future role controls can make this approval-only.</div>
                              <button type="button" onClick={() => handleReleasePackageForSale(lot)} disabled={releaseBusyId === lot.id} className="btn btn-accent mt-3 text-xs disabled:opacity-60">
                                {releaseBusyId === lot.id ? "Releasing..." : "Release package for sale"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="rounded-xl border border-zinc-800 p-3 space-y-3">
                        <div className="font-medium text-sm">Outbound action</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
                          <label className="space-y-1 text-sm block"><span className="text-zinc-400">Action</span><select value={movementForm.movementType} onChange={(e) => { const nextType = e.target.value; const defaultPrice = getLockedPackagePrice(lot); setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, movementType: nextType, destinationType: nextType === "destroy" ? "disposal" : nextType === "sample" ? (getSkuType(lot) === "promo" ? "event" : "internal") : movementForm.destinationType, direction: nextType === "adjustment" ? movementForm.direction : "out", unitPrice: nextType === "sell" ? (movementForm.unitPrice || (defaultPrice > 0 ? String(defaultPrice) : "")) : movementForm.unitPrice, fefoOverride: nextType === "sell" ? movementForm.fefoOverride : false, fefoOverrideReason: nextType === "sell" ? movementForm.fefoOverrideReason : "" } })); }} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"><option value="sell">Sell</option><option value="donate">Donate</option><option value="sample">Sample out</option><option value="waste">Waste</option><option value="destroy">Destroy</option><option value="adjustment">Manual adjustment</option></select></label>
                          <label className="space-y-1 text-sm block"><span className="text-zinc-400">Quantity</span><input type="number" inputMode="decimal" min="0" step="1" max={available || undefined} value={movementForm.quantity} onChange={(e) => handleMovementQuantityChange(lot, movementForm, e.target.value)} className={`w-full rounded-xl border bg-zinc-950 px-3 py-2 ${movementWarnings[lot.id] ? "border-red-400 text-red-100" : "border-zinc-700"}`} /></label>
                          <label className="space-y-1 text-sm block"><span className="text-zinc-400">Sale price</span><input type="number" inputMode="decimal" min="0" step="0.01" value={movementForm.unitPrice} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, unitPrice: e.target.value, priceManuallyChanged: true } }))} disabled={movementForm.movementType !== "sell"} placeholder={String(getLockedPackagePrice(lot) || "")} className={`w-full rounded-xl border bg-zinc-950 px-3 py-2 disabled:opacity-60 ${priceAudit.requiresMemo ? "border-amber-400 text-amber-100" : "border-zinc-700"}`} /></label>
                          <label className="space-y-1 text-sm block"><span className="text-zinc-400">Date</span><input type="date" value={movementForm.date} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, date: e.target.value } }))} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" /></label>
                          <label className="space-y-1 text-sm block"><span className="text-zinc-400">Destination type</span><select value={movementForm.destinationType} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, destinationType: e.target.value } }))} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"><option value="customer">Customer</option><option value="donation">Donation target</option><option value="event">Event</option><option value="wholesale">Wholesale</option><option value="internal">Internal use</option><option value="disposal">Disposal / destroy</option><option value="other">Other</option></select></label>
                          <label className="space-y-1 text-sm block"><span className="text-zinc-400">Destination name</span><input type="text" value={movementForm.destinationName} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, destinationName: e.target.value, counterparty: e.target.value } }))} placeholder="Customer, store, event, donation target" className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" /></label>
                        </div>

                        {priceAudit.requiresMemo ? (
                          <div className="rounded-xl border border-amber-400/80 bg-amber-950/25 p-3 space-y-3 text-sm text-amber-50">
                            <div className="font-medium">Price override memo required</div>
                            <div className="text-amber-100/90">
                              Default package price is {money(priceAudit.defaultPrice)}. This sale is being recorded at {money(priceAudit.actualPrice)} because the sale price field was manually changed.
                              {priceAudit.belowCost ? ` This is below package cost (${money(priceAudit.unitCost)}).` : ""}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <label className="space-y-1 block">
                                <span>Override type</span>
                                <select value={movementForm.priceOverrideType} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, priceOverrideType: e.target.value } }))} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100">
                                  <option value="">Select reason type</option>
                                  <option value="veteran_discount">Veteran discount</option>
                                  <option value="event_special">Event special</option>
                                  <option value="promo">Promo / comp</option>
                                  <option value="damaged_label">Damaged label</option>
                                  <option value="wholesale">Wholesale</option>
                                  <option value="manual_correction">Manual correction</option>
                                  <option value="other">Other</option>
                                </select>
                              </label>
                              <label className="space-y-1 block">
                                <span>Price override memo *</span>
                                <input type="text" value={movementForm.priceOverrideReason} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, priceOverrideReason: e.target.value } }))} placeholder="Required audit note for price change" className="w-full rounded-xl border border-amber-400/70 bg-zinc-950 px-3 py-2 text-zinc-100" />
                              </label>
                            </div>
                          </div>
                        ) : null}

                        {movementForm.movementType === "destroy" ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-red-800/70 bg-red-950/20 p-3">
                            <label className="space-y-1 text-sm block"><span className="text-red-100">Destroy method</span><select value={movementForm.destroyMethod} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, destroyMethod: e.target.value } }))} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"><option value="discarded">Discarded</option><option value="expired">Expired</option><option value="compromised">Compromised package</option><option value="failed_qc">Failed QC / potency</option><option value="recall">Recall/removal</option><option value="other">Other</option></select></label>
                            <div className="text-sm text-red-100">Destroy removes finished product from sellable inventory. A reason is required and the movement is retained in History.</div>
                          </div>
                        ) : null}

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <label className="space-y-1 text-sm block"><span className="text-zinc-400">Destination location</span><input type="text" value={movementForm.destinationLocation} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, destinationLocation: e.target.value } }))} placeholder="Optional city, booth, clinic, etc." className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" /></label>
                          <label className="space-y-1 text-sm block"><span className="text-zinc-400">Reason{movementForm.movementType === "destroy" ? " *" : ""}</span><input type="text" value={movementForm.reason} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, reason: e.target.value } }))} placeholder={movementForm.movementType === "destroy" ? "Required for destroy" : "Optional reason"} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" /></label>
                          <label className="space-y-1 text-sm block"><span className="text-zinc-400">Note</span><input type="text" value={movementForm.note} onChange={(e) => setMovementForms((prev) => ({ ...prev, [lot.id]: { ...movementForm, note: e.target.value } }))} placeholder="Optional note" className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2" /></label>
                        </div>

                        {movementWarnings[lot.id] ? (
                          <div className="rounded-xl border border-red-400/80 bg-red-950/30 p-3 text-sm text-red-100">
                            {movementWarnings[lot.id]}
                          </div>
                        ) : null}

                        <button type="button" onClick={() => handleFinishedMovement(lot)} disabled={movementBusyId === lot.id || sellBlockedByFefo || sellBlockedByQuality} className="btn btn-accent disabled:opacity-60 text-sm">
                          {sellBlockedByFefo
                            ? fefoOverrideRequested
                              ? "FEFO override reason required"
                              : "Sell earlier-expiring package first"
                            : sellBlockedByQuality
                              ? "Sale blocked"
                              : movementBusyId === lot.id
                                ? "Recording..."
                                : "Record Sale / Outbound Movement"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const tabs = [
    { id: "dry", label: "Dry Material", icon: Package },
    { id: "extractions", label: "Extractions", icon: FlaskConical },
    { id: "production", label: "Production", icon: Factory },
    { id: "finished", label: "Finished Inventory", icon: Archive },
    { id: "sales", label: "Sales", icon: DollarSign },
    { id: "history", label: "History", icon: History },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Post Processing</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-4xl">
            Manufacturing now follows the real chain: harvested grow to dry material lot, dry lot
            to extraction, extraction to dry powder or liquid extract, extract or dry material to
            production batch, then completed batches land in finished inventory for QC, potency, pricing,
            label printing, and handoff into the Sales tab for outbound tracking.
          </p>
        </div>

        <div className="flex flex-wrap gap-2" data-tour="postprocess-tabs">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)} className={chipClass(activeTab === id)}>
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {message ? (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            border: "1px solid rgba(var(--accent-rgb), 0.35)",
            backgroundColor: "rgba(var(--accent-rgb), 0.10)",
          }}
        >
          {message}
        </div>
      ) : null}

      {!canUsePostProcessing ||
      !canUseFinishedInventory ||
      !canCreatePackageRuns ||
      !canRecordSales ||
      !canUsePostProcessLabels ? (
        <div
          className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-100"
          data-testid="postprocess-read-only-notice"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-4xl">
              <div className="font-semibold">Existing operational records remain available</div>
              <p className="mt-1 leading-6">
                New Post Processing, package-run, sales, and finished-label actions require Lab
                access. Existing batches can still be completed, and waste, destruction, recall,
                reservation release, and final-disposition actions remain available so inventory
                never becomes stuck.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                requestFeatureAccess({
                  allowed: false,
                  featureKey: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING,
                  actionLabel: "Start a new Lab operation",
                  supportingText:
                    "Existing operational history stays visible and safety actions remain available after a downgrade.",
                })
              }
              className="rounded-full accent-bg px-4 py-2 text-sm font-semibold text-white"
            >
              View Lab access
            </button>
          </div>
        </div>
      ) : null}

      {activeTab !== "sales" ? (
        <>
      {lowStockLots.length > 0 ? (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm">
          <span className="font-medium">Low stock alert:</span> {lowStockLots.length} active lot{lowStockLots.length === 1 ? "" : "s"} are at or below threshold.
        </div>
      ) : null}


      {qcPendingLots.length > 0 ? (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            border: "1px solid rgba(var(--accent-rgb), 0.35)",
            backgroundColor: "rgba(var(--accent-rgb), 0.10)",
          }}
        >
          <span className="font-medium">QC pending:</span> {qcPendingLots.length} active lot{qcPendingLots.length === 1 ? "" : "s"} still need QC completion.
        </div>
      ) : null}

      {expiringSoonLots.length > 0 ? (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm">
          <span className="font-medium">Expiring soon:</span> {expiringSoonLots.length} active lot{expiringSoonLots.length === 1 ? "" : "s"} reach best-by within 30 days.
        </div>
      ) : null}

      <SectionCard
        title="Manufacturing chain"
        defaultOpen={false}
        subtitle="Finished goods are now treated as their own inventory endpoint instead of just another output row."
        action={
          <div className="flex flex-wrap gap-2">
            {nextAction === "dry" ? (
              <button
                onClick={() => setActiveTab("dry")}
                className="btn btn-accent text-sm"
              >
                Go to Dry Intake
              </button>
            ) : null}
            {nextAction === "extraction" ? (
              <button
                onClick={() => setActiveTab("extractions")}
                className="btn btn-accent text-sm"
              >
                Create Extraction
              </button>
            ) : null}
            {nextAction === "production" ? (
              <button
                onClick={() => setActiveTab("production")}
                className="btn btn-accent text-sm"
              >
                Start Production
              </button>
            ) : null}
            {nextAction === "finished" ? (
              <button
                onClick={() => setActiveTab("finished")}
                className="btn btn-accent text-sm"
              >
                Open Finished Inventory
              </button>
            ) : null}
            {nextAction === "sales" ? (
              <button
                onClick={() => setActiveTab("sales")}
                className="btn btn-accent text-sm"
              >
                Open Sales
              </button>
            ) : null}
          </div>
        }
      >
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <WorkflowStep
            number="1"
            title="Dry Intake"
            body="Every harvested grow with dry weight becomes a dry-material lot that preserves remaining grams for downstream use."
            statusText={stageStatuses.dry.text}
            tone={stageStatuses.dry.tone}
            next={nextAction === "dry"}
          />
          <WorkflowStep
            number="2"
            title="Extraction"
            body="Consume dry material into extraction batches and record method, source lots, and audit movements."
            statusText={stageStatuses.extraction.text}
            tone={stageStatuses.extraction.tone}
            next={nextAction === "extraction"}
          />
          <WorkflowStep
            number="3"
            title="Production"
            body="Make capsules, gummies, tinctures, or chocolates from dry lots or extract lots and capture batch cost."
            statusText={stageStatuses.production.text}
            tone={stageStatuses.production.tone}
            next={nextAction === "production"}
          />
          <WorkflowStep
            number="4"
            title="Finished Inventory"
            body="QC, potency, shelf life, and package runs live here before outbound movement."
            statusText={stageStatuses.finished.text}
            tone={stageStatuses.finished.tone}
            next={nextAction === "finished"}
          />
          <WorkflowStep
            number="5"
            title="Sales"
            body="Sell, donate, sample, waste, or destroy packaged SKUs while FEFO keeps the earliest best-by matching SKUs first."
            statusText={stageStatuses.sales.text}
            tone={stageStatuses.sales.tone}
            next={nextAction === "sales"}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Manufacturing overview"
        subtitle="Cross-stage inventory, quality, production, and outbound totals."
        defaultOpen={false}
      >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
        <SummaryCard
          label="Active dry lots"
          value={String(activeDryLots.length)}
          hint="Harvest intake records"
          icon={Package}
        />
        <SummaryCard
          label="Remaining dry"
          value={formatQty(totalRemainingDry, "g")}
          hint="Ready to consume"
          icon={Package}
        />
        <SummaryCard
          label="Allocated dry"
          value={formatQty(totalAllocatedDry, "g")}
          hint="Already consumed"
          icon={ArrowRight}
        />
        <SummaryCard
          label="Active extracts"
          value={String(activeExtractLots.length)}
          hint="Usable extract lots"
          icon={FlaskConical}
        />
        <SummaryCard
          label="Extractions needing output"
          value={String(pendingExtractionOutputs.length)}
          hint="Complete inside Extractions"
          icon={AlertTriangle}
        />
        <SummaryCard
          label="Active production"
          value={String(activeProductionBatches.length)}
          hint="Runs still needing attention"
          icon={Factory}
        />
        <SummaryCard
          label="Reserved lots"
          value={String(reservedLots.length)}
          hint={formatTotalsByUnit(reservedSummary) || "No soft holds"}
          icon={Tags}
        />
        <SummaryCard
          label="Low stock"
          value={String(lowStockLots.length)}
          hint={lowStockLots.length > 0 ? "Needs review" : "No active alerts"}
          icon={AlertTriangle}
        />
        <SummaryCard
          label="QC pending"
          value={String(qcPendingLots.length)}
          hint={qcPendingLots.length > 0 ? "Needs checkpoint review" : "All active lots checked"}
          icon={AlertTriangle}
        />
        <SummaryCard
          label="Expiring soon"
          value={String(expiringSoonLots.length)}
          hint={expiringSoonLots.length > 0 ? "Within 30 days" : "No near-term shelf issues"}
          icon={AlertTriangle}
        />
        <SummaryCard
          label="Unpackaged finished"
          value={String(totalUnpackagedFinishedUnits)}
          hint="Parent batch units still available"
          icon={Sparkles}
        />
        <SummaryCard
          label="Packaged available"
          value={String(totalSaleReadyUnits)}
          hint="Sellable package units on hand"
          icon={Tags}
        />
        <SummaryCard
          label="Units sold"
          value={String(totalSoldUnits)}
          hint="Completed retail sales"
          icon={DollarSign}
        />
        <SummaryCard
          label="Units destroyed"
          value={String(totalDestroyedUnits)}
          hint="Recorded package destruction"
          icon={AlertTriangle}
        />
        <SummaryCard
          label="Batches needing action"
          value={String(batchesNeedingAttention)}
          hint="Extraction or production actions"
          icon={ArrowRight}
        />
        <SummaryCard
          label="Revenue logged"
          value={money(totalRealizedRevenue)}
          hint="Sold outbound value"
          icon={DollarSign}
        />
      </div>
      </SectionCard>
        </>
      ) : (
        <SectionCard
          title="Sales overview"
          subtitle="Sales-only package availability, outbound totals, shelf-life risk, and revenue."
          defaultOpen={false}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <SummaryCard
              label="Available packages"
              value={String(totalSaleReadyUnits)}
              hint="Active packaged inventory"
              icon={Tags}
            />
            <SummaryCard
              label="Units sold"
              value={String(totalSoldUnits)}
              hint="Completed retail sales"
              icon={DollarSign}
            />
            <SummaryCard
              label="Units sampled"
              value={String(totalSampledUnits)}
              hint="Samples moved outbound"
              icon={Sparkles}
            />
            <SummaryCard
              label="Units destroyed"
              value={String(totalDestroyedUnits)}
              hint="Recorded package destruction"
              icon={AlertTriangle}
            />
            <SummaryCard
              label="Expiring soon"
              value={String(salesExpiringSoonLots.length)}
              hint={salesExpiringSoonLots.length > 0 ? "Packaged lots within 30 days" : "No near-term package shelf issues"}
              icon={AlertTriangle}
            />
            <SummaryCard
              label="Realized revenue"
              value={money(totalRealizedRevenue)}
              hint="Revenue already recorded"
              icon={BadgeDollarSign}
            />
            <SummaryCard
              label="Remaining projection"
              value={money(totalProjectedRevenue)}
              hint="Available packages at locked prices"
              icon={DollarSign}
            />
          </div>
        </SectionCard>
      )}

      {activeTab === "dry" && (
        <div className="space-y-6">
          <SectionCard
            title="Ready for intake"
            defaultOpen={true}
            subtitle="Harvested grows with dry weight that do not yet have a linked dry-material lot."
          >
            {harvestedEligibleGrows.length === 0 ? (
              <EmptyState
                title="Nothing waiting for dry intake"
                body="Once a harvested grow has dry weight recorded, it can be turned into a dry-material lot here."
              />
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {harvestedEligibleGrows.map((grow) => (
                  <div
                    key={grow.id}
                    className={`rounded-2xl border p-4 bg-white dark:bg-zinc-900 ${
                      grow.id === focusGrowId
                        ? "accent-selected"
                        : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">{getGrowLabel(grow)}</div>
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                          {grow?.strain || "Unknown strain"}
                        </div>
                      </div>
                      <Link
                        to={`/grow/${grow.id}`}
                        className="text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Open Grow
                      </Link>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <DetailStat
                        label="Dry harvested"
                        value={formatQty(getGrowDryTotal(grow), "g")}
                      />
                      <DetailStat label="Harvest date" value={getGrowHarvestDate(grow) || "—"} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => handleCreateDryLot(grow)}
                        disabled={busyGrowId === grow.id}
                        className="btn btn-accent disabled:opacity-60 text-sm"
                      >
                        {busyGrowId === grow.id ? "Creating..." : "Create Dry Lot"}
                      </button>
                      <Link
                        to={`/?tab=postprocess&ppgrow=${grow.id}`}
                        className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        Focus Here
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Existing dry-material lots"
            defaultOpen={false}
            subtitle="Only active usable dry lots are shown here. Depleted or archived dry lots live in the History tab."
          >
            {activeDryLots.length === 0 ? (
              <EmptyState
                title="No active dry lots"
                body="Create a dry-material lot from a harvested grow first, or review depleted dry lots in the History tab."
              />
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {activeDryLots.map((lot) => (
                  <div
                    key={lot.id}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <DetailNameButton onClick={() => setSelectedDryLotId(lot.id)}>
                          {lot?.name || lot.id}
                        </DetailNameButton>
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                          {lot?.strain || "Unknown strain"} ·{" "}
                          {lot?.growLabel || lot?.sourceGrowId || "Unknown source"}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-semibold">
                          {formatQty(getLotAvailableQuantity(lot), lot?.unit || "g", getQtyDigits(lot?.unit || "g"))}
                        </div>
                        <div className="text-zinc-500 dark:text-zinc-400 capitalize">
                          {getLotStatus(lot)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <DetailStat
                        label="Initial quantity"
                        value={formatQty(lot?.initialQuantity, lot?.unit || "g")}
                      />
                      <DetailStat
                        label="Allocated"
                        value={formatQty(lot?.allocatedQuantity, lot?.unit || "g")}
                      />
                      <DetailStat label="Unit cost" value={money(getLotUnitCost(lot))} />
                      <DetailStat
                        label="Batch cost"
                        value={money(lot?.batchTotalCost || lot?.costs?.batchTotalCost || 0)}
                      />
                    </div>


                    <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                      Click the lot name to open reservations, cost, QC, shelf-life, and lineage in a detail window.
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === "extractions" && (
        <div className="space-y-6">
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (
                  requestLabOperation(
                    LAB_OPERATION_ACTIONS.CREATE_EXTRACTION,
                    canUsePostProcessing
                  )
                ) {
                  setCreateExtractionModalOpen(true);
                }
              }}
              className="btn btn-accent text-sm"
            >
              Create Extraction Batch
            </button>
          </div>

          {createExtractionModalOpen ? (
            <PostProcessDetailModal
              title="Create extraction batch"
              subtitle="Consume dry lots into a dry powder or liquid extraction batch."
              onClose={() => setCreateExtractionModalOpen(false)}
              maxWidth="max-w-7xl"
            >
              <SectionCard
                title="Create extraction batch"
                defaultOpen={true}
                subtitle="Choose source lots, method, status, and optional output. The main tab stays clean until you open this window."
              >
            {availableDryLots.length === 0 ? (
              <EmptyState
                title="No dry lots available"
                body="Create a dry-material lot first so extraction has something to consume."
              />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <label className="space-y-1 text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Batch name</span>
                    <input
                      type="text"
                      value={extractionForm.name}
                      onChange={(e) =>
                        setExtractionForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder="Optional auto name if left blank"
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                    />
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Extraction type</span>
                    <select
                      value={extractionForm.extractionType}
                      onChange={(e) => {
                        const extractionType = e.target.value;
                        const outputUnit = getDefaultExtractionOutputUnit(extractionType);
                        setExtractionOutputEdited(false);
                        setExtractionForm((prev) => ({
                          ...prev,
                          extractionType,
                          outputUnit,
                          outputAmount: outputUnit === "g" && !prev.outputAmount ? String(getExtractionInputTotalForUnit(selectedExtractionLots, "g") || "") : prev.outputAmount,
                        }));
                      }}
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                    >
                      <option value="dual">Dual extract</option>
                      <option value="hot_water">Hot water</option>
                      <option value="ethanol">Ethanol</option>
                      <option value="powder">Dry powder extract</option>
                      <option value="resin">Resin</option>
                      <option value="other">Other</option>
                    </select>
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Date</span>
                    <input
                      type="date"
                      value={extractionForm.date}
                      onChange={(e) =>
                        setExtractionForm((prev) => ({
                          ...prev,
                          date: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                    />
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Status</span>
                    <select
                      value={extractionForm.status}
                      onChange={(e) =>
                        setExtractionForm((prev) => ({
                          ...prev,
                          status: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                    >
                      <option value="planned">Planned</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </label>
                </div>



                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="xl:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
                    <div>
                      <div className="font-medium">Source dry lots</div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        Enter only the amount you want to consume from each lot. You can combine
                        more than one harvested grow into one extraction batch.
                      </div>
                    </div>

                    <div className="space-y-3">
                      {availableDryLots.map((lot) => {
                        const remaining = Number(getLotAvailableQuantity(lot)) || 0;
                        const value = extractionForm.lotQuantities?.[lot.id] ?? "";
                        const isFocused = !!focusGrowId && lot?.sourceGrowId === focusGrowId;

                        return (
                          <div
                            key={lot.id}
                            className={`rounded-2xl border p-4 ${
                              isFocused
                                ? "accent-selected"
                                : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold">{lot?.name || lot.id}</div>
                                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                                  {lot?.strain || "Unknown strain"} ·{" "}
                                  {lot?.growLabel || lot?.sourceGrowId || "Unknown source"}
                                </div>
                              </div>
                              <div className="text-right text-sm">
                                <div className="font-semibold">
                                  {formatQty(remaining, lot?.unit || "g")}
                                </div>
                                <div className="text-zinc-500 dark:text-zinc-400">remaining</div>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                              <label className="space-y-1 text-sm md:col-span-2">
                                <span className="text-zinc-600 dark:text-zinc-400">
                                  Dry amount to consume
                                </span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  step="0.01"
                                  max={remaining || undefined}
                                  value={value}
                                  onChange={(e) => handleExtractionLotQuantityChange(lot, e.target.value)}
                                  className={`w-full rounded-xl border bg-white dark:bg-zinc-900 px-3 py-2 ${consumptionWarnings[`extraction:${lot.id}`] ? "border-rose-400 text-rose-900 dark:text-rose-100" : "border-zinc-300 dark:border-zinc-700"}`}
                                  placeholder={`0 to ${remaining}`}
                                />
                                {consumptionWarnings[`extraction:${lot.id}`] ? (
                                  <div className="rounded-lg border border-rose-400/70 bg-rose-950/25 px-3 py-2 text-xs text-rose-200">{consumptionWarnings[`extraction:${lot.id}`]}</div>
                                ) : null}
                              </label>
                              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                Unit cost {money(getLotUnitCost(lot))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
                    <div>
                      <div className="font-medium">Extraction details</div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        If status is completed, enter the output amount now so an extract lot is
                        created immediately.
                      </div>
                    </div>

                    <label className="space-y-1 text-sm block">
                      <span className="text-zinc-600 dark:text-zinc-400">Method</span>
                      <textarea
                        value={extractionForm.method}
                        onChange={(e) =>
                          setExtractionForm((prev) => ({
                            ...prev,
                            method: e.target.value,
                          }))
                        }
                        rows={3}
                        placeholder="Example: dual extraction with hot water reduction"
                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                      />
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Output amount</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={extractionForm.outputAmount}
                          onChange={(e) => {
                            setExtractionOutputEdited(true);
                            setExtractionForm((prev) => ({
                              ...prev,
                              outputAmount: e.target.value,
                            }));
                          }}
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>

                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Output unit</span>
                        <select
                          value={extractionForm.outputUnit}
                          onChange={(e) =>
                            setExtractionForm((prev) => ({
                              ...prev,
                              outputUnit: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        >
                          <option value="mL">mL</option>
                          <option value="g">g</option>
                                    </select>
                      </label>
                    </div>

                    <label className="space-y-1 text-sm block">
                      <span className="text-zinc-600 dark:text-zinc-400">Output yield percent</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={extractionForm.outputYieldPercent}
                        onChange={(e) =>
                          setExtractionForm((prev) => ({
                            ...prev,
                            outputYieldPercent: e.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        placeholder="Optional"
                      />
                    </label>

                    <label className="space-y-1 text-sm block">
                      <span className="text-zinc-600 dark:text-zinc-400">Notes</span>
                      <textarea
                        value={extractionForm.notes}
                        onChange={(e) =>
                          setExtractionForm((prev) => ({
                            ...prev,
                            notes: e.target.value,
                          }))
                        }
                        rows={4}
                        placeholder="Reduction notes, solvent details, filtration notes, etc."
                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                      />
                    </label>

                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 text-sm space-y-2">
                      <div className="font-medium">Extraction preview</div>
                      <div className="text-zinc-600 dark:text-zinc-400">
                        Selected input: {extractionPreview.selectedInputLabel}
                      </div>
                      <div className="text-zinc-600 dark:text-zinc-400">
                        Output lot: {extractionPreview.outputLabel} {extractionPreview.yieldPercent > 0 ? `· ${extractionPreview.yieldPercent}% yield against same-unit input` : ""}
                      </div>
                      <div className="text-zinc-500 dark:text-zinc-500 text-xs">
                        Dry powder/resin defaults to grams. Dual, hot-water, and ethanol extracts default to mL.
                      </div>
                    </div>

                    <button
                      onClick={handleCreateExtraction}
                      disabled={extractionBusy}
                      className="w-full btn btn-accent disabled:opacity-60 text-sm justify-center"
                    >
                      {extractionBusy ? "Creating..." : "Create Extraction Batch"}
                    </button>
                  </div>
                </div>
              </div>
            )}
              </SectionCard>
            </PostProcessDetailModal>
          ) : null}

          {pendingExtractionOutputs.length > 0 ? (
            <SectionCard
              title="Pending extract outputs"
              defaultOpen={true}
              subtitle="These extractions already consumed dry material but still need their output recorded to generate an extract lot."
            >
              <div className="space-y-4">
                {pendingExtractionOutputs.map((batch) => {
                  const form = finalizeForms[batch.id] || {
                    outputAmount: "",
                    outputUnit: "mL",
                    outputYieldPercent: "",
                    date: today,
                    notes: "",
                  };

                  return (
                    <div
                      key={batch.id}
                      className="rounded-2xl border border-amber-300/60 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <DetailNameButton onClick={() => setSelectedExtractionBatchId(batch.id)}>
                            {batch?.name || batch.id}
                          </DetailNameButton>
                          <div className="text-sm text-zinc-600 dark:text-zinc-400">
                            {batch?.date || "—"} · {formatTotalsByUnit(batch?.inputLots || []) || "No source quantity"}
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="font-semibold capitalize">{formatBatchStatus(getProcessBatchStatus(batch))}</div>
                          <div className="text-zinc-500 dark:text-zinc-400">Needs output</div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <DetailStat label="Input" value={formatTotalsByUnit(batch?.inputLots || []) || "—"} />
                        <DetailStat label="Date" value={batch?.date || "—"} />
                        <DetailStat label="Output lot" value={batch?.outputLotId || "Not created"} />
                      </div>
                      <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                        Click the batch name to record output and view extraction detail.
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Extract lots"
            defaultOpen={false}
            subtitle="These lots are ready for production or downstream batching."
          >
            {activeExtractLots.length === 0 ? (
              <EmptyState
                title="No extract lots yet"
                body="Complete an extraction batch with an output amount and the extract lot will appear here."
              />
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {activeExtractLots.map((lot) => (
                  <div
                    key={lot.id}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <DetailNameButton onClick={() => setSelectedExtractLotId(lot.id)}>
                          {lot?.name || lot.id}
                        </DetailNameButton>
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                          {lot?.extractionType || "extract"} · {lot?.strain || "Unknown strain"}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-semibold">
                          {formatQty(getLotAvailableQuantity(lot), lot?.unit || "mL", getQtyDigits(lot?.unit || "mL"))}
                        </div>
                        <div className="text-zinc-500 dark:text-zinc-400 capitalize">
                          {getLotStatus(lot)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <DetailStat
                        label="Initial quantity"
                        value={formatQty(lot?.initialQuantity, lot?.unit || "mL")}
                      />
                      <DetailStat label="Unit cost" value={money(getLotUnitCost(lot))} />
                      <DetailStat label="Method" value={lot?.method || "—"} />
                      <DetailStat
                        label="Source batch"
                        value={lot?.batchName || lot?.sourceBatchId || "—"}
                      />
                    </div>

                    <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                      Click the lot name to open reservations, cost, QC, shelf-life, and lineage in a detail window.
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === "production" && (
        <div className="space-y-6">
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              to="/?tab=labels&labelSource=finished_goods"
              onClick={(event) => {
                if (!requestPostProcessLabelAccess()) event.preventDefault();
              }}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Labels Tab
            </Link>
            <button
              type="button"
              onClick={() => {
                if (
                  requestLabOperation(
                    LAB_OPERATION_ACTIONS.CREATE_PRODUCTION,
                    canUsePostProcessing
                  )
                ) {
                  setCreateProductionModalOpen(true);
                }
              }}
              className="btn btn-accent text-sm"
            >
              Start Production Batch
            </button>
          </div>

          {createProductionModalOpen ? (
            <PostProcessDetailModal
              title="Start production batch"
              subtitle="Build capsules, gummies, tinctures, chocolates, or other finished batches from source lots."
              onClose={() => setCreateProductionModalOpen(false)}
              maxWidth="max-w-7xl"
            >
              <SectionCard
                title="Create production batch"
                defaultOpen={true}
                subtitle="Use this window for formula planning, source-lot consumption, cost previews, and finished-batch creation."
              >
            {availableProductionSourceLots.length === 0 ? (
              <EmptyState
                title="No source lots available"
                body="Dry lots or extract lots with remaining inventory are required before you can start a production batch."
              />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <label className="space-y-1 text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Batch name</span>
                    <input
                      type="text"
                      value={productionForm.name}
                      onChange={(e) =>
                        setProductionForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder="Optional auto name if left blank"
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                    />
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Production type</span>
                    <select
                      value={productionForm.productType}
                      onChange={(e) => {
                        const nextType = e.target.value;
                        const defaultOutput = nextType === "chocolate" ? "24" : nextType === "tincture" ? "120" : "100";
                        setProductionForm((prev) => ({
                          ...prev,
                          productType: nextType,
                          outputCount: defaultOutput,
                          formulaRows: [{ id: `formula_${Date.now()}`, ingredientName: "", sourceLotId: "", amountPerUnit: "", gramsPerCapsule: "", percent: "" }],
                          lotQuantities: {},
                          bottleSize: "",
                        }));
                        setConsumptionWarnings((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith("formula:") && !key.startsWith("production:"))));
                      }}
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                    >
                      <option value="capsule">Capsules</option>
                      <option value="gummy">Gummies</option>
                      <option value="tincture">Tinctures</option>
                      <option value="chocolate">Chocolates</option>
                    </select>
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Date</span>
                    <input
                      type="date"
                      value={productionForm.date}
                      onChange={(e) =>
                        setProductionForm((prev) => ({
                          ...prev,
                          date: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                    />
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-zinc-600 dark:text-zinc-400">Status</span>
                    <select
                      value={productionForm.status}
                      onChange={(e) =>
                        setProductionForm((prev) => ({
                          ...prev,
                          status: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                    >
                      <option value="planned">Planned</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </label>
                </div>

                {(() => {
                  const formulaConfig = productionCapsulePlan.config || getProductionFormulaConfig(productionForm.productType);
                  const isCapsuleFormula = formulaConfig.key === "capsule";
                  const isTinctureFormula = formulaConfig.key === "tincture";
                  return (
                    <div className="rounded-2xl border border-purple-300/60 dark:border-purple-900/60 bg-purple-50/60 dark:bg-purple-950/10 p-4 space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{formulaConfig.title}</div>
                          <div className="text-sm text-zinc-600 dark:text-zinc-400">
                            Enter the amount of each source used per finished {formulaConfig.unitLabel}. The app calculates batch totals, inventory usage, and average potency/fill automatically.
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {formulaConfig.presets.map((count) => (
                            <button
                              key={`formula-count-${formulaConfig.key}-${count}`}
                              type="button"
                              onClick={() => setProductionForm((prev) => ({ ...prev, outputCount: String(count) }))}
                              className={`rounded-lg border px-3 py-1.5 text-xs ${Number(productionForm.outputCount) === count ? "accent-selected" : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                            >
                              {count} {formulaConfig.presetSuffix}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
                        <label className="space-y-1 block">
                          <span className="text-zinc-600 dark:text-zinc-400">{formulaConfig.outputLabel}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step={isTinctureFormula ? "0.01" : "1"}
                            value={productionForm.outputCount}
                            onChange={(e) => setProductionForm((prev) => ({ ...prev, outputCount: e.target.value }))}
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                          />
                        </label>
                        <DetailStat label="Formula / output unit" value={productionCapsulePlan.perUnitSummary} />
                        <DetailStat label="Total source needed" value={productionCapsulePlan.batchTotalSummary} />
                        <DetailStat label={isTinctureFormula ? "Auto concentration" : "Auto mg / unit"} value={productionAutoMgPerUnit ? `${isCapsuleFormula ? "≈ " : ""}${formatMg(productionAutoMgPerUnit)}${isTinctureFormula ? " / mL" : ""}` : "Build formula"} />
                        <DetailStat label="Label display" value={isCapsuleFormula ? `${productionCapsulePlan.displayDose.perCapsuleLabel} · ${productionCapsulePlan.displayDose.totalWeightLabel}` : "Calculated from completed batch output"} />
                      </div>

                      <div className="space-y-3">
                        {((productionForm.formulaRows && productionForm.formulaRows.length > 0) ? productionForm.formulaRows : [{ id: "formula_1", ingredientName: "", sourceLotId: "", amountPerUnit: "", gramsPerCapsule: "", percent: "" }]).map((row, index) => {
                          const planned = productionCapsulePlan.rows.find((entry) => entry.id === row.id) || {};
                          const rowWarning = consumptionWarnings[`formula:${row.id || `formula_${index + 1}`}`];
                          return (
                            <div key={row.id || `formula-row-${index}`} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/30 p-3 space-y-2">
                              <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                                <label className="space-y-1 text-sm md:col-span-2">
                                  <span className="text-zinc-600 dark:text-zinc-400">Ingredient / species</span>
                                  <input
                                    type="text"
                                    value={row.ingredientName || ""}
                                    onChange={(e) => updateFormulaRow(index, { ingredientName: e.target.value })}
                                    placeholder="P. cubensis, Reishi, Cordyceps..."
                                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                                  />
                                </label>
                                <label className="space-y-1 text-sm">
                                  <span className="text-zinc-600 dark:text-zinc-400">{formulaConfig.amountLabel}</span>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    step="0.0001"
                                    value={row.amountPerUnit ?? row.gramsPerCapsule ?? ""}
                                    onChange={(e) => updateFormulaRow(index, { amountPerUnit: e.target.value, gramsPerCapsule: e.target.value })}
                                    placeholder={isTinctureFormula ? "0.01" : "0.30"}
                                    className={`w-full rounded-xl border bg-white dark:bg-zinc-900 px-3 py-2 ${rowWarning ? "border-rose-400 text-rose-900 dark:text-rose-100" : "border-zinc-300 dark:border-zinc-700"}`}
                                  />
                                </label>
                                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 px-3 py-2 text-sm">
                                  <div className="text-zinc-500 dark:text-zinc-400">Formula share</div>
                                  <div className="font-semibold">{planned.percent ? `${planned.percent}%` : "—"}</div>
                                </div>
                                <label className="space-y-1 text-sm">
                                  <span className="text-zinc-600 dark:text-zinc-400">Source lot guard</span>
                                  <select
                                    value={row.sourceLotId || ""}
                                    onChange={(e) => updateFormulaRow(index, { sourceLotId: e.target.value })}
                                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                                  >
                                    <option value="">No linked lot</option>
                                    {availableProductionSourceLots.map((lot) => {
                                      const usedByOtherRow = ((productionForm.formulaRows && productionForm.formulaRows.length > 0) ? productionForm.formulaRows : []).some((otherRow, otherIndex) => otherIndex !== index && String(otherRow?.sourceLotId || "") === String(lot.id));
                                      return (
                                        <option key={`formula-source-${lot.id}`} value={lot.id} disabled={usedByOtherRow}>
                                          {lot?.name || lot.id} · {formatQty(getLotAvailableQuantity(lot), lot?.unit || "g", getQtyDigits(lot?.unit || "g"))}{usedByOtherRow ? " · already used" : ""}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </label>
                                <div className="flex items-end justify-between gap-2 text-sm">
                                  <div>
                                    <div className="font-semibold">{planned.totalRequired ? formatFormulaQuantity(planned.totalRequired, planned.sourceUnit) : "0"}</div>
                                    <div className={planned.shortage > 0 ? "text-rose-600 dark:text-rose-300 text-xs" : "text-zinc-500 dark:text-zinc-400 text-xs"}>
                                      {planned.shortage > 0 ? `${formatFormulaQuantity(planned.shortage, planned.sourceUnit)} short` : "needed total"}
                                    </div>
                                  </div>
                                  <button type="button" onClick={() => removeFormulaRow(index)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                    Remove
                                  </button>
                                </div>
                              </div>
                              {rowWarning ? (
                                <div className="rounded-lg border border-rose-400/70 bg-rose-950/25 px-3 py-2 text-xs text-rose-200">{rowWarning}</div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={addFormulaRow} className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                          Add ingredient row
                        </button>
                        <button type="button" onClick={applyFormulaToSourceLots} className="btn btn-accent text-sm">
                          Apply formula totals to source lots
                        </button>
                      </div>

                      {productionCapsulePlan.rows.length > 0 && !productionCapsulePlan.rows.some((row) => row.amountPerUnit > 0) ? (
                        <div className="rounded-xl border border-amber-300/70 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
                          Enter the amount of each source used per finished {formulaConfig.unitLabel}. The app calculates the average fill/concentration and batch source totals automatically.
                        </div>
                      ) : null}
                      {productionCapsulePlan.inventoryGuards.length > 0 ? (
                        <div className="rounded-xl border border-rose-300/70 bg-rose-50 dark:border-rose-900/70 dark:bg-rose-950/30 p-3 text-sm text-rose-800 dark:text-rose-200">
                          Source-lot guard: {productionCapsulePlan.inventoryGuards.map((entry) => `${entry.sourceLotName || entry.sourceLotId} needs ${formatFormulaQuantity(entry.totalRequired, entry.sourceUnit)}, ${formatFormulaQuantity(entry.shortage, entry.sourceUnit)} short`).join(" · ")}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="xl:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
                    <div>
                      <div className="font-medium">Source lots</div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        Production can consume either dry material directly or an extract lot. This
                        is the handoff into finished goods manufacturing.
                      </div>
                    </div>

                    <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                      {availableProductionSourceLots.map((lot) => {
                        const remaining = Number(getLotAvailableQuantity(lot)) || 0;
                        const lotType = String(lot?.lotType || "");
                        const value = productionForm.lotQuantities?.[lot.id] ?? "";

                        return (
                          <div
                            key={lot.id}
                            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30 p-4"
                          >
                            <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3 items-start">
                              <div className="min-w-0">
                                <div className="font-semibold leading-snug break-words">{lot?.name || lot.id}</div>
                                <div className="text-sm text-zinc-600 dark:text-zinc-400 leading-snug break-words">
                                  {lotType === "extract" ? "Extract" : "Dry material"} ·{" "}
                                  {lot?.strain || "Unknown strain"} ·{" "}
                                  {lot?.growLabel ||
                                    lot?.batchName ||
                                    lot?.sourceGrowId ||
                                    lot?.sourceBatchId ||
                                    "Unknown source"}
                                </div>
                              </div>
                              <div className="text-right text-sm shrink-0">
                                <div className="font-semibold tabular-nums whitespace-nowrap">
                                  {formatQty(
                                    remaining,
                                    lot?.unit || (lotType === "extract" ? "mL" : "g")
                                  )}
                                </div>
                                <div className="text-zinc-500 dark:text-zinc-400 whitespace-nowrap">remaining</div>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                              <label className="space-y-1 text-sm md:col-span-2">
                                <span className="text-zinc-600 dark:text-zinc-400">
                                  Amount to consume
                                </span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  step="0.01"
                                  max={remaining || undefined}
                                  value={value}
                                  onChange={(e) => handleProductionLotQuantityChange(lot, e.target.value)}
                                  className={`w-full rounded-xl border bg-white dark:bg-zinc-900 px-3 py-2 ${consumptionWarnings[`production:${lot.id}`] ? "border-rose-400 text-rose-900 dark:text-rose-100" : "border-zinc-300 dark:border-zinc-700"}`}
                                  placeholder={`0 to ${remaining}`}
                                />
                                {consumptionWarnings[`production:${lot.id}`] ? (
                                  <div className="rounded-lg border border-rose-400/70 bg-rose-950/25 px-3 py-2 text-xs text-rose-200">{consumptionWarnings[`production:${lot.id}`]}</div>
                                ) : null}
                              </label>
                              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                Unit cost {money(getLotUnitCost(lot))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
                    <div>
                      <div className="font-medium">Batch details</div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        Link an optional recipe for COG/BOM supply costing. Packaging, retail SKUs, MSRP, and final sale price happen later in Finished Inventory and Sales.
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <DetailStat
                        label={getProductionFormulaConfig(productionForm.productType).outputLabel}
                        value={`${Number(productionForm.outputCount) || 0} ${getProductionFormulaConfig(productionForm.productType).unitLabelPlural}`}
                      />
                      <DetailStat
                        label={productionForm.productType === "tincture" ? "Auto concentration" : productionForm.productType === "capsule" ? "Approx. avg fill" : "Auto mg / unit"}
                        value={productionAutoMgPerUnit ? `${productionForm.productType === "capsule" ? "≈ " : ""}${formatMg(productionAutoMgPerUnit)}${productionForm.productType === "tincture" ? " / mL" : ""}` : "Build formula or select source lots"}
                      />
                    </div>

                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 p-3 text-xs text-zinc-600 dark:text-zinc-400">
                      Production creates the parent finished batch only. SKU/package sizes are created later from Finished Inventory so labels, FEFO, samples, and retail packages stay separate from manufacturing.
                    </div>

                    {productionForm.productType === "tincture" ? (
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 p-3 text-xs text-zinc-600 dark:text-zinc-400">
                        Production records bulk tincture in mL. Bottle sizes and bottle counts are created later as package/SKU runs from Finished Inventory.
                      </div>
                    ) : null}

                    <label className="space-y-1 text-sm block">
                      <span className="text-zinc-600 dark:text-zinc-400">Batch variant / formula note</span>
                      <input
                        type="text"
                        value={productionForm.variant}
                        onChange={(e) =>
                          setProductionForm((prev) => ({
                            ...prev,
                            variant: e.target.value,
                          }))
                        }
                        placeholder="Example: LM-FB-500, focus formula, test blend, or 30 mL tincture"
                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                      />
                    </label>

                    <label className="space-y-1 text-sm block">
                      <span className="text-zinc-600 dark:text-zinc-400">Recipe / BOM</span>
                      <select
                        value={productionForm.recipeId}
                        onChange={(e) => applyProductionRecipe(e.target.value)}
                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                      >
                        <option value="">No recipe selected</option>
                        {recipes
                          .slice()
                          .sort((a, b) =>
                            String(a?.name || "").localeCompare(String(b?.name || ""))
                          )
                          .map((recipe) => (
                            <option key={recipe.id} value={recipe.id}>
                              {recipe?.name || recipe.id}
                            </option>
                          ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Production supplies / recipe extra</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={productionForm.packagingCost}
                          onChange={(e) =>
                            setProductionForm((prev) => ({
                              ...prev,
                              packagingCost: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>

                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Labor cost</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={productionForm.laborCost}
                          onChange={(e) =>
                            setProductionForm((prev) => ({
                              ...prev,
                              laborCost: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>

                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Overhead</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={productionForm.overheadCost}
                          onChange={(e) =>
                            setProductionForm((prev) => ({
                              ...prev,
                              overheadCost: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>

                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Other cost</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={productionForm.otherCost}
                          onChange={(e) =>
                            setProductionForm((prev) => ({
                              ...prev,
                              otherCost: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>
                    </div>

                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 p-3 text-xs text-zinc-600 dark:text-zinc-400">
                      Pricing fields were intentionally removed from Production. Cost follows this batch into Finished Inventory, then package-level MSRP and actual sale price are handled in Sales for better analytics.
                    </div>

                    <label className="space-y-1 text-sm block">
                      <span className="text-zinc-600 dark:text-zinc-400">Method / notes</span>
                      <textarea
                        value={productionForm.method}
                        onChange={(e) =>
                          setProductionForm((prev) => ({
                            ...prev,
                            method: e.target.value,
                          }))
                        }
                        rows={3}
                        placeholder="Mixing, fill weights, mold notes, carrier details, etc."
                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                      />
                    </label>

                    <label className="space-y-1 text-sm block">
                      <span className="text-zinc-600 dark:text-zinc-400">Additional notes</span>
                      <textarea
                        value={productionForm.notes}
                        onChange={(e) =>
                          setProductionForm((prev) => ({
                            ...prev,
                            notes: e.target.value,
                          }))
                        }
                        rows={3}
                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                      />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
                    <div className="font-medium">Cost preview</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <DetailStat
                        label="Source material cost"
                        value={money(productionInputMaterialCostTotal)}
                      />
                      <DetailStat
                        label="Recipe / BOM cost"
                        value={money(selectedRecipeCosting.totalCost)}
                      />
                      <DetailStat
                        label="Direct added cost"
                        value={money(productionDirectCost)}
                      />
                      <DetailStat
                        label="Batch total cost"
                        value={money(productionBatchCostPreview)}
                      />
                      <DetailStat
                        label="Unit cost"
                        value={money(productionUnitCostPreview)}
                      />
                      <DetailStat
                        label="Selected input"
                        value={formatTotalsByUnit(productionInputTotals) || "None"}
                      />
                      <DetailStat
                        label="Auto mg / unit"
                        value={productionAutoMgPerUnit ? formatMg(productionAutoMgPerUnit) : "Not enough gram input"}
                      />
                    </div>

                    {selectedRecipe ? (
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 text-sm space-y-2">
                        <div className="font-medium">Recipe costing from COG</div>
                        <div className="text-zinc-600 dark:text-zinc-400">
                          {selectedRecipe.name} scaled from base yield{" "}
                          {selectedRecipeCosting.recipeYield || 1} to target output{" "}
                          {Number(productionForm.outputCount) ||
                            0 ||
                            selectedRecipeCosting.recipeYield ||
                            1}
                          .
                        </div>
                        <div className="rounded-lg border border-emerald-800/70 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100">
                          Recipe/BOM costs are already included in the Recipe/BOM cost stat. Manual cost fields above are extra production costs only.
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {selectedRecipeCosting.breakdown.map((item) => (
                            <div
                              key={`${item.supplyId}-${item.supplyName}`}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <div>
                                <div className="font-medium">{item.supplyName}</div>
                                <div className="text-zinc-500 dark:text-zinc-400">
                                  {item.scaledAmount} {item.unit || "units"} @{" "}
                                  {money(item.unitCost)}
                                  {item.reusable
                                    ? " · reusable excluded from unit cost"
                                    : ""}
                                </div>
                              </div>
                              <div className="font-semibold">{money(item.totalCost)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-sm text-zinc-600 dark:text-zinc-400">
                        No recipe selected. You can still manufacture directly from source lots and
                        manual added costs.
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
                    <div className="font-medium">Production planning</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <DetailStat label="Coverage" value={`${Number(productionPlanningSnapshot?.coveragePercent || 0).toFixed(2)}%`} />
                      <DetailStat label="Estimated max output" value={productionPlanningSnapshot?.estimatedMaxOutputQuantity > 0 ? String(productionPlanningSnapshot.estimatedMaxOutputQuantity) : "0"} />
                      <DetailStat label="Can start batch" value={productionPlanningSnapshot?.canStartBatch ? "Yes" : "No"} />
                      <DetailStat label="Limiting lots" value={String(productionPlanningSnapshot?.limitingLots?.length || 0)} />
                    </div>
                    {productionPlanningSnapshot?.shortages?.length > 0 ? (
                      <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/20 p-3 text-sm text-rose-700 dark:text-rose-300">
                        {productionPlanningSnapshot.shortages.slice(0, 5).map((entry) => `${entry.lotName}: ${formatQty(entry.shortageQuantity, entry.unit, entry.unit === "count" ? 0 : 2)} short`).join(" · ")}
                      </div>
                    ) : null}
                    <SupplyRequirementPanel
                      snapshot={productionSupplySnapshot}
                      title="Recipe and packaging requirements"
                      emptyMessage="No recipe selected, so there are no inventory-backed packaging requirements to check."
                    />
                  </div>

                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
                    <div className="font-medium">Create parent finished batch</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <DetailStat
                        label="Output units"
                        value={`${Number(productionForm.outputCount) || 0} ${productionForm.productType === "capsule" ? "capsules" : getProductTypeMeta(productionForm.productType).pieceLabelPlural}`}
                      />
                      <DetailStat
                        label="Avg mg / unit"
                        value={productionAutoMgPerUnit ? formatMg(productionAutoMgPerUnit) : "Not enough gram input"}
                      />
                      <DetailStat
                        label="Batch total cost"
                        value={money(productionBatchCostPreview)}
                      />
                      <DetailStat
                        label="Cost / unit"
                        value={money(productionUnitCostPreview)}
                      />
                    </div>

                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 p-3 text-xs text-zinc-600 dark:text-zinc-400">
                      After this succeeds, the modal closes and the new parent batch appears in Finished Inventory. Create 3.5 g, 7 g, samples, promos, MSRP, and sale pricing from that finished batch.
                    </div>

                    <button
                      onClick={handleCreateProduction}
                      disabled={productionBusy}
                      className="w-full btn btn-accent disabled:opacity-60 text-sm justify-center"
                    >
                      {productionBusy ? "Creating..." : "Create Parent Finished Batch"}
                    </button>
                  </div>
                </div>
              </div>
            )}
              </SectionCard>
            </PostProcessDetailModal>
          ) : null}

          <SectionCard
            title="Production batches"
            defaultOpen={true}
            subtitle="These are your manufacturing runs. Completed runs create finished goods lots that move into Finished Inventory."
          >
            {activeProductionBatches.length === 0 ? (
              <EmptyState
                title="No active production batches"
                body="Completed production runs move into Finished Inventory and the History tab. Only active or in-progress manufacturing runs stay here."
              />
            ) : (
              <div className="space-y-4">
                {activeProductionBatches.map((batch) => {
                  const meta = getProductTypeMeta(batch?.productType);
                  const outputLot = batch?.outputLotId
                    ? finishedGoodsLots.find((lot) => lot.id === batch.outputLotId) || null
                    : null;

                  return (
                    <div
                      key={batch.id}
                      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <DetailNameButton onClick={() => setSelectedProductionBatchId(batch.id)}>
                            {batch?.name || `${meta.label} Batch`}
                          </DetailNameButton>
                          <div className="text-sm text-zinc-600 dark:text-zinc-400 capitalize">
                            {meta.pluralLabel} ·{" "}
                            {String(batch?.sourceMode || "mixed").replace(/_/g, " ")} source ·{" "}
                            {batch?.date || "—"}
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="font-semibold capitalize">
                            {formatBatchStatus(getProcessBatchStatus(batch))}
                          </div>
                          <div className="text-zinc-500 dark:text-zinc-400">
                            {Number(batch?.outputCount) > 0
                              ? `${Math.floor(Number(batch.outputCount) || 0)} ${meta.pieceLabelPlural}`
                              : "Pending output"}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                        <DetailStat
                          label="Total input"
                          value={formatTotalsByUnit(batch?.inputTotals || batch?.inputLots || []) || "—"}
                        />
                        <DetailStat
                          label="Batch cost"
                          value={money(batch?.batchTotalCost || batch?.costs?.batchTotalCost || 0)}
                        />
                        <DetailStat
                          label="Unit cost"
                          value={money(batch?.unitCost || batch?.costs?.unitCost || 0)}
                        />
                        <DetailStat
                          label="Output lot"
                          value={outputLot?.name || "Not created"}
                        />
                      </div>

                      <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                        Click the batch name to open full manufacturing detail, cost, recipe, lineage, and notes in a detail window.
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === "finished" && (
        <div className="space-y-6">
          <SectionCard
            title="Finished inventory"
            defaultOpen={true}
            subtitle="QC, potency, shelf life, and label-ready packaged stock live here before outbound movement. Pricing and selling are managed in Sales."
            action={
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/?tab=labels&labelSource=finished_goods"
                  onClick={(event) => {
                    if (!requestPostProcessLabelAccess()) event.preventDefault();
                  }}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Open Label Print
                </Link>
              </div>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <SummaryCard
                label="Finished lots"
                value={String(finishedBatchCards.length)}
                hint="Batch-first inventory sources"
                icon={Archive}
              />
              <SummaryCard
                label="Packaged lots"
                value={String(saleReadyFinishedGoodsLots.length)}
                hint="Ready for Sales and labels"
                icon={Tags}
              />
              <SummaryCard
                label="QC pending"
                value={String(activeFinishedGoodsLots.filter((lot) => isQcPendingLot(lot)).length)}
                hint="Finished lots needing review"
                icon={AlertTriangle}
              />
              <SummaryCard
                label="Expiring soon"
                value={String(activeFinishedGoodsLots.filter((lot) => isExpiringSoonLot(lot)).length)}
                hint="Best by within 30 days"
                icon={AlertTriangle}
              />
            </div>

            {finishedBatchCards.length === 0 ? (
              <EmptyState
                title="No active finished inventory"
                body="Once a completed production batch is created, its output lot will appear here. Depleted lots move to the History tab."
              />
            ) : (
              <div className="space-y-4">
                {finishedBatchCards.map((lot) => {
                  const meta = getProductTypeMeta(
                    lot?.productType || lot?.finishedGoodType || lot?.lotType
                  );
                  const isFocusedFinishedLot = focusFinishedLotId === lot.id;
                  const sourceRuns = packageRunsBySourceLotId.get(lot.id) || [];
                  const availableQuantity = Number(getLotAvailableQuantity(lot)) || 0;
                  const shelfLife = getShelfLifeSummary(lot);
                  const qcSummary = getLotQcSummary(lot);

                  return (
                    <button
                      key={lot.id}
                      id={`finished-lot-${lot.id}`}
                      type="button"
                      onClick={() => setSelectedFinishedLotId(lot.id)}
                      className={`w-full rounded-2xl border bg-white dark:bg-zinc-900 p-4 text-left transition hover:border-purple-400 hover:bg-purple-50/40 dark:hover:border-purple-800 dark:hover:bg-purple-950/20 ${
                        isFocusedFinishedLot
                          ? "accent-selected"
                          : "border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-lg font-semibold text-purple-700 dark:text-purple-300 line-clamp-2">
                            {lot?.name || `${meta.label} Lot`}
                          </div>
                          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                            {meta.pluralLabel} · {lot?.variant || lot?.strain || "No variant"}
                          </div>
                        </div>
                        <div className="text-right text-sm shrink-0">
                          <div className="font-semibold">
                            {availableQuantity} available {meta.pieceLabelPlural}
                          </div>
                          <div className="text-zinc-500 dark:text-zinc-400 capitalize">
                            {getLotStatus(lot)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
                        <DetailStat label="Initial qty" value={`${Number(lot?.initialQuantity) || 0} ${getPackageUnitName(lot, meta)}`} />
                        <DetailStat label="Package runs" value={`${sourceRuns.length} run${sourceRuns.length === 1 ? "" : "s"}`} />
                        <DetailStat label="QC" value={qcSummary.status} />
                        <DetailStat label="Best by" value={shelfLife.bestBy || "—"} />
                        <DetailStat label="Lot code" value={lot?.lotCode || lot?.batchLot || "—"} />
                      </div>

                      <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                        Open full detail for reservations, QC, potency, costs, lineage, package creation, and batch actions.
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {selectedFinishedLot ? (() => {
            const lot = selectedFinishedLot;
            const meta = getProductTypeMeta(
              lot?.productType || lot?.finishedGoodType || lot?.lotType
            );

            return (
              <div
                className="fixed inset-0 z-[100] p-3 sm:p-6 overflow-y-auto backdrop-blur-xs"
                role="presentation"
                style={{ backgroundColor: "rgba(0, 0, 0, 0.82)" }}
                onMouseDown={() => setSelectedFinishedLotId("")}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="finished-inventory-detail-title"
                  className="mx-auto max-w-6xl rounded-2xl border shadow-2xl dark"
                  style={{
                    borderColor: "rgba(var(--accent-rgb), 0.45)",
                    backgroundColor: "rgba(8, 10, 18, 0.97)",
                    color: "#f4f4f5",
                    boxShadow: "0 24px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(var(--accent-rgb),0.18)",
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div
                    className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b backdrop-blur px-4 py-4 sm:px-5"
                    style={{
                      borderColor: "rgba(var(--accent-rgb), 0.35)",
                      background: "linear-gradient(135deg, rgba(var(--accent-rgb), 0.26), rgba(8, 10, 18, 0.98))",
                    }}
                  >
                    <div>
                      <div
                        id="finished-inventory-detail-title"
                        className="text-xl font-semibold"
                        style={{ color: "var(--accent-200)" }}
                      >
                        {lot?.name || `${meta.label} Lot`}
                      </div>
                      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        {meta.pluralLabel} · {lot?.variant || lot?.strain || "No variant"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFinishedLotId("")}
                      className="btn text-sm"
                    >
                      <X className="h-4 w-4" />
                      Close
                    </button>
                  </div>

                  <div className="p-4 sm:p-5 space-y-5">
                    <div className="grid grid-cols-2 xl:grid-cols-6 gap-3 text-sm">
                      <DetailStat
                        label="Initial qty"
                        value={`${Number(lot?.initialQuantity) || 0} ${getPackageUnitName(lot, meta)}`}
                      />
                      <DetailStat
                        label="Available"
                        value={`${Number(getLotAvailableQuantity(lot)) || 0} ${getPackageUnitName(lot, meta)}`}
                      />
                      <DetailStat label="Package size" value={getPackageSizeLabel(lot)} />
                      <DetailStat label="Lot code" value={lot?.lotCode || lot?.batchLot || "—"} />
                      <DetailStat label="Status" value={getLotStatus(lot)} />
                      <DetailStat
                        label="Source batch"
                        value={lot?.batchName || lot?.sourceBatchId || "—"}
                      />
                    </div>

                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                      <DetailStat label="Potency" value={getLotPotencySummary(lot)} />
                      <DetailStat label="QC" value={getLotQcSummary(lot).status} />
                      <DetailStat label="Best by" value={getShelfLifeSummary(lot).bestBy || "—"} />
                      <DetailStat label="Package date" value={lot?.package?.packagedDate || lot?.labelMetadata?.packDate || lot?.packDate || "Not packaged"} />
                    </div>

                    <LotInventoryControls
                      lot={lot}
                      today={today}
                      reservationForm={reservationForms[lot.id] || normalizeReservationForm(today)}
                      onReservationChange={(nextForm) =>
                        setReservationForms((prev) => ({ ...prev, [lot.id]: nextForm }))
                      }
                      onSaveReservation={() => handleSaveReservation(lot)}
                      onRemoveReservation={(reservationId) => handleRemoveReservation(lot, reservationId)}
                      thresholdValue={thresholdForms[lot.id]}
                      onThresholdChange={(value) =>
                        setThresholdForms((prev) => ({ ...prev, [lot.id]: value }))
                      }
                      onSaveThreshold={() => handleSaveThreshold(lot)}
                      reservationBusyId={reservationBusyId}
                      thresholdBusyId={thresholdBusyId}
                    />

                    {(lot?.productType === "tincture" ||
                      lot?.finishedGoodType === "tincture" ||
                      lot?.lotType === "tinctures") ? (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <DetailStat
                          label="Bottle size"
                          value={
                            lot?.bottleSize
                              ? `${lot.bottleSize} ${lot?.bottleSizeUnit || "mL"}`
                              : "—"
                          }
                        />
                        <DetailStat
                          label="mg per bottle"
                          value={Number(lot?.mgPerUnit) > 0 ? `${lot.mgPerUnit} mg` : "—"}
                        />
                      </div>
                    ) : null}

                    <CostRollupPanel record={lot} title="Stage cost rollup" />
                    <RecipeSnapshotPanel record={lot} />
                    <LotQualityPanel
                      lot={lot}
                      form={qualityForms[lot.id] || normalizeQualityForm(lot, today)}
                      onChange={(nextForm) =>
                        setQualityForms((prev) => ({ ...prev, [lot.id]: nextForm }))
                      }
                      onSave={() => handleSaveQuality(lot)}
                      busy={qualityBusyId === lot.id}
                    />

                    {renderPackageRunCreator(lot, meta)}
                  </div>
                </div>
              </div>
            );
          })() : null}
        </div>
      )}

      {activeTab === "sales" && (
        <div className="space-y-6">
          <SectionCard
            title="Sales and outbound tracking"
            defaultOpen={true}
            subtitle="Product-first sales view. Retail, sample, promo, and internal SKUs are grouped under the batch/product they came from so you are not sorting through one giant lot list."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <SummaryCard label="Products" value={String(salesProductGroups.length)} hint="Grouped product/batch cards" icon={Archive} />
              <SummaryCard label="Available packages" value={String(totalSaleReadyUnits)} hint="Current packaged inventory" icon={Tags} />
              <SummaryCard label="Units sold" value={String(totalSoldUnits)} hint="Completed sale quantity" icon={DollarSign} />
              <SummaryCard label="Units sampled" value={String(totalSampledUnits)} hint="Samples moved outbound" icon={Sparkles} />
              <SummaryCard label="Units destroyed" value={String(totalDestroyedUnits)} hint="Destroyed package quantity" icon={AlertTriangle} />
              <SummaryCard label="Realized revenue" value={money(totalRealizedRevenue)} hint="Revenue already recorded" icon={DollarSign} />
              <SummaryCard label="Remaining projected revenue" value={money(totalProjectedRevenue)} hint="Available packages × locked price" icon={BadgeDollarSign} />
            </div>

            {salesProductGroups.length === 0 ? (
              <EmptyState
                title="No packaged SKUs available for sales"
                body="Create package runs from Finished Inventory first. Retail and sample SKUs will appear here grouped by product and package size."
              />
            ) : (
              <div className="space-y-5">
                {salesProductGroups.map((product) => {
                  const productAvailable = product.lots.reduce((sum, lot) => sum + getLotAvailableQuantity(lot), 0);
                  const productSold = product.lots.reduce((sum, lot) => sum + getOutboundQuantity(lot, "sold"), 0);
                  const productDestroyed = product.lots.reduce((sum, lot) => sum + getOutboundQuantity(lot, "destroyed"), 0);
                  const productRevenue = product.lots.reduce((sum, lot) => sum + (Number(lot?.outboundSummary?.revenue || 0) || 0), 0);
                  const productProjectedRevenue = product.lots.reduce((sum, lot) => sum + getRemainingProjectedRevenue(lot), 0);
                  return (
                    <button
                      key={`sales-product-${product.key}`}
                      type="button"
                      onClick={() => setSelectedSalesProductKey(product.key)}
                      className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-left transition hover:border-purple-400 hover:bg-purple-50/40 dark:hover:border-purple-800 dark:hover:bg-purple-950/20"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-purple-700 dark:text-purple-300">{product.label}</div>
                          <div className="text-sm text-zinc-600 dark:text-zinc-400">
                            {product.variant || "No variant"} · {product.activeSkus.length} active SKU group{product.activeSkus.length === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="font-semibold">{productAvailable} packages available</div>
                          <div className="text-zinc-500 dark:text-zinc-400">
                            {productSold} sold · {productDestroyed} destroyed
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
                        <DetailStat label="Active SKU groups" value={String(product.activeSkus.length)} />
                        <DetailStat label="Available packages" value={String(productAvailable)} />
                        <DetailStat label="Sold" value={String(productSold)} />
                        <DetailStat label="Realized revenue" value={money(productRevenue)} />
                        <DetailStat label="Remaining projection" value={money(productProjectedRevenue)} />
                      </div>
                      <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                        Open full detail for SKU rows, FEFO package rotation, pricing, sales, samples, destroy, and adjustments.
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === "finished" && (
        <SectionCard
          title="Rework and repurpose"
          defaultOpen={false}
          subtitle="Use finished lots to create rework batches for relabeling, repackaging, salvage, or reformulation."
        >
          {activeFinishedGoodsLots.length === 0 ? (
            <EmptyState
              title="No finished lots available for rework"
              body="Create finished inventory first, then select the lots and quantities you want to rework."
            />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <label className="space-y-1 text-sm block">
                  <span className="text-zinc-600 dark:text-zinc-400">Rework batch name</span>
                  <input type="text" value={reworkForm.name} onChange={(e) => setReworkForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Optional auto name if left blank" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
                </label>
                <label className="space-y-1 text-sm block">
                  <span className="text-zinc-600 dark:text-zinc-400">Rework type</span>
                  <select value={reworkForm.reworkType} onChange={(e) => setReworkForm((prev) => ({ ...prev, reworkType: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                    <option value="rework">Rework</option>
                    <option value="relabel">Relabel</option>
                    <option value="repackage">Repackage</option>
                    <option value="salvage">Salvage</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm block">
                  <span className="text-zinc-600 dark:text-zinc-400">Product type</span>
                  <select value={reworkForm.productType} onChange={(e) => setReworkForm((prev) => ({ ...prev, productType: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                    <option value="capsule">Capsules</option>
                    <option value="gummy">Gummies</option>
                    <option value="tincture">Tinctures</option>
                    <option value="chocolate">Chocolates</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm block">
                  <span className="text-zinc-600 dark:text-zinc-400">Date</span>
                  <input type="date" value={reworkForm.date} onChange={(e) => setReworkForm((prev) => ({ ...prev, date: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
                </label>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
                  <div>
                    <div className="font-medium">Finished lots to consume</div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">Select the lots and quantities you want to pull into this rework batch.</div>
                  </div>
                  <div className="space-y-3 max-h-[26rem] overflow-y-auto pr-1">
                    {activeFinishedGoodsLots.map((lot) => {
                      const meta = getProductTypeMeta(lot?.productType || lot?.finishedGoodType || lot?.lotType);
                      const available = Number(getLotAvailableQuantity(lot)) || 0;
                      const value = reworkForm.lotQuantities?.[lot.id] ?? "";
                      return (
                        <div key={lot.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/30 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold">{lot?.name || lot.id}</div>
                              <div className="text-sm text-zinc-600 dark:text-zinc-400">{meta.pluralLabel} · {lot?.variant || lot?.strain || "No variant"}</div>
                            </div>
                            <div className="text-right text-sm">
                              <div className="font-semibold">{available} {meta.pieceLabelPlural}</div>
                              <div className="text-zinc-500 dark:text-zinc-400">available</div>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                            <label className="space-y-1 text-sm md:col-span-2">
                              <span className="text-zinc-600 dark:text-zinc-400">Units to consume</span>
                              <input type="number" inputMode="numeric" min="0" step="1" max={available || undefined} value={value} onChange={(e) => handleReworkLotQuantityChange(lot, e.target.value)} className={`w-full rounded-xl border bg-white dark:bg-zinc-900 px-3 py-2 ${consumptionWarnings[`rework:${lot.id}`] ? "border-rose-400 text-rose-900 dark:text-rose-100" : "border-zinc-300 dark:border-zinc-700"}`} placeholder={`0 to ${available}`} />{consumptionWarnings[`rework:${lot.id}`] ? (<div className="rounded-lg border border-rose-400/70 bg-rose-950/25 px-3 py-2 text-xs text-rose-200">{consumptionWarnings[`rework:${lot.id}`]}</div>) : null}
                            </label>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">Unit cost {money(getLotUnitCost(lot))}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
                  <div>
                    <div className="font-medium">Rework output</div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">Set the new finished output, expected salvage, and any packaging or relabel recipe you want to consume.</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Output count</span><input type="number" inputMode="numeric" min="0" step="1" value={reworkForm.outputCount} onChange={(e) => setReworkForm((prev) => ({ ...prev, outputCount: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Expected output</span><input type="number" inputMode="numeric" min="0" step="1" value={reworkForm.expectedOutputCount} onChange={(e) => setReworkForm((prev) => ({ ...prev, expectedOutputCount: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Variant</span><input type="text" value={reworkForm.variant} onChange={(e) => setReworkForm((prev) => ({ ...prev, variant: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">mg per unit</span><input type="number" inputMode="decimal" min="0" step="0.01" value={reworkForm.mgPerUnit} onChange={(e) => setReworkForm((prev) => ({ ...prev, mgPerUnit: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Recipe / packaging BOM</span><select value={reworkForm.recipeId} onChange={(e) => setReworkForm((prev) => ({ ...prev, recipeId: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"><option value="">No recipe selected</option>{recipes.slice().sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""))).map((recipe) => (<option key={recipe.id} value={recipe.id}>{recipe?.name || recipe.id}</option>))}</select></label>
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Waste qty</span><input type="number" inputMode="decimal" min="0" step="0.01" value={reworkForm.wasteQuantity} onChange={(e) => setReworkForm((prev) => ({ ...prev, wasteQuantity: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Waste unit</span><input type="text" value={reworkForm.wasteUnit} onChange={(e) => setReworkForm((prev) => ({ ...prev, wasteUnit: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                    <label className="space-y-1 text-sm block xl:col-span-2"><span className="text-zinc-600 dark:text-zinc-400">Waste reason</span><input type="text" value={reworkForm.wasteReason} onChange={(e) => setReworkForm((prev) => ({ ...prev, wasteReason: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Packaging cost</span><input type="number" inputMode="decimal" min="0" step="0.01" value={reworkForm.packagingCost} onChange={(e) => setReworkForm((prev) => ({ ...prev, packagingCost: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Labor cost</span><input type="number" inputMode="decimal" min="0" step="0.01" value={reworkForm.laborCost} onChange={(e) => setReworkForm((prev) => ({ ...prev, laborCost: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Overhead</span><input type="number" inputMode="decimal" min="0" step="0.01" value={reworkForm.overheadCost} onChange={(e) => setReworkForm((prev) => ({ ...prev, overheadCost: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                    <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Other cost</span><input type="number" inputMode="decimal" min="0" step="0.01" value={reworkForm.otherCost} onChange={(e) => setReworkForm((prev) => ({ ...prev, otherCost: e.target.value }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                  </div>
                  <label className="space-y-1 text-sm block"><span className="text-zinc-600 dark:text-zinc-400">Notes</span><textarea value={reworkForm.notes} onChange={(e) => setReworkForm((prev) => ({ ...prev, notes: e.target.value }))} rows={3} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" /></label>
                  <SupplyRequirementPanel snapshot={reworkSupplySnapshot} title="Rework packaging and ingredient requirements" emptyMessage="No recipe selected for rework, so no packaging or ingredient inventory will be consumed." />
                  <button onClick={handleCreateRework} disabled={reworkBusy} className="w-full btn btn-accent disabled:opacity-60 text-sm justify-center">{reworkBusy ? "Creating..." : "Create Rework Batch"}</button>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {activeTab === "history" && (
        <>
          <SectionCard
            title="Final disposition required"
            defaultOpen={true}
            subtitle="Expired, recalled, failed-QC, rejected, or inconsistent lots stay visible here until their remaining quantity is formally removed. Each action writes an inventory movement and preserves the lot history."
          >
            {finalDispositionRequiredLots.length === 0 ? (
              <EmptyState
                title="No lots awaiting final disposition"
                body="Blocked inventory will appear here when it needs a recorded destruction or other final removal."
              />
            ) : (
              <div className="space-y-4">
                {sortByNewest(finalDispositionRequiredLots).map((lot) => {
                  const dispositionState = getMaterialLotFinalDispositionState(lot, today);
                  const form = finalDispositionForms[lot.id] || getDefaultFinalDispositionForm(lot, today);
                  const available = getLotAvailableQuantity(lot);
                  const remaining = Number(lot?.remainingQuantity || 0);
                  const reserved = getLotReservedQuantity(lot);
                  const digits = getQtyDigits(lot?.unit || "units");
                  const busy = finalDispositionBusyId === lot.id;

                  return (
                    <div
                      key={lot.id}
                      className="rounded-2xl border border-rose-300/70 dark:border-rose-900/70 bg-rose-50/50 dark:bg-rose-950/10 p-4 space-y-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{lot?.name || lot.id}</div>
                          <div className="text-sm text-rose-700 dark:text-rose-200">
                            {dispositionState.reasonLabel || "Final disposition required"}
                          </div>
                          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                            {lot?.lotType || lot?.inventoryCategory || "material lot"} · {lot?.strain || lot?.variant || lot?.sourceGrowId || "No source label"}
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="font-semibold">
                            {formatQty(available, lot?.unit || "units", digits)} available
                          </div>
                          <div className="text-zinc-500 dark:text-zinc-400">
                            {formatQty(remaining, lot?.unit || "units", digits)} remaining
                          </div>
                          {reserved > 0 ? (
                            <div className="text-amber-700 dark:text-amber-300">
                              {formatQty(reserved, lot?.unit || "units", digits)} reserved
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                        <label className="space-y-1 text-sm">
                          <span className="text-zinc-600 dark:text-zinc-400">Quantity</span>
                          <input
                            type="number"
                            min="0"
                            step={digits === 0 ? "1" : "0.01"}
                            max={available || undefined}
                            value={form.quantity}
                            onChange={(e) =>
                              setFinalDispositionForms((prev) => ({
                                ...prev,
                                [lot.id]: { ...form, quantity: e.target.value },
                              }))
                            }
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2"
                          />
                        </label>

                        <label className="space-y-1 text-sm">
                          <span className="text-zinc-600 dark:text-zinc-400">Date</span>
                          <input
                            type="date"
                            value={form.date}
                            onChange={(e) =>
                              setFinalDispositionForms((prev) => ({
                                ...prev,
                                [lot.id]: { ...form, date: e.target.value },
                              }))
                            }
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2"
                          />
                        </label>

                        <label className="space-y-1 text-sm">
                          <span className="text-zinc-600 dark:text-zinc-400">Method</span>
                          <select
                            value={form.method}
                            onChange={(e) =>
                              setFinalDispositionForms((prev) => ({
                                ...prev,
                                [lot.id]: { ...form, method: e.target.value },
                              }))
                            }
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2"
                          >
                            <option value="discarded">Discarded</option>
                            <option value="expired">Expired inventory</option>
                            <option value="failed_qc">Failed QC / potency</option>
                            <option value="recall">Recall / removal</option>
                            <option value="compromised">Compromised material</option>
                            <option value="other">Other</option>
                          </select>
                        </label>

                        <label className="space-y-1 text-sm md:col-span-2 xl:col-span-2">
                          <span className="text-zinc-600 dark:text-zinc-400">Reason *</span>
                          <input
                            type="text"
                            value={form.reason}
                            onChange={(e) =>
                              setFinalDispositionForms((prev) => ({
                                ...prev,
                                [lot.id]: { ...form, reason: e.target.value },
                              }))
                            }
                            placeholder="Required final-disposition reason"
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
                        <label className="space-y-1 text-sm">
                          <span className="text-zinc-600 dark:text-zinc-400">Notes</span>
                          <input
                            type="text"
                            value={form.note}
                            onChange={(e) =>
                              setFinalDispositionForms((prev) => ({
                                ...prev,
                                [lot.id]: { ...form, note: e.target.value },
                              }))
                            }
                            placeholder="Optional handling, witness, or disposal notes"
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => handleFinalDisposition(lot)}
                          disabled={busy || available <= 0}
                          className="rounded-xl border border-rose-500/70 bg-rose-950 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-900 disabled:opacity-50"
                        >
                          {busy ? "Recording..." : "Destroy selected quantity"}
                        </button>
                      </div>

                      {reserved > 0 ? (
                        <div className="rounded-xl border border-amber-300/70 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                          Reserved quantity is protected. Release the reservation before disposing more than the currently available amount.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Depleted / archived lots"
            defaultOpen={false}
            subtitle="Fully consumed source lots and depleted finished goods are removed from active inventory and listed here for traceability."
          >
            {depletedOrArchivedMaterialLots.length === 0 ? (
              <EmptyState
                title="No depleted lots yet"
                body="Fully consumed dry lots, extract lots, and finished goods will appear here once their available quantity reaches zero or they are archived."
              />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <DetailStat label="Dry lots" value={String(depletedDryLots.length)} />
                  <DetailStat label="Extract lots" value={String(depletedExtractLots.length)} />
                  <DetailStat label="Finished lots" value={String(depletedFinishedGoodsLots.length)} />
                  <DetailStat label="Total history lots" value={String(depletedOrArchivedMaterialLots.length)} />
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {sortByNewest(depletedOrArchivedMaterialLots).map((lot) => (
                    <div
                      key={lot.id}
                      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{lot?.name || lot.id}</div>
                          <div className="text-sm text-zinc-600 dark:text-zinc-400">
                            {lot?.lotType || lot?.inventoryCategory || "lot"} · {lot?.strain || lot?.variant || lot?.sourceGrowId || "No source label"}
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="font-semibold">
                            {formatQty(getLotAvailableQuantity(lot), lot?.unit || "units", getQtyDigits(lot?.unit || "units"))}
                          </div>
                          <div className="text-zinc-500 dark:text-zinc-400 capitalize">
                            {getLotStatus(lot)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                        <DetailStat label="Initial" value={formatQty(lot?.initialQuantity, lot?.unit || "units", getQtyDigits(lot?.unit || "units"))} />
                        <DetailStat label="Allocated" value={formatQty(lot?.allocatedQuantity, lot?.unit || "units", getQtyDigits(lot?.unit || "units"))} />
                        <DetailStat label="Unit cost" value={money(getLotUnitCost(lot))} />
                        <DetailStat label="Updated" value={lot?.updatedDate || lot?.createdDate || "—"} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Inventory movement ledger"
            defaultOpen={true}
            subtitle="Every intake, consumption, output creation, and finished-goods movement lands in one auditable ledger."
          >
            {movements.length === 0 ? (
              <EmptyState
                title="No movement history yet"
                body="As you intake dry material, run extractions, create production batches, and move finished goods outbound, the ledger will build here."
              />
            ) : (
              <div className="space-y-3">
                {movements.map((movement) => {
                  const movementLot = materialLotById.get(movement?.lotId) || null;
                  const movementLotLabel =
                    movementLot?.lotCode ||
                    movementLot?.batchLot ||
                    movementLot?.name ||
                    movement?.lotId ||
                    "—";
                  const movementBatchLabel =
                    movementLot?.batchName ||
                    movementLot?.sourceBatchId ||
                    movement?.batchId ||
                    "—";
                  const movementRevenue = Number(
                    movement?.revenue ?? movement?.totalValue ?? 0
                  ) || 0;
                  const movementUnitPrice = Number(movement?.pricePerUnit || 0) || 0;

                  return (
                  <div
                    key={movement.id}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold capitalize">
                          {formatMovementType(movement?.movementType || "movement")}
                        </div>
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                          {movement?.processCategory || movement?.processType || "inventory"} ·{" "}
                          {movement?.date || "—"}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-semibold">
                          {movement?.quantity != null
                            ? `${movement.quantity} ${movement?.unit || "units"}`
                            : "—"}
                        </div>
                        <div className="text-zinc-500 dark:text-zinc-400 capitalize">
                          {movement?.direction || "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                      <DetailStat label="Lot / package" value={movementLotLabel} />
                      <DetailStat label="Source batch" value={movementBatchLabel} />
                      <DetailStat
                        label="Source type"
                        value={movement?.sourceType || movement?.referenceType || "—"}
                      />
                      <DetailStat
                        label="Destination"
                        value={movement?.destinationName || movement?.counterparty || "—"}
                      />
                      <DetailStat
                        label="Price / package"
                        value={movementUnitPrice > 0 ? money(movementUnitPrice) : "—"}
                      />
                      <DetailStat
                        label="Revenue / value"
                        value={movementRevenue > 0 ? money(movementRevenue) : "—"}
                      />
                      <DetailStat
                        label="Default price"
                        value={Number(movement?.defaultPricePerUnit || 0) > 0 ? money(movement.defaultPricePerUnit) : "—"}
                      />
                      <DetailStat
                        label="Price override memo"
                        value={movement?.priceOverride?.reason || movement?.priceOverrideReason || "—"}
                      />
                      {movement?.fefoOverride?.applied || movement?.inventoryRotation?.overrideApplied ? (
                        <>
                          <DetailStat
                            label="FEFO override reason"
                            value={movement?.fefoOverride?.reason || movement?.inventoryRotation?.overrideReason || "—"}
                          />
                          <DetailStat
                            label="Skipped package"
                            value={`${movement?.fefoOverride?.skippedLotCode || movement?.inventoryRotation?.skippedLotCode || movement?.fefoOverride?.skippedLotId || movement?.inventoryRotation?.skippedLotId || "—"} · Best by ${movement?.fefoOverride?.skippedBestBy || movement?.inventoryRotation?.skippedBestBy || "—"}`}
                          />
                          <DetailStat
                            label="Selected package best by"
                            value={movement?.fefoOverride?.selectedBestBy || movement?.inventoryRotation?.selectedBestBy || "—"}
                          />
                        </>
                      ) : null}
                    </div>

                    {movement?.note || movement?.reason || movement?.destinationName || movement?.counterparty || movement?.destinationLocation || movement?.fefoOverride?.reason || movement?.inventoryRotation?.overrideReason ? (
                      <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                        {[
                          movement?.destinationType ? `${formatDestinationType(movement.destinationType)}: ${movement?.destinationName || movement?.counterparty || "—"}` : movement?.destinationName || movement?.counterparty,
                          movement?.destinationLocation,
                          movement?.reason,
                          movement?.fefoOverride?.reason || movement?.inventoryRotation?.overrideReason
                            ? `FEFO override: ${movement?.fefoOverride?.reason || movement?.inventoryRotation?.overrideReason}`
                            : "",
                          movement?.note,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    ) : null}
                  </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {selectedDryLot ? (
        <PostProcessDetailModal
          title={selectedDryLot?.name || selectedDryLot.id}
          subtitle={`${selectedDryLot?.strain || "Unknown strain"} · ${selectedDryLot?.growLabel || selectedDryLot?.sourceGrowId || "Unknown source"}`}
          onClose={() => setSelectedDryLotId("")}
        >
          {renderLotDetailPanel(selectedDryLot, { unitFallback: "g" })}
        </PostProcessDetailModal>
      ) : null}

      {selectedExtractLot ? (
        <PostProcessDetailModal
          title={selectedExtractLot?.name || selectedExtractLot.id}
          subtitle={`${selectedExtractLot?.extractionType || "extract"} · ${selectedExtractLot?.strain || "Unknown strain"}`}
          onClose={() => setSelectedExtractLotId("")}
        >
          {renderLotDetailPanel(selectedExtractLot, { unitFallback: "mL" })}
        </PostProcessDetailModal>
      ) : null}

      {selectedExtractionBatch ? (
        <PostProcessDetailModal
          title={selectedExtractionBatch?.name || selectedExtractionBatch.id}
          subtitle={`Extraction batch · ${selectedExtractionBatch?.date || "No date"}`}
          onClose={() => setSelectedExtractionBatchId("")}
        >
          {renderExtractionBatchDetail(selectedExtractionBatch)}
        </PostProcessDetailModal>
      ) : null}

      {selectedProductionBatch ? (
        <PostProcessDetailModal
          title={selectedProductionBatch?.name || "Production batch"}
          subtitle={`${getProductTypeMeta(selectedProductionBatch?.productType).pluralLabel} · ${selectedProductionBatch?.date || "No date"}`}
          onClose={() => setSelectedProductionBatchId("")}
        >
          {renderProductionBatchDetail(selectedProductionBatch)}
        </PostProcessDetailModal>
      ) : null}

      {selectedSalesProductGroup ? (
        <PostProcessDetailModal
          title={selectedSalesProductGroup.label}
          subtitle={`${selectedSalesProductGroup.variant || "No variant"} · ${selectedSalesProductGroup.skus.length} SKU group${selectedSalesProductGroup.skus.length === 1 ? "" : "s"}`}
          onClose={() => setSelectedSalesProductKey("")}
        >
          {renderSalesProductDetail(selectedSalesProductGroup)}
        </PostProcessDetailModal>
      ) : null}

    </div>
  );
}
