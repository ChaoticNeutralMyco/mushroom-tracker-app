// src/lib/growFilters.js

/** Identify bulk runs (best-effort; covers your data shapes). */
export function isBulkGrow(g = {}) {
  const v = String(g?.growType || g?.type || "").toLowerCase();
  return (
    g?.isBulk === true ||
    v.includes("bulk") ||
    v.includes("tub") ||
    v.includes("bag")
  );
}

/** Matches the Archive page’s heuristic (plus a couple synonyms). */
export function isArchivedish(g = {}) {
  const stage = String(g?.stage || "").toLowerCase();
  const status = String(g?.status || "").toLowerCase();

  const archivedLike =
    g?.archived === true ||
    g?.isArchived === true ||
    !!g?.archivedAt ||
    !!g?.archived_on ||
    !!g?.archivedOn ||
    stage === "archived" ||
    status === "archived";

  const contaminatedLike =
    g?.contaminated === true ||
    g?.isContaminated === true ||
    status === "contaminated" ||
    stage === "contaminated";

  // Many apps record “consumed” by zeroing inventory, but support it if flagged:
  const consumedLike =
    g?.consumed === true ||
    g?.isConsumed === true ||
    status === "consumed" ||
    stage === "consumed";

  const harvestedLike = stage === "harvested" || stage === "finished";

  // Emptied jars/bags (your Archive page treats amountAvailable <= 0 as archived)
  const zeroInventory = Number(g?.amountAvailable ?? Infinity) <= 0;

  return (
    archivedLike ||
    contaminatedLike ||
    consumedLike ||
    harvestedLike ||
    zeroInventory
  );
}

/** “Active” = not archived-ish. */
export function isActiveGrow(g = {}) {
  if (isArchivedish(g)) return false;
  if (g?.active === true) return true;
  if (g?.active === false) return false;

  const stage = String(g?.stage || "").toLowerCase();
  return ["inoculated", "colonizing", "colonized", "fruiting"].includes(stage);
}

/** Convenience splitter. */
export function partitionGrows(grows = []) {
  const active = [];
  const archived = [];
  for (const g of Array.isArray(grows) ? grows : []) {
    (isActiveGrow(g) ? active : archived).push(g);
  }
  return { active, archived };
}
