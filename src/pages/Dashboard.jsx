// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db, auth } from "../firebase-config";
import { isActiveGrow, isArchivedish } from "../lib/growFilters";
import GrowList from "../components/Grow/GrowList";
import GrowForm from "../components/Grow/GrowForm";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";

function Stat({ label, value }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
      <p className="text-sm text-gray-600 dark:text-gray-300">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

export default function Dashboard({ grows: growsProp }) {
  const location = useLocation();

  const [growsLocal, setGrowsLocal] = useState(
    Array.isArray(growsProp) ? growsProp : []
  );
  const [strainFilter, setStrainFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("All Stages");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  // sync from props
  useEffect(() => {
    if (Array.isArray(growsProp)) setGrowsLocal(growsProp);
  }, [growsProp]);

  // fallback Firestore load
  useEffect(() => {
    if (Array.isArray(growsProp)) return;
    (async () => {
      const user = auth.currentUser;
      if (!user) return;
      const snap = await getDocs(collection(db, "users", user.uid, "grows"));
      setGrowsLocal(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, [growsProp]);

  const activeGrows = useMemo(
    () => (Array.isArray(growsLocal) ? growsLocal.filter(isActiveGrow) : []),
    [growsLocal]
  );
  const archivedGrows = useMemo(
    () => (Array.isArray(growsLocal) ? growsLocal.filter(isArchivedish) : []),
    [growsLocal]
  );

  // modal state
  const [editingGrow, setEditingGrow] = useState(null);
  const closeModal = () => setEditingGrow(null);

  // open from prefill (also on SPA navigation)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("prefillGrowFromLibrary");
      if (raw) {
        const prefill = JSON.parse(raw);
        setEditingGrow(prefill || {});
        localStorage.removeItem("prefillGrowFromLibrary");
      }
    } catch {}
  }, [location.pathname, location.search, location.hash]);

  // ESC to close
  useEffect(() => {
    if (editingGrow == null) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingGrow]);

  // stats (active only)
  const filteredGrows = useMemo(() => {
    let data = [...activeGrows];
    if (strainFilter) {
      const f = strainFilter.toLowerCase();
      data = data.filter((g) => (g.strain || "").toLowerCase().includes(f));
    }
    if (stageFilter !== "All Stages") {
      data = data.filter((g) => g.stage === stageFilter);
    }
    if (dateRange.start) {
      data = data.filter(
        (g) => g.createdAt && new Date(g.createdAt) >= new Date(dateRange.start)
      );
    }
    if (dateRange.end) {
      data = data.filter(
        (g) =>
          g.createdAt &&
          new Date(g.createdAt) <=
            new Date(new Date(dateRange.end).getTime() + 86400000 - 1)
      );
    }
    return data;
  }, [activeGrows, strainFilter, stageFilter, dateRange]);

  const totalActive = filteredGrows.length;
  const uniqueStrains = useMemo(() => {
    const s = new Set(filteredGrows.map((g) => g.strain || ""));
    s.delete("");
    return s.size;
  }, [filteredGrows]);
  const growTypes = useMemo(() => {
    const s = new Set(filteredGrows.map((g) => g.type || g.growType || ""));
    s.delete("");
    return s.size;
  }, [filteredGrows]);
  const totalCost = useMemo(
    () => filteredGrows.reduce((acc, g) => acc + (Number(g.cost) || 0), 0).toFixed(2),
    [filteredGrows]
  );

  const stages = [
    "Inoculated",
    "Colonizing",
    "Colonized",
    "Fruiting",
    "Harvested",
    "Consumed",
    "Contaminated",
  ];

  return (
    <div className="p-4 space-y-4">
      {/* Stats */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-bold mb-2 flex items-center gap-2">📊 Dashboard Stats</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Total Active Grows" value={totalActive} />
          <Stat label="Active Strains" value={uniqueStrains} />
          <Stat label="Types" value={growTypes} />
          <Stat label="Total Cost" value={`$${totalCost}`} />
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-3">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col">
            <span className="text-sm">Strain</span>
            <input
              value={strainFilter}
              onChange={(e) => setStrainFilter(e.target.value)}
              placeholder="e.g. Golden Teacher"
              className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-sm">Stage</span>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
            >
              <option>All Stages</option>
              {stages.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col">
              <span className="text-sm">From</span>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange((d) => ({ ...d, start: e.target.value }))}
                className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm">To</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange((d) => ({ ...d, end: e.target.value }))}
                className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Grows */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-2">Grows</h3>
        <GrowList
          growsActive={activeGrows}
          archivedGrows={archivedGrows}
          setEditingGrow={setEditingGrow}
          showAddButton
        />
      </div>

      {/* Modal: Add/Edit Grow */}
      {editingGrow !== null && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 font-semibold flex items-center justify-between">
              <span>New Grow</span>
              <button
                className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={closeModal}
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <GrowForm
                editingGrow={editingGrow || {}}
                Close={closeModal}
                onClose={closeModal}
                onCancel={closeModal}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
