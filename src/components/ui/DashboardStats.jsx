// src/components/ui/DashboardStats.jsx
import React, { useMemo } from "react";

/**
 * DashboardStats
 * Pure, prop-driven. App.jsx owns Firestore listeners.
 *
 * Props
 *  - grows: array | undefined
 *  - recipes: array | undefined
 *  - supplies: array | undefined
 *  - loading: boolean (optional) – skeleton while snapshots hydrate
 */
export default function DashboardStats({ grows, recipes, supplies, loading = false }) {
  const isHydrating =
    loading || grows === undefined || recipes === undefined || supplies === undefined;

  const { totalActiveGrows, activeStrainCount, totalCost } = useMemo(() => {
    const safeGrows = Array.isArray(grows) ? grows : [];

    const isActiveGrow = (g) => {
      try {
        const status = (g?.status || "").toLowerCase();
        if (status) {
          if (["archived", "contaminated", "finished", "inactive", "done"].includes(status))
            return false;
          if (status === "active") return true;
        }
        if (g?.archived === true || g?.isArchived === true) return false;

        const stage = (g?.stage || "").toLowerCase();
        if (["contaminated", "harvested", "finished", "archived"].includes(stage)) return false;

        if (typeof g?.amountAvailable === "number") return g.amountAvailable > 0;
        if (typeof g?.remainingVolume === "number") return g.remainingVolume > 0;

        return true;
      } catch {
        return true;
      }
    };

    const active = safeGrows.filter(isActiveGrow);

    // Unique strains among ACTIVE grows
    const strainSet = new Set();
    for (const g of active) {
      const s = (g?.strain || "").trim().toLowerCase();
      if (s) strainSet.add(s);
    }

    // Sum cost across ALL grows; prefer stored numeric `cost`
    const costSum = safeGrows.reduce((sum, g) => {
      if (typeof g?.cost === "number") return sum + g.cost;
      return sum;
    }, 0);

    return {
      totalActiveGrows: active.length,
      activeStrainCount: strainSet.size,
      totalCost: costSum,
    };
  }, [grows, recipes, supplies]);

  if (isHydrating) {
    return (
      <div className="w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl p-4 bg-gray-100 dark:bg-zinc-800 shadow overflow-hidden"
            >
              <div className="h-4 w-24 mb-3 rounded animate-pulse bg-gray-200 dark:bg-zinc-700" />
              <div className="h-8 w-32 rounded animate-pulse bg-gray-200 dark:bg-zinc-700" />
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
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Total Active Grows
          </h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            {totalActiveGrows}
          </p>
        </div>

        {/* Active Strains (unique among active grows) */}
        <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-xl shadow">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Active Strains
          </h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            {activeStrainCount}
          </p>
        </div>

        {/* Types (kept simple to avoid regressions; can expand later) */}
        <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-xl shadow">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Types</h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            {Array.isArray(grows) ? grows.length : 0}
          </p>
        </div>

        {/* Total Cost */}
        <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-xl shadow">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Total Cost</h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            ${Number(totalCost || 0).toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
}
