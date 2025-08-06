import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  Timestamp,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";
import { db, auth } from "../firebase-config";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];

export default function GrowDetailPage() {
  const { growId } = useParams();
  const [grow, setGrow] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [envInputs, setEnvInputs] = useState({});
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    fetchGrow();
  }, [growId]);

  const fetchGrow = async () => {
    const user = auth.currentUser;
    if (!user || !growId) return;
    const snap = await getDoc(doc(db, "users", user.uid, "grows", growId));
    if (snap.exists()) {
      setGrow({ id: snap.id, ...snap.data() });
      fetchLogs(user.uid);
    }
  };

  const fetchLogs = async (uid) => {
    const q = query(
      collection(db, `users/${uid}/grows/${growId}/environmentLogs`),
      orderBy("timestamp", "desc")
    );
    const snap = await getDocs(q);
    setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const updateField = async (updates) => {
    const user = auth.currentUser;
    if (!user || !grow) return;
    const ref = doc(db, "users", user.uid, "grows", grow.id);
    await updateDoc(ref, updates);
    setGrow((prev) => ({ ...prev, ...updates }));
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    const notes = [...(grow.notes || []), {
      text: noteText.trim(),
      date: new Date().toISOString(),
    }];
    await updateField({ notes });
    setNoteText("");
  };

  const saveEnvLog = async () => {
    const user = auth.currentUser;
    if (!user || !envInputs.stage || !envInputs.temperature || !envInputs.humidity) return;

    const newLog = {
      ...envInputs,
      temperature: parseFloat(envInputs.temperature),
      humidity: parseFloat(envInputs.humidity),
      timestamp: new Date(),
    };

    await addDoc(
      collection(db, `users/${user.uid}/grows/${grow.id}/environmentLogs`),
      newLog
    );
    setEnvInputs({});
    fetchLogs(user.uid);
  };

  if (!grow) {
    return <div className="p-6">Loading grow...</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">
        🌱 {grow.strain || "Unnamed"} – {grow.stage}
      </h1>

      {/* Stage Selector */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => updateField({ stage: s })}
            className={`px-3 py-1 rounded-full ${
              grow.stage === s
                ? "bg-blue-600 text-white"
                : "bg-zinc-200 dark:bg-zinc-700"
            }`}
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
          placeholder="Add note..."
        />
        <button
          onClick={addNote}
          className="mt-2 bg-blue-600 text-white px-4 py-1 rounded"
        >
          ➕ Add Note
        </button>

        <ul className="mt-3 space-y-2 text-sm">
          {(grow.notes || []).map((n, i) => (
            <li key={i} className="border-t pt-2">
              {n.text}
              <div className="text-xs text-zinc-500">
                {new Date(n.date).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Environment Log */}
      <div>
        <h2 className="text-lg font-semibold">🌡️ Environment Log</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select
            value={envInputs.stage || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, stage: e.target.value })}
            className="p-2 border rounded"
          >
            <option value="">Stage</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Temp (°F)"
            value={envInputs.temperature || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, temperature: e.target.value })}
            className="p-2 border rounded"
          />
          <input
            type="number"
            placeholder="Humidity (%)"
            value={envInputs.humidity || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, humidity: e.target.value })}
            className="p-2 border rounded"
          />
          <input
            type="text"
            placeholder="Notes"
            value={envInputs.notes || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, notes: e.target.value })}
            className="p-2 border rounded"
          />
        </div>
        <button
          onClick={saveEnvLog}
          className="mt-2 px-4 py-1 bg-green-600 text-white rounded"
        >
          ➕ Save Log
        </button>

        {logs.length > 0 && (
          <div className="mt-4 space-y-2 text-sm">
            {logs.map((log) => (
              <div key={log.id} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded">
                <div className="flex justify-between font-semibold">
                  <span>{log.stage}</span>
                  <span>{new Date(log.timestamp.toDate()).toLocaleString()}</span>
                </div>
                <div>Temp: {log.temperature}°F | RH: {log.humidity}%</div>
                {log.notes && <div className="italic text-xs">{log.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
