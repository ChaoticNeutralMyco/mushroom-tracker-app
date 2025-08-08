// src/pages/Archive.jsx
import React, { useMemo } from "react";

export default function Archive({ grows = [] }) {
  const isArchivedish = (g) =>
    g.status === "Archived" ||
    g.status === "Contaminated" ||
    (Number(g.amountAvailable ?? Infinity) <= 0) ||
    g.stage === "Harvested";

  const archived = useMemo(() => (Array.isArray(grows) ? grows.filter(isArchivedish) : []), [grows]);

  const byStrain = useMemo(() => {
    const map = new Map();
    for (const g of archived) {
      const key = g.strain || "Unknown";
      const arr = map.get(key) || [];
      arr.push(g);
      map.set(key, arr);
    }
    return map;
  }, [archived]);

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Archived Grows</h2>
        {archived.length === 0 && <div className="text-sm opacity-70">No archived grows yet.</div>}
        <div className="space-y-2">
          {archived.map((g) => (
            <div key={g.id} className="p-3 rounded bg-zinc-100 dark:bg-zinc-800">
              <div className="font-semibold">{g.abbreviation || g.strain}</div>
              <div className="text-xs opacity-80">
                {g.createdAt} — {g.growType} — {g.status}
                {g.amountAvailable != null ? ` — Remaining: ${g.amountAvailable}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Strain Analytics (Archived)</h2>
        {Array.from(byStrain.entries()).map(([strain, items]) => {
          const contaminated = items.filter((g) => g.status === "Contaminated").length;
          const finished = items.filter((g) => g.stage === "Harvested").length;
          const zeroed = items.filter((g) => Number(g.amountAvailable ?? Infinity) <= 0).length;
          return (
            <div key={strain} className="p-3 rounded bg-zinc-100 dark:bg-zinc-800 mb-2">
              <div className="font-semibold">{strain}</div>
              <div className="text-xs opacity-80">
                Total archived: {items.length} • Contaminated: {contaminated} • Harvested: {finished} • Emptied: {zeroed}
              </div>
            </div>
          );
        })}
        {byStrain.size === 0 && <div className="text-sm opacity-70">Nothing here yet.</div>}
      </div>
    </div>
  );
}
