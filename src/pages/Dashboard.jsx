// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";

// Fallback-only Firebase imports (used iff App doesn't pass props yet)
import { collection, getDocs } from "firebase/firestore";
import { db, auth } from "../firebase-config";

/**
 * Dashboard (standalone page)
 * Preferred: pass `grows` from App to avoid reads here.
 * Fallback: if no `grows` prop, it fetches once so the page still works.
 */
export default function Dashboard({ grows: growsProp }) {
  const [growsLocal, setGrowsLocal] = useState(Array.isArray(growsProp) ? growsProp : []);
  const [strainFilter, setStrainFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("All Stages");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  // Keep local in sync with prop
  useEffect(() => {
    if (Array.isArray(growsProp)) setGrowsLocal(growsProp);
  }, [growsProp]);

  // Fallback fetch (one-shot)
  useEffect(() => {
    if (Array.isArray(growsProp)) return;
    (async () => {
      const user = auth.currentUser;
      if (!user) return;
      const snapshot = await getDocs(collection(db, "users", user.uid, "grows"));
      setGrowsLocal(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, [growsProp]);

  const filteredGrows = useMemo(() => {
    let data = Array.isArray(growsLocal) ? growsLocal : [];
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
  }, [growsLocal, strainFilter, stageFilter, dateRange]);

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

  const uniqueStrains = useMemo(
    () => new Set(filteredGrows.map((g) => g.strain).filter(Boolean)).size,
    [filteredGrows]
  );

  return (
    <div className="p-4">
      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow mb-4">
        <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
          📊 Dashboard Stats
        </h2>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Total Grows" value={filteredGrows.length} />
          <Stat label="Active Strains" value={uniqueStrains} />
          <Stat label="Total Cost" value={`$${totalCost.toFixed(2)}`} />
          <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded shadow">
            <p className="text-sm text-gray-600 dark:text-gray-300 font-semibold mb-1">
              By Stage
            </p>
            <ul className="text-sm text-gray-700 dark:text-gray-300 pl-4 list-disc space-y-0.5">
              {stages.map((s) => (
                <li key={s}>
                  {s}: {stageCounts[s] || 0}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded shadow mb-4">
        <h2 className="text-xl font-bold mb-2">Filter Grows</h2>
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
              onChange={(e) =>
                setDateRange((prev) => ({ ...prev, start: e.target.value }))
              }
              className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
              aria-label="Start date"
            />
          </label>
          <label className="w-1/2">
            <span className="text-sm">To</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) =>
                setDateRange((prev) => ({ ...prev, end: e.target.value }))
              }
              className="w-full p-2 rounded border dark:bg-gray-700 dark:text-white"
              aria-label="End date"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded shadow">
      <p className="text-sm text-gray-600 dark:text-gray-300">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
