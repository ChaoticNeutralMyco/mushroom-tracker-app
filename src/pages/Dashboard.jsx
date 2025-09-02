// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db, auth } from "../firebase-config";
import { isActiveGrow, isArchivedish } from "../lib/growFilters";
import GrowList from "../components/Grow/GrowList";

function Stat({ label, value }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
      <p className="text-sm text-gray-600 dark:text-gray-300">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

export default function Dashboard({ grows: growsProp }) {
  const [growsLocal, setGrowsLocal] = useState(
    Array.isArray(growsProp) ? growsProp : []
  );
  const [strainFilter, setStrainFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("All Stages");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  // Keep in sync if a parent passes grows
  useEffect(() => {
    if (Array.isArray(growsProp)) setGrowsLocal(growsProp);
  }, [growsProp]);

  // Load from Firestore when no grows were provided by a parent.
  useEffect(() => {
    if (Array.isArray(growsProp)) return;

    (async () => {
      const user = auth.currentUser;
      if (!user) return;

      // Primary collection that holds BOTH active and archived flags.
      const snap = await getDocs(collection(db, "users", user.uid, "grows"));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setGrowsLocal(all);
    })();
  }, [growsProp]);

  // Partition using the SAME rules as Archive page
  const activeGrows = useMemo(
    () => (Array.isArray(growsLocal) ? growsLocal.filter(isActiveGrow) : []),
    [growsLocal]
  );
  const archivedGrows = useMemo(
    () =>
      (Array.isArray(growsLocal) ? growsLocal.filter(isArchivedish) : []),
    [growsLocal]
  );

  // The stat cards remain ACTIVE‐only, as before
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
        (g) => g.createdAt && new Date(g.createdAt) <= new Date(dateRange.end)
      );
    }
    return data;
  }, [activeGrows, strainFilter, stageFilter, dateRange]);

  const totalActive = filteredGrows.length;
  const uniqueStrains = useMemo(
    () => new Set(filteredGrows.map((g) => g.strain).filter(Boolean)).size,
    [filteredGrows]
  );
  const uniqueTypes = useMemo(() => {
    const getType = (g) => g?.type || g?.growType || g?.container || "";
    return new Set(filteredGrows.map(getType).filter(Boolean)).size;
  }, [filteredGrows]);
  const totalCost = useMemo(
    () => filteredGrows.reduce((sum, g) => sum + Number(g.cost || 0), 0),
    [filteredGrows]
  );

  const stages = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];
  const stageCounts = useMemo(() => {
    const acc = Object.fromEntries(stages.map((s) => [s, 0]));
    for (const g of filteredGrows) {
      if (acc[g.stage] != null) acc[g.stage] += 1;
    }
    return acc;
  }, [filteredGrows]);

  return (
    <div className="p-4 space-y-4">
      {/* Stats */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-bold mb-2 flex items-center gap-2">📊 Dashboard Stats</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Total Active Grows" value={totalActive} />
          <Stat label="Active Strains" value={uniqueStrains} />
          <Stat label="Types" value={uniqueTypes} />
          <Stat label="Total Cost" value={`$${totalCost.toFixed(2)}`} />
        </div>

        {/* By Stage (ACTIVE only) */}
        <div className="bg-gray-50 dark:bg-gray-700/40 p-4 rounded border border-gray-200 dark:border-gray-700 mt-4">
          <p className="text-sm text-gray-700 dark:text-gray-200 font-semibold mb-1">By Stage</p>
          <ul className="text-sm text-gray-800 dark:text-gray-100 pl-4 list-disc space-y-0.5">
            {stages.map((s) => (
              <li key={s}>
                {s}: {stageCounts[s] || 0}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Filters for stats (unchanged) */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-bold mb-2">Filter Grows (for stats above)</h2>
        <label className="block mb-2">
          <span className="text-sm">Search by strain</span>
          <input
            type="text"
            placeholder="e.g., Golden Teacher"
            value={strainFilter}
            onChange={(e) => setStrainFilter(e.target.value)}
            className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
            aria-label="Search by strain"
          />
        </label>

        <label className="block mb-2">
          <span className="text-sm">Stage</span>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
            aria-label="Filter by stage"
          >
            <option>All Stages</option>
            {stages.map((stage) => (
              <option key={stage}>{stage}</option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <label className="w-1/2">
            <span className="text-sm">From</span>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
              className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
              aria-label="Start date"
            />
          </label>
          <label className="w-1/2">
            <span className="text-sm">To</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
              className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
              aria-label="End date"
            />
          </label>
        </div>
      </div>

      {/* Grows tile — now driven by unified archived logic */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-2">Grows</h3>
        <GrowList
          growsActive={activeGrows}
          archivedGrows={archivedGrows}
          showAddButton
        />
      </div>
    </div>
  );
}
