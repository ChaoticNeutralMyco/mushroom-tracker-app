// src/lib/growFilters.js

/** Is this a bulk run? */
export function isBulkGrow(g) {
  if (g?.isBulk === true) return true;
  const t = String(g?.type || g?.growType || g?.container || "").toLowerCase();
  return t.includes("bulk") || t.includes("tub") || t.includes("monotub");
}

/** Is this a consumable seed culture (LC/agar/grain jar/etc)? */
export function isConsumableType(g) {
  const t = String(g?.type || g?.growType || g?.container || "").toLowerCase();
  return (
    t.includes("grain") ||
    t.includes("jar") ||    // e.g. "grain jar"
    t.includes("lc") ||
    t.includes("liquid") ||
    t.includes("agar") ||
    t.includes("plate") ||
    t.includes("slant")
  );
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function firstNumber(values) {
  for (const v of values) {
    const n = numOrNull(v);
    if (n !== null) return n;
  }
  return null;
}

/**
 * Unified "active grows" filter used by cards/stats/searches.
 * - hides explicit archived/contaminated/inactive
 * - hides harvested bulk
 * - hides seed cultures that are empty/consumed
 */
export function isActiveGrow(g) {
  if (!g) return false;

  // Explicit inactive markers
  if (g.archived === true) return false;
  const status = String(g.status || "").toLowerCase();
  if (status === "archived" || status === "contaminated") return false;
  if (g.active === false) return false;

  // Bulk: not active once harvested
  if (isBulkGrow(g) && String(g.stage || "").toLowerCase() === "harvested") {
    return false;
  }

  // Seed cultures: not active when empty/consumed
  if (isConsumableType(g)) {
    const remaining =
      firstNumber([
        g.amountAvailable,
        g.unitsRemaining,
        g.volumeRemaining,
        g.jarsRemaining,
      ]) ?? Infinity;
    if (remaining <= 0) return false;
    if (g.empty || g.consumed || g.usedUp) return false;
  }

  return true;
}

/**
 * Timeline visibility: slightly looser than isActiveGrow.
 * Keep bulk grows visible even at Harvested so user can add flushes
 * and click "Finish harvest & Archive" on the Timeline.
 */
export function isTimelineVisible(g) {
  if (!g) return false;

  if (g.archived === true) return false;
  const status = String(g.status || "").toLowerCase();
  if (status === "archived" || status === "contaminated") return false;
  if (g.active === false) return false;

  // Seed cultures disappear once consumed/empty
  if (isConsumableType(g)) {
    const remaining =
      firstNumber([
        g.amountAvailable,
        g.unitsRemaining,
        g.volumeRemaining,
        g.jarsRemaining,
      ]) ?? Infinity;
    if (remaining <= 0) return false;
    if (g.empty || g.consumed || g.usedUp) return false;
  }

  // IMPORTANT: bulk @ Harvested stays visible on Timeline
  return true;
}
