// src/pages/Analytics.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, Cell, ZAxis
} from "recharts";

import { db, auth } from "../firebase-config";
import { collection, onSnapshot } from "firebase/firestore";

/* ---------- helpers ---------- */
function isActiveGrow(g) {
  const s = String(g?.stage || "").toLowerCase();
  const status = String(g?.status || "").toLowerCase();

  const archivedLike =
    g?.archived === true ||
    g?.isArchived === true ||
    !!g?.archivedAt ||
    !!g?.archived_on ||
    !!g?.archivedOn ||
    s === "archived" ||
    status === "archived";

  const consumedLike =
    g?.consumed === true ||
    g?.isConsumed === true ||
    status === "consumed" ||
    s === "consumed";

  const contaminatedLike =
    g?.contaminated === true ||
    g?.isContaminated === true ||
    status === "contaminated" ||
    s === "contaminated";

  const finishedLike =
    g?.finished === true ||
    s === "harvested" ||
    s === "finished";

  if (archivedLike || consumedLike || contaminatedLike || finishedLike) return false;
  if (g?.active === false) return false;
  if (g?.active === true) return true;

  // ✅ Include the new stage as active
  return ["inoculated", "colonizing", "colonized", "fruiting", "harvesting"].includes(s);
}
const isContaminated = (g) => {
  const s = String(g?.stage || "").toLowerCase();
  const status = String(g?.status || "").toLowerCase();
  return (
    g?.contaminated === true ||
    g?.isContaminated === true ||
    s === "contaminated" ||
    status === "contaminated"
  );
};


function cleanLabel(value, fallback = "Unknown") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function shortGrowName(g = {}) {
  return (
    g?.abbreviation ||
    g?.subName ||
    g?.strain ||
    g?.name ||
    (g?.id ? String(g.id).slice(0, 8) : "Grow")
  );
}


function getSopWorkflowMeta(grow = {}) {
  const templateId = String(grow?.workflowTemplateId || grow?.sopTemplateId || "").trim();
  const title = String(
    grow?.workflowTemplateTitle ||
      grow?.sopTemplateTitle ||
      grow?.workflowTitle ||
      ""
  ).trim();
  const category = String(
    grow?.workflowTemplateCategory ||
      grow?.sopTemplateCategory ||
      grow?.workflowCategory ||
      ""
  ).trim();
  const step = String(grow?.workflowStep || category || "").trim();
  const source = String(grow?.workflowSource || grow?.sopSource || "").trim();
  const summary = String(grow?.workflowTemplateSummary || grow?.sopTemplateSummary || "").trim();

  return {
    hasWorkflow: !!(templateId || title || category || step || source),
    templateId,
    title: title || "Workflow SOP",
    category,
    step,
    source: source || (templateId || title ? "sop-template" : ""),
    summary,
  };
}

function workflowKey(meta = {}) {
  return meta.templateId || meta.title || meta.category || meta.step || "Workflow SOP";
}

function getSopChecklistStats(grow = {}) {
  const items = Array.isArray(grow?.sopChecklist) ? grow.sopChecklist : [];
  const total = items.length;
  const done = items.filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    return item?.completed === true || status === "done" || status === "complete" || status === "completed";
  }).length;
  const skipped = items.filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    return item?.skipped === true || status === "skipped";
  }).length;
  const pending = Math.max(0, total - done - skipped);
  const actionable = Math.max(0, total - skipped);
  const completionRate = actionable > 0 ? Number(((done / actionable) * 100).toFixed(1)) : total > 0 ? 100 : 0;
  return { total, done, skipped, pending, actionable, completionRate };
}

function isSopTask(task = {}) {
  const source = String(task?.source || task?.taskSource || task?.origin || "").toLowerCase();
  return source === "sop-template" || !!task?.workflowTemplateId || !!task?.sopTemplateId || !!task?.sopTaskTemplateId;
}

function isTaskComplete(task = {}) {
  const status = String(task?.status || "").toLowerCase();
  return task?.completed === true || status === "complete" || status === "completed" || status === "done";
}

function getGrowTypeLabel(g = {}) {
  return cleanLabel(g?.type || g?.growType || g?.kind || g?.category, "Unknown type");
}

function getLogDate(log = {}, grow = {}) {
  return (
    toDateMaybe(log?.observedAt) ||
    toDateMaybe(log?.timestamp) ||
    toDateMaybe(log?.createdAt) ||
    toDateMaybe(log?.updatedAt) ||
    toDateMaybe(grow?.contaminationLastAt) ||
    toDateMaybe(grow?.archivedAt) ||
    toDateMaybe(grow?.updatedAt) ||
    getRefDate(grow)
  );
}

function isConfirmedContaminationLog(log = {}) {
  const severity = String(log?.severity || "").toLowerCase();
  const outcome = String(log?.outcome || "").toLowerCase();
  const status = String(log?.status || "").toLowerCase();
  return (
    severity.includes("confirmed") ||
    status.includes("confirmed") ||
    outcome.includes("disposed") ||
    outcome.includes("archived") ||
    log?.confirmed === true ||
    log?.markGrowContaminated === true
  );
}

function splitContaminationTokens(value) {
  return String(value || "")
    .split(/[\n,;|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeContaminationList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, checked]) => !!checked)
      .map(([key]) => String(key || "").trim())
      .filter(Boolean);
  }
  return splitContaminationTokens(value);
}

function cleanupLabel(id = "") {
  return String(id || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function incrementCount(map, key, amount = 1) {
  const clean = cleanLabel(key);
  map[clean] = (map[clean] || 0) + amount;
}

function countMapToRows(map, limit = 12) {
  return Object.entries(map || {})
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function normalizeContaminationLog(raw = {}, grow = {}) {
  const observedDate = getLogDate(raw, grow);
  const severity =
    raw?.severity ||
    grow?.contaminationLastSeverity ||
    (isContaminated(grow) ? "Confirmed" : "Suspected");

  return {
    id: raw?.id || `summary-${grow?.id || Math.random().toString(36).slice(2)}`,
    growId: raw?.growId || grow?.id || "",
    growName: shortGrowName(grow),
    strain: cleanLabel(grow?.strain, "Unknown strain"),
    growType: getGrowTypeLabel(grow),
    stage: cleanLabel(raw?.stage || grow?.contaminationLastStage || grow?.stage, "Unknown stage"),
    observedAt: raw?.observedAt || raw?.timestamp || grow?.contaminationLastAt || "",
    observedDate,
    observedTime: observedDate ? observedDate.getTime() : 0,
    severity: cleanLabel(severity, "Suspected"),
    suspectedCause: cleanLabel(raw?.suspectedCause || grow?.contaminationLastCause, "Unknown / investigating"),
    visualSigns: String(raw?.visualSigns || raw?.signs || "").trim(),
    actionTaken: cleanLabel(raw?.actionTaken || raw?.action || "", "Not recorded"),
    outcome: cleanLabel(raw?.outcome || "", "Monitoring"),
    notes: String(raw?.notes || raw?.note || "").trim(),
    preventionNotes: String(raw?.preventionNotes || raw?.prevention || "").trim(),
    cleanupChecklist: normalizeContaminationList(raw?.cleanupChecklist),
    cleanupNotes: String(raw?.cleanupNotes || "").trim(),
    quarantineLocation: String(raw?.quarantineLocation || "").trim(),
    disposalMethod: cleanLabel(raw?.disposalMethod || "", "Not recorded"),
    sanitationMethod: cleanLabel(raw?.sanitationMethod || "", "Not recorded"),
    clearedForReuse: !!raw?.clearedForReuse,
    clearedForReuseDate: raw?.clearedForReuseDate || "",
    followUpRequired: !!raw?.followUpRequired,
    followUpDate: raw?.followUpDate || "",
    evidencePhotoCount: normalizeContaminationList(raw?.evidencePhotoIds).length || (Array.isArray(raw?.evidencePhotos) ? raw.evidencePhotos.length : 0),
    confirmed: isConfirmedContaminationLog({ ...raw, severity }),
    summaryFallback: raw?.summaryFallback === true,
  };
}

function buildSummaryContaminationLog(grow = {}) {
  if (!grow?.id) return null;
  const hasSummary =
    Number(grow?.contaminationLogCount || 0) > 0 ||
    !!grow?.contaminationLastAt ||
    !!grow?.contaminationLastCause ||
    !!grow?.contaminationLastSeverity ||
    isContaminated(grow);

  if (!hasSummary) return null;

  return normalizeContaminationLog(
    {
      id: `summary-${grow.id}`,
      growId: grow.id,
      stage: grow?.contaminationLastStage || grow?.stage || "Unknown stage",
      observedAt: grow?.contaminationLastAt || grow?.archivedAt || grow?.updatedAt || "",
      severity: grow?.contaminationLastSeverity || (isContaminated(grow) ? "Confirmed" : "Suspected"),
      suspectedCause: grow?.contaminationLastCause || "Unknown / investigating",
      outcome: isContaminated(grow) ? "Archived" : "Monitoring",
      summaryFallback: true,
    },
    grow
  );
}

function textExportLine(label, value) {
  return `${label}: ${value === null || value === undefined || value === "" ? "—" : value}`;
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}


const PALETTE = {
  wet: "#60a5fa",
  dry: "#a78bfa",
  cost: "#f59e0b",
  line: "#34d399",
  axis: "#94a3b8",
  grid: "#475569",
  scatter: "#22d3ee",
};
const PIE_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#facc15", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];

function totalsFromGrow(g) {
  const flushes =
    (Array.isArray(g?.flushes) && g.flushes) ||
    (Array.isArray(g?.harvest?.flushes) && g.harvest.flushes) ||
    [];
  const t = flushes.reduce((acc, f) => {
    acc.Wet += Number(f?.wet) || 0;
    acc.Dry += Number(f?.dry) || 0;
    return acc;
  }, { Wet: 0, Dry: 0 });
  if (!t.Wet && g?.wetYield) t.Wet = Number(g.wetYield) || 0;
  if (!t.Dry && g?.dryYield) t.Dry = Number(g.dryYield) || 0;
  return t;
}
const fmtInt = (n) => new Intl.NumberFormat().format(Math.round(Number(n) || 0));
const fmtG = (n) => `${fmtInt(n)} g`;
const fmt$ = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function KeyLegend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm px-2 py-1">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span className="inline-block w-3.5 h-3.5 rounded" style={{ background: it.color }} />
          <span className="text-zinc-300">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function toDateMaybe(v) {
  if (!v && v !== 0) return null;
  try {
    if (v?.toDate) return v.toDate();
    if (typeof v === "object" && "seconds" in v) return new Date(v.seconds * 1000);
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}
function getRefDate(g) {
  const sd = g?.stageDates || {};
  return (
    toDateMaybe(sd.Inoculated) ||
    toDateMaybe(g?.inoculatedAt) ||
    toDateMaybe(g?.inoculationDate) ||
    toDateMaybe(g?.createdAt) ||
    toDateMaybe(g?.created_on) ||
    toDateMaybe(g?.startDate) ||
    null
  );
}
const diffDays = (a, b) => Math.max(0, Math.round((b - a) / 86400000));
const median = (arr) => {
  const xs = arr.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
};
const monthKey = (d) => d.toISOString().slice(0, 7);
const recipeNameById = (recipes) => new Map((recipes || []).map((r) => [r.id, r.name]));

/* ---------- NEW: normalized cost helpers (non-destructive) ---------- */
const toNumber = (n, fb = 0) => (Number.isFinite(Number(n)) ? Number(n) : fb);

function resolveRecipeItemsForGrow(g, recipeById) {
  if (Array.isArray(g?.recipeItems) && g.recipeItems.length) return g.recipeItems;
  const rid = g?.recipeId || g?.recipe_id || g?.recipe?.id;
  const rec = rid ? recipeById.get(rid) : null;
  return rec && Array.isArray(rec.items) ? rec.items : null;
}

/**
 * Compute TOTAL batch cost for a set of recipe items using supply costs.
 * (Per-serving normalization happens later using the recipe's yield.)
 */
function computeItemsCost(items, supplyCostById) {
  if (!Array.isArray(items) || !items.length) return null;
  let sum = 0;
  for (const it of items) {
    const sid = it?.supplyId;
    const per =
      sid && supplyCostById.has(sid)
        ? toNumber(supplyCostById.get(sid), toNumber(it?.cost, 0))
        : toNumber(it?.cost, 0);
    const amt = toNumber(it?.amount, 0);
    sum += per * amt;
  }
  return Math.max(0, Number(sum.toFixed(2)));
}

/**
 * Yield helper: how many jars/tubs a recipe makes.
 * Priority:
 *  - grow.recipeYield (inline override)
 *  - recipe.yield from the recipe document
 *  - default 1 when missing/invalid
 */
function getRecipeYieldForGrow(g, recipeById) {
  if (!g) return 1;

  const inline = toNumber(g?.recipeYield, 0);
  if (inline > 0) return inline;

  const rid = g?.recipeId || g?.recipe_id || g?.recipe?.id;
  if (!rid) return 1;

  const rec = recipeById.get(rid);
  if (!rec) return 1;

  const y = toNumber(rec?.yield, 0);
  return y > 0 ? y : 1;
}

function computeStoredLabConsumablesCost(g, supplyCostById) {
  const inline = Number(g?.labConsumablesCost);
  if (Number.isFinite(inline)) return Math.max(0, Number(inline.toFixed(2)));

  const rows = Array.isArray(g?.labConsumablesUsed) ? g.labConsumablesUsed : [];
  if (!rows.length) return 0;

  let total = 0;
  for (const row of rows) {
    const directTotal = Number(row?.totalCost ?? row?.totalCostPerGrow ?? row?.costTotal);
    if (Number.isFinite(directTotal)) {
      total += directTotal;
      continue;
    }

    const amount = toNumber(row?.amount ?? row?.amountPerGrow ?? row?.qty, 0);
    const directUnitCost = Number(row?.unitCost ?? row?.unitPrice ?? row?.costPerUnit);
    if (Number.isFinite(directUnitCost)) {
      total += directUnitCost * amount;
      continue;
    }

    const liveUnitCost =
      row?.supplyId && supplyCostById.has(row.supplyId)
        ? toNumber(supplyCostById.get(row.supplyId), 0)
        : 0;
    total += liveUnitCost * amount;
  }

  return Math.max(0, Number(total.toFixed(2)));
}


/* ---------- post-process helpers ---------- */
const POST_PROCESS_FINISHED_TYPES = new Set(["capsules", "gummies", "chocolates", "tinctures"]);
const PACKAGING_TYPE_HINTS = new Set([
  "container", "packaging", "package", "bottle", "jar", "bag", "box", "label", "labels",
  "capsule", "capsules", "dropper", "droppers", "shrink_band", "shrink band", "wrapper", "wrappers"
]);
const lower = (v) => String(v || "").trim().toLowerCase();
const num = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);
function isFinishedPostProcessLot(lot) {
  return POST_PROCESS_FINISHED_TYPES.has(lower(lot?.lotType || lot?.finishedGoodType || lot?.productType));
}
function getLotAvailableQty(lot = {}) {
  const explicit = num(lot?.availableQuantity, NaN);
  if (Number.isFinite(explicit)) return explicit;
  const initial = num(lot?.initialQuantity ?? lot?.quantity ?? lot?.count, 0);
  const allocated = num(lot?.allocatedQuantity ?? lot?.usedQuantity ?? lot?.consumedQuantity, 0);
  return Math.max(0, initial - allocated);
}
function isArchivedPostProcessLot(lot = {}) {
  const status = lower(lot?.status || lot?.workflowState);
  return !!lot?.archived || !!lot?.archivedAt || status === "archived" || status === "depleted" || getLotAvailableQty(lot) <= 0;
}
function getLotWorkflowState(lot = {}) {
  const workflow = lower(lot?.workflowState || lot?.workflow?.state || lot?.releaseState || lot?.status);
  const qc = lower(lot?.qc?.status);
  if (lot?.recalled || workflow === "recalled") return "recalled";
  if (lot?.quarantined || workflow === "quarantined" || workflow === "quarantine") return "quarantined";
  if (qc === "hold" || workflow === "hold") return "hold";
  if (lot?.released === true || workflow === "released") return "released";
  return workflow || "pending";
}
function isBlockedPostProcessLot(lot = {}) {
  const wf = getLotWorkflowState(lot);
  const qc = lower(lot?.qc?.status);
  return ["hold", "quarantined", "quarantine", "recalled", "pending"].includes(wf) || qc === "hold" || qc === "fail";
}
function isLabelReadyPostProcessLot(lot = {}) {
  return isFinishedPostProcessLot(lot) && !isArchivedPostProcessLot(lot) && !isBlockedPostProcessLot(lot);
}
function getLabelMeta(lot = {}) {
  const meta = lot?.labelMetadata || lot?.label || {};
  return {
    lotCode: meta?.lotCode || lot?.lotCode || "",
    packDate: meta?.packDate || lot?.packDate || "",
    bestBy: meta?.bestBy || meta?.bestByDate || lot?.bestBy || "",
    ingredients: Array.isArray(meta?.ingredients) ? meta.ingredients : [],
    allergens: Array.isArray(meta?.allergens) ? meta.allergens : [],
  };
}
function getBatchExpectedOutput(batch = {}) {
  return num(
    batch?.expectedOutput ?? batch?.expectedOutputCount ?? batch?.expectedOutputAmount ?? batch?.plannedOutput ?? batch?.plannedCount,
    0
  );
}
function getBatchActualOutput(batch = {}) {
  return num(
    batch?.actualOutput ?? batch?.actualOutputCount ?? batch?.actualOutputAmount ?? batch?.finalOutput ?? batch?.finalCount ?? batch?.outputCount ?? batch?.outputAmount,
    0
  );
}
function getBatchWasteQty(batch = {}) {
  return num(batch?.wasteQuantity ?? batch?.waste?.quantity ?? batch?.shrinkQuantity, 0);
}
function getBatchWasteReason(batch = {}) {
  return batch?.wasteReason || batch?.waste?.reason || batch?.shrinkReason || batch?.reason || "Unspecified";
}
function getBatchKind(batch = {}) {
  return lower(batch?.processType || batch?.processCategory || batch?.batchType || batch?.type);
}
function isReworkBatch(batch = {}) {
  const hay = `${getBatchKind(batch)} ${lower(batch?.name)}`;
  return /rework|repurpose|relabel|rebottle|repackage/.test(hay);
}
function getMoveRevenue(move = {}) {
  const revenue = num(move?.revenue ?? move?.totalValue, NaN);
  if (Number.isFinite(revenue)) return revenue;
  return num(move?.unitPrice, 0) * num(move?.quantity, 0);
}
function withinDays(rawDate, days) {
  const d = toDateMaybe(rawDate);
  if (!d) return false;
  const now = new Date();
  now.setHours(0,0,0,0);
  const target = new Date(d);
  target.setHours(0,0,0,0);
  const diff = Math.round((target - now) / 86400000);
  return diff >= 0 && diff <= days;
}
function isPackagingSupply(supply = {}) {
  const type = lower(supply?.type);
  const unit = lower(supply?.unit);
  const name = lower(supply?.name);
  return PACKAGING_TYPE_HINTS.has(type) || PACKAGING_TYPE_HINTS.has(unit) || /bottle|jar|bag|label|capsule|dropper|box|wrapper|shrink/.test(name);
}

/* ---------- component ---------- */
export default function Analytics({
  grows = [],
  activeGrows = null,
  growsActive = null,
  archivedGrows = [],
  growsAll = null,
  recipes = [],
  supplies = [],
  tasks = [],
  supplyAudits = null,
}) {
  // Default to something that always has data
  
  const [chartKey, setChartKey] = useState("stageCounts");
  const [showValues, setShowValues] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [groupMode, setGroupMode] = useState("strain"); // "strain" | "recipe"
  const [sortMode, setSortMode] = useState("recent"); // "recent" | "alpha"

  // Live-load audits if not provided
  const [audits, setAudits] = useState(Array.isArray(supplyAudits) ? supplyAudits : []);

  const [materialLots, setMaterialLots] = useState([]);
  const [processBatches, setProcessBatches] = useState([]);
  const [inventoryMoves, setInventoryMoves] = useState([]);
  const [contaminationLogsByGrow, setContaminationLogsByGrow] = useState({});
  const [contaminationLogErrors, setContaminationLogErrors] = useState({});

  useEffect(() => setAudits(Array.isArray(supplyAudits) ? supplyAudits : []), [supplyAudits]);
  useEffect(() => {
    if (Array.isArray(supplyAudits)) return;
    const u = auth.currentUser;
    if (!u) return;
    const col = collection(db, "users", u.uid, "supply_audits");
    const unsub = onSnapshot(col, (snap) => setAudits(snap.docs.map((d) => d.data())));
    return () => unsub && unsub();
  }, []);
  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;
    const lotsCol = collection(db, "users", u.uid, "materialLots");
    const batchCol = collection(db, "users", u.uid, "processBatches");
    const moveCol = collection(db, "users", u.uid, "inventoryMovements");
    const unsubLots = onSnapshot(lotsCol, (snap) => setMaterialLots(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const unsubBatches = onSnapshot(batchCol, (snap) => setProcessBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const unsubMoves = onSnapshot(moveCol, (snap) => setInventoryMoves(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => {
      unsubLots && unsubLots();
      unsubBatches && unsubBatches();
      unsubMoves && unsubMoves();
    };
  }, []);

  // Filters (strain + date)
  const allStrainOptions = useMemo(() => {
    const set = new Set(
      [...(grows || []), ...(archivedGrows || [])]
        .map((g) => (g?.strain ? String(g.strain).trim() : null))
        .filter(Boolean)
    );
    return ["All strains", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [grows, archivedGrows]);
  const [strainFilter, setStrainFilter] = useState("All strains");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Merge active + archived
  const allGrows = useMemo(() => {
    const listA = Array.isArray(grows) ? grows : [];
    const listB = Array.isArray(archivedGrows) ? archivedGrows : [];
    if (listB.length === 0) return listA;
    const byId = new Map();
    for (const g of [...listA, ...listB]) {
      const prev = byId.get(g.id);
      if (!prev) byId.set(g.id, g);
      else if (g?.archived && !prev?.archived) byId.set(g.id, g);
    }
    return Array.from(byId.values());
  }, [grows, archivedGrows]);

  useEffect(() => {
    const u = auth.currentUser;
    const ids = Array.from(
      new Set(
        (allGrows || [])
          .map((g) => g?.id)
          .filter(Boolean)
      )
    );

    if (!u || ids.length === 0) {
      setContaminationLogsByGrow({});
      setContaminationLogErrors({});
      return undefined;
    }

    let active = true;
    const unsubs = [];

    setContaminationLogsByGrow((prev) => {
      const next = {};
      ids.forEach((id) => {
        if (prev[id]) next[id] = prev[id];
      });
      return next;
    });

    ids.forEach((growId) => {
      const logsRef = collection(db, "users", u.uid, "grows", growId, "contaminationLogs");
      const unsub = onSnapshot(
        logsRef,
        (snap) => {
          if (!active) return;
          const logs = snap.docs.map((d) => ({ id: d.id, growId, ...d.data() }));
          setContaminationLogsByGrow((prev) => ({ ...prev, [growId]: logs }));
          setContaminationLogErrors((prev) => {
            if (!prev[growId]) return prev;
            const next = { ...prev };
            delete next[growId];
            return next;
          });
        },
        (error) => {
          if (!active) return;
          console.warn("Contamination analytics log read failed:", growId, error?.message || error);
          setContaminationLogErrors((prev) => ({ ...prev, [growId]: error?.message || "Read failed" }));
        }
      );
      unsubs.push(unsub);
    });

    return () => {
      active = false;
      unsubs.forEach((unsub) => unsub && unsub());
    };
  }, [allGrows]);


  // Toggle sources
  const datasetActive = useMemo(
    () => (
      Array.isArray(growsActive) ? growsActive
      : Array.isArray(activeGrows) ? activeGrows
      : Array.isArray(grows) ? grows.filter(isActiveGrow)
      : []
    ),
    [growsActive, activeGrows, grows]
  );
  const datasetAll = useMemo(() => (Array.isArray(growsAll) ? growsAll : allGrows), [growsAll, allGrows]);

  // Filter predicate (strain/date)
  const filterPredicate = useMemo(() => {
    const wantStrain = strainFilter !== "All strains" ? String(strainFilter) : null;
    const from = fromDate ? new Date(fromDate) : null;
    const to = toDate ? new Date(toDate) : null;
    if (to) to.setHours(23, 59, 59, 999);
    return (g) => {
      if (wantStrain && String(g?.strain || "").trim() !== wantStrain) return false;
      const d = getRefDate(g);
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      return true;
    };
  }, [strainFilter, fromDate, toDate]);

  /* ===== Stage pie source ===== */
  const activeSource = useMemo(() => datasetActive, [datasetActive]);
  const activeFiltered = useMemo(
    () => activeSource.filter(isActiveGrow).filter(filterPredicate),
    [activeSource, filterPredicate]
  );
  const filteredAll = useMemo(
    () => (showAll ? datasetAll : datasetActive).filter(filterPredicate),
    [showAll, datasetAll, datasetActive, filterPredicate]
  );

  // Tiny active-only overview (cards)
  // NEW: build normalized cost map once for the current dataset (active vs all)
  const supplyCostById = useMemo(
    () => new Map((supplies || []).map((s) => [s.id, toNumber(s.cost, 0)])),
    [supplies]
  );
  const recipesMap = useMemo(() => recipeNameById(recipes), [recipes]);
  const recipeById = useMemo(() => new Map((recipes || []).map((r) => [r.id, r])), [recipes]);

  const normalizedCostById = useMemo(() => {
    const src = showAll ? datasetAll : datasetActive;
    const map = new Map();

    for (const g of src) {
      if (!g?.id) continue;

      const items = resolveRecipeItemsForGrow(g, recipeById);

      // Derived per-serving cost from recipe + supplies
      let derived = null;
      if (items) {
        const batchCost = computeItemsCost(items, supplyCostById); // total recipe cost
        if (batchCost != null) {
          const y = getRecipeYieldForGrow(g, recipeById);          // jars/tubs per batch
          const divisor = y > 0 ? y : 1;
          derived = Math.max(
            0,
            Number(((batchCost || 0) / divisor).toFixed(2))
          );
        }
      }

      const stored = toNumber(g?.cost, null);
      const labConsumablesCost = computeStoredLabConsumablesCost(g, supplyCostById);
      const cost = derived != null
        ? Number((derived + labConsumablesCost).toFixed(2))
        : stored != null
        ? stored
        : labConsumablesCost;

      map.set(g.id, cost);
    }

    return map;
  }, [showAll, datasetAll, datasetActive, recipeById, supplyCostById]);

  const overview = useMemo(() => {
    const totalActive = activeFiltered.length;
    const uniqueStrains = new Set(activeFiltered.map((g) => g.strain || "Unknown")).size;
    const runningCost = activeFiltered.reduce((sum, g) => {
      const c = (g?.id && normalizedCostById.has(g.id)) ? normalizedCostById.get(g.id) : toNumber(g?.cost, 0);
      return sum + c;
    }, 0);
    const ages = activeFiltered
      .map((g) => getRefDate(g))
      .filter(Boolean)
      .map((d) => (Date.now() - d.getTime()) / 86400000);
    const avgAgeDays = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    return { totalActive, uniqueStrains, runningCost: Number(runningCost.toFixed(2)), avgAgeDays };
  }, [activeFiltered, normalizedCostById]);

  const supplyNameById = useMemo(() => new Map((supplies || []).map((s) => [s.id, s.name])), [supplies]);
  const supplyQtyById = useMemo(() => new Map((supplies || []).map((s) => [s.id, Number(s.quantity || 0)])), [supplies]);
  const supplyIdByName = useMemo(() => {
    const m = new Map();
    for (const s of supplies || []) if (s?.name) m.set(String(s.name), s.id);
    return m;
  }, [supplies]);

  const supplyMetaById = useMemo(() => new Map((supplies || []).map((s) => [s.id, s])), [supplies]);
  const packagingSupplyIds = useMemo(
    () => new Set((supplies || []).filter((s) => isPackagingSupply(s)).map((s) => s.id)),
    [supplies]
  );

  const postProcessAnalytics = useMemo(() => {
    const finishedLots = (materialLots || []).filter((lot) => isFinishedPostProcessLot(lot));
    const activeFinishedLots = finishedLots.filter((lot) => !isArchivedPostProcessLot(lot));
    const blockedFinishedLots = activeFinishedLots.filter((lot) => isBlockedPostProcessLot(lot));
    const releasedFinishedLots = activeFinishedLots.filter((lot) => getLotWorkflowState(lot) === "released");
    const labelReadyLots = activeFinishedLots.filter((lot) => isLabelReadyPostProcessLot(lot));
    const expiringSoonLots = activeFinishedLots.filter((lot) => withinDays(getLabelMeta(lot).bestBy || lot?.expirationDate || lot?.shelfLife?.bestBy, 30));

    const workflowCounts = [
      { name: "Blocked", value: blockedFinishedLots.length },
      { name: "Released", value: releasedFinishedLots.length },
      { name: "Label Ready", value: labelReadyLots.length },
      { name: "Expiring Soon", value: expiringSoonLots.length },
    ];

    const valuationMap = {};
    activeFinishedLots.forEach((lot) => {
      const key = lot?.productType || lot?.finishedGoodType || lot?.lotType || "other";
      const available = Math.max(0, getLotAvailableQty(lot));
      const unitCost = num(lot?.costs?.unitCost ?? lot?.unitCost ?? lot?.pricing?.unitCost, 0);
      const unitPrice = num(lot?.pricePerUnit ?? lot?.pricing?.pricePerUnit, 0);
      if (!valuationMap[key]) valuationMap[key] = { name: key, units: 0, costValue: 0, salesValue: 0 };
      valuationMap[key].units += available;
      valuationMap[key].costValue += available * unitCost;
      valuationMap[key].salesValue += available * unitPrice;
    });
    const valuationByType = Object.values(valuationMap)
      .map((row) => ({ ...row, costValue: Number(row.costValue.toFixed(2)), salesValue: Number(row.salesValue.toFixed(2)) }))
      .sort((a, b) => b.salesValue - a.salesValue);

    const salesMap = {};
    (inventoryMoves || []).forEach((move) => {
      const type = lower(move?.movementType);
      if (!["sell", "donate", "sample"].includes(type)) return;
      const key = move?.destinationName || move?.destinationType || move?.counterparty || "Unspecified";
      if (!salesMap[key]) salesMap[key] = { name: key, quantity: 0, revenue: 0, type: move?.destinationType || type };
      salesMap[key].quantity += num(move?.quantity, 0);
      salesMap[key].revenue += getMoveRevenue(move);
    });
    const salesByDestination = Object.values(salesMap)
      .map((row) => ({ ...row, revenue: Number(row.revenue.toFixed(2)) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 12);

    const wasteMap = {};
    (processBatches || []).forEach((batch) => {
      const qty = getBatchWasteQty(batch);
      if (qty <= 0) return;
      const key = getBatchWasteReason(batch);
      if (!wasteMap[key]) wasteMap[key] = { name: key, quantity: 0 };
      wasteMap[key].quantity += qty;
    });
    (inventoryMoves || []).forEach((move) => {
      if (lower(move?.movementType) !== "waste") return;
      const key = move?.reason || move?.note || "Inventory waste";
      if (!wasteMap[key]) wasteMap[key] = { name: key, quantity: 0 };
      wasteMap[key].quantity += num(move?.quantity, 0);
    });
    const wasteByReason = Object.values(wasteMap).sort((a, b) => b.quantity - a.quantity).slice(0, 12);

    const efficiencyByBatch = (processBatches || [])
      .map((batch) => {
        const expected = getBatchExpectedOutput(batch);
        const actual = getBatchActualOutput(batch);
        if (!(expected > 0 || actual > 0)) return null;
        const variance = actual - expected;
        const variancePct = expected > 0 ? (variance / expected) * 100 : 0;
        return {
          name: batch?.name || batch?.id || "Batch",
          kind: getBatchKind(batch) || "batch",
          expected,
          actual,
          variance,
          variancePct: Number(variancePct.toFixed(2)),
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
      .slice(0, 14);

    const reworkSeries = (processBatches || [])
      .filter((batch) => isReworkBatch(batch))
      .map((batch) => ({
        name: batch?.name || batch?.id || "Rework",
        salvage: num(batch?.salvageOutput ?? batch?.salvageQuantity ?? batch?.actualOutput, 0),
        waste: getBatchWasteQty(batch),
      }))
      .sort((a, b) => (b.salvage + b.waste) - (a.salvage + a.waste));

    const packagingUsageMap = {};
    (audits || []).forEach((audit) => {
      const sid = audit?.supplyId || audit?.supply_id;
      if (!sid || !packagingSupplyIds.has(sid)) return;
      if (lower(audit?.action) !== "consume") return;
      const name = audit?.supplyName || supplyMetaById.get(sid)?.name || sid;
      if (!packagingUsageMap[name]) packagingUsageMap[name] = { name, used: 0, onHand: num(supplyMetaById.get(sid)?.quantity, 0) };
      packagingUsageMap[name].used += num(audit?.amount, 0);
    });
    const packagingUsage = Object.values(packagingUsageMap)
      .map((row) => ({ ...row, daysCover: row.used > 0 ? Math.round((row.onHand / ((row.used / 56) || 1))) : null }))
      .sort((a, b) => b.used - a.used)
      .slice(0, 12);

    const packagingShortages = (supplies || [])
      .filter((s) => isPackagingSupply(s))
      .filter((s) => {
        const qty = num(s?.quantity, 0);
        const threshold = num(s?.lowStockThreshold ?? s?.reorderAt ?? s?.reorderThreshold, 0);
        return threshold > 0 ? qty <= threshold : qty <= 0;
      });

    const labelCompleteness = activeFinishedLots.reduce((acc, lot) => {
      const meta = getLabelMeta(lot);
      if (meta.lotCode) acc.codes += 1;
      if (meta.packDate) acc.packDates += 1;
      if (meta.ingredients?.length) acc.ingredients += 1;
      if (meta.allergens?.length) acc.allergens += 1;
      return acc;
    }, { codes: 0, packDates: 0, ingredients: 0, allergens: 0 });

    return {
      summary: {
        activeFinished: activeFinishedLots.length,
        blockedFinished: blockedFinishedLots.length,
        releasedFinished: releasedFinishedLots.length,
        labelReady: labelReadyLots.length,
        expiringSoon: expiringSoonLots.length,
        packagingShortages: packagingShortages.length,
        reworkBatches: reworkSeries.length,
      },
      workflowCounts,
      valuationByType,
      salesByDestination,
      wasteByReason,
      efficiencyByBatch,
      reworkSeries,
      packagingUsage,
      packagingShortages,
      labelCompleteness,
    };
  }, [materialLots, processBatches, inventoryMoves, audits, packagingSupplyIds, supplyMetaById, supplies]);


  const contaminationAnalytics = useMemo(() => {
    const scopeGrows = (datasetAll || []).filter(filterPredicate);
    const logs = [];

    scopeGrows.forEach((grow) => {
      const directLogs = Array.isArray(contaminationLogsByGrow[grow.id])
        ? contaminationLogsByGrow[grow.id]
        : [];

      if (directLogs.length) {
        directLogs.forEach((log) => logs.push(normalizeContaminationLog(log, grow)));
        return;
      }

      const summaryLog = buildSummaryContaminationLog(grow);
      if (summaryLog) logs.push(summaryLog);
    });

    const impactedGrowIds = new Set();
    const confirmedGrowIds = new Set();
    const suspectedGrowIds = new Set();
    const stageCountsMap = {};
    const strainCountsMap = {};
    const typeCountsMap = {};
    const causeCountsMap = {};
    const signCountsMap = {};
    const actionCountsMap = {};
    const outcomeCountsMap = {};
    const severityCountsMap = {};
    const cleanupCountsMap = {};
    const disposalCountsMap = {};
    const sanitationCountsMap = {};
    const monthCountsMap = {};
    const preventionNotes = [];
    const cleanupNotes = [];

    logs.forEach((log) => {
      if (log.growId) impactedGrowIds.add(log.growId);
      if (log.confirmed && log.growId) confirmedGrowIds.add(log.growId);
      if (!log.confirmed && log.growId) suspectedGrowIds.add(log.growId);

      incrementCount(stageCountsMap, log.stage);
      incrementCount(strainCountsMap, log.strain);
      incrementCount(typeCountsMap, log.growType);
      incrementCount(causeCountsMap, log.suspectedCause);
      incrementCount(actionCountsMap, log.actionTaken);
      incrementCount(outcomeCountsMap, log.outcome);
      incrementCount(severityCountsMap, log.severity);
      normalizeContaminationList(log.cleanupChecklist).forEach((item) => incrementCount(cleanupCountsMap, cleanupLabel(item)));
      if (log.disposalMethod && log.disposalMethod !== "Not recorded") incrementCount(disposalCountsMap, log.disposalMethod);
      if (log.sanitationMethod && log.sanitationMethod !== "Not recorded") incrementCount(sanitationCountsMap, log.sanitationMethod);

      splitContaminationTokens(log.visualSigns).forEach((sign) => incrementCount(signCountsMap, sign));

      if (log.observedDate) {
        incrementCount(monthCountsMap, monthKey(log.observedDate));
      }

      const noteText = log.preventionNotes || log.notes;
      if (noteText) {
        preventionNotes.push({
          id: log.id,
          growId: log.growId,
          growName: log.growName,
          strain: log.strain,
          stage: log.stage,
          cause: log.suspectedCause,
          text: noteText,
          observedTime: log.observedTime,
        });
      }

      if (log.cleanupNotes || log.followUpRequired || log.clearedForReuse || normalizeContaminationList(log.cleanupChecklist).length) {
        cleanupNotes.push({
          id: log.id,
          growId: log.growId,
          growName: log.growName,
          strain: log.strain,
          stage: log.stage,
          clearedForReuse: !!log.clearedForReuse,
          clearedForReuseDate: log.clearedForReuseDate,
          followUpRequired: !!log.followUpRequired,
          followUpDate: log.followUpDate,
          cleanupNotes: log.cleanupNotes,
          checklist: normalizeContaminationList(log.cleanupChecklist).map(cleanupLabel),
          evidencePhotoCount: log.evidencePhotoCount || 0,
          observedTime: log.observedTime,
        });
      }
    });

    const contaminatedStageGrowCount = scopeGrows.filter(isContaminated).length;
    const summaryFallbacks = logs.filter((log) => log.summaryFallback).length;
    const topCause = countMapToRows(causeCountsMap, 1)[0]?.name || "None logged";
    const mostAffectedStage = countMapToRows(stageCountsMap, 1)[0]?.name || "None logged";
    const mostAffectedStrain = countMapToRows(strainCountsMap, 1)[0]?.name || "None logged";

    const recentEvents = [...logs]
      .sort((a, b) => (b.observedTime || 0) - (a.observedTime || 0))
      .slice(0, 8);

    return {
      scopeGrowCount: scopeGrows.length,
      logCount: logs.length,
      logs,
      readErrorCount: Object.keys(contaminationLogErrors || {}).length,
      summary: {
        impactedGrows: impactedGrowIds.size,
        confirmedGrows: confirmedGrowIds.size,
        suspectedGrows: suspectedGrowIds.size,
        contaminatedStageGrowCount,
        confirmedLogs: logs.filter((log) => log.confirmed).length,
        suspectedLogs: logs.filter((log) => !log.confirmed).length,
        summaryFallbacks,
        topCause,
        mostAffectedStage,
        mostAffectedStrain,
        cleanupFollowUps: logs.filter((log) => log.followUpRequired).length,
        clearedForReuse: logs.filter((log) => log.clearedForReuse).length,
        evidencePhotoCount: logs.reduce((sum, log) => sum + (Number(log.evidencePhotoCount) || 0), 0),
      },
      byStage: countMapToRows(stageCountsMap),
      byStrain: countMapToRows(strainCountsMap),
      byGrowType: countMapToRows(typeCountsMap),
      byCause: countMapToRows(causeCountsMap),
      byVisualSign: countMapToRows(signCountsMap),
      byAction: countMapToRows(actionCountsMap),
      byOutcome: countMapToRows(outcomeCountsMap),
      bySeverity: countMapToRows(severityCountsMap),
      byCleanup: countMapToRows(cleanupCountsMap),
      byDisposal: countMapToRows(disposalCountsMap),
      bySanitation: countMapToRows(sanitationCountsMap),
      byMonth: Object.entries(monthCountsMap)
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      recentEvents,
      preventionNotes: preventionNotes
        .sort((a, b) => (b.observedTime || 0) - (a.observedTime || 0))
        .slice(0, 6),
      cleanupNotes: cleanupNotes
        .sort((a, b) => (b.observedTime || 0) - (a.observedTime || 0))
        .slice(0, 8),
    };
  }, [datasetAll, filterPredicate, contaminationLogsByGrow, contaminationLogErrors]);



  const sopWorkflowAnalytics = useMemo(() => {
    const scopeGrows = (datasetAll || []).filter(filterPredicate);
    const workflowGrows = scopeGrows.filter((grow) => getSopWorkflowMeta(grow).hasWorkflow);
    const templateMap = {};
    const categoryMap = {};
    const stepMap = {};
    const recent = [];
    const sopTasks = (Array.isArray(tasks) ? tasks : []).filter(isSopTask);
    const tasksByGrow = {};

    sopTasks.forEach((task) => {
      const growId = String(task?.growId || "").trim();
      if (!growId) return;
      if (!tasksByGrow[growId]) tasksByGrow[growId] = [];
      tasksByGrow[growId].push(task);
    });

    workflowGrows.forEach((grow) => {
      const meta = getSopWorkflowMeta(grow);
      const key = workflowKey(meta);
      const contaminated =
        isContaminated(grow) ||
        Number(grow?.contaminationLogCount || 0) > 0 ||
        (Array.isArray(contaminationLogsByGrow[grow.id]) && contaminationLogsByGrow[grow.id].length > 0);
      const harvested =
        String(grow?.stage || "").toLowerCase() === "harvested" ||
        !!grow?.harvestedAt ||
        !!grow?.archived;
      const active = isActiveGrow(grow);
      const totals = totalsFromGrow(grow);
      const cost = Number(normalizedCostById.get(grow.id) ?? grow?.cost ?? 0) || 0;
      const checklist = getSopChecklistStats(grow);
      const growTasks = tasksByGrow[grow.id] || [];
      const taskDone = growTasks.filter(isTaskComplete).length;
      const taskOpen = Math.max(0, growTasks.length - taskDone);

      if (!templateMap[key]) {
        templateMap[key] = {
          name: meta.title || key,
          templateId: meta.templateId,
          category: meta.category || "Workflow",
          step: meta.step || "",
          total: 0,
          active: 0,
          harvested: 0,
          contaminated: 0,
          wet: 0,
          dry: 0,
          cost: 0,
          costCount: 0,
          checklistTotal: 0,
          checklistDone: 0,
          checklistSkipped: 0,
          checklistPending: 0,
          taskTotal: 0,
          taskDone: 0,
          taskOpen: 0,
        };
      }

      templateMap[key].total += 1;
      if (active) templateMap[key].active += 1;
      if (harvested) templateMap[key].harvested += 1;
      if (contaminated) templateMap[key].contaminated += 1;
      templateMap[key].wet += Number(totals.Wet || 0);
      templateMap[key].dry += Number(totals.Dry || 0);
      if (cost > 0) {
        templateMap[key].cost += cost;
        templateMap[key].costCount += 1;
      }
      templateMap[key].checklistTotal += checklist.total;
      templateMap[key].checklistDone += checklist.done;
      templateMap[key].checklistSkipped += checklist.skipped;
      templateMap[key].checklistPending += checklist.pending;
      templateMap[key].taskTotal += growTasks.length;
      templateMap[key].taskDone += taskDone;
      templateMap[key].taskOpen += taskOpen;

      if (meta.category) {
        categoryMap[meta.category] = (categoryMap[meta.category] || 0) + 1;
      }
      if (meta.step) {
        stepMap[meta.step] = (stepMap[meta.step] || 0) + 1;
      }

      recent.push({
        id: grow.id,
        name: shortGrowName(grow),
        strain: grow?.strain || "Unknown strain",
        stage: grow?.stage || "—",
        template: meta.title,
        category: meta.category || "Workflow",
        step: meta.step || "",
        createdAt: getRefDate(grow),
        contaminated,
        checklistPct: checklist.completionRate,
        taskOpen,
      });
    });

    const byTemplate = Object.values(templateMap)
      .map((row) => ({
        ...row,
        contaminationRate: row.total ? Number(((row.contaminated / row.total) * 100).toFixed(1)) : 0,
        harvestRate: row.total ? Number(((row.harvested / row.total) * 100).toFixed(1)) : 0,
        avgWet: row.harvested ? Number((row.wet / row.harvested).toFixed(1)) : 0,
        avgDry: row.harvested ? Number((row.dry / row.harvested).toFixed(1)) : 0,
        avgCost: row.costCount ? Number((row.cost / row.costCount).toFixed(2)) : 0,
        checklistCompletionRate:
          row.checklistTotal - row.checklistSkipped > 0
            ? Number(((row.checklistDone / (row.checklistTotal - row.checklistSkipped)) * 100).toFixed(1))
            : row.checklistTotal > 0
              ? 100
              : 0,
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const topTemplate = byTemplate[0]?.name || "—";
    const highestContam = byTemplate
      .filter((row) => row.total > 0)
      .slice()
      .sort((a, b) => b.contaminationRate - a.contaminationRate || b.contaminated - a.contaminated)[0];

    return {
      scopeGrowCount: scopeGrows.length,
      sopGrowCount: workflowGrows.length,
      nonSopGrowCount: Math.max(0, scopeGrows.length - workflowGrows.length),
      summary: {
        topTemplate,
        templatesTracked: byTemplate.length,
        sopContaminated: byTemplate.reduce((sum, row) => sum + row.contaminated, 0),
        sopHarvested: byTemplate.reduce((sum, row) => sum + row.harvested, 0),
        highestContamTemplate: highestContam?.name || "—",
        highestContamRate: highestContam?.contaminationRate || 0,
        sopTaskTotal: sopTasks.length,
        sopTaskOpen: sopTasks.filter((task) => !isTaskComplete(task)).length,
        checklistTotal: byTemplate.reduce((sum, row) => sum + row.checklistTotal, 0),
        checklistDone: byTemplate.reduce((sum, row) => sum + row.checklistDone, 0),
        checklistCompletionRate: (() => {
          const total = byTemplate.reduce((sum, row) => sum + row.checklistTotal - row.checklistSkipped, 0);
          const done = byTemplate.reduce((sum, row) => sum + row.checklistDone, 0);
          return total > 0 ? Number(((done / total) * 100).toFixed(1)) : 0;
        })(),
      },
      byTemplate,
      byCategory: countMapToRows(categoryMap),
      byStep: countMapToRows(stepMap),
      recent: recent
        .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))
        .slice(0, 8),
    };
  }, [datasetAll, filterPredicate, normalizedCostById, contaminationLogsByGrow, tasks]);


  const {
    stageCounts,
    yieldData,
    avgYieldPerStrain,
    growCosts,
    mostUsedSupplies,
    recipeUseCounts,
    stageTransitions,
    contamRate,
    ttsSeries,
    burnRateSeries,
    burnTopSupplies,
    burnNote,
    yieldVsCost,
    throughputSeries,
  } = useMemo(() => {
    // Stage distribution
    const stageCounts = Object.entries(
      activeFiltered.reduce((acc, x) => {
        const s = x.stage || "Active";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {})
    ).map(([name, value]) => ({ name, value }));

    // Wet vs Dry
    const yieldData = filteredAll
      .filter((x) => x.stage === "Harvested" || x.archived)
      .map((x) => {
        const t = totalsFromGrow(x);
        return {
          name: x.strain || x.abbreviation || (x.id ? x.id.slice(0, 6) : ""),
          Wet: t.Wet,
          Dry: t.Dry,
        };
      })
      .filter((d) => d.Wet || d.Dry);

    // Avg yield per strain
    const stats = {};
    filteredAll.forEach((x) => {
      if (!x.strain) return;
      const key = String(x.strain).trim();
      const t = totalsFromGrow(x);
      if (!stats[key]) stats[key] = { wet: 0, dry: 0, count: 0 };
      if (t.Wet || t.Dry) {
        stats[key].wet += t.Wet;
        stats[key].dry += t.Dry;
        stats[key].count += 1;
      }
    });
    const avgYieldPerStrain = Object.entries(stats).map(([name, v]) => ({
      name,
      Wet: v.count ? v.wet / v.count : 0,
      Dry: v.count ? v.dry / v.count : 0,
    }));

    // Cost per grow — NEW: use normalized cost if available
    const growCosts = filteredAll
      .map((x) => {
        const cost =
          (x?.id && normalizedCostById.has(x.id))
            ? normalizedCostById.get(x.id)
            : toNumber(x.cost, 0);
        const ref = getRefDate(x);
        return {
          name: x.abbreviation || x.strain || (x.id ? x.id.slice(0, 6) : ""),
          Cost: Number(cost || 0),
          _refTime: ref ? ref.getTime() : 0,
        };
      })
      .sort((a, b) => {
        if (sortMode === "alpha") {
          return a.name.localeCompare(b.name);
        }
        // default: most recently inoculated first
        return (b._refTime || 0) - (a._refTime || 0);
      });

    // Most used supplies (via recipes)
    const supplyCount = {};
    filteredAll.forEach((x) => {
      let items = resolveRecipeItemsForGrow(x, recipeById);
      if (!items) return;
      items.forEach((it) => {
        const n = it?.name || supplyNameById.get(it?.supplyId) || "Unknown";
        supplyCount[n] = (supplyCount[n] || 0) + 1;
      });
    });
    const mostUsedSupplies = Object.entries(supplyCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Recipe usage count — NEW: average cost via normalized cost
    const usageAcc = {};
    filteredAll.forEach((g) => {
      const rid = g.recipeId || g.recipe_id || g.recipe?.id || null;
      const rname =
        (rid && (recipesMap.get(rid) || g.recipeName || g.recipe?.name)) ||
        g.recipeName ||
        g.recipe?.name ||
        null;
      if (!rname) return;
      if (!usageAcc[rname]) usageAcc[rname] = { name: rname, count: 0, totalCost: 0 };
      usageAcc[rname].count += 1;
      const c = (g?.id && normalizedCostById.has(g.id)) ? normalizedCostById.get(g.id) : toNumber(g.cost, 0);
      usageAcc[rname].totalCost += c;
    });
    const recipeUseCounts = Object.values(usageAcc)
      .map((x) => ({ ...x, avgCost: x.count ? x.totalCost / x.count : 0 }))
      .sort((a, b) => b.count - a.count);

    // Stage transitions over time
    const perMonthTransitions = {};
    filteredAll.forEach((x) => {
      const sd = x.stageDates || {};
      Object.values(sd).forEach((date) => {
        const d = toDateMaybe(date);
        if (d) {
          const k = monthKey(d);
          perMonthTransitions[k] = (perMonthTransitions[k] || 0) + 1;
        }
      });
      const created = getRefDate(x);
      if (created) perMonthTransitions[monthKey(created)] = (perMonthTransitions[monthKey(created)] || 0) + 1;
      const harvest =
        toDateMaybe(sd.Harvested) ||
        (Array.isArray(x?.harvest?.flushes) ? toDateMaybe(x.harvest.flushes.at(-1)?.date) : null);
      if (harvest) perMonthTransitions[monthKey(harvest)] = (perMonthTransitions[monthKey(harvest)] || 0) + 1;
    });
    const stageTransitions = Object.entries(perMonthTransitions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count }));

    // Contamination rate by group
    const groupKey = (g) => {
      if (groupMode === "recipe") {
        const rid = g.recipeId || g.recipe_id || g.recipe?.id || null;
        return (rid && (recipesMap.get(rid) || g.recipeName || g.recipe?.name)) || g.recipeName || g.recipe?.name || "No recipe";
      }
      return g.strain || "Unknown";
    };
    const contamTotals = {};
    filteredAll.forEach((g) => {
      const key = groupKey(g);
      if (!contamTotals[key]) contamTotals[key] = { name: key, total: 0, bad: 0 };
      contamTotals[key].total += 1;
      if (isContaminated(g)) contamTotals[key].bad += 1;
    });
    const contamRate = Object.values(contamTotals)
      .map((r) => ({ name: r.name, rate: r.total ? (r.bad / r.total) * 100 : 0, bad: r.bad, total: r.total }))
      .sort((a, b) => b.rate - a.rate);

    // Time-to-stage (median days)
    const ttsBuckets = {};
    filteredAll.forEach((g) => {
      const sd = g.stageDates || {};
      const inoc = toDateMaybe(sd.Inoculated) || getRefDate(g);
      const colon = toDateMaybe(sd.Colonized);
      const fruit = toDateMaybe(sd.Fruiting);
      const harvest =
        toDateMaybe(sd.Harvested) ||
        (Array.isArray(g?.harvest?.flushes) ? toDateMaybe(g.harvest.flushes.at(-1)?.date) : null);
      const k = groupKey(g);
      if (!ttsBuckets[k]) ttsBuckets[k] = { ic: [], cf: [], fh: [] };
      if (inoc && colon) ttsBuckets[k].ic.push(diffDays(inoc, colon));
      if (colon && fruit) ttsBuckets[k].cf.push(diffDays(colon, fruit));
      if (fruit && harvest) ttsBuckets[k].fh.push(diffDays(fruit, harvest));
    });
    const ttsSeries = Object.entries(ttsBuckets).map(([name, v]) => ({
      name,
      Inoc_to_Colonized: median(v.ic),
      Colonized_to_Fruiting: median(v.cf),
      Fruiting_to_Harvested: median(v.fh),
    }));

    // ===== Supply burn rate =====
    const now = new Date();
    const weeksBack = 8;
    const weekKey = (d) => {
      const dt = new Date(d);
      const year = dt.getUTCFullYear();
      const day = (dt.getUTCDay() + 6) % 7;
      const thurs = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() - day + 3));
      const week1 = new Date(Date.UTC(thurs.getUTCFullYear(), 0, 4));
      const w = 1 + Math.round((thurs - week1) / 604800000);
      return `${year}-W${String(w).padStart(2, "0")}`;
    };
    const weekLabels = [];
const temp = new Date(
  Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  )
);

for (let i = weeksBack - 1; i >= 0; i--) {
  const d = new Date(temp);
  d.setUTCDate(d.getUTCDate() - i * 7);
  weekLabels.push(weekKey(d));
}

    const consumeEvents = (audits || []).filter((a) => String(a?.action).toLowerCase() === "consume" && a?.timestamp);
    const usingAudits = consumeEvents.length > 0;

        // byKey maps LABEL -> { weeks:{wk:amount}, total }
    const byKey = {};

    if (usingAudits) {
      // Real consumption from audits
      consumeEvents.forEach((a) => {
        const d = new Date(a.timestamp);
        if (!Number.isFinite(d.getTime())) return;
        const wk = weekKey(d);
        if (!weekLabels.includes(wk)) return;

        const sid = a.supplyId || a.supply_id || null;
        const friendly =
          a.supplyName ||
          a.name ||
          (sid ? supplyNameById.get(sid) : null);

        // If we still can't resolve a friendly name, ignore this audit
        if (!friendly) return;

        const label = String(friendly);

        if (!byKey[label]) byKey[label] = { weeks: {}, total: 0, sid };
        const amt = Number(a.amount || 0);
        const safe = Number.isFinite(amt) ? amt : 0;
        byKey[label].weeks[wk] =
          (byKey[label].weeks[wk] || 0) + safe;
        byKey[label].total += safe;
      });
    } else {
      // Synthetic estimate from recipe items on the grow's start week
      const windowStart = new Date(temp);
      windowStart.setUTCDate(
        windowStart.getUTCDate() - (weeksBack - 1) * 7
      );

      filteredAll.forEach((g) => {
        const start = getRefDate(g);
        if (!start || start < windowStart) return;
        const wk = weekKey(start);
        if (!weekLabels.includes(wk)) return;

        const items = resolveRecipeItemsForGrow(g, recipeById);
        if (!items) return;

        items.forEach((it) => {
          const sid = it?.supplyId || null;
          const friendly =
            it?.name ||
            (sid ? supplyNameById.get(sid) : null);

          // Skip items we can't map to a supply name
          if (!friendly) return;

          const label = String(friendly);

          if (!byKey[label]) {
            byKey[label] = {
              weeks: {},
              total: 0,
              sid,
            };
          }

          const amt = Number(it?.amount);
          const use = Number.isFinite(amt) ? amt : 1; // assume 1 if undefined
          byKey[label].weeks[wk] =
            (byKey[label].weeks[wk] || 0) + use;
          byKey[label].total += use;
        });
      });
    }


    const topKeys = Object.entries(byKey)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([label]) => label);

    const burnRateSeries = weekLabels.map((wk) => {
      const row = { week: wk };
      topKeys.forEach((label) => {
        row[label] = byKey[label]?.weeks[wk] || 0;
      });
      return row;
    });

    const windowDays = weeksBack * 7;
    const burnTopSupplies = topKeys.map((label, idx) => {
      const entry = byKey[label];
      const sid = entry?.sid || null;
      // try by id then by name
      let qty = null;
      if (sid && supplyQtyById.has(sid)) qty = supplyQtyById.get(sid);
      if (qty == null) {
        const possibleId = supplyIdByName.get(label);
        if (possibleId && supplyQtyById.has(possibleId)) qty = supplyQtyById.get(possibleId);
      }
      const used = entry?.total || 0;
      const perDay = used / windowDays;
      const days = perDay > 0 && qty != null ? Math.round(qty / perDay) : null;
      return { id: sid || label, name: label, daysToZero: days, color: PIE_COLORS[idx % PIE_COLORS.length] };
    });

    const burnNote = usingAudits ? "(from audits)" : "(estimated from recipes and start dates)";

    // Yield vs Cost — NEW: use normalized cost
    const yieldVsCost = filteredAll
      .map((g) => {
        const t = totalsFromGrow(g);
        const y = t.Dry || t.Wet || 0;
        const x =
          (g?.id && normalizedCostById.has(g.id))
            ? normalizedCostById.get(g.id)
            : toNumber(g.cost, 0);
        return {
          x: Number(x),
          y: Number(y),
          name: g.abbreviation || g.strain || (g.id ? g.id.slice(0, 6) : ""),
        };
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    // Throughput
    const started = {};
    filteredAll.forEach((g) => {
      const d = getRefDate(g);
      if (!d) return;
      const key = d.toISOString().slice(0, 7);
      started[key] = (started[key] || 0) + 1;
    });
    const harvested = {};
    filteredAll.forEach((g) => {
      const sd = g.stageDates || {};
      const d = toDateMaybe(sd.Harvested) || (Array.isArray(g?.harvest?.flushes) ? toDateMaybe(g.harvest.flushes.at(-1)?.date) : null);
      if (!d) return;
      const key = d.toISOString().slice(0, 7);
      harvested[key] = (harvested[key] || 0) + 1;
    });
    const months = Array.from(new Set([...Object.keys(started), ...Object.keys(harvested)])).sort();
    const throughputSeries = months.map((m) => ({
      month: m,
      Started: started[m] || 0,
      Harvested: harvested[m] || 0,
    }));

    return {
      stageCounts,
      yieldData,
      avgYieldPerStrain,
      growCosts,
      mostUsedSupplies,
      recipeUseCounts,
      stageTransitions,
      contamRate,
      ttsSeries,
      burnRateSeries,
      burnTopSupplies,
      burnNote,
      yieldVsCost,
      throughputSeries,
    };
  }, [
    activeFiltered,
    filteredAll,
    recipesMap,
    groupMode,
    audits,
    supplies,
    recipeById,
    supplyNameById,
    supplyQtyById,
    supplyIdByName,
    normalizedCostById,
    sortMode,
  ]);

  // CSV export
  const exportCSV = () => {
    const lines = [
      "Type,Name,ValueA,ValueB",
      ...stageCounts.map((d) => ["StageCount (active)", d.name, d.value, ""].join(",")),
      ...yieldData.map((d) => ["Yield", d.name, d.Wet, d.Dry].join(",")),
      ...avgYieldPerStrain.map((d) => ["AvgYieldPerStrain", d.name, d.Wet, d.Dry].join(",")),
      ...growCosts.map((d) => ["Cost", d.name, d.Cost, ""].join(",")),
      ...mostUsedSupplies.map((d) => ["MostUsedSupplies", d.name, d.count, ""].join(",")),
      ...recipeUseCounts.map((d) =>
        ["RecipeUseCount", d.name, d.count, (Number(d.avgCost) || 0).toFixed(2)].join(",")
      ),
      ...stageTransitions.map((d) => ["StageTransition", d.month, d.count, ""].join(",")),
      ...contamRate.map((d) => ["ContamRate(" + groupMode + ")", d.name, d.rate.toFixed(1) + "%", `${d.bad}/${d.total}`].join(",")),
      ...contaminationAnalytics.byStage.map((d) => ["ContamByStage", d.name, d.count, ""].join(",")),
      ...contaminationAnalytics.byCause.map((d) => ["ContamByCause", d.name, d.count, ""].join(",")),
      ...contaminationAnalytics.byStrain.map((d) => ["ContamByStrain", d.name, d.count, ""].join(",")),
      ...contaminationAnalytics.byGrowType.map((d) => ["ContamByGrowType", d.name, d.count, ""].join(",")),
      ...contaminationAnalytics.byCleanup.map((d) => ["ContamCleanup", d.name, d.count, ""].join(",")),
      ...contaminationAnalytics.bySanitation.map((d) => ["ContamSanitation", d.name, d.count, ""].join(",")),
      ...contaminationAnalytics.byDisposal.map((d) => ["ContamDisposal", d.name, d.count, ""].join(",")),
      ...sopWorkflowAnalytics.byTemplate.map((d) => ["SOPWorkflow", d.name, d.total, `contam ${d.contaminationRate}% | harvested ${d.harvestRate}% | checklist ${d.checklistCompletionRate}% | open tasks ${d.taskOpen}`].join(",")),
      ...sopWorkflowAnalytics.byCategory.map((d) => ["SOPWorkflowCategory", d.name, d.count, ""].join(",")),
      ...sopWorkflowAnalytics.byStep.map((d) => ["SOPWorkflowStep", d.name, d.count, ""].join(",")),
      ...ttsSeries.map((d) => ["TimeToStage(" + groupMode + ")", d.name, d.Inoc_to_Colonized, d.Colonized_to_Fruiting + "|" + d.Fruiting_to_Harvested].join(",")),
      ...burnRateSeries.map((row) => ["BurnRate", row.week, JSON.stringify({ ...row, week: undefined }), ""].join(",")),
      ...yieldVsCost.map((p) => ["YieldVsCost", p.name, p.x, p.y].join(",")),
      ...throughputSeries.map((r) => ["Throughput", r.month, r.Started, r.Harvested].join(",")),
      ...postProcessAnalytics.workflowCounts.map((d) => ["PostProcessWorkflow", d.name, d.value, ""].join(",")),
      ...postProcessAnalytics.valuationByType.map((d) => ["PostProcessValuation", d.name, d.costValue.toFixed(2), d.salesValue.toFixed(2)].join(",")),
      ...postProcessAnalytics.salesByDestination.map((d) => ["PostProcessSales", d.name, d.quantity, d.revenue.toFixed(2)].join(",")),
      ...postProcessAnalytics.wasteByReason.map((d) => ["PostProcessWaste", d.name, d.quantity, ""].join(",")),
      ...postProcessAnalytics.efficiencyByBatch.map((d) => ["PostProcessEfficiency", d.name, d.expected, `${d.actual}|${d.variancePct}%`].join(",")),
      ...postProcessAnalytics.reworkSeries.map((d) => ["PostProcessRework", d.name, d.salvage, d.waste].join(",")),
      ...postProcessAnalytics.packagingUsage.map((d) => ["PackagingUsage", d.name, d.used, d.onHand].join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "analytics.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // JSON export
  const exportJSON = () => {
    const chosenGrows = showAll ? (Array.isArray(growsAll) ? growsAll : allGrows) : datasetActive;
    const payload = {
      app: "Mushroom Tracker",
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      dataset: showAll ? "all" : "active",
      counts: {
        grows: Array.isArray(chosenGrows) ? chosenGrows.length : 0,
        tasks: Array.isArray(tasks) ? tasks.length : 0,
        recipes: Array.isArray(recipes) ? recipes.length : 0,
        supplies: Array.isArray(supplies) ? supplies.length : 0,
        audits: Array.isArray(audits) ? audits.length : 0,
      },
      data: {
        grows: Array.isArray(chosenGrows) ? chosenGrows : [],
        tasks: Array.isArray(tasks) ? tasks : [],
        recipes: Array.isArray(recipes) ? recipes : [],
        supplies: Array.isArray(supplies) ? supplies : [],
        audits: Array.isArray(audits) ? audits : [],
      },
      analytics: {
        recipeUseCounts,
        mostUsedSupplies,
        contamRate,
        contamination: contaminationAnalytics,
        sopWorkflow: sopWorkflowAnalytics,
        ttsSeries,
        burnTopSupplies,
        throughputSeries,
        postProcess: postProcessAnalytics,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `myco-backup-${payload.dataset}-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportContaminationReport = () => {
    const a = contaminationAnalytics;
    const lines = [
      "Chaotic Neutral Myco Tracker — Contamination Analytics Report",
      textExportLine("Exported", new Date().toLocaleString()),
      textExportLine("Matching grows", a.scopeGrowCount),
      textExportLine("Total contamination logs", a.logCount),
      textExportLine("Impacted grows", a.summary.impactedGrows),
      textExportLine("Confirmed logs", a.summary.confirmedLogs),
      textExportLine("Suspected logs", a.summary.suspectedLogs),
      textExportLine("Cleanup follow-ups", a.summary.cleanupFollowUps),
      textExportLine("Cleared for reuse", a.summary.clearedForReuse),
      textExportLine("Evidence photos", a.summary.evidencePhotoCount),
      textExportLine("Top suspected cause", a.summary.topCause),
      textExportLine("Most affected stage", a.summary.mostAffectedStage),
      "",
      "By Stage",
      ...a.byStage.map((row) => `- ${row.name}: ${row.count}`),
      "",
      "By Suspected Cause",
      ...a.byCause.map((row) => `- ${row.name}: ${row.count}`),
      "",
      "By Visual Sign",
      ...(a.byVisualSign.length ? a.byVisualSign.map((row) => `- ${row.name}: ${row.count}`) : ["- No visual signs logged yet."]),
      "",
      "Cleanup Checklist Items",
      ...(a.byCleanup.length ? a.byCleanup.map((row) => `- ${row.name}: ${row.count}`) : ["- No cleanup checklist items logged yet."]),
      "",
      "Sanitation Methods",
      ...(a.bySanitation.length ? a.bySanitation.map((row) => `- ${row.name}: ${row.count}`) : ["- No sanitation methods logged yet."]),
      "",
      "Recent Events",
      ...(a.recentEvents.length
        ? a.recentEvents.map((log) => {
            const date = log.observedDate ? log.observedDate.toLocaleDateString() : "No date";
            return `- ${date} · ${log.growName} · ${log.stage} · ${log.severity} · ${log.suspectedCause}`;
          })
        : ["- No contamination events logged yet."]),
      "",
      "Prevention / Follow-up Notes",
      ...(a.preventionNotes.length
        ? a.preventionNotes.map((note) => `- ${note.growName} (${note.stage}, ${note.cause}): ${note.text}`)
        : ["- No prevention notes logged yet."]),
      "",
      "Cleanup / Reuse Notes",
      ...(a.cleanupNotes.length
        ? a.cleanupNotes.map((note) => `- ${note.growName} (${note.stage}): ${note.cleanupNotes || note.checklist.join(", ") || "Cleanup tracked"}${note.followUpRequired ? " [follow-up]" : ""}${note.clearedForReuse ? " [cleared]" : ""}`)
        : ["- No cleanup notes logged yet."]),
      "",
    ];

    downloadTextFile(`myco-contamination-report-${new Date().toISOString().slice(0, 10)}.txt`, lines.join("\n"));
  };


  const axisProps = { stroke: PALETTE.axis, tick: { fill: PALETTE.axis, fontSize: 12 } };
  const gridProps = { stroke: PALETTE.grid, strokeDasharray: "3 3" };

  const renderChart = () => {
    switch (chartKey) {
      case "stageCounts":
        return (
          <ResponsiveContainer width="100%" height={360}>
            <PieChart>
              <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
              <Legend verticalAlign="bottom" />
              <Pie data={stageCounts} dataKey="value" nameKey="name" label>
                {stageCounts.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        );

      case "yieldData":
        return (
          <>
            <KeyLegend items={[{ label: "Wet (g)", color: PALETTE.wet }, { label: "Dry (g)", color: PALETTE.dry }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={yieldData}>
                <CartesianGrid {...gridProps} />
                <XAxis
                  dataKey="name"
                  {...axisProps}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={70}
                />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v, n) => (n === "Wet" || n === "Dry" ? fmtG(v) : fmtInt(v))} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Bar dataKey="Wet" fill={PALETTE.wet}>{showValues && <LabelList dataKey="Wet" position="top" formatter={fmtInt} />}</Bar>
                <Bar dataKey="Dry" fill={PALETTE.dry}>{showValues && <LabelList dataKey="Dry" position="top" formatter={fmtInt} />}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "avgYieldPerStrain":
        return (
          <>
            <KeyLegend items={[{ label: "Avg Wet (g)", color: PALETTE.wet }, { label: "Avg Dry (g)", color: PALETTE.dry }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={avgYieldPerStrain}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v, n) => (n === "Wet" || n === "Dry" ? fmtG(v) : fmtInt(v))} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Bar dataKey="Wet" fill={PALETTE.wet}>{showValues && <LabelList dataKey="Wet" position="top" formatter={fmtInt} />}</Bar>
                <Bar dataKey="Dry" fill={PALETTE.dry}>{showValues && <LabelList dataKey="Dry" position="top" formatter={fmtInt} />}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "growCosts":
        return (
          <>
            <KeyLegend items={[{ label: "Cost ($)", color: PALETTE.cost }]} />
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={growCosts}>
                <CartesianGrid {...gridProps} />
                <XAxis
                  dataKey="name"
                  {...axisProps}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={70}
                />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmt$(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Line dataKey="Cost" stroke={PALETTE.cost} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        );

      case "recipeUseCounts":
        return (
          <>
            <KeyLegend items={[{ label: "Grows using recipe", color: PALETTE.line }]} />
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={recipeUseCounts}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip
                  formatter={(v, n) => (n === "count" ? fmtInt(v) : fmt$(v))}
                  labelFormatter={(label, payload) => {
                    const row = payload && payload[0] && payload[0].payload;
                    if (!row) return label;
                    return `${label} — ${fmtInt(row.count)} uses · avg cost ${fmt$(row.avgCost)}`;
                  }}
                  contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }}
                />
                <Bar dataKey="count" fill={PALETTE.line}>
                  {showValues && <LabelList dataKey="count" position="top" formatter={fmtInt} />}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "recipeUsage":
        return (
          <>
            <KeyLegend items={[{ label: "Times in recipes", color: PALETTE.line }]} />
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={mostUsedSupplies}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Bar dataKey="count" fill={PALETTE.line}>{showValues && <LabelList dataKey="count" position="top" formatter={fmtInt} />}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "contamRate":
        return (
          <>
            <KeyLegend items={[{ label: "Contamination rate (%)", color: "#f87171" }]} />
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={contamRate}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={(v) => `${Math.round(v)}%`} />
                <Tooltip
                  formatter={(v) => `${Math.round(v)}%`}
                  labelFormatter={(label, payload) => {
                    const r = payload?.[0]?.payload;
                    return r ? `${label} — ${Math.round(r.rate)}% (${r.bad}/${r.total})` : label;
                  }}
                  contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }}
                />
                <Bar dataKey="rate" fill="#f87171">
                  {showValues && <LabelList dataKey="rate" position="top" formatter={(v) => `${Math.round(v)}%`} />}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "contamInsights":
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-950 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100">
              <div>
                <h3 className="text-lg font-semibold">Contamination summary</h3>
                <p className="text-sm opacity-80">
                  Uses detailed grow contamination logs when available, with grow-level summary fallbacks for older records.
                </p>
                {contaminationAnalytics.readErrorCount > 0 && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-200">
                    {contaminationAnalytics.readErrorCount} grow log source(s) could not be read. Check Firestore rules if this persists.
                  </p>
                )}
              </div>
              <button type="button" onClick={exportContaminationReport} className="btn btn-accent">
                Export Report
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
              <StatCard label="Matching Grows" value={contaminationAnalytics.scopeGrowCount} />
              <StatCard label="Contam Logs" value={contaminationAnalytics.logCount} />
              <StatCard label="Impacted Grows" value={contaminationAnalytics.summary.impactedGrows} />
              <StatCard label="Confirmed Logs" value={contaminationAnalytics.summary.confirmedLogs} />
              <StatCard label="Follow-ups" value={contaminationAnalytics.summary.cleanupFollowUps} />
              <StatCard label="Cleared" value={contaminationAnalytics.summary.clearedForReuse} />
              <StatCard label="Evidence Photos" value={contaminationAnalytics.summary.evidencePhotoCount} />
              <StatCard label="Top Cause" value={contaminationAnalytics.summary.topCause} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-3 font-semibold">Logs by stage</div>
                {contaminationAnalytics.byStage.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={contaminationAnalytics.byStage}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                      <YAxis {...axisProps} tickFormatter={fmtInt} />
                      <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                      <Bar dataKey="count" fill="#f87171">
                        {showValues && <LabelList dataKey="count" position="top" formatter={fmtInt} />}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="No contamination stages logged yet." />
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-3 font-semibold">Logs by suspected cause</div>
                {contaminationAnalytics.byCause.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={contaminationAnalytics.byCause}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={90} />
                      <YAxis {...axisProps} tickFormatter={fmtInt} />
                      <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                      <Bar dataKey="count" fill="#fb923c">
                        {showValues && <LabelList dataKey="count" position="top" formatter={fmtInt} />}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="No suspected causes logged yet." />
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-3 font-semibold">Logs by strain</div>
                {contaminationAnalytics.byStrain.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={contaminationAnalytics.byStrain}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                      <YAxis {...axisProps} tickFormatter={fmtInt} />
                      <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                      <Bar dataKey="count" fill="#a78bfa">
                        {showValues && <LabelList dataKey="count" position="top" formatter={fmtInt} />}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState message="No strain-level contamination data yet." />
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-3 font-semibold">Visual signs</div>
                {contaminationAnalytics.byVisualSign.length ? (
                  <div className="flex flex-wrap gap-2">
                    {contaminationAnalytics.byVisualSign.map((row) => (
                      <span key={row.name} className="rounded-full border border-zinc-200 px-3 py-1 text-sm dark:border-zinc-700">
                        {row.name} <span className="opacity-60">×{row.count}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No visual signs have been entered yet." />
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-3 font-semibold">Cleanup checklist items</div>
                {contaminationAnalytics.byCleanup.length ? (
                  <div className="flex flex-wrap gap-2">
                    {contaminationAnalytics.byCleanup.map((row) => (
                      <span key={row.name} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                        {row.name} <span className="opacity-60">×{row.count}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No cleanup checklist items logged yet." />
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-3 font-semibold">Sanitation / disposal</div>
                {contaminationAnalytics.bySanitation.length || contaminationAnalytics.byDisposal.length ? (
                  <div className="space-y-3">
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Sanitation</div>
                      <div className="flex flex-wrap gap-2">
                        {contaminationAnalytics.bySanitation.map((row) => (
                          <span key={row.name} className="rounded-full border border-zinc-200 px-3 py-1 text-sm dark:border-zinc-700">
                            {row.name} <span className="opacity-60">×{row.count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Disposal</div>
                      <div className="flex flex-wrap gap-2">
                        {contaminationAnalytics.byDisposal.map((row) => (
                          <span key={row.name} className="rounded-full border border-zinc-200 px-3 py-1 text-sm dark:border-zinc-700">
                            {row.name} <span className="opacity-60">×{row.count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState message="No sanitation or disposal methods logged yet." />
                )}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-3 font-semibold">Recent contamination events</div>
                {contaminationAnalytics.recentEvents.length ? (
                  <div className="space-y-3">
                    {contaminationAnalytics.recentEvents.map((log) => (
                      <div key={`${log.growId}-${log.id}`} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold">{log.growName}</div>
                          <div className="text-xs text-zinc-500">
                            {log.observedDate ? log.observedDate.toLocaleDateString() : "No date"}
                          </div>
                        </div>
                        <div className="mt-1 text-zinc-600 dark:text-zinc-300">
                          {log.strain} · {log.growType} · {log.stage}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
                            {log.severity}
                          </span>
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            {log.suspectedCause}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                            {log.outcome}
                          </span>
                          {log.followUpRequired ? (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                              Cleanup follow-up
                            </span>
                          ) : null}
                          {log.clearedForReuse ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                              Cleared
                            </span>
                          ) : null}
                          {log.evidencePhotoCount ? (
                            <span className="rounded-full bg-sky-100 px-2 py-1 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                              {log.evidencePhotoCount} photo{log.evidencePhotoCount === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                        {log.notes && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{log.notes}</p>}
                        {log.cleanupNotes && <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">Cleanup: {log.cleanupNotes}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No contamination events match the current filters." />
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-3 font-semibold">Prevention notes and follow-up ideas</div>
                {contaminationAnalytics.preventionNotes.length ? (
                  <div className="space-y-3">
                    {contaminationAnalytics.preventionNotes.map((note) => (
                      <div key={`${note.growId}-${note.id}`} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                        <div className="font-semibold">{note.growName}</div>
                        <div className="text-xs text-zinc-500">
                          {note.strain} · {note.stage} · {note.cause}
                        </div>
                        <p className="mt-2 text-zinc-700 dark:text-zinc-300">{note.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No prevention notes logged yet. Add notes in Grow Detail contamination logs to make this report useful." />
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="mb-3 font-semibold">Cleanup follow-ups and reuse clearance</div>
                {contaminationAnalytics.cleanupNotes.length ? (
                  <div className="space-y-3">
                    {contaminationAnalytics.cleanupNotes.map((note) => (
                      <div key={`${note.growId}-${note.id}`} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold">{note.growName}</div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            {note.followUpRequired ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Follow-up {note.followUpDate ? `· ${String(note.followUpDate).slice(0, 10)}` : ""}</span> : null}
                            {note.clearedForReuse ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">Cleared {note.clearedForReuseDate ? `· ${String(note.clearedForReuseDate).slice(0, 10)}` : ""}</span> : null}
                            {note.evidencePhotoCount ? <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">{note.evidencePhotoCount} photo{note.evidencePhotoCount === 1 ? "" : "s"}</span> : null}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">{note.strain} · {note.stage}</div>
                        {note.checklist.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {note.checklist.map((item) => (
                              <span key={item} className="rounded-full border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700">{item}</span>
                            ))}
                          </div>
                        ) : null}
                        {note.cleanupNotes ? <p className="mt-2 text-zinc-700 dark:text-zinc-300">{note.cleanupNotes}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No cleanup metadata logged yet. Add checklist items in Grow Detail contamination logs." />
                )}
              </div>
            </div>
          </div>
        );



      case "sopWorkflow":
        return (
          <div className="space-y-4">
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950 dark:border-indigo-900/60 dark:bg-indigo-950/20 dark:text-indigo-100">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">SOP / Workflow performance</h3>
                  <p className="text-sm opacity-80">
                    Tracks grows started from SOP templates and connects outcomes back to the workflow that created them.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <StatCard label="SOP Grows" value={sopWorkflowAnalytics.sopGrowCount} />
              <StatCard label="Templates" value={sopWorkflowAnalytics.summary.templatesTracked} />
              <StatCard label="SOP Harvested" value={sopWorkflowAnalytics.summary.sopHarvested} />
              <StatCard label="SOP Contam" value={sopWorkflowAnalytics.summary.sopContaminated} />
              <StatCard label="SOP Tasks" value={sopWorkflowAnalytics.summary.sopTaskTotal} />
              <StatCard label="Checklist" value={`${sopWorkflowAnalytics.summary.checklistCompletionRate}%`} />
            </div>

            {sopWorkflowAnalytics.byTemplate.length ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-3 font-semibold">Grows by SOP template</div>
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={sopWorkflowAnalytics.byTemplate}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={90} />
                    <YAxis {...axisProps} tickFormatter={fmtInt} />
                    <Tooltip contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                    <Legend />
                    <Bar dataKey="total" name="Total" fill={PALETTE.line}>
                      {showValues && <LabelList dataKey="total" position="top" formatter={fmtInt} />}
                    </Bar>
                    <Bar dataKey="harvested" name="Harvested" fill={PALETTE.wet} />
                    <Bar dataKey="contaminated" name="Contam" fill="#f87171" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState message="No SOP-started grows match the current filters yet." />
            )}

            {sopWorkflowAnalytics.byTemplate.length ? (
              <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-3 font-semibold">SOP outcome table</div>
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="py-2 pr-3">Template</th>
                      <th className="py-2 pr-3">Category</th>
                      <th className="py-2 pr-3">Total</th>
                      <th className="py-2 pr-3">Active</th>
                      <th className="py-2 pr-3">Harvested</th>
                      <th className="py-2 pr-3">Contam %</th>
                      <th className="py-2 pr-3">Avg Dry</th>
                      <th className="py-2 pr-3">Avg Cost</th>
                      <th className="py-2 pr-3">Checklist</th>
                      <th className="py-2 pr-3">Open Tasks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sopWorkflowAnalytics.byTemplate.map((row) => (
                      <tr key={row.templateId || row.name} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="py-2 pr-3 font-medium">{row.name}</td>
                        <td className="py-2 pr-3">{row.category || "Workflow"}</td>
                        <td className="py-2 pr-3">{row.total}</td>
                        <td className="py-2 pr-3">{row.active}</td>
                        <td className="py-2 pr-3">{row.harvested}</td>
                        <td className="py-2 pr-3">{row.contaminationRate}%</td>
                        <td className="py-2 pr-3">{row.avgDry ? fmtG(row.avgDry) : "—"}</td>
                        <td className="py-2 pr-3">{row.avgCost ? fmt$(row.avgCost) : "—"}</td>
                        <td className="py-2 pr-3">{row.checklistTotal ? `${row.checklistCompletionRate}%` : "—"}</td>
                        <td className="py-2 pr-3">{row.taskOpen || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-3 font-semibold">Workflow categories</div>
                {sopWorkflowAnalytics.byCategory.length ? (
                  <div className="space-y-2">
                    {sopWorkflowAnalytics.byCategory.map((row) => (
                      <div key={row.name} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
                        <span>{row.name}</span>
                        <span className="font-semibold">{row.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No SOP categories tracked yet." />
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="mb-3 font-semibold">Recent SOP-started grows</div>
                {sopWorkflowAnalytics.recent.length ? (
                  <div className="space-y-2">
                    {sopWorkflowAnalytics.recent.map((grow) => (
                      <div key={grow.id || `${grow.name}-${grow.template}`} className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
                        <div className="font-medium">{grow.name} · {grow.strain}</div>
                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {grow.template} · {grow.category} · {grow.stage}
                          {grow.checklistPct ? ` · checklist ${grow.checklistPct}%` : ""}
                          {grow.taskOpen ? ` · ${grow.taskOpen} open SOP task${grow.taskOpen === 1 ? "" : "s"}` : ""}
                          {grow.contaminated ? " · contamination logged" : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No recent SOP-started grows match the current filters." />
                )}
              </div>
            </div>
          </div>
        );

      case "timeToStage":
        return (
          <>
            <KeyLegend items={[
              { label: "Inoc → Colonized", color: "#60a5fa" },
              { label: "Colonized → Fruiting", color: "#34d399" },
              { label: "Fruiting → Harvested", color: "#f59e0b" },
            ]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={ttsSeries}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => `${fmtInt(v)} days`} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Bar dataKey="Inoc_to_Colonized" fill="#60a5fa" />
                <Bar dataKey="Colonized_to_Fruiting" fill="#34d399" />
                <Bar dataKey="Fruiting_to_Harvested" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "burnRate":
        return (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
              {burnTopSupplies.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-2 rounded-full px-2 py-1 border border-zinc-700">
                  <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: s.color }} />
                  {s.name}
                  <span className="opacity-70">· {s.daysToZero != null ? `${s.daysToZero}d to zero` : "no est."}</span>
                </span>
              ))}
              <span className="ml-2 italic opacity-70">{burnNote}</span>
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={burnRateSeries}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="week" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                {burnTopSupplies.map((s) => (
                  <Line key={s.id} dataKey={s.name} stroke={s.color} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        );

      case "yieldVsCost":
        return (
          <>
            <KeyLegend items={[{ label: "Point = Grow", color: PALETTE.scatter }]} />
            <ResponsiveContainer width="100%" height={360}>
              <ScatterChart>
                <CartesianGrid {...gridProps} />
                <XAxis type="number" dataKey="x" name="Cost" unit="$" {...axisProps} tickFormatter={(v) => `$${v}`} />
                <YAxis type="number" dataKey="y" name="Yield" unit=" g" {...axisProps} tickFormatter={(v) => fmtInt(v)} />
                <ZAxis type="number" dataKey="z" range={[60, 60]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }}
                  formatter={(value, name) => name === "x" ? fmt$(value) : name === "y" ? fmtG(value) : fmtInt(value)}
                  labelFormatter={() => ""} />
                <Scatter data={yieldVsCost} fill={PALETTE.scatter} />
              </ScatterChart>
            </ResponsiveContainer>
          </>
        );

      case "throughput":
        return (
          <>
            <KeyLegend items={[{ label: "Started", color: "#60a5fa" }, { label: "Harvested", color: "#a78bfa" }]} />
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={throughputSeries}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Line dataKey="Started" stroke="#60a5fa" strokeWidth={2} dot={false} />
                <Line dataKey="Harvested" stroke="#a78bfa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        );

      case "stageTransitions":
        return (
          <>
            <KeyLegend items={[{ label: "Stage changes / month", color: PALETTE.line }]} />
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={stageTransitions}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Line dataKey="count" stroke={PALETTE.line} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        );


      case "ppWorkflow":
        return (
          <>
            <KeyLegend items={[
              { label: "Blocked", color: "#f87171" },
              { label: "Released", color: "#34d399" },
              { label: "Label Ready", color: "#60a5fa" },
              { label: "Expiring Soon", color: "#f59e0b" },
            ]} />
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={postProcessAnalytics.workflowCounts}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Bar dataKey="value" fill="#60a5fa">{showValues && <LabelList dataKey="value" position="top" formatter={fmtInt} />}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "ppValuation":
        return (
          <>
            <KeyLegend items={[{ label: "Cost value", color: "#f59e0b" }, { label: "Sales value", color: "#34d399" }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={postProcessAnalytics.valuationByType}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmt$(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Bar dataKey="costValue" fill="#f59e0b" />
                <Bar dataKey="salesValue" fill="#34d399" />
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "ppSales":
        return (
          <>
            <KeyLegend items={[{ label: "Revenue by destination", color: "#22d3ee" }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={postProcessAnalytics.salesByDestination}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v, n) => n === "revenue" ? fmt$(v) : fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Bar dataKey="revenue" fill="#22d3ee" />
                <Bar dataKey="quantity" fill="#60a5fa" />
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "ppWaste":
        return (
          <>
            <KeyLegend items={[{ label: "Waste by reason", color: "#f87171" }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={postProcessAnalytics.wasteByReason}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={80} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Bar dataKey="quantity" fill="#f87171" />
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "ppEfficiency":
        return (
          <>
            <KeyLegend items={[{ label: "Expected", color: "#60a5fa" }, { label: "Actual", color: "#34d399" }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={postProcessAnalytics.efficiencyByBatch}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={80} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip labelFormatter={(label, payload) => {
                  const row = payload?.[0]?.payload;
                  return row ? `${label} · ${row.variancePct}% variance` : label;
                }} formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Bar dataKey="expected" fill="#60a5fa" />
                <Bar dataKey="actual" fill="#34d399" />
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "ppPackaging":
        return (
          <>
            <KeyLegend items={[{ label: "Packaging used", color: "#a78bfa" }, { label: "On hand", color: "#f59e0b" }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={postProcessAnalytics.packagingUsage}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={80} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Bar dataKey="used" fill="#a78bfa" />
                <Bar dataKey="onHand" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "ppRework":
        return (
          <>
            <KeyLegend items={[{ label: "Salvage", color: "#34d399" }, { label: "Waste", color: "#f87171" }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={postProcessAnalytics.reworkSeries}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={80} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Bar dataKey="salvage" fill="#34d399" />
                <Bar dataKey="waste" fill="#f87171" />
              </BarChart>
            </ResponsiveContainer>
          </>
        );


      default:
        return null;
    }
  };

  const showGroupChooser = chartKey === "contamRate" || chartKey === "timeToStage";

  return (
    <div className="space-y-4 p-4 md:p-6 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
      {/* overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Grows" value={overview.totalActive} />
        <StatCard label="Unique Strains" value={overview.uniqueStrains} />
        <StatCard label="Avg Age (days)" value={overview.avgAgeDays} />
        <StatCard label="Est. Running Cost" value={`$${overview.runningCost}`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
        <StatCard label="Contam Logs" value={contaminationAnalytics.logCount} />
        <StatCard label="Impacted Grows" value={contaminationAnalytics.summary.impactedGrows} />
        <StatCard label="Confirmed Issues" value={contaminationAnalytics.summary.confirmedLogs} />
        <StatCard label="Top Cause" value={contaminationAnalytics.summary.topCause} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
        <StatCard label="SOP Grows" value={sopWorkflowAnalytics.sopGrowCount} />
        <StatCard label="SOP Templates" value={sopWorkflowAnalytics.summary.templatesTracked} />
        <StatCard label="Top SOP" value={sopWorkflowAnalytics.summary.topTemplate} />
        <StatCard
          label="Highest SOP Contam"
          value={
            sopWorkflowAnalytics.summary.highestContamTemplate === "—"
              ? "—"
              : `${sopWorkflowAnalytics.summary.highestContamRate}%`
          }
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
        <StatCard label="PP Active Finished" value={postProcessAnalytics.summary.activeFinished} />
        <StatCard label="PP Blocked" value={postProcessAnalytics.summary.blockedFinished} />
        <StatCard label="PP Released" value={postProcessAnalytics.summary.releasedFinished} />
        <StatCard label="Label Ready" value={postProcessAnalytics.summary.labelReady} />
        <StatCard label="Expiring ≤30d" value={postProcessAnalytics.summary.expiringSoon} />
        <StatCard label="Packaging Shortages" value={postProcessAnalytics.summary.packagingShortages} />
        <StatCard label="Rework Batches" value={postProcessAnalytics.summary.reworkBatches} />
        <StatCard label="Label Codes" value={`${postProcessAnalytics.labelCompleteness.codes}/${postProcessAnalytics.summary.activeFinished || 0}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          data-testid="analytics-chart-select"
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={chartKey}
          onChange={(e) => setChartKey(e.target.value)}
        >
          <option value="stageCounts">Grow Stage Distribution</option>
          <option value="yieldData">Wet vs Dry Yield</option>
          <option value="avgYieldPerStrain">Average Yield per Strain</option>
          <option value="growCosts">Cost per Grow</option>
          <option value="recipeUseCounts">Recipe Usage Count</option>
          <option value="recipeUsage">Most Used Supplies</option>
          <option value="contamRate">Contamination Rate</option>
          <option value="contamInsights">Contamination Analytics Report</option>
          <option value="sopWorkflow">SOP / Workflow Performance</option>
          <option value="timeToStage">Time to Stage (median)</option>
          <option value="burnRate">Top Supplies: Weekly Usage &amp; Days Until Empty</option>
          <option value="yieldVsCost">Yield vs Cost</option>
          <option value="throughput">Throughput (Started vs Harvested)</option>
          <option value="stageTransitions">Stage Transitions Over Time</option>
          <option value="ppWorkflow">Post Process Workflow Status</option>
          <option value="ppValuation">Post Process Inventory Valuation</option>
          <option value="ppSales">Post Process Sales by Destination</option>
          <option value="ppWaste">Post Process Waste by Reason</option>
          <option value="ppEfficiency">Post Process Batch Efficiency</option>
          <option value="ppPackaging">Packaging Usage vs On Hand</option>
          <option value="ppRework">Rework Salvage vs Waste</option>
        </select>

        {showGroupChooser && (
          <select
            className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            value={groupMode}
            onChange={(e) => setGroupMode(e.target.value)}
            title="Group by"
          >
            <option value="strain">By Strain</option>
            <option value="recipe">By Recipe</option>
          </select>
        )}

        <select
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={strainFilter}
          onChange={(e) => setStrainFilter(e.target.value)}
          title="Filter by strain"
        >
          {allStrainOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {chartKey === "growCosts" && (
          <select
            className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value)}
            title="Sort cost chart"
          >
            <option value="recent">Newest inoculated first</option>
            <option value="alpha">Name A → Z</option>
          </select>
        )}

        <div className="flex items-center gap-2 text-sm">
          <span className="opacity-70">From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1"
          />
          <span className="opacity-70">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1"
          />
        </div>

        <label className="inline-flex items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            style={{ accentColor: "var(--_accent-600)" }}
            checked={showValues}
            onChange={(e) => setShowValues(e.target.checked)}
          />
          Show values
        </label>

        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex items-center gap-0 rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-700">
            <span className="px-2 py-2 text-xs uppercase tracking-wide bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-r border-zinc-300 dark:border-zinc-700 select-none">DATASET</span>
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="chip !rounded-none !border-0 text-sm"
              aria-pressed={!showAll}
              title="Show only active grows"
            >
              Active only
            </button>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="chip !rounded-none !border-0 text-sm"
              aria-pressed={showAll}
              title="Include archived and contaminated"
            >
              All
            </button>
          </div>

          <button onClick={exportCSV} className="btn btn-accent">
            Export CSV
          </button>
          <button
            onClick={exportJSON}
            className="btn"
            title="Export grows, tasks, recipes, supplies, audits as JSON + analytic snapshots"
          >
            Export JSON
          </button>
        </div>
      </div>

      <div className="text-xs opacity-60">
        Showing {filteredAll.length} grows ({activeFiltered.length} active in stage distribution)
        {strainFilter !== "All strains" ? ` · Strain: ${strainFilter}` : ""}
        {(fromDate || toDate) ? ` · Range: ${fromDate || "…"} → ${toDate || "…"}`
          : ""}
      </div>

      {renderChart()}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
      {message}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
