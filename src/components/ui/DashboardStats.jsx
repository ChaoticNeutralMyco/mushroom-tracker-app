// src/components/ui/DashboardStats.jsx
import React, { useMemo } from "react";
import { isArchivedish, normalizeStage, normalizeStatus } from "../../lib/growFilters";

/**
 * DashboardStats – pure/prop-driven
 * Counts should match the list's "Active" dataset:
 *  - Exclude Archived (incl. fully-consumed legacy)
 *  - Exclude Stored
 *  - Exclude Harvested (even if not archived yet)
 *
 * Total Cost now matches GrowList/Analytics:
 *  - Prefer per-serving cost derived from recipe + supplies + yield
 *  - Fallback to stored grow.cost when recipe/supplies are missing
 */
export default function DashboardStats({ grows, recipes, supplies, loading = false }) {
  const isHydrating =
    loading || grows === undefined || recipes === undefined || supplies === undefined;

  const { totalActiveGrows, activeStrainCount, typeCount, totalCost } = useMemo(() => {
    const safeGrows = Array.isArray(grows) ? grows : [];
    const safeRecipes = Array.isArray(recipes) ? recipes : [];
    const safeSupplies = Array.isArray(supplies) ? supplies : [];

    // Build quick lookup maps
    const recipeById = new Map();
    for (const r of safeRecipes) {
      if (r && r.id) recipeById.set(r.id, r);
    }

    const supplyCostById = new Map();
    for (const s of safeSupplies) {
      if (!s || !s.id) continue;
      const n = Number(s.cost);
      supplyCostById.set(s.id, Number.isFinite(n) ? n : 0);
    }

    const toNumber = (val, fb = 0) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : fb;
    };

    const resolveRecipeItemsForGrow = (g) => {
      if (Array.isArray(g?.recipeItems) && g.recipeItems.length) return g.recipeItems;
      const rid = g?.recipeId || g?.recipe_id || g?.recipe?.id;
      if (!rid) return null;
      const rec = recipeById.get(rid);
      return rec && Array.isArray(rec.items) ? rec.items : null;
    };

    const computeItemsCost = (items) => {
      if (!Array.isArray(items) || !items.length) return null;
      let sum = 0;
      for (const it of items) {
        const sid = it?.supplyId;
        const per =
          sid && supplyCostById.has(sid)
            ? supplyCostById.get(sid)
            : toNumber(it?.cost, 0);
        const amt = toNumber(it?.amount, 0);
        sum += per * amt;
      }
      return Math.max(0, Number(sum.toFixed(2)));
    };

    const getRecipeYieldForGrow = (g) => {
      if (!g) return 1;

      const inline = toNumber(g?.recipeYield, 0);
      if (inline > 0) return inline;

      const rid = g?.recipeId || g?.recipe_id || g?.recipe?.id;
      if (!rid) return 1;

      const rec = recipeById.get(rid);
      if (!rec) return 1;

      const y = toNumber(rec?.yield, 0);
      return y > 0 ? y : 1;
    };

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

    // Cost across ACTIVE:
    //  - Prefer derived per-serving cost from recipe+supplies+yield
    //  - Fallback to stored grow.cost when derivation is not possible
    const costSum = active.reduce((sum, g) => {
      let cost = null;

      const items = resolveRecipeItemsForGrow(g);
      if (items) {
        const batchCost = computeItemsCost(items);
        if (batchCost != null) {
          const y = getRecipeYieldForGrow(g);
          const divisor = y > 0 ? y : 1;
          cost = Math.max(0, Number(((batchCost || 0) / divisor).toFixed(2)));
        }
      }

      if (cost == null) {
        const stored = Number(g?.cost);
        cost = Number.isFinite(stored) ? stored : 0;
      }

      return sum + cost;
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
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Total Active Grows
          </h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            {totalActiveGrows}
          </p>
        </div>

        {/* Active Strains */}
        <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-xl shadow">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Active Strains
          </h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            {activeStrainCount}
          </p>
        </div>

        {/* Types (ACTIVE) */}
        <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-xl shadow">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Types</h3>
          <p className="text-3xl font-semibold text-gray-900 dark:text-white">
            {typeCount}
          </p>
        </div>

        {/* Total Cost (ACTIVE, per-serving) */}
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
