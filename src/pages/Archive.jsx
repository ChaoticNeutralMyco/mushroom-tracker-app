// src/pages/Archive.jsx
import React, { useMemo, useState } from "react";
import { auth, db } from "../firebase-config";
import { doc, updateDoc, deleteField } from "firebase/firestore";
import { isBulkGrow } from "../lib/growFilters";

function totalsFromGrow(g) {
  const flushes =
    (Array.isArray(g?.flushes) && g.flushes) ||
    (Array.isArray(g?.harvest?.flushes) && g.harvest.flushes) ||
    [];
  const t = flushes.reduce(
    (acc, f) => {
      acc.wet += Number(f?.wet) || 0;
      acc.dry += Number(f?.dry) || 0;
      return acc;
    },
    { wet: 0, dry: 0 }
  );
  if (!t.wet && g?.wetYield) t.wet = Number(g.wetYield) || 0;
  if (!t.dry && g?.dryYield) t.dry = Number(g.dryYield) || 0;
  return { ...t, count: flushes.length };
}

function isArchivedish(g) {
  // Your app shows items here if they are explicitly archived OR stage === Harvested.
  return (
    g?.archived === true ||
    String(g?.status || "").toLowerCase() === "archived" ||
    String(g?.status || "").toLowerCase() === "contaminated" ||
    String(g?.stage || "").toLowerCase() === "harvested" ||
    Number(g?.amountAvailable ?? Infinity) <= 0
  );
}

/** We only allow the quick "Unarchive" when it's clearly a mistake:
 * - bulk run,
 * - in Harvested (or flagged archived),
 * - zero flushes and zero totals (no data to lose)
 */
function canUnarchive(g) {
  if (!isBulkGrow(g)) return false;
  const stage = String(g?.stage || "").toLowerCase();
  const t = totalsFromGrow(g);
  const noYields = t.wet === 0 && t.dry === 0 && t.count === 0;
  return noYields && (stage === "harvested" || g?.archived === true);
}

export default function Archive({ grows = [] }) {
  const uid = auth.currentUser?.uid || null;
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const archived = useMemo(
    () => (Array.isArray(grows) ? grows.filter(isArchivedish) : []),
    [grows]
  );

  const byStrain = useMemo(() => {
    const map = new Map();
    for (const g of archived) {
      const key = g?.strain || "Unknown";
      const arr = map.get(key) || [];
      arr.push(g);
      map.set(key, arr);
    }
    return map;
  }, [archived]);

  async function handleUnarchive(g) {
    if (!uid) return;
    setError("");
    setBusyId(g.id);

    try {
      const ref = doc(db, "users", uid, "grows", g.id);
      // Re-open as active fruiting (bulk-only stage set),
      // and clear the harvested date if present.
      await updateDoc(ref, {
        stage: "Fruiting",
        archived: false,
        status: "Active",
        "stageDates.Harvested": deleteField(),
      });
    } catch (e) {
      setError(e?.message || "Failed to unarchive.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Archived Grows</h2>
          {error ? (
            <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
          ) : null}
        </div>

        {archived.length === 0 && (
          <div className="text-sm opacity-70 mt-2">No archived grows yet.</div>
        )}

        <div className="space-y-2 mt-2">
          {archived.map((g) => {
            const t = totalsFromGrow(g);
            const okToUnarchive = canUnarchive(g);

            return (
              <div
                key={g.id}
                className="p-3 rounded bg-zinc-100 dark:bg-zinc-800 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      {g.abbreviation || g.strain || g.id}
                    </div>
                    <div className="text-xs opacity-80">
                      {(g.createdAt || "").toString()} — {g.growType || g.type || "—"} —{" "}
                      {g.status || (g.archived ? "Archived" : g.stage || "—")}
                      {g.amountAvailable != null
                        ? ` — Remaining: ${g.amountAvailable}`
                        : ""}
                    </div>
                    {(t.wet || t.dry) && (
                      <div className="text-xs mt-1">
                        Yield: <b>{round1(t.wet)}g wet</b> ·{" "}
                        <b>{round1(t.dry)}g dry</b>
                        {t.count ? ` — ${t.count} flush${t.count > 1 ? "es" : ""}` : ""}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Only show when it's clearly a mistaken harvest with zero data */}
                    {okToUnarchive && (
                      <button
                        onClick={() => handleUnarchive(g)}
                        disabled={busyId === g.id}
                        className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs disabled:opacity-50"
                        title="Move back to Fruiting and mark as Active"
                      >
                        {busyId === g.id ? "Unarchiving…" : "Unarchive"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Strain rollup stays the same */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
        <h2 className="text-lg font-semibold mb-2">Strain Analytics (Archived)</h2>
        {Array.from(byStrain.entries()).map(([strain, items]) => {
          const contaminated = items.filter(
            (g) => String(g.status || "").toLowerCase() === "contaminated"
          ).length;
          const finished = items.filter(
            (g) =>
              String(g.stage || "").toLowerCase() === "harvested" || g.archived
          ).length;
          const zeroed = items.filter(
            (g) => Number(g.amountAvailable ?? Infinity) <= 0
          ).length;

          const yieldTotals = items.reduce(
            (acc, g) => {
              const t = totalsFromGrow(g);
              acc.wet += t.wet;
              acc.dry += t.dry;
              acc.flushes += t.count;
              return acc;
            },
            { wet: 0, dry: 0, flushes: 0 }
          );

          return (
            <div key={strain} className="p-3 rounded bg-zinc-100 dark:bg-zinc-800 mb-2">
              <div className="font-semibold flex items-center justify-between">
                <span>{strain}</span>
                {(yieldTotals.wet || yieldTotals.dry) && (
                  <span className="text-xs opacity-80">
                    Total: {round1(yieldTotals.wet)}g wet · {round1(yieldTotals.dry)}g dry ·{" "}
                    {yieldTotals.flushes} flush{yieldTotals.flushes === 1 ? "" : "es"}
                  </span>
                )}
              </div>
              <div className="text-xs opacity-80">
                Total archived: {items.length} • Contaminated: {contaminated} • Harvested:{" "}
                {finished} • Emptied: {zeroed}
              </div>
            </div>
          );
        })}
        {byStrain.size === 0 && (
          <div className="text-sm opacity-70">Nothing here yet.</div>
        )}
      </div>
    </div>
  );
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}
