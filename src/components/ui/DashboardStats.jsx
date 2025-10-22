// src/components/ui/DashboardStats.jsx
import React, { useMemo } from "react";
import { isArchivedish, normalizeStage, normalizeStatus } from "../../lib/growFilters";

/**
 * DashboardStats – pure/prop-driven
 * Counts should match the list's "Active" dataset:
 *  - Exclude Archived (incl. fully-consumed legacy)
 *  - Exclude Stored
 *  - Exclude Harvested (even if not archived yet)
 */
export default function DashboardStats({ grows, recipes, supplies, loading = false }) {
  const isHydrating =
    loading || grows === undefined || recipes === undefined || supplies === undefined;

  const { totalActiveGrows, activeStrainCount, typeCount, totalCost } = useMemo(() => {
    const safeGrows = Array.isArray(grows) ? grows : [];

    // Active for STATS = not archived-ish, not stored, not harvested
    const active = safeGrows.filter((g) => {
      if (isArchivedish(g)) return false;
      const status = normalizeStatus(g?.status);
      if (status === "stored") return false;
      const stage = normalizeStage(g?.stage);
      if (stage === "Harvested") return false;
      return true;
    });

    // distinct strains among ACTIVE
    const strainSet = new Set();
    for (const g of active) {
      const s = (g?.strain || "").trim().toLowerCase();
      if (s) strainSet.add(s);
    }

    // distinct types among ACTIVE
    const typeSet = new Set();
    for (const g of active) {
      const t = (g?.type || g?.growType || g?.container || "").trim().toLowerCase();
      if (t) typeSet.add(t);
    }

    // cost across ACTIVE (keeps cards consistent with the list/timeline)
    const costSum = active.reduce((sum, g) => {
      const n = Number(g?.cost);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);

    return {
      totalActiveGrows: active.length,
      activeStrainCount: strainSet.size,
      typeCount: typeSet.size,
      totalCost: costSum,
    };
  }, [grows, recipes, supplies]);

  if (isHydrating) {
    return (
      <div className="w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl p-4 bg-gray-100 dark:bg-zinc-800 shadow">
              <div className="h-4 w-24 mb-3 rounded animate-pulse bg-gray-200 dark:bg-zinc-700" />
              <div className="h-8 w-16 rounded animate-pulse bg-gray-200 dark:bg-zinc-700" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Active Grows */}
        <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-xl shadow">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Total Active Grows</h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">{totalActiveGrows}</p>
        </div>

        {/* Active Strains */}
        <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-xl shadow">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Active Strains</h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">{activeStrainCount}</p>
        </div>

        {/* Types (ACTIVE) */}
        <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-xl shadow">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Types</h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">{typeCount}</p>
        </div>

        {/* Total Cost (ACTIVE) */}
        <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-xl shadow">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Total Cost</h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">${Number(totalCost || 0).toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}
