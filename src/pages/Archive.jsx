// src/pages/Archive.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  onSnapshot,
  updateDoc,
  doc,
  serverTimestamp,
  deleteField,
} from "firebase/firestore";
import { db, auth } from "../firebase-config";
import { Box, Recycle, AlertTriangle, X } from "lucide-react";
import { isArchivedish, normalizeStage, normalizeType } from "../lib/growFilters";

/* ---------------- UI bits ---------------- */
function Row({ children, className = "" }) {
  return (
    <div
      className={
        "px-4 py-3 flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 " +
        className
      }
    >
      {children}
    </div>
  );
}

function StatText({ label, value }) {
  return (
    <span className="text-xs text-zinc-500">
      {label}: <span className="text-zinc-700 dark:text-zinc-200">{value}</span>
    </span>
  );
}

/* ---------------- Modal ---------------- */
function UnarchiveModal({ grow, onClose, onSubmit }) {
  const normType = normalizeType(grow?.growType);
  const prevStage = normalizeStage(grow?.stage);
  const isBulk = normType === "Bulk";

  // If previous was Consumed/Contaminated or 0 remaining, default to a non-terminal active stage
  const defaultStage =
    prevStage === "Consumed"
      ? isBulk
        ? "Harvested"
        : "Colonized"
      : prevStage || (isBulk ? "Colonizing" : "Inoculated");

  const [amount, setAmount] = useState(grow?.amountAvailable ?? 0);
  const [unit] = useState(grow?.amountUnit || grow?.volumeUnit || (isBulk ? "g" : "ml"));
  const [stage, setStage] = useState(defaultStage);
  const [status, setStatus] = useState("Active");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const stageOptions =
    normType === "Bulk"
      ? ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"]
      : ["Inoculated", "Colonizing", "Colonized"];

  // Require an amount if it was archived at 0 (or missing)
  const mustRequireAmount = Number(grow?.amountAvailable || 0) <= 0;

  function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    const nAmt = Number(amount);
    if (mustRequireAmount && !(nAmt > 0)) {
      setErr("This grow was archived at 0. Enter a positive amount to activate it.");
      return;
    }

    // Guard: if user left stage at Consumed but provided >0 remaining, force a valid active stage.
    const stageNorm = normalizeStage(stage);
    let nextStage = stage;
    if (nAmt > 0 && stageNorm === "Consumed") {
      nextStage = isBulk ? "Harvested" : "Colonized";
    }

    onSubmit({
      amountAvailable: Number.isFinite(nAmt) ? nAmt : 0,
      stage: nextStage,
      status,
      unarchiveNote: note,
      unit,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl max-w-lg w-full overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="font-semibold">Unarchive Grow</h3>
          </div>
        <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 text-sm space-y-3">
          <p className="text-zinc-600 dark:text-zinc-300">
            Move this grow back to the active list. Confirm the details below.
          </p>

          <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-3 space-y-1">
            <div className="font-medium">{grow?.abbreviation || grow?.id}</div>
            <div className="text-xs text-zinc-500">
              {grow?.growType} — {grow?.strain}
            </div>
            <div className="flex flex-wrap gap-3 mt-1">
              <StatText label="Previous stage" value={grow?.stage || "—"} />
              <StatText label="Previous status" value={grow?.status || "Archived"} />
              <StatText
                label="Remaining"
                value={`${grow?.amountAvailable ?? 0} ${grow?.amountUnit || grow?.volumeUnit || ""}`}
              />
            </div>
          </div>

          {mustRequireAmount ? (
            <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-xs">
              Archived at 0 remaining. Enter the corrected amount to re-activate it.
            </div>
          ) : (
            <div className="text-xs text-zinc-500">Adjust the remaining amount if needed.</div>
          )}

          <label className="block text-xs font-medium">Remaining amount</label>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min={mustRequireAmount ? 0.00001 : 0}
              required={mustRequireAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 ${
                mustRequireAmount ? "ring-1 ring-amber-300" : ""
              }`}
            />
            <span className="px-2 py-2 rounded bg-zinc-100 dark:bg-zinc-800 text-xs">{unit}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium">Stage</label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
              >
                {stageOptions.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
              >
                {/* Status, not stage */}
                <option>Active</option>
                <option>Stored</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
              placeholder="Why are you unarchiving? e.g., data entry correction"
            />
          </div>

          {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
        </div>

        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700"
          >
            Cancel
          </button>
          <button type="submit" className="px-3 py-1.5 rounded-full accent-bg text-white">
            Confirm Unarchive
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Page ---------------- */
export default function Archive({ grows: growsProp, onUpdateGrow }) {
  const [growsLocal, setGrowsLocal] = useState(Array.isArray(growsProp) ? growsProp : []);
  const [selected, setSelected] = useState(null);

  // keep in sync with props
  useEffect(() => {
    if (Array.isArray(growsProp)) setGrowsLocal(growsProp);
  }, [growsProp]);

  // live data if props not given
  useEffect(() => {
    if (Array.isArray(growsProp)) return;
    const u = auth.currentUser;
    if (!u) return;
    const unsub = onSnapshot(collection(db, "users", u.uid, "grows"), (snap) => {
      setGrowsLocal(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [growsProp]);

  // Archive list uses your robust heuristic
  const archived = useMemo(
    () => (Array.isArray(growsLocal) ? growsLocal.filter(isArchivedish) : []),
    [growsLocal]
  );

  async function unarchiveGrow(grow, changes) {
    const u = auth.currentUser;
    if (!u || !grow?.id) return;

    const amtAvail = Number.isFinite(Number(changes.amountAvailable))
      ? Number(changes.amountAvailable)
      : Number(grow.amountAvailable || 0);

    const next = {
      // Status becomes Active (or Stored) on unarchive
      status: changes.status || "Active",
      // Stage comes from modal (already guarded to be non-Consumed for >0 amounts)
      stage: changes.stage || grow.stage || "Inoculated",
      // Keep legacy field for older UIs:
      amountAvailable: amtAvail,
      // Update timestamps
      updatedAt: serverTimestamp(),
      unarchiveNote: changes.unarchiveNote || "",
      // Clear any archive flags that might keep it in Archive
      archived: deleteField(),
      archivedAt: deleteField(),
      archivedOn: deleteField(),
      isArchived: deleteField(),
      inArchive: deleteField(),
    };

    // Write/normalize new-model fields so remaining math is correct across the app
    const total = Number(grow.amountTotal);
    const hasNewModel = Number.isFinite(total) && total > 0;
    const unit = changes.unit || grow.amountUnit || grow.volumeUnit || "";

    if (hasNewModel) {
      next.amountTotal = total;
      next.amountUsed = Math.max(0, total - amtAvail);
      next.amountUnit = unit;
    } else if (amtAvail > 0) {
      // Bootstrap new model from the available amount
      next.amountTotal = amtAvail;
      next.amountUsed = 0;
      next.amountUnit = unit;
    }

    // If stage is no longer Consumed, we can clear consumedAt (optional)
    if (normalizeStage(next.stage) !== "Consumed") {
      next.consumedAt = deleteField();
    }

    // Persist
    if (typeof onUpdateGrow === "function") {
      await onUpdateGrow(grow.id, next);
    } else {
      await updateDoc(doc(db, "users", u.uid, "grows", grow.id), next);
    }

    // Optimistic local update so the item immediately leaves Archive list
    setGrowsLocal((prev) =>
      prev.map((g) =>
        g.id === grow.id
          ? {
              ...g,
              ...next,
              archived: false,
              archivedAt: null,
              archivedOn: null,
              isArchived: false,
              inArchive: null,
            }
          : g
      )
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
          <Box className="w-5 h-5 opacity-80" />
          <h2 className="text-lg font-semibold">Archived Grows</h2>
          <span className="ml-auto text-xs text-zinc-500">
            {archived.length} archived/consumed grows
          </span>
        </div>

        {archived.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500">Nothing archived.</div>
        ) : (
          <div>
            {archived.map((g) => {
              const st = normalizeStage(g?.stage);
              const statusRaw = String(g?.status || "");
              const isArchived = statusRaw.toLowerCase() === "archived" || !!g?.archivedAt;
              const label = isArchived ? "Archived" : st || "Archived";

              return (
                <Row key={g.id}>
                  <div className="min-w-0">
                    <div className="font-mono text-sm truncate">{g.abbreviation || g.id}</div>
                    <div className="text-xs text-zinc-500 truncate">
                      {g.growType} — {g.strain} — {label}
                      {" · "}Remaining: {g.amountAvailable ?? 0} {g.amountUnit || g.volumeUnit || ""}
                    </div>
                  </div>
                  <button
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full accent-bg text-white"
                    onClick={() => setSelected(g)}
                    title="Unarchive"
                  >
                    <Recycle className="w-4 h-4" />
                    Unarchive
                  </button>
                </Row>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <UnarchiveModal
          grow={selected}
          onClose={() => setSelected(null)}
          onSubmit={async (changes) => {
            await unarchiveGrow(selected, changes);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
