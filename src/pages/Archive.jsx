// src/pages/Archive.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  onSnapshot,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db, auth } from "../firebase-config";
import { Box, Recycle, AlertTriangle, X } from "lucide-react";

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

function UnarchiveModal({ grow, onClose, onSubmit }) {
  const [amount, setAmount] = useState(
     grow?.amountAvailable ?? 0
  );
  const [unit] = useState(grow?.volumeUnit || "mL");
  const [stage, setStage] = useState(
    grow?.stage || (grow?.growType === "Bulk" ? "Colonizing" : "Inoculated")
  );
  const [status, setStatus] = useState("Active");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  const stageOptions =
    (grow?.growType || "") === "Bulk"
      ? ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"]
      : ["Inoculated", "Colonizing", "Colonized"];

  const mustRequireAmount = Number(grow?.amountAvailable || 0) <= 0;

  function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    if (mustRequireAmount && Number(amount) <= 0) {
      setErr("This grow was archived at 0. Please enter a positive amount to make it active again.");
      return;
    }
    onSubmit({
      amountAvailable: Number.isFinite(Number(amount)) ? Number(amount) : 0,
      stage,
      status,
      unarchiveNote: note,
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
            You’re about to move this grow back to the active list. Confirm the details below.
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
                value={`${grow?.amountAvailable ?? 0} ${grow?.volumeUnit || ""}`}
              />
            </div>
          </div>

          {mustRequireAmount ? (
            <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-xs">
              This grow was archived because it reached 0 remaining. Enter the corrected amount to
              re-activate it.
            </div>
          ) : (
            <div className="text-xs text-zinc-500">
              Adjust remaining amount if needed, or leave as-is.
            </div>
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
                <option>Active</option>
                <option>Contaminated</option>
                <option>Harvested</option>
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

          {err && (
            <div className="text-xs text-red-600 dark:text-red-400">
              {err}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-full accent-bg text-white"
          >
            Confirm Unarchive
          </button>
        </div>
      </form>
    </div>
  );
}

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

  const archived = useMemo(
    () => (Array.isArray(growsLocal) ? growsLocal.filter((g) => (g.status || "") === "Archived") : []),
    [growsLocal]
  );

  async function unarchiveGrow(grow, changes) {
    const u = auth.currentUser;
    if (!u || !grow?.id) return;

    const payload = {
      status: changes.status || "Active",
      stage: changes.stage || grow.stage || "Inoculated",
      amountAvailable: Number.isFinite(Number(changes.amountAvailable))
        ? Number(changes.amountAvailable)
        : Number(grow.amountAvailable || 0),
      updatedAt: new Date().toISOString(),
      unarchiveNote: changes.unarchiveNote || "",
    };

    if (typeof onUpdateGrow === "function") {
      await onUpdateGrow(grow.id, payload);
    } else {
      await updateDoc(doc(db, "users", u.uid, "grows", grow.id), payload);
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
          <Box className="w-5 h-5 opacity-80" />
          <h2 className="text-lg font-semibold">Archived Grows</h2>
          <span className="ml-auto text-xs text-zinc-500">{archived.length} archived grows</span>
        </div>

        {archived.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-500">
            Nothing archived.
          </div>
        ) : (
          <div>
            {archived.map((g) => (
              <Row key={g.id}>
                <div className="min-w-0">
                  <div className="font-mono text-sm truncate">{g.abbreviation || g.id}</div>
                  <div className="text-xs text-zinc-500 truncate">
                    {g.growType} — {g.strain} — Archived
                    {" · "}
                    Remaining: {g.amountAvailable ?? 0} {g.volumeUnit || ""}
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
            ))}
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
