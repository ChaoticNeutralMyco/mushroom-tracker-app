// src/components/Grow/GrowDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

// Fallback-only Firestore APIs (used if App doesn't pass props/handlers yet)
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";
import { db, auth } from "../../firebase-config";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];

/**
 * GrowDetail
 * - Preferred mode: prop-driven (no reads). Pass any/all:
 *    grows: Array<{ id, ... }>
 *    envLogsByGrow: Map|Object { [growId]: Array<logs> }
 *    onUpdateGrow: (growId, patch) => Promise
 *    onAddEnvLog: (growId, log) => Promise
 *    onAddNote: (growId, stage, text) => Promise   // stage may be "General"
 *
 * - Legacy fallback (temporary): if props/handlers are not provided, it will
 *   read/write the needed bits directly to Firestore so the page still works.
 */
export default function GrowDetail({
  grows,
  envLogsByGrow,
  onUpdateGrow,
  onAddEnvLog,
  onAddNote,
}) {
  const { growId } = useParams();

  // If App is passing grows, resolve the grow from props
  const growFromProps = useMemo(() => {
    if (!Array.isArray(grows)) return null;
    return grows.find((g) => g.id === growId) || null;
  }, [grows, growId]);

  // Local state mirrors, used both for prop-mode (to keep quick UI response)
  // and for fallback mode (source of truth when fetched).
  const [grow, setGrow] = useState(growFromProps);
  const [noteText, setNoteText] = useState("");
  const [envInputs, setEnvInputs] = useState({});
  const logsFromProps =
    envLogsByGrow &&
    (envLogsByGrow instanceof Map
      ? envLogsByGrow.get(growId)
      : envLogsByGrow[growId]);
  const [logs, setLogs] = useState(Array.isArray(logsFromProps) ? logsFromProps : []);

  // Keep local state synced with props if they change
  useEffect(() => {
    if (growFromProps) setGrow(growFromProps);
  }, [growFromProps]);

  useEffect(() => {
    if (Array.isArray(logsFromProps)) setLogs(logsFromProps);
  }, [logsFromProps]);

  // Legacy fallback: fetch grow + logs if not provided via props
  useEffect(() => {
    if (growFromProps) return;
    (async () => {
      const user = auth.currentUser;
      if (!user || !growId) return;
      const snap = await getDoc(doc(db, "users", user.uid, "grows", growId));
      if (snap.exists()) {
        setGrow({ id: snap.id, ...snap.data() });
        const q = query(
          collection(db, `users/${user.uid}/grows/${growId}/environmentLogs`),
          orderBy("timestamp", "desc")
        );
        const ls = await getDocs(q);
        setLogs(ls.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    })();
  }, [growId, growFromProps]);

  // ---------- helpers ----------
  const callUpdateGrow = async (patch) => {
    // Preferred: delegate to App if provided
    if (typeof onUpdateGrow === "function") {
      await onUpdateGrow(growId, patch);
      setGrow((prev) => (prev ? { ...prev, ...patch } : prev));
      return;
    }
    // Fallback: write directly
    const user = auth.currentUser;
    if (!user || !growId) return;
    await updateDoc(doc(db, "users", user.uid, "grows", growId), patch);
    setGrow((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const addNote = async () => {
    const text = noteText.trim();
    if (!text) return;

    // Preferred: route via App's notes handler (stage "General")
    if (typeof onAddNote === "function") {
      await onAddNote(growId, "General", text);
      setNoteText("");
      return;
    }

    // Fallback: append to notes array on the grow doc
    const nextNotes = [...(grow?.notes || []), { text, date: new Date().toISOString() }];
    await callUpdateGrow({ notes: nextNotes });
    setNoteText("");
  };

  const saveEnvLog = async () => {
    const { stage, temperature, humidity, notes } = envInputs || {};
    if (!stage || temperature === undefined || humidity === undefined) return;

    const newLog = {
      stage,
      temperature: parseFloat(temperature),
      humidity: parseFloat(humidity),
      notes: notes || "",
      // store a plain ISO string for compatibility (works whether using props or fallback)
      timestamp: new Date().toISOString(),
    };

    // Preferred: App handles Firestore write
    if (typeof onAddEnvLog === "function") {
      await onAddEnvLog(growId, newLog);
      setEnvInputs({});
      return;
    }

    // Fallback: write directly in subcollection
    const user = auth.currentUser;
    if (!user || !growId) return;
    await addDoc(collection(db, `users/${user.uid}/grows/${growId}/environmentLogs`), newLog);
    setEnvInputs({});
    // Refresh logs locally
    setLogs((prev) => [{ id: `local-${Date.now()}`, ...newLog }, ...prev]);
  };

  // Graceful display of timestamps (supports Firestore Timestamp, JS Date, or ISO string)
  const fmtWhen = (t) => {
    if (!t) return "";
    try {
      if (typeof t?.toDate === "function") return t.toDate().toLocaleString();
      if (t instanceof Date) return t.toLocaleString();
      return new Date(t).toLocaleString(); // ISO/string
    } catch {
      return String(t);
    }
  };

  if (!grow) {
    return <div className="p-6">Loading grow…</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">
        🌱 {grow.strain || "Unnamed"}{" "}
        {grow.subName ? <span className="opacity-75">– {grow.subName}</span> : null}{" "}
        <span className="text-sm opacity-70">({grow.stage || "—"})</span>
      </h1>

      {/* Stage Selector */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => callUpdateGrow({ stage: s })}
            className={`px-3 py-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current ${
              grow.stage === s ? "accent-chip" : "bg-zinc-200 dark:bg-zinc-700"
            }`}
            aria-pressed={grow.stage === s ? "true" : "false"}
            aria-label={`Set stage to ${s}`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Notes */}
      <div>
        <h2 className="text-lg font-semibold">📝 Notes</h2>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          className="w-full p-2 border rounded dark:bg-zinc-800 dark:text-white"
          placeholder="Add note…"
          aria-label="New note text"
        />
        <button
          onClick={addNote}
          className="mt-2 accent-bg px-4 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current disabled:opacity-60"
          aria-label="Add note"
          disabled={!noteText.trim()}
        >
          ➕ Add Note
        </button>

        <ul className="mt-3 space-y-2 text-sm">
          {(grow.notes || []).map((n, i) => (
            <li key={i} className="border-t pt-2">
              {n.text}
              <div className="text-xs text-zinc-500">{fmtWhen(n.date)}</div>
            </li>
          ))}
        </ul>
        {(!grow.notes || grow.notes.length === 0) && (
          <div className="text-sm opacity-70 mt-2">No notes yet.</div>
        )}
      </div>

      {/* Environment Log */}
      <div>
        <h2 className="text-lg font-semibold">🌡️ Environment Log</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select
            value={envInputs.stage || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, stage: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
            aria-label="Log stage"
          >
            <option value="">Stage</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Temp (°F)"
            value={envInputs.temperature || ""}
            onChange={(e) =>
              setEnvInputs({ ...envInputs, temperature: e.target.value })
            }
            className="p-2 border rounded bg-white dark:bg-zinc-900"
            aria-label="Temperature in Fahrenheit"
          />
          <input
            type="number"
            placeholder="Humidity (%)"
            value={envInputs.humidity || ""}
            onChange={(e) =>
              setEnvInputs({ ...envInputs, humidity: e.target.value })
            }
            className="p-2 border rounded bg-white dark:bg-zinc-900"
            aria-label="Relative humidity"
          />
          <input
            type="text"
            placeholder="Notes"
            value={envInputs.notes || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, notes: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
            aria-label="Environment notes"
          />
        </div>
        <button
          onClick={saveEnvLog}
          className="mt-2 px-4 py-1 rounded accent-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current disabled:opacity-60"
          disabled={
            !envInputs.stage || envInputs.temperature === undefined || envInputs.humidity === undefined
          }
          aria-label="Save environment log"
        >
          ➕ Save Log
        </button>

        {Array.isArray(logs) && logs.length > 0 ? (
          <div className="mt-4 space-y-2 text-sm">
            {logs.map((log, idx) => (
              <div
                key={log.id || `log-${idx}`}
                className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded"
              >
                <div className="flex justify-between font-semibold">
                  <span>{log.stage}</span>
                  <span>{fmtWhen(log.timestamp)}</span>
                </div>
                <div>
                  Temp: {log.temperature}°F | RH: {log.humidity}%
                </div>
                {log.notes && <div className="italic text-xs">{log.notes}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm opacity-70 mt-3">No environment logs yet.</div>
        )}
      </div>
    </div>
  );
}
