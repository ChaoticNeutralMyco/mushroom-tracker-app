// src/components/Grow/GrowList.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { db, auth } from "../../firebase-config";
import { updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { useConfirm } from "../ui/ConfirmDialog";

/**
 * GrowList
 * - Compact rows, filters, search, presets
 * - Row quick actions with CONFIRMS:
 *   • Stage + (disabled at end; confirm → persists)
 *   • Archive/Unarchive (confirm → persists)
 *   • Delete (confirm → persists)
 *   • Store/Unstore (confirm → persists for Agar/LC)
 * - Batch actions bar:
 *   • Select all / Clear
 *   • Stage + (bulk)
 *   • Archive/Unarchive (bulk)
 *   • Store/Unstore (bulk)
 *   • Delete (bulk)
 * - Cover photos on rows
 * - Performance: memoized derived data
 */

export default function GrowList({
  growsActive = [],
  archivedGrows = [],
  setEditingGrow,
  showAddButton = false,
  onUpdateStatus,
  onUpdateStage,
  onDeleteGrow,
}) {
  const confirm = useConfirm();

  // ---------- Filtering state ----------
  const [dataset, setDataset] = useState("active"); // "active" | "archived"
  const [q, setQ] = useState("");

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
  const STAGE_FLOW = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested", "Consumed"];

  // Persisted filters (localStorage)
  const lastKey = "growFiltersLast";
  const presetsKey = "growFiltersPresets";
  const restoreLast = (key, fallback) => {
    try {
      const obj = JSON.parse(localStorage.getItem(lastKey) || "{}");
      return obj[key] ?? fallback;
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

  // ---------- Selection ----------
  const [selected, setSelected] = useState(() => new Set());
  const clearSel = () => setSelected(new Set());
  const toggleSel = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ---------- Local optimistic fields ----------
  const [localStage, setLocalStage] = useState({});
  const [localStatus, setLocalStatus] = useState({});
  const [localArchived, setLocalArchived] = useState({});

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
  const nextStageOf = (cur) => {
    const idx = STAGE_FLOW.indexOf(cur);
    if (idx < 0 || idx >= STAGE_FLOW.length - 1) return null;
    return STAGE_FLOW[idx + 1];
  };

  // ---------- Restore persisted ----------
  useEffect(() => {
    const t = restoreLast("types", []);
    const s = restoreLast("stages", []);
    setTypes(t);
    setStages(s);
  }, []);

  useEffect(() => {
    persistLast({ types, stages });
  }, [types, stages]);

  // ---------- Datasets ----------
  const itemsActive = useMemo(() => (Array.isArray(growsActive) ? growsActive : []), [growsActive]);
  const itemsArchived = useMemo(
    () => (Array.isArray(archivedGrows) ? archivedGrows : []),
    [archivedGrows]
  );
  const items = useMemo(
    () => (dataset === "archived" ? itemsArchived : itemsActive),
    [dataset, itemsActive, itemsArchived]
  );

  // ---------- Derived filters ----------
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const ts = new Set(types);
    const ss = new Set(stages);
    const matchQ = (g) =>
      !qq ||
      String(g.name || g.title || "").toLowerCase().includes(qq) ||
      String(g.strain || "").toLowerCase().includes(qq) ||
      String(g.type || "").toLowerCase().includes(qq);
    const matchType = (g) => ts.size === 0 || ts.has(normalizeType(g.type || g.growType));
    const matchStage = (g) => ss.size === 0 || ss.has(normalizeStage(g.stage || ""));
    return items.filter((g) => matchQ(g) && matchType(g) && matchStage(g));
  }, [items, q, types, stages]);

  const selectedIds = useMemo(() => [...selected], [selected]);

  // ---------- Firestore ops ----------
  const applyStage = async (id, stage) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid, "grows", id), {
      stage,
      updatedAt: serverTimestamp(),
    });
    setLocalStage((p) => ({ ...p, [id]: stage }));
    onUpdateStage?.(id, stage);
  };
  const applyStatus = async (id, status) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid, "grows", id), {
      status,
      updatedAt: serverTimestamp(),
    });
    setLocalStatus((p) => ({ ...p, [id]: status }));
    setLocalArchived((p) => ({ ...p, [id]: status === "Archived" }));
    onUpdateStatus?.(id, status);
  };
  const applyDelete = async (id) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await deleteDoc(doc(db, "users", uid, "grows", id));
    onDeleteGrow?.(id);
  };

  // row actions
  const handleStoreToggle = async (grow) => {
    if (!grow?.id) return;
    const isStored = String(localStatus[grow.id] || grow.status || "").toLowerCase() === "stored";
    const next = isStored ? "Active" : "Stored";
    if (!(await confirm(`${isStored ? "Unstore" : "Store"} this grow?`))) return;
    await applyStatus(grow.id, next);
  };

  const handleNextStage = async (grow) => {
    const cur = normalizeStage(localStage[grow.id] || grow.stage);
    const next = nextStageOf(cur);
    if (!next) return;
    if (!(await confirm(`Advance stage to "${next}"?`))) return;
    await applyStage(grow.id, next);
  };

  const handleArchiveToggle = async (grow) => {
    if (!grow?.id) return;
    const status = String(localStatus[grow.id] || grow.status || "").toLowerCase();
    const next = status === "archived" ? "Active" : "Archived";
    if (!(await confirm(`${status === "archived" ? "Unarchive" : "Archive"} this grow?`))) return;
    await applyStatus(grow.id, next);
  };

  const handleDelete = async (grow) => {
    if (!grow?.id) return;
    if (!(await confirm("Delete this grow? This cannot be undone."))) return;
    await applyDelete(grow.id);
  };

  // ---------- Batch actions ----------
  const batchArchive = async () => {
    if (!selectedIds.length) return;
    if (!(await confirm(`Archive ${selectedIds.length} grow(s)?`))) return;
    await Promise.all(selectedIds.map((id) => applyStatus(id, "Archived")));
    clearSel();
  };
  const batchUnarchive = async () => {
    if (!selectedIds.length) return;
    if (!(await confirm(`Unarchive ${selectedIds.length} grow(s)?`))) return;
    await Promise.all(selectedIds.map((id) => applyStatus(id, "Active")));
    clearSel();
  };
  const batchDelete = async () => {
    if (!selectedIds.length) return;
    if (!(await confirm(`Delete ${selectedIds.length} grow(s)? This cannot be undone.`))) return;
    await Promise.all(selectedIds.map((id) => applyDelete(id)));
    clearSel();
  };

  const eligibleForStagePlus = useMemo(() => {
    const out = [];
    for (const id of selectedIds) {
      const grow = filtered.find((g) => g.id === id);
      if (!grow) continue;
      const cur = normalizeStage(localStage[id] || grow.stage);
      const next = nextStageOf(cur);
      if (next) out.push({ id, next });
    }
    return out;
  }, [selectedIds, filtered, localStage]);

  const eligibleForStore = useMemo(() => {
    return selectedIds.filter((id) => {
      const grow = filtered.find((g) => g.id === id);
      if (!grow) return false;
      const status = String(localStatus[id] || grow.status || "").toLowerCase();
      return status !== "stored";
    });
  }, [selectedIds, filtered, localStatus]);

  const eligibleForUnstore = useMemo(() => {
    return selectedIds.filter((id) => {
      const grow = filtered.find((g) => g.id === id);
      if (!grow) return false;
      const status = String(localStatus[id] || grow.status || "").toLowerCase();
      return status === "stored";
    });
  }, [selectedIds, filtered, localStatus]);

  const batchStagePlus = async () => {
    if (!eligibleForStagePlus.length) return;
    if (!(await confirm(`Advance stage for ${eligibleForStagePlus.length} grow(s)?`))) return;
    await Promise.all(eligibleForStagePlus.map(({ id, next }) => applyStage(id, next)));
    clearSel();
  };

  const batchStore = async () => {
    if (!eligibleForStore.length) return;
    if (!(await confirm(`Store ${eligibleForStore.length} grow(s)?`))) return;
    await Promise.all(eligibleForStore.map((id) => applyStatus(id, "Stored")));
    clearSel();
  };

  const batchUnstore = async () => {
    if (!eligibleForUnstore.length) return;
    if (!(await confirm(`Unstore ${eligibleForUnstore.length} grow(s)?`))) return;
    await Promise.all(eligibleForUnstore.map((id) => applyStatus(id, "Active")));
    clearSel();
  };

  // ---------- Row ----------
  const Row = useCallback(
    ({ grow, style }) => {
      const abbr = grow.abbreviation || grow.abbr || grow.subName || "";
      const strain = grow.strain || "Unknown strain";
      const type = grow.type || grow.growType || "";
      const stage = localStage[grow.id] || grow.stage || "—";
      const status = localStatus[grow.id] || grow.status || "—";
      const costNumber = typeof grow.cost === "number" && !Number.isNaN(grow.cost) ? grow.cost : null;
      const inoc =
        (grow.inoc || grow.inoculationDate || grow.createdAt || "")?.toString().slice(0, 10) || "—";
      const title = abbr || strain;

      const checked = selectedIds.includes(grow.id);

      const curNorm = normalizeStage(stage);
      const atEnd = STAGE_FLOW.indexOf(curNorm) === STAGE_FLOW.length - 1 || curNorm === "Other";
      const canStagePlus = !atEnd;

      const isArchived =
        String(localArchived[grow.id] ?? (grow.status || "")).toLowerCase() === "archived";
      const canArchiveToggle = true;

      const isStored = String(status || "").toLowerCase() === "stored";

      return (
        <div
          className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
          style={style}
        >
          <input
            type="checkbox"
            aria-label="Select row"
            checked={checked}
            onChange={() => toggleSel(grow.id)}
          />

          {/* Cover */}
          {grow.coverUrl ? (
            <img
              alt=""
              src={grow.coverUrl}
              className="w-12 h-12 rounded-lg object-cover bg-zinc-200 dark:bg-zinc-800"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          )}

          {/* Main */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link to={`/grow/${grow.id}`} className="font-medium truncate hover:underline">
                {title || "Untitled"}
              </Link>
              <span className="chip">{type || "Other"}</span>
              <span className="chip">{stage}</span>
              <span className="chip">{status}</span>
              {costNumber !== null && <span className="chip">${costNumber.toFixed(2)}</span>}
            </div>
            <div className="text-xs opacity-70">
              Inoculated: {inoc} • Strain: {grow.strain || "—"}
            </div>
          </div>

          {/* Row actions */}
          <div className="flex items-center gap-1">
            <Link className="chip" to={`/grow/${grow.id}`}>
              Open
            </Link>
            <button className="chip" onClick={() => setEditingGrow(grow)}>
              Stage/Status
            </button>
            <button className="chip" onClick={() => handleNextStage(grow)} disabled={!canStagePlus}>
              Stage +
            </button>
            <button className="chip" onClick={() => handleArchiveToggle(grow)} disabled={!canArchiveToggle}>
              {isArchived ? "Unarchive" : "Archive"}
            </button>
            <button className="chip" onClick={() => handleStoreToggle(grow)}>
              {isStored ? "Unstore" : "Store"}
            </button>
            <button className="chip" onClick={() => handleDelete(grow)}>
              Delete
            </button>
          </div>
        </div>
      );
    },
    [
      selectedIds,
      localStage,
      localStatus,
      localArchived,
      setEditingGrow,
      handleNextStage,
      handleArchiveToggle,
      handleStoreToggle,
    ]
  );

  // ---------- Render ----------
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900">
          <button
            className={`px-3 py-1.5 rounded-l-xl ${dataset === "active" ? "accent-bg text-white" : ""}`}
            onClick={() => setDataset("active")}
          >
            Active
          </button>
          <button
            className={`px-3 py-1.5 rounded-r-xl ${dataset === "archived" ? "accent-bg text-white" : ""}`}
            onClick={() => setDataset("archived")}
          >
            Archived
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search grows…"
          className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
        />

        {/* Type filter chips */}
        <div className="flex flex-wrap items-center gap-1">
          {TYPE_OPTIONS.map((t) => {
            const active = types.includes(t);
            return (
              <button
                key={t}
                className={`chip ${active ? "chip--active" : ""}`}
                onClick={() =>
                  setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
                }
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Stage filter chips */}
        <div className="flex flex-wrap items-center gap-1">
          {STAGE_OPTIONS.map((t) => {
            const active = stages.includes(t);
            return (
              <button
                key={t}
                className={`chip ${active ? "chip--active" : ""}`}
                onClick={() =>
                  setStages((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
                }
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Presets */}
        <div className="ml-auto flex items-center gap-2">
          <select
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs"
            value={selectedPreset}
            onChange={(e) => {
              const name = e.target.value;
              setSelectedPreset(name);
              const p = presets.find((x) => x.name === name);
              if (!p) return;
              setTypes([...p.types]);
              setStages([...p.stages]);
              persistLast({ types: p.types, stages: p.stages });
            }}
          >
            <option value="">Presets…</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="chip"
            onClick={() => {
              const name = window.prompt("Preset name?");
              if (!name) return;
              const next = { name, types, stages };
              setPresets((prev) => {
                const arr = prev.filter((x) => x.name !== name);
                const out = [...arr, next];
                try {
                  localStorage.setItem(presetsKey, JSON.stringify(out));
                } catch {}
                return out;
              });
              setSelectedPreset(name);
            }}
          >
            Save preset
          </button>
          <button
            className="chip"
            onClick={() => {
              if (!selectedPreset) return;
              setPresets((prev) => {
                const out = prev.filter((x) => x.name !== selectedPreset);
                try {
                  localStorage.setItem(presetsKey, JSON.stringify(out));
                } catch {}
                return out;
              });
              setSelectedPreset("");
            }}
          >
            Delete preset
          </button>
        </div>

        {showAddButton && (
          <button className="chip chip--active" onClick={() => setEditingGrow({})}>
            + New
          </button>
        )}
      </div>

      {/* Batch bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800">
          <span className="text-sm opacity-80">{selectedIds.length} selected</span>
          <button className="chip" onClick={() => setSelected(new Set(filtered.map((g) => g.id)))}>
            Select all
          </button>
          <button className="chip" onClick={clearSel}>
            Clear
          </button>
          <button className="chip" onClick={batchStagePlus} disabled={eligibleForStagePlus.length === 0}>
            Stage +
          </button>
          <button className="chip" onClick={batchArchive}>
            Archive
          </button>
          <button className="chip" onClick={batchUnarchive}>
            Unarchive
          </button>
          <button className="chip" onClick={batchStore} disabled={eligibleForStore.length === 0}>
            Store
          </button>
          <button className="chip" onClick={batchUnstore} disabled={eligibleForUnstore.length === 0}>
            Unstore
          </button>
          <button className="chip" onClick={batchDelete}>
            Delete
          </button>
        </div>
      )}

      {/* Rows */}
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow">
        {filtered.map((g) => (
          <Row key={g.id || g.abbreviation || g.strain} grow={g} />
        ))}
      </div>

      {items.length === 0 && (
        <div className="text-sm text-slate-500 dark:text-slate-400 px-1 py-2">
          No {dataset === "archived" ? "archived" : "active"} grows match your filters.
        </div>
      )}
    </div>
  );
}
