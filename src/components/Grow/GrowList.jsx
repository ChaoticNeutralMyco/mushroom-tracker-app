import React, { useEffect, useMemo, useState, useCallback } from "react";

/**
 * Props:
 * - growsActive:     Array<Grow>
 * - archivedGrows:   Array<Grow>
 * - setEditingGrow:  (growOrEmpty) => void
 * - showAddButton?:  boolean
 * - onUpdateStatus?: (growId, nextStatus) => Promise<void>   // <— NEW (optional)
 *
 * NOTE: Uses accent-aware chips for the dataset toggle:
 *   .chip + .chip--active (from index.css)
 * Buttons use .btn / .btn-outline / .btn-accent.
 *
 * Virtualization:
 * - Attempts to lazy-load `react-window`. If unavailable, gracefully falls back.
 */
export default function GrowList({
  growsActive = [],
  archivedGrows = [],
  setEditingGrow,
  showAddButton = false,
  onUpdateStatus, // optional; enables “Store” action for Agar/LC
}) {
  const [dataset, setDataset] = useState("active"); // "active" | "archived"
  const [q, setQ] = useState("");

  // lazy-import react-window (optional)
  const [RW, setRW] = useState(null);
  useEffect(() => {
    let mounted = true;
    import("react-window")
      .then((mod) => mounted && setRW(mod))
      .catch(() => {
        // no-op: not installed, fallback to non-virtualized rendering
      });
    return () => {
      mounted = false;
    };
  }, []);

  const items = useMemo(() => {
    const base = dataset === "archived" ? archivedGrows : growsActive;
    if (!q) return base;
    const needle = q.toLowerCase();
    return base.filter((g) => {
      const s = [
        g.strain,
        g.subName || g.abbreviation || g.abbr,
        g.type || g.growType,
        g.stage,
        g.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return s.includes(needle);
    });
  }, [dataset, growsActive, archivedGrows, q]);

  const counts = useMemo(
    () => ({
      active: Array.isArray(growsActive) ? growsActive.length : 0,
      archived: Array.isArray(archivedGrows) ? archivedGrows.length : 0,
    }),
    [growsActive, archivedGrows]
  );

  const onAddNew = useCallback(() => {
    if (typeof setEditingGrow === "function") setEditingGrow({});
  }, [setEditingGrow]);

  // ---- helpers for "Store" action (Agar/LC only) ----
  const normalizeType = (t = "") => {
    const s = String(t).toLowerCase();
    if (s.includes("agar")) return "Agar";
    if (s.includes("lc") || s.includes("liquid")) return "LC";
    if (s.includes("bulk")) return "Bulk";
    if (s.includes("grain")) return "Grain Jar";
    return "Other";
  };

  const canStore = (grow) => {
    if (typeof onUpdateStatus !== "function") return false;
    const t = normalizeType(grow.type || grow.growType);
    const status = String(grow.status || "").toLowerCase();
    // Only Agar or LC, and not already Stored
    return (t === "Agar" || t === "LC") && status !== "stored";
  };

  const handleStore = async (grow) => {
    try {
      await onUpdateStatus?.(grow.id, "Stored");
    } catch (e) {
      console.error("Move to Storage failed:", e);
    }
  };

  const Row = useCallback(
    ({ grow, style }) => {
      const abbr = grow.abbreviation || grow.abbr || grow.subName || "";
      const strain = grow.strain || "Unknown strain";
      const type = grow.type || grow.growType || "";
      const stage = grow.stage || "—";
      const status = grow.status || "—";
      const cost =
        typeof grow.cost === "number" && !Number.isNaN(grow.cost)
          ? `$${grow.cost.toFixed(2)}`
          : "—";
      const inoc =
        (grow.inoc || grow.inoculationDate || grow.createdAt || "")
          ?.toString()
          .slice(0, 10) || "—";

      return (
        <div
          className="grid grid-cols-12 items-center gap-3 px-3"
          style={style}
          role="row"
        >
          <div className="col-span-4 truncate" title={strain}>
            <div className="font-medium truncate">{abbr || strain}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{strain}</div>
          </div>
          <div className="col-span-2">
            <div className="text-sm">{type || "—"}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Inoc: {inoc}</div>
          </div>
          <div className="col-span-2">
            <div className="text-sm">Stage: {stage}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Status: {status}</div>
          </div>
          <div className="col-span-2 text-sm">{cost}</div>
          <div className="col-span-2 flex justify-end gap-2">
            {canStore(grow) && (
              <button
                type="button"
                className="chip"
                onClick={() => handleStore(grow)}
                title="Move to Storage (Agar/LC only)"
                aria-label="Move to Storage"
              >
                Store
              </button>
            )}
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => setEditingGrow && setEditingGrow(grow)}
              aria-label={`Edit ${abbr || strain}`}
            >
              Edit
            </button>
          </div>
        </div>
      );
    },
    [setEditingGrow, onUpdateStatus]
  );

  const Header = () => (
    <div className="grid grid-cols-12 gap-3 px-3 py-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
      <div className="col-span-4">Grow</div>
      <div className="col-span-2">Type / Inoc</div>
      <div className="col-span-2">Stage / Status</div>
      <div className="col-span-2">Cost</div>
      <div className="col-span-2" />
    </div>
  );

  const rowHeight = 64;
  const listHeight = Math.min(8 * rowHeight + 8, Math.max(rowHeight, items.length * rowHeight));

  return (
    <div className="space-y-3">
      {/* Top bar: dataset toggle + search + (optional) add new */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Dataset" className="flex items-center gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={dataset === "active"}
            className={`chip ${dataset === "active" ? "chip--active" : ""}`}
            onClick={() => setDataset("active")}
          >
            Active <span className="opacity-80">({counts.active})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dataset === "archived"}
            className={`chip ${dataset === "archived" ? "chip--active" : ""}`}
            onClick={() => setDataset("archived")}
          >
            Archived <span className="opacity-80">({counts.archived})</span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter grows…"
            className="w-48 sm:w-64 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          />
          {showAddButton && (
            <button type="button" className="btn-accent text-sm" onClick={onAddNew}>
              + New
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900">
        <Header />
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800" role="table" aria-rowcount={items.length}>
          {RW?.FixedSizeList ? (
            <RW.FixedSizeList
              height={listHeight}
              width={"100%"}
              itemCount={items.length}
              itemSize={rowHeight}
              itemKey={(index) => items[index]?.id || index}
            >
              {({ index, style }) => <Row grow={items[index]} style={style} />}
            </RW.FixedSizeList>
          ) : (
            items.map((g) => <Row key={g.id || g.abbreviation || g.strain} grow={g} />)
          )}
        </div>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="text-sm text-slate-500 dark:text-slate-400 px-1 py-2">
          No {dataset === "archived" ? "archived" : "active"} grows{q ? " match your filter" : ""}.
        </div>
      )}
    </div>
  );
}
