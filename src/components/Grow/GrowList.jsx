import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";

/**
 * GrowList
 * - Compact rows, subtle separators (styled in desktop.css)
 * - Multi-tag filters (Type/Stage), Clear all, local presets
 * - Cost right-aligned; smaller Store/Edit buttons
 * - NEW: Grow name is a <Link> to /grow/:id
 *
 * Props:
 * - growsActive:   Array<Grow>
 * - archivedGrows: Array<Grow>
 * - setEditingGrow(growOrEmpty)
 * - showAddButton?: boolean
 * - onUpdateStatus?(growId, nextStatus)
 */
export default function GrowList({
  growsActive = [],
  archivedGrows = [],
  setEditingGrow,
  showAddButton = false,
  onUpdateStatus,
}) {
  // ---------- Filtering state ----------
  const [dataset, setDataset] = useState("active"); // "active" | "archived"
  const [q, setQ] = useState("");

  // Multi-select filters
  const TYPE_OPTIONS = ["Agar", "LC", "Grain Jar", "Bulk", "Other"];
  const STAGE_OPTIONS = [
    "Inoculated",
    "Colonizing",
    "Colonized",
    "Fruiting",
    "Harvested",
    "Consumed",
    "Contaminated",
    "Other",
  ];

  const lastKey = "growFiltersLast";
  const presetsKey = "growFiltersPresets";

  const restoreLast = (key, fallback) => {
    try {
      const obj = JSON.parse(localStorage.getItem(lastKey) || "{}");
      return Array.isArray(obj[key]) ? obj[key] : fallback;
    } catch {
      return fallback;
    }
  };

  const [types, setTypes] = useState(() => restoreLast("types", []));
  const [stages, setStages] = useState(() => restoreLast("stages", []));
  const [presets, setPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(presetsKey) || "[]");
    } catch {
      return [];
    }
  });
  const [selectedPreset, setSelectedPreset] = useState("");

  const persistLast = (next) => {
    try {
      const prev = JSON.parse(localStorage.getItem(lastKey) || "{}");
      localStorage.setItem(lastKey, JSON.stringify({ ...prev, ...next }));
    } catch {}
  };

  // ---------- Virtualization (optional; loads if available) ----------
  const [RW, setRW] = useState(null);
  useEffect(() => {
    let mounted = true;
    import("react-window")
      .then((m) => mounted && setRW(m))
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // ---------- Helpers ----------
  const normalizeType = (t = "") => {
    const s = String(t).toLowerCase();
    if (s.includes("agar")) return "Agar";
    if (s.includes("lc") || s.includes("liquid")) return "LC";
    if (s.includes("grain")) return "Grain Jar";
    if (s.includes("bulk")) return "Bulk";
    return "Other";
  };
  const normalizeStage = (st = "") => {
    const s = String(st).toLowerCase();
    if (s.startsWith("inoc")) return "Inoculated";
    if (s.includes("colonizing")) return "Colonizing";
    if (s.includes("colonized")) return "Colonized";
    if (s.includes("fruit")) return "Fruiting";
    if (s.includes("harvest")) return "Harvested";
    if (s.includes("consum")) return "Consumed";
    if (s.includes("contam")) return "Contaminated";
    return "Other";
  };

  // --- NEW: consumed logic helpers ---
  const allGrows = useMemo(
    () => [...(Array.isArray(growsActive) ? growsActive : []), ...(Array.isArray(archivedGrows) ? archivedGrows : [])],
    [growsActive, archivedGrows]
  );

  const coerceId = (v) => {
    if (!v) return null;
    if (typeof v === "string") return v;
    return v.id || v.growId || v.docId || v._id || null;
  };

  // Set of grow IDs that were referenced as a parent by another grow
  const parentUsedSet = useMemo(() => {
    const s = new Set();
    for (const g of allGrows) {
      const cands = [g.parentId, g.parentGrowId, g.parentRef, g.parent];
      for (const c of cands) {
        const id = coerceId(c);
        if (id) s.add(String(id));
      }
    }
    return s;
  }, [allGrows]);

  // Try to read a "remaining" number from common fields
  const getRemaining = (g) => {
    const cands = [
      g.remaining,
      g.remainingQty,
      g.qtyRemaining,
      g.amountRemaining,
      g.balance,
      g?.harvest?.remaining,
      g?.harvest?.balance,
    ];
    for (const v of cands) {
      if (v === undefined || v === null) continue;
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
    return null;
  };

  const isConsumedGrow = useCallback(
    (g) => {
      const text = `${g?.stage || ""} ${g?.status || ""} ${g?.outcome || ""}`.toLowerCase();
      if (text.includes("consum")) return true; // explicit Consumed status/stage/outcome
      const rem = getRemaining(g);
      if (typeof rem === "number" && rem <= 0) return true; // zero/negative remaining
      const id = coerceId(g?.id || g?.docId || g?._id);
      if (id && parentUsedSet.has(String(id))) return true; // was used as parent
      return false;
    },
    [parentUsedSet]
  );

  // ---------- Toggle handlers ----------
  const toggleType = (t) => {
    setTypes((prev) => {
      const has = prev.includes(t);
      const next = has ? prev.filter((x) => x !== t) : [...prev, t];
      persistLast({ types: next });
      return next;
    });
  };
  const toggleStage = (s) => {
    setStages((prev) => {
      const has = prev.includes(s);
      const next = has ? prev.filter((x) => x !== s) : [...prev, s];
      persistLast({ stages: next });
      return next;
    });
  };
  const clearAll = () => {
    setTypes([]);
    setStages([]);
    setQ("");
    setSelectedPreset("");
    persistLast({ types: [], stages: [], q: "" });
  };

  // ---------- Presets ----------
  const savePreset = () => {
    const name = window.prompt("Preset name?");
    if (!name) return;
    const next = { name, types: [...types], stages: [...stages] };
    setPresets((prev) => {
      const out = [...prev.filter((p) => p.name !== name), next];
      localStorage.setItem(presetsKey, JSON.stringify(out));
      return out;
    });
    setSelectedPreset(name);
  };
  const loadPreset = (name) => {
    setSelectedPreset(name);
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setTypes([...p.types]);
    setStages([...p.stages]);
    persistLast({ types: p.types, stages: p.stages });
  };
  const deletePreset = () => {
    if (!selectedPreset) return;
    setPresets((prev) => {
      const out = prev.filter((p) => p.name !== selectedPreset);
      localStorage.setItem(presetsKey, JSON.stringify(out));
      return out;
    });
    setSelectedPreset("");
  };

  // ---------- Data ----------
  const base = useMemo(
    () => (dataset === "archived" ? archivedGrows : growsActive),
    [dataset, archivedGrows, growsActive]
  );

  const items = useMemo(() => {
    let arr = Array.isArray(base) ? base : [];

    // text filter
    const needle = q.trim().toLowerCase();
    if (needle) {
      arr = arr.filter((g) => {
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
    }

    // type filter
    if (types.length) {
      arr = arr.filter((g) => types.includes(normalizeType(g.type || g.growType)));
    }

    // stage filter (SPECIAL handling for "Consumed")
    if (stages.length) {
      arr = arr.filter((g) => {
        const n = normalizeStage(g.stage);
        if (stages.includes(n)) return true;
        if (stages.includes("Consumed") && isConsumedGrow(g)) return true;
        return false;
      });
    }
    return arr;
  }, [base, q, types, stages, isConsumedGrow]);

  const counts = useMemo(
    () => ({
      active: Array.isArray(growsActive) ? growsActive.length : 0,
      archived: Array.isArray(archivedGrows) ? archivedGrows.length : 0,
    }),
    [growsActive, archivedGrows]
  );

  // ---- actions ----
  const onAddNew = useCallback(() => {
    if (typeof setEditingGrow === "function") setEditingGrow({});
  }, [setEditingGrow]);

  const canStore = (grow) => {
    if (typeof onUpdateStatus !== "function") return false;
    const t = normalizeType(grow.type || grow.growType);
    const status = String(grow.status || "").toLowerCase();
    return (t === "Agar" || t === "LC") && status !== "stored";
  };

  const handleStore = async (grow) => {
    try {
      await onUpdateStatus?.(grow.id, "Stored");
    } catch (e) {
      console.error("Store failed:", e);
    }
  };

  // ---------- Row ----------
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

      const title = abbr || strain;

      return (
        <div className="grid grid-cols-12 items-center gap-3 px-3" style={style} role="row">
          <div className="col-span-4 truncate" title={strain}>
            {grow.id ? (
              <Link
                to={`/grow/${grow.id}`}
                className="font-medium truncate hover:underline focus:underline"
                title="Open grow details"
              >
                {title}
              </Link>
            ) : (
              <span className="font-medium truncate">{title}</span>
            )}
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

          <div className="col-span-2 text-sm text-right cost">{cost}</div>

          <div className="col-span-2 flex justify-end gap-2">
            {canStore(grow) && (
              <button
                type="button"
                className="chip"
                onClick={() => handleStore(grow)}
                title="Move to Storage (Agar/LC)"
              >
                Store
              </button>
            )}
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => setEditingGrow && setEditingGrow(grow)}
              aria-label={`Edit ${title}`}
            >
              Edit
            </button>
          </div>
        </div>
      );
    },
    [setEditingGrow, onUpdateStatus]
  );

  const rowHeight = 64;
  const listHeight = Math.min(
    8 * rowHeight + 8,
    Math.max(rowHeight, (items.length || 1) * rowHeight)
  );

  // ---------- UI ----------
  return (
    <div className="space-y-3 grow-list">
      {/* Dataset + search */}
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
            onChange={(e) => {
              setQ(e.target.value);
              persistLast({ q: e.target.value });
            }}
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

      {/* Filters + presets */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Type</span>
          {TYPE_OPTIONS.map((t) => {
            const active = types.includes(t);
            return (
              <button key={t} className={`chip ${active ? "chip--active" : ""}`} onClick={() => toggleType(t)}>
                {t}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Stage</span>
          {STAGE_OPTIONS.map((s) => {
            const active = stages.includes(s);
            return (
              <button key={s} className={`chip ${active ? "chip--active" : ""}`} onClick={() => toggleStage(s)}>
                {s}
              </button>
            );
          })}

          <div className="ml-auto flex items-center gap-2">
            {(types.length || stages.length || q) ? (
              <button className="text-xs underline opacity-80 hover:opacity-100" onClick={clearAll}>
                Clear all
              </button>
            ) : null}

            <button className="chip text-xs" onClick={savePreset}>💾 Save preset</button>

            <select
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs"
              value={selectedPreset}
              onChange={(e) => loadPreset(e.target.value)}
            >
              <option value="">Presets…</option>
              {presets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="text-xs px-2 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50"
              onClick={deletePreset}
              disabled={!selectedPreset}
              title="Delete selected preset"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-white dark:bg-zinc-900">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800" role="table" aria-rowcount={items.length}>
          {RW?.FixedSizeList ? (
            <RW.FixedSizeList
              height={listHeight}
              width={"100%"}
              itemCount={items.length}
              itemSize={64}
              itemKey={(index) => items[index]?.id || index}
            >
              {({ index, style }) => <Row grow={items[index]} style={style} />}
            </RW.FixedSizeList>
          ) : (
            items.map((g) => <Row key={g.id || g.abbreviation || g.strain} grow={g} />)
          )}
        </div>
      </div>

      {items.length === 0 && (
        <div className="text-sm text-slate-500 dark:text-slate-400 px-1 py-2">
          No {dataset === "archived" ? "archived" : "active"} grows match your filters.
        </div>
      )}
    </div>
  );
}
