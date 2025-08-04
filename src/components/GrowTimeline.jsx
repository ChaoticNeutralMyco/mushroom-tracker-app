import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase-config";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  query,
  orderBy,
} from "firebase/firestore";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];

export default function GrowTimeline({ grows, setGrows, updateGrowStage }) {
  const [envLogs, setEnvLogs] = useState({});
  const [inputs, setInputs] = useState({});
  const [stageDates, setStageDates] = useState({});

  useEffect(() => {
    fetchLogs();
  }, [grows]);

  const fetchLogs = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const newEnvLogs = {};
    for (const grow of grows) {
      const logRef = collection(
        db,
        `users/${user.uid}/grows/${grow.id}/environmentLogs`
      );
      const q = query(logRef, orderBy("timestamp", "desc"));
      const snap = await getDocs(q);
      newEnvLogs[grow.id] = snap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    }
    setEnvLogs(newEnvLogs);
  };

  const handleInput = (growId, field, value) => {
    setInputs((prev) => ({
      ...prev,
      [growId]: { ...prev[growId], [field]: value },
    }));
  };

  const saveLog = async (growId) => {
    const user = auth.currentUser;
    if (!user || !inputs[growId]) return;

    const { stage, temperature, humidity, notes } = inputs[growId];
    if (!stage || !temperature || !humidity) return alert("Fill all required fields");

    const log = {
      stage,
      temperature: parseFloat(temperature),
      humidity: parseFloat(humidity),
      notes: notes || "",
      timestamp: new Date(),
    };

    await addDoc(
      collection(db, `users/${user.uid}/grows/${growId}/environmentLogs`),
      log
    );

    setInputs((prev) => ({ ...prev, [growId]: {} }));
    fetchLogs();
  };

  const handleStageDateChange = async (growId, stage, date) => {
    const user = auth.currentUser;
    if (!user) return;

    const growRef = doc(db, `users/${user.uid}/grows/${growId}`);
    const grow = grows.find((g) => g.id === growId);
    const updatedDates = { ...(grow.stageDates || {}), [stage]: date };

    await updateDoc(growRef, {
      stageDates: updatedDates,
    });

    setGrows((prev) =>
      prev.map((g) =>
        g.id === growId ? { ...g, stageDates: updatedDates } : g
      )
    );
  };

  const handleYieldUpdate = async (growId, type, value) => {
    const user = auth.currentUser;
    if (!user) return;

    const growRef = doc(db, `users/${user.uid}/grows/${growId}`);
    await updateDoc(growRef, { [type]: parseFloat(value) });

    setGrows((prev) =>
      prev.map((g) => (g.id === growId ? { ...g, [type]: parseFloat(value) } : g))
    );
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-8">
      {grows.map((grow) => (
        <div
          key={grow.id}
          className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-xl shadow p-4 space-y-4"
        >
          <h2 className="text-xl font-semibold">
            🌱 {grow.strain || "Unnamed"} – {grow.inoculation || "No Date"}
          </h2>

          <div className="flex flex-wrap gap-2 items-center">
            {STAGES.map((s) => (
              <button
                key={s}
                onClick={() => updateGrowStage(grow.id, s)}
                className={`px-3 py-1 rounded-full text-sm ${
                  grow.stage === s
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-zinc-700"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {STAGES.map((s) => (
              <div key={s}>
                <label className="text-xs">{s} Date</label>
                <input
                  type="date"
                  value={grow.stageDates?.[s]?.substring(0, 10) || ""}
                  onChange={(e) =>
                    handleStageDateChange(grow.id, s, e.target.value)
                  }
                  className="w-full p-2 rounded border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
                />
              </div>
            ))}
          </div>

          {grow.stage === "Harvested" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="text-sm">Wet Yield (g or oz)</label>
                <input
                  type="number"
                  value={grow.wetYield || ""}
                  onChange={(e) =>
                    handleYieldUpdate(grow.id, "wetYield", e.target.value)
                  }
                  className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-600"
                />
              </div>
              <div>
                <label className="text-sm">Dry Yield (g or oz)</label>
                <input
                  type="number"
                  value={grow.dryYield || ""}
                  onChange={(e) =>
                    handleYieldUpdate(grow.id, "dryYield", e.target.value)
                  }
                  className="w-full p-2 border rounded dark:bg-zinc-800 dark:border-zinc-600"
                />
              </div>
            </div>
          )}

          {/* 🌡️ ENVIRONMENT LOGGING */}
          <div className="mt-6 border-t pt-4 space-y-3">
            <h3 className="text-lg font-semibold">🌡️ Log Environment</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <select
                value={inputs[grow.id]?.stage || ""}
                onChange={(e) =>
                  handleInput(grow.id, "stage", e.target.value)
                }
                className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-600"
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
                value={inputs[grow.id]?.temperature || ""}
                onChange={(e) =>
                  handleInput(grow.id, "temperature", e.target.value)
                }
                className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-600"
              />
              <input
                type="number"
                placeholder="Humidity (%)"
                value={inputs[grow.id]?.humidity || ""}
                onChange={(e) =>
                  handleInput(grow.id, "humidity", e.target.value)
                }
                className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-600"
              />
              <input
                type="text"
                placeholder="Optional Notes"
                value={inputs[grow.id]?.notes || ""}
                onChange={(e) =>
                  handleInput(grow.id, "notes", e.target.value)
                }
                className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-600"
              />
            </div>
            <button
              onClick={() => saveLog(grow.id)}
              className="mt-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              ➕ Save Log
            </button>

            {envLogs[grow.id]?.length > 0 && (
              <div className="mt-4 space-y-2">
                <h4 className="font-medium text-sm text-gray-600 dark:text-gray-300">
                  Recent Logs:
                </h4>
                {envLogs[grow.id].map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded bg-zinc-100 dark:bg-zinc-800 text-sm"
                  >
                    <div className="flex justify-between font-semibold">
                      <span>{log.stage}</span>
                      <span>
                        {new Date(log.timestamp.toDate()).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-sm">
                      Temp: {log.temperature}°F | RH: {log.humidity}%
                    </div>
                    {log.notes && (
                      <div className="text-xs italic mt-1">{log.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
