// src/lib/growFilters.js
// Centralized grow filters and helpers (safe, additive).
// - Active definition tightened per spec:
//   Active = NOT archived, NOT deleted, NOT stored, NOT harvested,
//            and (status === "Active" OR stage ∈ {Inoculated, Colonizing, Colonized, Fruiting})
// - Archived-ish covers explicit archived flags and fully-consumed items.
// - Exports remain stable for existing imports across the app.

// ---------- Normalizers ----------
export function normalizeType(t = "") {
  const s = String(t || "").toLowerCase();
  if (s.includes("agar")) return "Agar";
  if (s.includes("lc") || s.includes("liquid")) return "LC";
  if (s.includes("grain")) return "Grain Jar";
  if (s.includes("bulk") || s.includes("tub") || s.includes("mono") || s.includes("bag")) return "Bulk";
  return "Other";
}

export function normalizeStage(stage = "") {
  const s = String(stage || "").trim().toLowerCase();
  if (s.startsWith("inoc")) return "Inoculated";
  if (s.includes("colonizing")) return "Colonizing";
  if (s.includes("colonised") || s.includes("colonized")) return "Colonized";
  if (s.includes("fruit")) return "Fruiting";
  if (s.includes("harvesting")) return "Harvesting";
  if (s.includes("harvested")) return "Harvested";
  if (s.includes("consum")) return "Consumed"; // legacy
  if (s.includes("contam")) return "Contaminated";
  return "Other";
}

export function normalizeStatus(status = "") {
  return String(status || "").trim().toLowerCase();
}

// ---------- Stage flow (new model, same for all types) ----------
const FLOW = [
  "Inoculated",
  "Colonizing",
  "Colonized",
  "Fruiting",
  "Harvesting",
  "Harvested",
];

export function allowedStagesForType(/* type */) {
  // All types share the same stage flow currently; hook remains for future divergence.
  return [...FLOW];
}

export const ALL_STAGE_OPTIONS = Array.from(new Set([...FLOW, "Consumed", "Contaminated", "Other"]));

// ---------- Numbers ----------
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// ---------- Dates ----------
export function toDateSafe(v) {
  try {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
    if (typeof v === "string") {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------- Remaining helpers (consumables only) ----------
export function remainingInfo(g = {}) {
  const total = num(g.amountTotal, NaN);
  const used = num(g.amountUsed, NaN);
  const unit = g.amountUnit || g.volumeUnit || "";
  if (Number.isFinite(total) && total > 0) {
    const available = Math.max(0, total - Math.max(0, used));
    return { total, used: Math.max(0, used), available, unit };
  }
  // legacy single-number inventory
  const legacy = num(g.amountAvailable, NaN);
  if (Number.isFinite(legacy)) {
    return { total: NaN, used: NaN, available: Math.max(0, legacy), unit };
  }
  return { total: NaN, used: NaN, available: 0, unit };
}

// ---------- Archive / Active logic ----------
export function isArchivedish(g = {}) {
  const status = normalizeStatus(g.status);
  const stage = normalizeStage(g.stage);

  const archivedFlags =
    g.archived === true ||
    g.isArchived === true ||
    !!g.archivedAt ||
    !!g.archivedOn ||
    !!g.archived_on ||
    !!g.inArchive;

  // Deleted items are treated as archived for listing purposes (but kept for analytics)
  const isDeleted = g.deleted === true || !!g.deletedAt;

  if (archivedFlags || status === "archived" || stage === "Consumed" || isDeleted) return true;

  // “Fully consumed” by new fields also counts as archived-ish
  const { total, available } = remainingInfo(g);
  if (Number.isFinite(total) && total > 0 && available <= 0) return true;

  return false;
}

// Active per spec:
// NOT archived, NOT deleted, NOT stored, NOT harvested;
// and (status === Active OR stage ∈ {Inoculated, Colonizing, Colonized, Fruiting})
export function isActiveGrow(g = {}) {
  if (!g) return false;

  // Quick exits
  if (isArchivedish(g)) return false;

  const status = normalizeStatus(g.status);
  const stage = normalizeStage(g.stage);

  if (status === "stored") return false;
  if (stage === "Harvested") return false;

  const activeStages = new Set(["Inoculated", "Colonizing", "Colonized", "Fruiting"]);
  return status === "active" || activeStages.has(stage);
}

export function partitionGrows(grows = []) {
  const active = [];
  const archived = [];
  for (const g of Array.isArray(grows) ? grows : []) {
    (isActiveGrow(g) ? active : archived).push(g);
  }
  return { active, archived };
}

// ---------- Display helpers ----------
export function titleOfGrow(g = {}) {
  return (
    String(g.abbreviation || g.abbr || g.subName || "").trim() ||
    String(g.strain || "").trim() ||
    String(g.name || g.title || "").trim() ||
    ""
  );
}

export function bestTimeMs(g = {}) {
  const raw =
    g?.stageDates?.Harvested ||
    g?.stageDates?.Colonized ||
    g?.stageDates?.Inoculated ||
    g?.createdDate ||
    g?.createdAt ||
    null;
  const d = toDateSafe(raw);
  return d ? d.getTime() : 0;
}

// ---------- Default aggregate export ----------
const growFilters = {
  normalizeType,
  normalizeStage,
  normalizeStatus,
  allowedStagesForType,
  ALL_STAGE_OPTIONS,
  remainingInfo,
  isArchivedish,
  isActiveGrow,
  partitionGrows,
  titleOfGrow,
  bestTimeMs,
  toDateSafe,
};

export default growFilters;
