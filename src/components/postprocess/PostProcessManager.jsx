// src/components/postprocess/PostProcessManager.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
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
  getProcessBatchStatus,
  getProductTypeMeta,
  getRecipeSnapshot,
  isActiveMaterialLot,
  isActiveProcessBatch,
  isFinishedGoodsLot,
  isLowStockLot,
  parseAnyDate,
  recordFinishedInventoryMovement,
  toLocalYYYYMMDD,
} from "../../lib/postprocess";

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

function chipClass(active) {
  return `chip ${active ? "chip--active" : ""}`;
}

function formatBatchStatus(status) {
  return String(status || "planned").replace(/_/g, " ");
}

function SectionCard({ title, subtitle, action, children }) {
  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {subtitle ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
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

function WorkflowStep({ number, title, body, done, next }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-start gap-3">
        <div
          className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold ${
            done
              ? "accent-bg"
              : next
                ? "accent-bg"
                : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
          }`}
        >
          {number}
        </div>
        <div>
          <div className="font-semibold flex items-center gap-2">
            <span>{title}</span>
            {done ? <span className="text-xs accent-text">Done</span> : null}
            {!done && next ? <span className="text-xs accent-text">Next</span> : null}
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

function formatTotalsByUnit(items = []) {
  const totals = {};
  (Array.isArray(items) ? items : []).forEach((item) => {
    const unit = String(item?.unit || "").trim() || "units";
    const value = Number(item?.total ?? item?.quantity ?? 0) || 0;
    totals[unit] = (totals[unit] || 0) + value;
  });

  const parts = Object.entries(totals).map(([unit, total]) => {
    const digits = unit === "count" ? 0 : 2;
    return formatQty(total, unit, digits);
  });

  return parts.join(" · ");
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
  const bestBy = shelfLife?.bestBy || shelfLife?.bestByDate || "";
  const expirationDate = shelfLife?.expirationDate || shelfLife?.expiresOn || "";
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
    bestBy: shelf.bestBy || "",
    expirationDate: shelf.expirationDate || "",
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
          <div>Best by: {shelfSummary.bestBy || shelfSummary.expirationDate || "—"}</div>
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

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-3 text-sm">
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">Made on</span>
          <input
            type="date"
            value={form.madeOn}
            onChange={(e) => onChange({ ...form, madeOn: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">Best by</span>
          <input
            type="date"
            value={form.bestBy}
            onChange={(e) => onChange({ ...form, bestBy: e.target.value })}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-zinc-600 dark:text-zinc-400">Expiration</span>
          <input
            type="date"
            value={form.expirationDate}
            onChange={(e) => onChange({ ...form, expirationDate: e.target.value })}
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

export default function PostProcessManager({ grows = [] }) {
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
  const [movementBusyId, setMovementBusyId] = useState("");
  const [pricingBusyId, setPricingBusyId] = useState("");
  const [reservationBusyId, setReservationBusyId] = useState("");
  const [thresholdBusyId, setThresholdBusyId] = useState("");
  const [qualityBusyId, setQualityBusyId] = useState("");

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
    outputCount: "",
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
  });


  const [reworkForm, setReworkForm] = useState(() => normalizeReworkForm(today));

  const [finalizeForms, setFinalizeForms] = useState({});
  const [movementForms, setMovementForms] = useState({});
  const [pricingForms, setPricingForms] = useState({});
  const [reservationForms, setReservationForms] = useState({});
  const [thresholdForms, setThresholdForms] = useState({});
  const [qualityForms, setQualityForms] = useState({});

  useEffect(() => {
    if (focusFinishedLotId) {
      setActiveTab("finished");
      return;
    }
    if (focusGrowId) {
      setActiveTab("dry");
    }
  }, [focusFinishedLotId, focusGrowId]);

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

  const availableDryLots = useMemo(
    () => activeDryLots.filter((lot) => getLotAvailableQuantity(lot) > 0),
    [activeDryLots]
  );

  const availableProductionSourceLots = useMemo(
    () =>
      [...activeDryLots, ...activeExtractLots].filter(
        (lot) => getLotAvailableQuantity(lot) > 0
      ),
    [activeDryLots, activeExtractLots]
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
        outputUnit: "count",
      }),
    [availableProductionSourceLots, selectedProductionLots, productionForm.outputCount]
  );

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
  const totalFinishedUnits = activeFinishedGoodsLots.reduce(
    (sum, lot) => sum + getLotAvailableQuantity(lot),
    0
  );
  const totalProjectedRevenue = activeFinishedGoodsLots.reduce(
    (sum, lot) => sum + (Number(lot?.pricing?.projectedRevenue || 0) || 0),
    0
  );
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

  const batchesNeedingAttention = pendingExtractionOutputs.length + activeProductionBatches.filter((batch) => {
    const status = getProcessBatchStatus(batch);
    return status === "planned" || status === "in_progress";
  }).length;

  const nextAction = !dryLots.length
    ? "dry"
    : pendingExtractionOutputs.length > 0
      ? "finalize"
      : !activeExtractLots.length
        ? "extraction"
        : !activeProductionBatches.length
          ? "production"
          : !activeFinishedGoodsLots.length
            ? "finished"
            : "finished";

  function resetExtractionForm() {
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
      outputCount: "",
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
    });
  }


  function resetReworkForm() {
    setReworkForm(normalizeReworkForm(today));
  }

  async function handleCreateDryLot(grow) {
    if (!userId || !grow?.id) return;
    try {
      setBusyGrowId(grow.id);
      setMessage("");
      const result = await createDryLotFromGrow({ userId, grow });
      setMessage(
        result?.created
          ? `Created dry lot for ${getGrowLabel(grow)}.`
          : `Dry lot already exists for ${getGrowLabel(grow)}.`
      );
    } catch (error) {
      setMessage(error?.message || "Failed to create dry lot.");
    } finally {
      setBusyGrowId("");
    }
  }

  async function handleCreateExtraction() {
    if (!userId) return;
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

  async function handleCreateProduction() {
    if (!userId) return;
    if (productionSupplySnapshot?.blockingShortages?.length > 0) {
      const labels = productionSupplySnapshot.blockingShortages
        .slice(0, 4)
        .map((entry) => `${entry.supplyName} (${formatQty(entry.shortageQuantity, entry.unit, entry.unit === "count" ? 0 : 2)} short)`)
        .join(", ");
      setMessage(`Resolve packaging or ingredient shortages before creating this batch: ${labels}.`);
      return;
    }
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
        mgPerUnit: productionForm.mgPerUnit,
        inputLots: selectedProductionLots.map((lot) => ({
          lotId: lot.id,
          quantity: lot.selectedQuantity,
        })),
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
        pricePerUnit: productionForm.pricePerUnit,
        msrpPerUnit: Number(productionForm.msrpPerUnit) || productionMsrpSuggestion,
        desiredMarginPercent: productionForm.desiredMarginPercent,
        bottleSize: productionForm.bottleSize,
        bottleSizeUnit: productionForm.bottleSizeUnit,
      });
      const meta = getProductTypeMeta(result?.productType || productionForm.productType);
      setMessage(
        `Created ${meta.label.toLowerCase()} production batch ${result?.name || ""}.`.trim()
      );
      resetProductionForm();
      setActiveTab("finished");
    } catch (error) {
      setMessage(error?.message || "Failed to create production batch.");
    } finally {
      setProductionBusy(false);
    }
  }


  async function handleCreateRework() {
    if (!userId) return;
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

  async function handleSaveLotPricing(lot) {
    if (!userId || !lot?.id) return;
    const draft = pricingForms[lot.id] || {
      pricePerUnit: String(lot?.pricePerUnit ?? lot?.pricing?.pricePerUnit ?? ""),
      msrpPerUnit: String(lot?.msrpPerUnit ?? lot?.pricing?.suggestedMsrpPerUnit ?? ""),
    };

    const pricePerUnit = Math.max(0, Number(draft.pricePerUnit) || 0);
    const msrpPerUnit = Math.max(0, Number(draft.msrpPerUnit) || 0);
    const unitCost = getLotUnitCost(lot);
    const quantity = Number(getLotAvailableQuantity(lot) || 0) || 0;
    const pricing = buildPricingPreview({ unitCost, pricePerUnit, msrpPerUnit, quantity });

    try {
      setPricingBusyId(lot.id);
      setMessage("");
      await updateDoc(doc(db, "users", userId, "materialLots", lot.id), {
        pricePerUnit,
        msrpPerUnit,
        pricing,
        updatedDate: today,
      });
      setMessage(`Updated pricing for ${lot?.name || lot.id}.`);
    } catch (error) {
      setMessage(error?.message || "Failed to save pricing.");
    } finally {
      setPricingBusyId("");
    }
  }

  async function handleFinishedMovement(lot) {
    if (!userId || !lot?.id) return;
    const form = movementForms[lot.id] || normalizeMovementForm(today);
    try {
      setMovementBusyId(lot.id);
      setMessage("");
      await recordFinishedInventoryMovement({
        userId,
        lotId: lot.id,
        movementType: form.movementType,
        quantity: form.quantity,
        direction: form.direction,
        date: form.date,
        note: form.note,
        unitPrice: form.unitPrice,
        counterparty: form.destinationName || form.counterparty,
        reason: form.reason,
        destinationType: form.destinationType,
        destinationName: form.destinationName,
        destinationLocation: form.destinationLocation,
      });
      setMessage(`${formatMovementType(form.movementType)} recorded for ${lot?.name || lot.id}.`);
      setMovementForms((prev) => ({
        ...prev,
        [lot.id]: normalizeMovementForm(today),
      }));
    } catch (error) {
      setMessage(error?.message || "Failed to record finished inventory movement.");
    } finally {
      setMovementBusyId("");
    }
  }

  async function handleSaveReservation(lot) {
    if (!userId || !lot?.id) return;
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
          madeOn: form.madeOn || today,
          bestBy: form.bestBy || "",
          expirationDate: form.expirationDate || "",
          storageCondition: form.storageCondition || "",
          storageNotes: form.storageNotes || "",
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

  const tabs = [
    { id: "dry", label: "Dry Material", icon: Package },
    { id: "extractions", label: "Extractions", icon: FlaskConical },
    { id: "production", label: "Production", icon: Factory },
    { id: "finished", label: "Finished Inventory", icon: Archive },
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
            production batch, then completed batches land in finished inventory for outbound
            tracking, pricing, margin review, and label printing.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
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
          <span className="font-medium">Expiring soon:</span> {expiringSoonLots.length} active lot{expiringSoonLots.length === 1 ? "" : "s"} reach best-by or expiration within 30 days.
        </div>
      ) : null}

      <SectionCard
        title="Manufacturing chain"
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
            {nextAction === "finalize" ? (
              <button
                onClick={() => setActiveTab("extractions")}
                className="btn text-sm"
              >
                Record Extract Output
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
          </div>
        }
      >
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <WorkflowStep
            number="1"
            title="Dry Intake"
            body="Every harvested grow with dry weight becomes a dry-material lot that preserves remaining grams for downstream use."
            done={dryLots.length > 0}
            next={nextAction === "dry"}
          />
          <WorkflowStep
            number="2"
            title="Extraction"
            body="Consume dry material into extraction batches and record method, source lots, and audit movements."
            done={extractionBatches.length > 0}
            next={nextAction === "extraction"}
          />
          <WorkflowStep
            number="3"
            title="Extract Output"
            body="An extraction only becomes usable for production once an extract lot is created with a real output quantity."
            done={pendingExtractionOutputs.length === 0 && extractionBatches.length > 0}
            next={nextAction === "finalize"}
          />
          <WorkflowStep
            number="4"
            title="Production"
            body="Make capsules, gummies, tinctures, or chocolates from dry lots or extract lots and capture batch cost."
            done={productionBatches.length > 0}
            next={nextAction === "production"}
          />
          <WorkflowStep
            number="5"
            title="Finished Inventory"
            body="Sell, donate, sample, waste, or adjust finished goods separately from manufacturing while keeping pricing and margin visible."
            done={finishedGoodsLots.length > 0}
            next={nextAction === "finished"}
          />
        </div>
      </SectionCard>

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
          label="Pending outputs"
          value={String(pendingExtractionOutputs.length)}
          hint="Need final yield"
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
          label="Finished units"
          value={String(totalFinishedUnits)}
          hint="Sellable active inventory"
          icon={Sparkles}
        />
        <SummaryCard
          label="Batches needing action"
          value={String(batchesNeedingAttention)}
          hint="Pending outputs or active runs"
          icon={ArrowRight}
        />
        <SummaryCard
          label="Revenue logged"
          value={money(totalRealizedRevenue)}
          hint="Sold outbound value"
          icon={DollarSign}
        />
      </div>

      {activeTab === "dry" && (
        <div className="space-y-6">
          <SectionCard
            title="Ready for intake"
            subtitle="Harvested grows with dry weight and no dry-material lot yet."
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
            subtitle="Only active usable dry lots are shown here. Depleted or archived dry lots live in the Archive tab."
          >
            {activeDryLots.length === 0 ? (
              <EmptyState
                title="No active dry lots"
                body="Create a dry-material lot from a harvested grow first, or review depleted dry lots in the Archive tab."
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
                        <div className="text-lg font-semibold">{lot?.name || lot.id}</div>
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

                    <div className="mt-4">
                      <CostRollupPanel record={lot} title="Stage cost rollup" />
                    </div>

                    <LotQualityPanel
                      lot={lot}
                      form={qualityForms[lot.id] || normalizeQualityForm(lot, today)}
                      onChange={(nextForm) =>
                        setQualityForms((prev) => ({ ...prev, [lot.id]: nextForm }))
                      }
                      onSave={() => handleSaveQuality(lot)}
                      busy={qualityBusyId === lot.id}
                    />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === "extractions" && (
        <div className="space-y-6">
          <SectionCard
            title="Create extraction batch"
            subtitle="Consume dry lots into a dry powder or liquid extraction batch. Completed batches can create an extract lot immediately."
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
                      onChange={(e) =>
                        setExtractionForm((prev) => ({
                          ...prev,
                          extractionType: e.target.value,
                        }))
                      }
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
                                  onChange={(e) =>
                                    setExtractionForm((prev) => ({
                                      ...prev,
                                      lotQuantities: {
                                        ...prev.lotQuantities,
                                        [lot.id]: e.target.value,
                                      },
                                    }))
                                  }
                                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                                  placeholder={`0 to ${remaining}`}
                                />
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
                          onChange={(e) =>
                            setExtractionForm((prev) => ({
                              ...prev,
                              outputAmount: e.target.value,
                            }))
                          }
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
                          <option value="oz">oz</option>
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
                        Selected input: {formatTotalsByUnit(selectedExtractionLots) || "None"}
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

          {pendingExtractionOutputs.length > 0 ? (
            <SectionCard
              title="Pending extract outputs"
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
                      className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold">{batch?.name || batch.id}</div>
                          <div className="text-sm text-zinc-600 dark:text-zinc-400">
                            {batch?.date || "—"} ·{" "}
                            {formatTotalsByUnit(batch?.inputLots || []) || "No source quantity"}
                          </div>
                        </div>
                        <div className="text-sm font-semibold capitalize">
                          {formatBatchStatus(getProcessBatchStatus(batch))}
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                        <label className="space-y-1 text-sm block">
                          <span className="text-zinc-600 dark:text-zinc-400">Output amount</span>
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
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                          />
                        </label>

                        <label className="space-y-1 text-sm block">
                          <span className="text-zinc-600 dark:text-zinc-400">Output unit</span>
                          <select
                            value={form.outputUnit}
                            onChange={(e) =>
                              setFinalizeForms((prev) => ({
                                ...prev,
                                [batch.id]: { ...form, outputUnit: e.target.value },
                              }))
                            }
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                          >
                            <option value="mL">mL</option>
                            <option value="g">g</option>
                            <option value="oz">oz</option>
                          </select>
                        </label>

                        <label className="space-y-1 text-sm block">
                          <span className="text-zinc-600 dark:text-zinc-400">Yield percent</span>
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
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                          />
                        </label>

                        <label className="space-y-1 text-sm block">
                          <span className="text-zinc-600 dark:text-zinc-400">Date</span>
                          <input
                            type="date"
                            value={form.date}
                            onChange={(e) =>
                              setFinalizeForms((prev) => ({
                                ...prev,
                                [batch.id]: { ...form, date: e.target.value },
                              }))
                            }
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                          />
                        </label>

                        <div className="flex items-end">
                          <button
                            onClick={() => handleFinalizeExtraction(batch)}
                            disabled={finalizeBusyId === batch.id}
                            className="w-full rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white px-4 py-2 text-sm"
                          >
                            {finalizeBusyId === batch.id ? "Saving..." : "Create Extract Lot"}
                          </button>
                        </div>
                      </div>

                      <label className="mt-3 space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Notes</span>
                        <textarea
                          value={form.notes}
                          onChange={(e) =>
                            setFinalizeForms((prev) => ({
                              ...prev,
                              [batch.id]: { ...form, notes: e.target.value },
                            }))
                          }
                          rows={3}
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Extract lots"
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
                        <div className="text-lg font-semibold">{lot?.name || lot.id}</div>
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

                    <div className="mt-4">
                      <CostRollupPanel record={lot} title="Stage cost rollup" />
                    </div>

                    <LotQualityPanel
                      lot={lot}
                      form={qualityForms[lot.id] || normalizeQualityForm(lot, today)}
                      onChange={(nextForm) =>
                        setQualityForms((prev) => ({ ...prev, [lot.id]: nextForm }))
                      }
                      onSave={() => handleSaveQuality(lot)}
                      busy={qualityBusyId === lot.id}
                    />
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === "production" && (
        <div className="space-y-6">
          <SectionCard
            title="Create production batch"
            subtitle="Production consumes dry material or extract lots and creates finished inventory for capsules, gummies, tinctures, or chocolates."
            action={
              <Link
                to="/?tab=labels&labelSource=finished_goods"
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Labels Tab
              </Link>
            }
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
                      onChange={(e) =>
                        setProductionForm((prev) => ({
                          ...prev,
                          productType: e.target.value,
                        }))
                      }
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
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold">{lot?.name || lot.id}</div>
                                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                                  {lotType === "extract" ? "Extract" : "Dry material"} ·{" "}
                                  {lot?.strain || "Unknown strain"} ·{" "}
                                  {lot?.growLabel ||
                                    lot?.batchName ||
                                    lot?.sourceGrowId ||
                                    lot?.sourceBatchId ||
                                    "Unknown source"}
                                </div>
                              </div>
                              <div className="text-right text-sm">
                                <div className="font-semibold">
                                  {formatQty(
                                    remaining,
                                    lot?.unit || (lotType === "extract" ? "mL" : "g")
                                  )}
                                </div>
                                <div className="text-zinc-500 dark:text-zinc-400">remaining</div>
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
                                  onChange={(e) =>
                                    setProductionForm((prev) => ({
                                      ...prev,
                                      lotQuantities: {
                                        ...prev.lotQuantities,
                                        [lot.id]: e.target.value,
                                      },
                                    }))
                                  }
                                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                                  placeholder={`0 to ${remaining}`}
                                />
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
                        Link an optional recipe for BOM-style supply costing, then set pricing so
                        finished inventory already has unit economics.
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Output count</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          step="1"
                          value={productionForm.outputCount}
                          onChange={(e) =>
                            setProductionForm((prev) => ({
                              ...prev,
                              outputCount: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>

                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">mg per unit</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={productionForm.mgPerUnit}
                          onChange={(e) =>
                            setProductionForm((prev) => ({
                              ...prev,
                              mgPerUnit: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>
                    </div>

                    {productionForm.productType === "tincture" ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="space-y-1 text-sm block">
                          <span className="text-zinc-600 dark:text-zinc-400">Bottle size</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={productionForm.bottleSize}
                            onChange={(e) =>
                              setProductionForm((prev) => ({
                                ...prev,
                                bottleSize: e.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                          />
                        </label>

                        <label className="space-y-1 text-sm block">
                          <span className="text-zinc-600 dark:text-zinc-400">Bottle unit</span>
                          <select
                            value={productionForm.bottleSizeUnit}
                            onChange={(e) =>
                              setProductionForm((prev) => ({
                                ...prev,
                                bottleSizeUnit: e.target.value,
                              }))
                            }
                            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                          >
                            <option value="mL">mL</option>
                            <option value="oz">oz</option>
                          </select>
                        </label>
                      </div>
                    ) : null}

                    <label className="space-y-1 text-sm block">
                      <span className="text-zinc-600 dark:text-zinc-400">Variant / SKU note</span>
                      <input
                        type="text"
                        value={productionForm.variant}
                        onChange={(e) =>
                          setProductionForm((prev) => ({
                            ...prev,
                            variant: e.target.value,
                          }))
                        }
                        placeholder="Example: 250 mg gummy or 2 oz amber bottle"
                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                      />
                    </label>

                    <label className="space-y-1 text-sm block">
                      <span className="text-zinc-600 dark:text-zinc-400">Recipe / BOM</span>
                      <select
                        value={productionForm.recipeId}
                        onChange={(e) =>
                          setProductionForm((prev) => ({
                            ...prev,
                            recipeId: e.target.value,
                          }))
                        }
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
                        <span className="text-zinc-600 dark:text-zinc-400">Packaging cost</span>
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

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Price per unit</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={productionForm.pricePerUnit}
                          onChange={(e) =>
                            setProductionForm((prev) => ({
                              ...prev,
                              pricePerUnit: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>

                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">Target margin %</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="1"
                          max="95"
                          step="1"
                          value={productionForm.desiredMarginPercent}
                          onChange={(e) =>
                            setProductionForm((prev) => ({
                              ...prev,
                              desiredMarginPercent: e.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>

                      <label className="space-y-1 text-sm block">
                        <span className="text-zinc-600 dark:text-zinc-400">MSRP per unit</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={productionForm.msrpPerUnit}
                          onChange={(e) =>
                            setProductionForm((prev) => ({
                              ...prev,
                              msrpPerUnit: e.target.value,
                            }))
                          }
                          placeholder={
                            productionMsrpSuggestion ? String(productionMsrpSuggestion) : "Auto"
                          }
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                        />
                      </label>
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
                    <div className="font-medium">Pricing preview</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <DetailStat
                        label="Suggested MSRP"
                        value={money(productionPricingPreview.suggestedMsrpPerUnit)}
                      />
                      <DetailStat
                        label="Price per unit"
                        value={money(productionPricingPreview.pricePerUnit)}
                      />
                      <DetailStat
                        label="Margin per unit"
                        value={money(productionPricingPreview.marginPerUnit)}
                      />
                      <DetailStat
                        label="Margin %"
                        value={`${productionPricingPreview.marginPercent.toFixed(2)}%`}
                      />
                      <DetailStat
                        label="Projected revenue"
                        value={money(productionPricingPreview.projectedRevenue)}
                      />
                      <DetailStat
                        label="Projected profit"
                        value={money(productionPricingPreview.projectedProfit)}
                      />
                    </div>

                    <button
                      onClick={handleCreateProduction}
                      disabled={productionBusy}
                      className="w-full btn btn-accent disabled:opacity-60 text-sm justify-center"
                    >
                      {productionBusy ? "Creating..." : "Create Production Batch"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Production batches"
            subtitle="These are your manufacturing runs. Completed runs create finished goods lots that move into Finished Inventory."
          >
            {activeProductionBatches.length === 0 ? (
              <EmptyState
                title="No active production batches"
                body="Completed production runs move into Finished Inventory and the Archive tab. Only active or in-progress manufacturing runs stay here."
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
                          <div className="text-lg font-semibold">
                            {batch?.name || `${meta.label} Batch`}
                          </div>
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

                      <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="font-medium mb-2">Consumed source lots</div>
                          <div className="space-y-2">
                            {(batch?.inputLots || []).map((lot) => (
                              <div
                                key={`${batch.id}-${lot.lotId}`}
                                className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <div className="font-semibold">
                                      {lot?.lotName || lot?.lotId}
                                    </div>
                                    <div className="text-zinc-500 dark:text-zinc-400">
                                      {String(lot?.lotType || "").replace(/_/g, " ")} ·{" "}
                                      {lot?.growLabel ||
                                        lot?.sourceBatchId ||
                                        lot?.sourceGrowId ||
                                        "Unknown source"}
                                    </div>
                                  </div>
                                  <div className="font-semibold">
                                    {formatQty(lot?.quantity, lot?.unit || "g")}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <div className="font-medium mb-2">Cost stack</div>
                            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 grid grid-cols-2 gap-3">
                              <DetailStat
                                label="Source material"
                                value={money(batch?.inputMaterialCostTotal || 0)}
                              />
                              <DetailStat
                                label="Recipe / BOM"
                                value={money(batch?.recipeBatchCostTotal || batch?.recipeCost || 0)}
                              />
                              <DetailStat
                                label="Direct cost"
                                value={money(batch?.directCostTotal || batch?.directCost || 0)}
                              />
                              <DetailStat
                                label="Projected profit"
                                value={money(batch?.pricing?.projectedProfit || 0)}
                              />
                            </div>
                          </div>
                          <CostRollupPanel record={batch} title="Stage cost rollup" />
                          <RecipeSnapshotPanel record={batch} />
                          <div>
                            <div className="font-medium mb-2">Notes</div>
                            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap min-h-[88px]">
                              {batch?.notes || batch?.variant || "No notes recorded."}
                            </div>
                          </div>
                        </div>
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
            subtitle="Completed production lots live here for pricing, labels, and outbound inventory actions."
            action={
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/?tab=labels&labelSource=finished_goods"
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
                value={String(activeFinishedGoodsLots.length)}
                hint="Completed sellable active lots"
                icon={Archive}
              />
              <SummaryCard
                label="Projected revenue"
                value={money(totalProjectedRevenue)}
                hint="If active priced lots all sold"
                icon={BadgeDollarSign}
              />
              <SummaryCard
                label="Realized revenue"
                value={money(totalRealizedRevenue)}
                hint="Sold outbound records"
                icon={DollarSign}
              />
              <SummaryCard
                label="Label-ready"
                value={String(activeFinishedGoodsLots.length)}
                hint="Active finished lots"
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
                hint="Best by or expiration within 30 days"
                icon={AlertTriangle}
              />
            </div>

            {activeFinishedGoodsLots.length === 0 ? (
              <EmptyState
                title="No active finished inventory"
                body="Once a completed production batch is created, its output lot will appear here. Depleted lots move to the Archive tab."
              />
            ) : (
              <div className="space-y-4">
                {activeFinishedGoodsLots.map((lot) => {
                  const meta = getProductTypeMeta(
                    lot?.productType || lot?.finishedGoodType || lot?.lotType
                  );
                  const movementForm = movementForms[lot.id] || normalizeMovementForm(today);
                  const pricingForm = pricingForms[lot.id] || {
                    pricePerUnit: String(lot?.pricePerUnit ?? lot?.pricing?.pricePerUnit ?? ""),
                    msrpPerUnit: String(
                      lot?.msrpPerUnit ?? lot?.pricing?.suggestedMsrpPerUnit ?? ""
                    ),
                  };
                  const livePricingPreview = buildPricingPreview({
                    unitCost: getLotUnitCost(lot),
                    pricePerUnit: Number(pricingForm.pricePerUnit) || 0,
                    msrpPerUnit: Number(pricingForm.msrpPerUnit) || 0,
                    quantity: Number(getLotAvailableQuantity(lot) || 0) || 0,
                  });
                  const outboundSummary = lot?.outboundSummary || {};
                  const isFocusedFinishedLot = focusFinishedLotId === lot.id;

                  return (
                    <div
                      key={lot.id}
                      id={`finished-lot-${lot.id}`}
                      className={`rounded-2xl border bg-white dark:bg-zinc-900 p-4 space-y-4 ${
                        isFocusedFinishedLot
                          ? "accent-selected"
                          : "border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold">
                            {lot?.name || `${meta.label} Lot`}
                          </div>
                          <div className="text-sm text-zinc-600 dark:text-zinc-400">
                            {meta.pluralLabel} · {lot?.variant || lot?.strain || "No variant"}
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div className="font-semibold">
                            {Number(getLotAvailableQuantity(lot)) || 0} available {meta.pieceLabelPlural}
                          </div>
                          <div className="text-zinc-500 dark:text-zinc-400 capitalize">
                            {getLotStatus(lot)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3 text-sm">
                        <DetailStat
                          label="Initial qty"
                          value={`${Number(lot?.initialQuantity) || 0} ${meta.pieceLabelPlural}`}
                        />
                        <DetailStat label="Unit cost" value={money(getLotUnitCost(lot))} />
                        <DetailStat
                          label="Price / unit"
                          value={money(lot?.pricePerUnit || lot?.pricing?.pricePerUnit || 0)}
                        />
                        <DetailStat
                          label="MSRP"
                          value={money(
                            lot?.msrpPerUnit || lot?.pricing?.suggestedMsrpPerUnit || 0
                          )}
                        />
                        <DetailStat
                          label="Revenue logged"
                          value={money(outboundSummary?.revenue || 0)}
                        />
                        <DetailStat
                          label="Source batch"
                          value={lot?.batchName || lot?.sourceBatchId || "—"}
                        />
                      </div>

                      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                        <DetailStat label="Potency" value={getLotPotencySummary(lot)} />
                        <DetailStat label="QC" value={getLotQcSummary(lot).status} />
                        <DetailStat label="Best by" value={getShelfLifeSummary(lot).bestBy || "—"} />
                        <DetailStat label="Expiration" value={getShelfLifeSummary(lot).expirationDate || "—"} />
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

                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                          <div className="font-medium">Pricing and margin</div>
                          <div className="grid grid-cols-2 gap-3">
                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">
                                Price per unit
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                value={pricingForm.pricePerUnit}
                                onChange={(e) =>
                                  setPricingForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...pricingForm,
                                      pricePerUnit: e.target.value,
                                    },
                                  }))
                                }
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              />
                            </label>

                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">
                                MSRP per unit
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                value={pricingForm.msrpPerUnit}
                                onChange={(e) =>
                                  setPricingForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...pricingForm,
                                      msrpPerUnit: e.target.value,
                                    },
                                  }))
                                }
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              />
                            </label>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <DetailStat
                              label="Margin per unit"
                              value={money(livePricingPreview.marginPerUnit)}
                            />
                            <DetailStat
                              label="Margin %"
                              value={`${livePricingPreview.marginPercent.toFixed(2)}%`}
                            />
                            <DetailStat
                              label="Projected revenue"
                              value={money(livePricingPreview.projectedRevenue)}
                            />
                            <DetailStat
                              label="Projected profit"
                              value={money(livePricingPreview.projectedProfit)}
                            />
                          </div>

                          <button
                            onClick={() => handleSaveLotPricing(lot)}
                            disabled={pricingBusyId === lot.id}
                            className="rounded-lg btn-accent disabled:opacity-60 px-4 py-2 text-sm"
                          >
                            {pricingBusyId === lot.id ? "Saving..." : "Save Pricing"}
                          </button>
                        </div>

                        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                          <div className="font-medium">Outbound inventory actions</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Action</span>
                              <select
                                value={movementForm.movementType}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      movementType: e.target.value,
                                      direction:
                                        e.target.value === "adjustment"
                                          ? movementForm.direction
                                          : "out",
                                    },
                                  }))
                                }
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              >
                                <option value="sell">Sell</option>
                                <option value="donate">Donate</option>
                                <option value="sample">Sample</option>
                                <option value="waste">Waste</option>
                                <option value="adjustment">Manual adjustment</option>
                              </select>
                            </label>

                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Direction</span>
                              <select
                                value={movementForm.direction}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      direction: e.target.value,
                                    },
                                  }))
                                }
                                disabled={movementForm.movementType !== "adjustment"}
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-60"
                              >
                                <option value="out">Out</option>
                                <option value="in">In</option>
                              </select>
                            </label>

                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Quantity</span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="1"
                                value={movementForm.quantity}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      quantity: e.target.value,
                                    },
                                  }))
                                }
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              />
                            </label>

                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Unit price</span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                value={movementForm.unitPrice}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      unitPrice: e.target.value,
                                    },
                                  }))
                                }
                                disabled={movementForm.movementType !== "sell"}
                                placeholder={String(
                                  lot?.pricePerUnit || lot?.pricing?.pricePerUnit || ""
                                )}
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-60"
                              />
                            </label>

                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Date</span>
                              <input
                                type="date"
                                value={movementForm.date}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      date: e.target.value,
                                    },
                                  }))
                                }
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              />
                            </label>

                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Destination type</span>
                              <select
                                value={movementForm.destinationType}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      destinationType: e.target.value,
                                    },
                                  }))
                                }
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              >
                                <option value="customer">Customer</option>
                                <option value="donation">Donation target</option>
                                <option value="event">Event</option>
                                <option value="wholesale">Wholesale</option>
                                <option value="internal">Internal use</option>
                                <option value="other">Other</option>
                              </select>
                            </label>

                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Destination name</span>
                              <input
                                type="text"
                                value={movementForm.destinationName}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      destinationName: e.target.value,
                                      counterparty: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="Customer, store, event, donation target"
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              />
                            </label>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Destination location</span>
                              <input
                                type="text"
                                value={movementForm.destinationLocation}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      destinationLocation: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="Optional city, booth, clinic, etc."
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              />
                            </label>

                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Reason</span>
                              <input
                                type="text"
                                value={movementForm.reason}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      reason: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="Optional reason"
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              />
                            </label>

                            <label className="space-y-1 text-sm block">
                              <span className="text-zinc-600 dark:text-zinc-400">Note</span>
                              <input
                                type="text"
                                value={movementForm.note}
                                onChange={(e) =>
                                  setMovementForms((prev) => ({
                                    ...prev,
                                    [lot.id]: {
                                      ...movementForm,
                                      note: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="Optional note"
                                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                              />
                            </label>
                          </div>

                          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
                            <DetailStat label="Sold" value={String(outboundSummary?.sold || 0)} />
                            <DetailStat
                              label="Donated"
                              value={String(outboundSummary?.donated || 0)}
                            />
                            <DetailStat
                              label="Sampled"
                              value={String(outboundSummary?.sampled || 0)}
                            />
                            <DetailStat
                              label="Wasted"
                              value={String(outboundSummary?.wasted || 0)}
                            />
                            <DetailStat
                              label="Adjusted"
                              value={`+${Number(outboundSummary?.adjustedIn || 0)} / -${Number(
                                outboundSummary?.adjustedOut || 0
                              )}`}
                            />
                          </div>

                          <button
                            onClick={() => handleFinishedMovement(lot)}
                            disabled={movementBusyId === lot.id}
                            className="btn btn-accent disabled:opacity-60 text-sm"
                          >
                            {movementBusyId === lot.id
                              ? "Recording..."
                              : "Record Outbound Movement"}
                          </button>
                        </div>
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
        <SectionCard
          title="Rework and repurpose"
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
                              <input type="number" inputMode="numeric" min="0" step="1" max={available || undefined} value={value} onChange={(e) => setReworkForm((prev) => ({ ...prev, lotQuantities: { ...prev.lotQuantities, [lot.id]: e.target.value } }))} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" placeholder={`0 to ${available}`} />
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
        <SectionCard
          title="Inventory history"
          subtitle="Every intake, consumption, output creation, and finished-goods movement lands in one auditable ledger."
        >
          {movements.length === 0 ? (
            <EmptyState
              title="No movement history yet"
              body="As you intake dry material, run extractions, create production batches, and move finished goods outbound, the ledger will build here."
            />
          ) : (
            <div className="space-y-3">
              {movements.map((movement) => (
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
                    <DetailStat label="Lot ID" value={movement?.lotId || "—"} />
                    <DetailStat label="Batch ID" value={movement?.batchId || "—"} />
                    <DetailStat
                      label="Source type"
                      value={movement?.sourceType || movement?.referenceType || "—"}
                    />
                    <DetailStat
                      label="Destination"
                      value={movement?.destinationName || movement?.counterparty || "—"}
                    />
                    <DetailStat
                      label="Value"
                      value={movement?.totalValue ? money(movement.totalValue) : "—"}
                    />
                  </div>

                  {movement?.note || movement?.reason || movement?.destinationName || movement?.counterparty || movement?.destinationLocation ? (
                    <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                      [
                        movement?.destinationType ? `${formatDestinationType(movement.destinationType)}: ${movement?.destinationName || movement?.counterparty || "—"}` : movement?.destinationName || movement?.counterparty,
                        movement?.destinationLocation,
                        movement?.reason,
                        movement?.note,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
