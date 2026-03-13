// src/pages/Archive.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  serverTimestamp,
  deleteField,
} from "firebase/firestore";
import { db, auth } from "../firebase-config";
import {
  Box,
  Recycle,
  AlertTriangle,
  X,
  ShieldAlert,
  ShieldCheck,
  Tag,
  GitBranch,
  FlaskConical,
  Package,
  Factory,
} from "lucide-react";
import { isArchivedish, normalizeStage, normalizeType } from "../lib/growFilters";
import {
  formatQty,
  getLotStatus,
  getProcessBatchStatus,
  isArchivedOrDepletedMaterialLot,
  isArchivedProcessBatch,
  isFinishedGoodsLot,
  getYieldMetrics,
  getTraceabilitySnapshot,
  getLotWorkflowState,
  isLotBlockedForUse,
  getLabelMetadataSnapshot,
  getShelfLifeAction,
  buildPostProcessReworkAnalytics,
} from "../lib/postprocess";

/* ---------------- UI bits ---------------- */
function Row({ children, className = "" }) {
  return (
    <div
      className={
        "px-4 py-3 flex items-start justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 " +
        className
      }
    >
      {children}
    </div>
  );
}

function StatText({ label, value }) {
  return (
    <span className="text-xs text-zinc-500">
      {label}: <span className="text-zinc-700 dark:text-zinc-200">{value}</span>
    </span>
  );
}

function SectionHeader({ title, count, icon: Icon = Box }) {
  return (
    <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
      <Icon className="w-5 h-5 opacity-80" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className="ml-auto text-xs text-zinc-500">{count}</span>
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="px-4 py-6 text-sm text-zinc-500">{text}</div>;
}

function SummaryCard({ label, value, hint, icon: Icon = Box }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Icon className="w-4 h-4" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div> : null}
    </div>
  );
}

function DetailPill({ children, tone = "default" }) {
  const toneClass =
    tone === "danger"
      ? "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200"
      : tone === "warning"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
        : tone === "success"
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
          : tone === "info"
            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";

  return <span className={`px-2 py-1 rounded-full text-[11px] font-medium ${toneClass}`}>{children}</span>;
}

function formatMoney(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getSortDateMs(record = {}) {
  const candidates = [
    record?.updatedAt,
    record?.createdAt,
    record?.archivedAt,
    record?.archivedOn,
    record?.updatedDate,
    record?.createdDate,
    record?.date,
    record?.harvestedDate,
  ];

  for (const value of candidates) {
    if (!value) continue;

    if (typeof value?.toDate === "function") {
      const ms = value.toDate()?.getTime?.();
      if (Number.isFinite(ms)) return ms;
    }

    if (value instanceof Date) {
      const ms = value.getTime();
      if (Number.isFinite(ms)) return ms;
    }

    if (typeof value === "number") {
      const ms = value < 100000000000 ? value * 1000 : value;
      if (Number.isFinite(ms)) return ms;
    }

    const parsed = new Date(String(value)).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

function sortNewestFirst(items = []) {
  return [...items].sort((a, b) => getSortDateMs(b) - getSortDateMs(a));
}

function titleCaseStatus(value = "") {
  const raw = String(value || "").replaceAll("_", " ").trim();
  if (!raw) return "Unknown";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatCompactList(values = []) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return "—";
  if (list.length <= 3) return list.join(", ");
  return `${list.slice(0, 3).join(", ")} +${list.length - 3} more`;
}

function getWorkflowTone(workflow) {
  if (workflow?.recalled) return "danger";
  if (workflow?.quarantined || workflow?.qcHold) return "warning";
  if (workflow?.releaseRequired && workflow?.releaseStatus === "released") return "success";
  if (workflow?.releaseRequired) return "info";
  return "default";
}

function getShelfLifeTone(action) {
  if (action === "do_not_sell" || action === "expired") return "danger";
  if (action === "hold" || action === "expiring_soon") return "warning";
  if (action === "discount_candidate" || action === "donation_priority") return "info";
  return "default";
}

/* ---------------- Modal ---------------- */
function UnarchiveModal({ grow, onClose, onSubmit }) {
  const normType = normalizeType(grow?.growType);
  const prevStage = normalizeStage(grow?.stage);
  const isBulk = normType === "Bulk";

  const defaultStage =
    prevStage === "Consumed"
      ? isBulk
        ? "Harvested"
        : "Colonized"
      : prevStage || (isBulk ? "Colonizing" : "Inoculated");

  const [amount, setAmount] = useState(grow?.amountAvailable ?? 0);
  const [unit] = useState(grow?.amountUnit || grow?.volumeUnit || (isBulk ? "g" : "ml"));
  const [stage, setStage] = useState(defaultStage);
  const [status, setStatus] = useState("Active");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const stageOptions =
    normType === "Bulk"
      ? ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"]
      : ["Inoculated", "Colonizing", "Colonized"];

  const mustRequireAmount = Number(grow?.amountAvailable || 0) <= 0;

  function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    const nAmt = Number(amount);
    if (mustRequireAmount && !(nAmt > 0)) {
      setErr("This grow was archived at 0. Enter a positive amount to activate it.");
      return;
    }

    const stageNorm = normalizeStage(stage);
    let nextStage = stage;
    if (nAmt > 0 && stageNorm === "Consumed") {
      nextStage = isBulk ? "Harvested" : "Colonized";
    }

    onSubmit({
      amountAvailable: Number.isFinite(nAmt) ? nAmt : 0,
      stage: nextStage,
      status,
      unarchiveNote: note,
      unit,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl max-w-lg w-full overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="font-semibold">Unarchive Grow</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 text-sm space-y-3">
          <p className="text-zinc-600 dark:text-zinc-300">
            Move this grow back to the active list. Confirm the details below.
          </p>

          <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 space-y-1">
            <div className="font-medium">{grow?.abbreviation || grow?.id}</div>
            <div className="text-xs text-zinc-500">
              {grow?.growType} — {grow?.strain}
            </div>
            <div className="flex flex-wrap gap-3 mt-1">
              <StatText label="Previous stage" value={grow?.stage || "—"} />
              <StatText label="Previous status" value={grow?.status || "Archived"} />
              <StatText
                label="Remaining"
                value={`${grow?.amountAvailable ?? 0} ${grow?.amountUnit || grow?.volumeUnit || ""}`}
              />
            </div>
          </div>

          {mustRequireAmount ? (
            <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-xs">
              Archived at 0 remaining. Enter the corrected amount to re-activate it.
            </div>
          ) : (
            <div className="text-xs text-zinc-500">Adjust the remaining amount if needed.</div>
          )}

          <label className="block text-xs font-medium">Remaining amount</label>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={mustRequireAmount ? 0.00001 : 0}
              required={mustRequireAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 ${
                mustRequireAmount ? "ring-1 ring-amber-300" : ""
              }`}
            />
            <span className="px-2 py-2 rounded bg-zinc-100 dark:bg-zinc-800 text-xs">{unit}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium">Stage</label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
              >
                {stageOptions.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
              >
                <option>Active</option>
                <option>Stored</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
              placeholder="Why are you unarchiving? e.g., data entry correction"
            />
          </div>

          {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
        </div>

        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700"
          >
            Cancel
          </button>
          <button type="submit" className="px-3 py-1.5 rounded-full accent-bg text-white">
            Confirm Unarchive
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Archive rows ---------------- */
function ArchivedLotRow({ lot, label }) {
  const status = titleCaseStatus(getLotStatus(lot));
  const remaining = Number(lot?.remainingQuantity || 0);
  const initial = Number(lot?.initialQuantity || 0);
  const unit = lot?.unit || (isFinishedGoodsLot(lot) ? "count" : "g");
  const workflow = getLotWorkflowState(lot);
  const blocked = isLotBlockedForUse(lot, isFinishedGoodsLot(lot) ? "label" : "general");
  const trace = getTraceabilitySnapshot(lot);
  const yieldMetrics = getYieldMetrics(lot);
  const labelMeta = getLabelMetadataSnapshot(lot);
  const shelfAction = getShelfLifeAction(lot);

  return (
    <Row>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-mono text-sm truncate">{lot?.name || lot?.id}</div>
          <DetailPill>{label}</DetailPill>
          <DetailPill tone={getWorkflowTone(workflow)}>
            {workflow?.recalled
              ? "Recalled"
              : workflow?.quarantined
                ? "Quarantined"
                : workflow?.qcHold
                  ? "QC Hold"
                  : workflow?.releaseRequired
                    ? workflow?.releaseStatus === "released"
                      ? "Released"
                      : `Release ${titleCaseStatus(workflow.releaseStatus)}`
                    : status}
          </DetailPill>
          {blocked ? <DetailPill tone="warning">Blocked</DetailPill> : null}
          {labelMeta?.lotCode ? <DetailPill tone="info">Lot {labelMeta.lotCode}</DetailPill> : null}
          {shelfAction && shelfAction !== "normal" ? (
            <DetailPill tone={getShelfLifeTone(shelfAction)}>{titleCaseStatus(shelfAction)}</DetailPill>
          ) : null}
        </div>

        <div className="text-xs text-zinc-500">
          {lot?.strain ? `${lot.strain} — ` : ""}
          {status}
          {" · "}Remaining: {formatQty(remaining, unit, unit === "count" ? 0 : 2)} / {formatQty(initial, unit, unit === "count" ? 0 : 2)}
          {lot?.variant ? ` · ${lot.variant}` : ""}
        </div>

        <div className="flex flex-wrap gap-2">
          {workflow?.holdReason ? <StatText label="Hold reason" value={workflow.holdReason} /> : null}
          {workflow?.recallReason ? <StatText label="Recall reason" value={workflow.recallReason} /> : null}
          {workflow?.quarantineReason ? <StatText label="Quarantine reason" value={workflow.quarantineReason} /> : null}
          {labelMeta?.packDate ? <StatText label="Pack date" value={labelMeta.packDate} /> : null}
          {labelMeta?.bestBy ? <StatText label="Best by" value={labelMeta.bestBy} /> : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 text-xs text-zinc-500">
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950/40 p-2">
            <div className="font-medium text-zinc-700 dark:text-zinc-200 mb-1">Traceability</div>
            <div>Sources: {formatCompactList(trace?.sourceLotIds)}</div>
            <div>Derived: {formatCompactList(trace?.derivedLotIds)}</div>
            <div>Batches: {formatCompactList(trace?.batchIds)}</div>
          </div>

          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950/40 p-2">
            <div className="font-medium text-zinc-700 dark:text-zinc-200 mb-1">Yield + waste</div>
            <div>
              Actual: {yieldMetrics?.actualQuantity ? formatQty(yieldMetrics.actualQuantity, yieldMetrics.actualUnit || unit, yieldMetrics.actualUnit === "count" ? 0 : 2) : "—"}
            </div>
            <div>
              Waste: {yieldMetrics?.wasteQuantity ? formatQty(yieldMetrics.wasteQuantity, yieldMetrics.wasteUnit || unit, yieldMetrics.wasteUnit === "count" ? 0 : 2) : "—"}
            </div>
            <div>Variance: {yieldMetrics?.variancePercent != null ? `${yieldMetrics.variancePercent}%` : "—"}</div>
          </div>

          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950/40 p-2">
            <div className="font-medium text-zinc-700 dark:text-zinc-200 mb-1">Label metadata</div>
            <div>Ingredients: {labelMeta?.ingredients?.length || 0}</div>
            <div>Allergens: {labelMeta?.allergens?.length || 0}</div>
            <div>Warnings: {labelMeta?.warnings?.length || 0}</div>
          </div>
        </div>
      </div>
    </Row>
  );
}

function ArchivedBatchRow({ batch }) {
  const status = titleCaseStatus(getProcessBatchStatus(batch));
  const processType = String(batch?.processType || "").toLowerCase();
  const processLabel =
    processType === "extraction"
      ? "Extraction"
      : processType === "rework"
        ? "Rework"
        : "Production";
  const yieldMetrics = getYieldMetrics(batch);
  const trace = getTraceabilitySnapshot(batch);

  return (
    <Row>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-mono text-sm truncate">{batch?.name || batch?.id}</div>
          <DetailPill>{processLabel}</DetailPill>
          <DetailPill tone={status.toLowerCase().includes("completed") || status.toLowerCase().includes("archived") ? "success" : "default"}>
            {status}
          </DetailPill>
          {batch?.outputLotId ? <DetailPill tone="info">Output created</DetailPill> : null}
          {processType === "rework" ? <DetailPill tone="warning">Repurpose flow</DetailPill> : null}
        </div>

        <div className="text-xs text-zinc-500 truncate">
          {batch?.productType ? `${titleCaseStatus(batch.productType)} — ` : ""}
          {batch?.strains?.length ? `${batch.strains.join(", ")} · ` : ""}
          {batch?.date || batch?.createdDate || "—"}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 text-xs text-zinc-500">
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950/40 p-2">
            <div className="font-medium text-zinc-700 dark:text-zinc-200 mb-1">Yield + waste</div>
            <div>
              Expected: {yieldMetrics?.expectedQuantity ? formatQty(yieldMetrics.expectedQuantity, yieldMetrics.expectedUnit || batch?.outputUnit || batch?.unit || "count", (yieldMetrics.expectedUnit || batch?.outputUnit || batch?.unit) === "count" ? 0 : 2) : "—"}
            </div>
            <div>
              Actual: {yieldMetrics?.actualQuantity ? formatQty(yieldMetrics.actualQuantity, yieldMetrics.actualUnit || batch?.outputUnit || batch?.unit || "count", (yieldMetrics.actualUnit || batch?.outputUnit || batch?.unit) === "count" ? 0 : 2) : "—"}
            </div>
            <div>
              Waste: {yieldMetrics?.wasteQuantity ? formatQty(yieldMetrics.wasteQuantity, yieldMetrics.wasteUnit || batch?.outputUnit || batch?.unit || "count", (yieldMetrics.wasteUnit || batch?.outputUnit || batch?.unit) === "count" ? 0 : 2) : "—"}
            </div>
            <div>Variance: {yieldMetrics?.variancePercent != null ? `${yieldMetrics.variancePercent}%` : "—"}</div>
          </div>

          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950/40 p-2">
            <div className="font-medium text-zinc-700 dark:text-zinc-200 mb-1">Traceability</div>
            <div>Source lots: {formatCompactList(trace?.sourceLotIds)}</div>
            <div>Derived lots: {formatCompactList(trace?.derivedLotIds)}</div>
            <div>Batch links: {formatCompactList(trace?.batchIds)}</div>
          </div>

          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950/40 p-2">
            <div className="font-medium text-zinc-700 dark:text-zinc-200 mb-1">Cost + output</div>
            <div>Batch total: {formatMoney(batch?.batchTotalCost || batch?.costs?.batchTotalCost || 0)}</div>
            <div>Unit cost: {formatMoney(batch?.unitCost || batch?.costs?.unitCost || 0)}</div>
            <div>Output lot: {batch?.outputLotId || "—"}</div>
          </div>
        </div>
      </div>
    </Row>
  );
}

/* ---------------- Page ---------------- */
export default function Archive({ grows: growsProp, onUpdateGrow }) {
  const [growsLocal, setGrowsLocal] = useState(Array.isArray(growsProp) ? growsProp : []);
  const [materialLots, setMaterialLots] = useState([]);
  const [processBatches, setProcessBatches] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (Array.isArray(growsProp)) setGrowsLocal(growsProp);
  }, [growsProp]);

  useEffect(() => {
    if (Array.isArray(growsProp)) return;
    const u = auth.currentUser;
    if (!u) return;

    const unsub = onSnapshot(collection(db, "users", u.uid, "grows"), (snap) => {
      setGrowsLocal(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => unsub();
  }, [growsProp]);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;

    const unsub = onSnapshot(collection(db, "users", u.uid, "materialLots"), (snap) => {
      setMaterialLots(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;

    const unsub = onSnapshot(collection(db, "users", u.uid, "processBatches"), (snap) => {
      setProcessBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => unsub();
  }, []);

  const archivedGrows = useMemo(
    () => sortNewestFirst(Array.isArray(growsLocal) ? growsLocal.filter(isArchivedish) : []),
    [growsLocal]
  );

  const archivedDryLots = useMemo(
    () =>
      sortNewestFirst(
        materialLots.filter(
          (lot) =>
            String(lot?.lotType || "").toLowerCase() === "dry_material" &&
            isArchivedOrDepletedMaterialLot(lot)
        )
      ),
    [materialLots]
  );

  const archivedExtractLots = useMemo(
    () =>
      sortNewestFirst(
        materialLots.filter(
          (lot) =>
            String(lot?.lotType || "").toLowerCase() === "extract" &&
            isArchivedOrDepletedMaterialLot(lot)
        )
      ),
    [materialLots]
  );

  const archivedFinishedLots = useMemo(
    () =>
      sortNewestFirst(
        materialLots.filter((lot) => isFinishedGoodsLot(lot) && isArchivedOrDepletedMaterialLot(lot))
      ),
    [materialLots]
  );

  const archivedExtractionBatches = useMemo(
    () =>
      sortNewestFirst(
        processBatches.filter(
          (batch) =>
            String(batch?.processType || "").toLowerCase() === "extraction" &&
            isArchivedProcessBatch(batch)
        )
      ),
    [processBatches]
  );

  const archivedProductionBatches = useMemo(
    () =>
      sortNewestFirst(
        processBatches.filter(
          (batch) =>
            String(batch?.processType || "").toLowerCase() === "production" &&
            isArchivedProcessBatch(batch)
        )
      ),
    [processBatches]
  );

  const archivedReworkBatches = useMemo(
    () =>
      sortNewestFirst(
        processBatches.filter(
          (batch) =>
            String(batch?.processType || "").toLowerCase() === "rework" &&
            isArchivedProcessBatch(batch)
        )
      ),
    [processBatches]
  );

  const blockedArchivedLots = useMemo(
    () =>
      [...archivedDryLots, ...archivedExtractLots, ...archivedFinishedLots].filter((lot) =>
        isLotBlockedForUse(lot, isFinishedGoodsLot(lot) ? "label" : "general")
      ),
    [archivedDryLots, archivedExtractLots, archivedFinishedLots]
  );

  const recalledArchivedLots = useMemo(
    () =>
      [...archivedDryLots, ...archivedExtractLots, ...archivedFinishedLots].filter(
        (lot) => getLotWorkflowState(lot)?.recalled
      ),
    [archivedDryLots, archivedExtractLots, archivedFinishedLots]
  );

  const archivedReworkSummary = useMemo(
    () => buildPostProcessReworkAnalytics({ processBatches: archivedReworkBatches }),
    [archivedReworkBatches]
  );

  async function unarchiveGrow(grow, changes) {
    const u = auth.currentUser;
    if (!u || !grow?.id) return;

    const amtAvail = Number.isFinite(Number(changes.amountAvailable))
      ? Number(changes.amountAvailable)
      : Number(grow.amountAvailable || 0);

    const next = {
      status: changes.status || "Active",
      stage: changes.stage || grow.stage || "Inoculated",
      amountAvailable: amtAvail,
      updatedAt: serverTimestamp(),
      unarchiveNote: changes.unarchiveNote || "",
      archived: deleteField(),
      archivedAt: deleteField(),
      archivedOn: deleteField(),
      isArchived: deleteField(),
      inArchive: deleteField(),
    };

    const total = Number(grow.amountTotal);
    const hasNewModel = Number.isFinite(total) && total > 0;
    const unit = changes.unit || grow.amountUnit || grow.volumeUnit || "";

    if (hasNewModel) {
      next.amountTotal = total;
      next.amountUsed = Math.max(0, total - amtAvail);
      next.amountUnit = unit;
    } else if (amtAvail > 0) {
      next.amountTotal = amtAvail;
      next.amountUsed = 0;
      next.amountUnit = unit;
    }

    if (normalizeStage(next.stage) !== "Consumed") {
      next.consumedAt = deleteField();
    }

    if (typeof onUpdateGrow === "function") {
      await onUpdateGrow(grow.id, next);
    } else {
      await updateDoc(doc(db, "users", u.uid, "grows", grow.id), next);
    }

    setGrowsLocal((prev) =>
      prev.map((g) =>
        g.id === grow.id
          ? {
              ...g,
              ...next,
              archived: false,
              archivedAt: null,
              archivedOn: null,
              isArchived: false,
              inArchive: null,
            }
          : g
      )
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
        <SummaryCard label="Archived grows" value={String(archivedGrows.length)} hint="Grows and consumed records" icon={Recycle} />
        <SummaryCard label="Archived lots" value={String(archivedDryLots.length + archivedExtractLots.length + archivedFinishedLots.length)} hint="Dry, extract, and finished" icon={Package} />
        <SummaryCard label="Archived batches" value={String(archivedExtractionBatches.length + archivedProductionBatches.length + archivedReworkBatches.length)} hint="Extraction, production, rework" icon={Factory} />
        <SummaryCard label="Blocked archived lots" value={String(blockedArchivedLots.length)} hint="Hold, quarantine, recall, pending release" icon={ShieldAlert} />
        <SummaryCard label="Recalled lots" value={String(recalledArchivedLots.length)} hint="Archived lots under recall" icon={AlertTriangle} />
        <SummaryCard label="Rework batches" value={String(archivedReworkSummary?.totalBatches || 0)} hint={`${archivedReworkSummary?.totalOutputCount || 0} output · ${archivedReworkSummary?.totalWasteQuantity || 0} waste`} icon={GitBranch} />
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <SectionHeader title="Archived Grows" count={`${archivedGrows.length} archived/consumed grows`} icon={Recycle} />

        {archivedGrows.length === 0 ? (
          <EmptyState text="No archived grows." />
        ) : (
          <div>
            {archivedGrows.map((g) => {
              const st = normalizeStage(g?.stage);
              const statusRaw = String(g?.status || "");
              const isArchived = statusRaw.toLowerCase() === "archived" || !!g?.archivedAt;
              const label = isArchived ? "Archived" : st || "Archived";

              return (
                <Row key={g.id}>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm truncate">{g.abbreviation || g.id}</div>
                    <div className="text-xs text-zinc-500 truncate">
                      {g.growType} — {g.strain} — {label}
                      {" · "}Remaining: {g.amountAvailable ?? 0} {g.amountUnit || g.volumeUnit || ""}
                    </div>
                  </div>
                  <button
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full accent-bg text-white"
                    onClick={() => setSelected(g)}
                    title="Unarchive"
                  >
                    <Recycle className="w-4 h-4" />
                    Unarchive
                  </button>
                </Row>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <SectionHeader title="Archived Dry Lots" count={`${archivedDryLots.length} lots`} icon={Package} />
        {archivedDryLots.length === 0 ? (
          <EmptyState text="No archived or depleted dry lots." />
        ) : (
          archivedDryLots.map((lot) => <ArchivedLotRow key={lot.id} lot={lot} label="Dry Material" />)
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <SectionHeader title="Archived Extract Lots" count={`${archivedExtractLots.length} lots`} icon={FlaskConical} />
        {archivedExtractLots.length === 0 ? (
          <EmptyState text="No archived or depleted extract lots." />
        ) : (
          archivedExtractLots.map((lot) => <ArchivedLotRow key={lot.id} lot={lot} label="Extract" />)
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <SectionHeader title="Archived Finished Inventory" count={`${archivedFinishedLots.length} lots`} icon={Tag} />
        {archivedFinishedLots.length === 0 ? (
          <EmptyState text="No archived or depleted finished inventory lots." />
        ) : (
          archivedFinishedLots.map((lot) => {
            const lotType = String(lot?.lotType || "").replaceAll("_", " ");
            return <ArchivedLotRow key={lot.id} lot={lot} label={titleCaseStatus(lotType || "Finished Goods")} />;
          })
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <SectionHeader title="Archived Extraction Batches" count={`${archivedExtractionBatches.length} batches`} icon={FlaskConical} />
        {archivedExtractionBatches.length === 0 ? (
          <EmptyState text="No archived or completed extraction batches." />
        ) : (
          archivedExtractionBatches.map((batch) => <ArchivedBatchRow key={batch.id} batch={batch} />)
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <SectionHeader title="Archived Production Batches" count={`${archivedProductionBatches.length} batches`} icon={Factory} />
        {archivedProductionBatches.length === 0 ? (
          <EmptyState text="No archived or completed production batches." />
        ) : (
          archivedProductionBatches.map((batch) => <ArchivedBatchRow key={batch.id} batch={batch} />)
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
        <SectionHeader title="Archived Rework Batches" count={`${archivedReworkBatches.length} batches`} icon={GitBranch} />
        {archivedReworkBatches.length === 0 ? (
          <EmptyState text="No archived rework or repurpose batches." />
        ) : (
          archivedReworkBatches.map((batch) => <ArchivedBatchRow key={batch.id} batch={batch} />)
        )}
      </div>

      {selected && (
        <UnarchiveModal
          grow={selected}
          onClose={() => setSelected(null)}
          onSubmit={async (changes) => {
            await unarchiveGrow(selected, changes);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
