import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  doc, getDoc, updateDoc, collection, addDoc, getDocs, query, orderBy,
} from "firebase/firestore";
import { db, auth } from "../../firebase-config";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];

export default function GrowDetail({
  grows,
  prefs,                           // <-- NEW: to read temperatureUnit
  envLogsByGrow,
  onUpdateGrow,
  onAddEnvLog,
  onAddNote,
  photosByGrow,
  onUploadPhoto,
  onUploadStagePhoto,
}) {
  const { growId } = useParams();
  const navigate = useNavigate();

  const goBack = useCallback(() => {
    if (window.history && window.history.length > 1) navigate(-1);
    else navigate("/");
  }, [navigate]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") goBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);

  const growFromProps = useMemo(() => {
    if (!Array.isArray(grows)) return null;
    return grows.find((g) => g.id === growId) || null;
  }, [grows, growId]);

  const [grow, setGrow] = useState(growFromProps);

  // Notes form: optional Temp/Humidity with unit-aware temperature
  const unit = (prefs?.temperatureUnit || "F").toUpperCase() === "C" ? "C" : "F";
  const [noteText, setNoteText] = useState("");
  const [noteTemp, setNoteTemp] = useState("");     // in selected unit
  const [noteRH, setNoteRH] = useState("");

  const logsFromProps =
    envLogsByGrow && (envLogsByGrow instanceof Map ? envLogsByGrow.get(growId) : envLogsByGrow[growId]);
  const [logs, setLogs] = useState(Array.isArray(logsFromProps) ? logsFromProps : []);

  const photosArrFromProps =
    photosByGrow && (photosByGrow instanceof Map ? photosByGrow.get(growId) : photosByGrow[growId]);
  const [photos, setPhotos] = useState(Array.isArray(photosArrFromProps) ? photosArrFromProps : []);
  const [upload, setUpload] = useState({ stage: "", caption: "", file: null });

  useEffect(() => { if (growFromProps) setGrow(growFromProps); }, [growFromProps]);
  useEffect(() => { if (Array.isArray(logsFromProps)) setLogs(logsFromProps); }, [logsFromProps]);
  useEffect(() => { if (Array.isArray(photosArrFromProps)) setPhotos(photosArrFromProps); }, [photosArrFromProps]);

  // Fallback fetch
  useEffect(() => {
    if (growFromProps) return;
    (async () => {
      const user = auth.currentUser;
      if (!user || !growId) return;
      const snap = await getDoc(doc(db, "users", user.uid, "grows", growId));
      if (snap.exists()) {
        setGrow({ id: snap.id, ...snap.data() });
        const q = query(collection(db, `users/${user.uid}/grows/${growId}/environmentLogs`), orderBy("timestamp", "desc"));
        const ls = await getDocs(q);
        setLogs(ls.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    })();
  }, [growId, growFromProps]);

  const callUpdateGrow = async (patch) => {
    if (typeof onUpdateGrow === "function") {
      await onUpdateGrow(growId, patch);
      setGrow((prev) => (prev ? { ...prev, ...patch } : prev));
      return;
    }
    const user = auth.currentUser;
    if (!user || !growId) return;
    await updateDoc(doc(db, "users", user.uid, "grows", growId), patch);
    setGrow((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  // Add note (passes F or C based on unit; App handles auto-convert if enabled)
  const addNote = async () => {
    const text = noteText.trim();
    if (!text) return;

    const extras = {};
    const t = Number(noteTemp);
    const h = Number(noteRH);
    if (Number.isFinite(h)) extras.humidityPct = h;
    if (Number.isFinite(t)) {
      if (unit === "F") extras.temperatureF = t;
      else extras.temperatureC = t;
    }

    await onAddNote?.(growId, "General", text, extras);
    setNoteText("");
    setNoteTemp("");
    setNoteRH("");
  };

  const [envInputs, setEnvInputs] = useState({});
  const saveEnvLog = async () => {
    const { stage, temperature, humidity, notes } = envInputs || {};
    if (!stage || temperature === undefined || humidity === undefined) return;

    const newLog = {
      stage,
      temperature: parseFloat(temperature), // this section stays in °F for now
      humidity: parseFloat(humidity),
      notes: notes || "",
      timestamp: new Date().toISOString(),
    };

    if (typeof onAddEnvLog === "function") {
      await onAddEnvLog(growId, newLog);
      setEnvInputs({});
      return;
    }
    const user = auth.currentUser;
    if (!user || !growId) return;
    await addDoc(collection(db, `users/${user.uid}/grows/${growId}/environmentLogs`), newLog);
    setEnvInputs({});
    setLogs((prev) => [{ id: `local-${Date.now()}`, ...newLog }, ...prev]);
  };

  const fmtWhen = (t) => {
    if (!t) return "";
    try {
      if (typeof t?.toDate === "function") return t.toDate().toLocaleString();
      if (t instanceof Date) return t.toLocaleString();
      return new Date(t).toLocaleString();
    } catch {
      return String(t);
    }
  };

  const doUploadPhoto = async () => {
    if (!upload.file) return;
    const stage = upload.stage || grow?.stage || "General";
    try {
      if (typeof onUploadStagePhoto === "function") {
        await onUploadStagePhoto(growId, stage, upload.file, upload.caption || "");
      } else if (typeof onUploadPhoto === "function") {
        await onUploadPhoto(growId, upload.file, upload.caption || "");
      }
      setUpload({ stage: "", caption: "", file: null });
    } catch (e) {
      console.error("Upload failed", e);
    }
  };

  if (!grow) return <div className="p-6">Loading grow…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <button onClick={goBack} className="chip" title="Go back (Esc)">← Back</button>
        <Link to="/" className="text-sm underline opacity-80 hover:opacity-100">Dashboard</Link>
      </div>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">
          🌱 {grow.strain || "Unnamed"} {grow.subName ? <span className="opacity-75">– {grow.subName}</span> : null}{" "}
          <span className="text-sm opacity-70">({grow.stage || "—"})</span>
        </h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => callUpdateGrow({ stage: s })}
            className={`px-3 py-1 rounded-full ${grow.stage === s ? "accent-chip" : "bg-zinc-200 dark:bg-zinc-700"}`}
            aria-pressed={grow.stage === s ? "true" : "false"}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Notes with optional Temp/RH, using selected unit */}
      <section>
        <h2 className="text-lg font-semibold">📝 Notes</h2>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          className="w-full p-2 border rounded dark:bg-zinc-800 dark:text-white"
          placeholder="Add note…"
          aria-label="New note text"
        />

        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="number"
            inputMode="decimal"
            placeholder={`Temp (°${unit}) — optional`}
            value={noteTemp}
            onChange={(e) => setNoteTemp(e.target.value)}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
            aria-label={`Optional temperature in ${unit}`}
          />
          <input
            type="number"
            inputMode="decimal"
            placeholder="Humidity (%) — optional"
            value={noteRH}
            onChange={(e) => setNoteRH(e.target.value)}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
            aria-label="Optional humidity percent"
          />
          <div className="flex">
            <button
              onClick={addNote}
              className="w-full accent-bg px-4 py-2 rounded disabled:opacity-60"
              disabled={!noteText.trim()}
            >
              ➕ Add Note
            </button>
          </div>
        </div>

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
      </section>

      {/* Photos */}
      <section>
        <h2 className="text-lg font-semibold">📸 Photos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
          <select
            value={upload.stage}
            onChange={(e) => setUpload({ ...upload, stage: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          >
            <option value="">Stage (optional)</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
          <input
            type="text"
            placeholder="Caption (optional)"
            value={upload.caption}
            onChange={(e) => setUpload({ ...upload, caption: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
          <button className="px-3 py-2 rounded accent-bg disabled:opacity-60" onClick={doUploadPhoto} disabled={!upload.file}>
            Upload Photo
          </button>
        </div>

        {Array.isArray(photos) && photos.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos
              .slice()
              .sort((a, b) => String(b.timestamp || 0).localeCompare(String(a.timestamp || 0)))
              .map((p) => (
                <figure key={p.id || p.url} className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
                  <img src={p.url} alt={p.caption || "Grow photo"} className="w-full h-40 object-cover" />
                  <figcaption className="p-2 text-xs">
                    <div className="font-medium truncate">{p.caption || "—"}</div>
                    <div className="opacity-70">{p.stage || "General"} · {fmtWhen(p.timestamp)}</div>
                  </figcaption>
                </figure>
              ))}
          </div>
        ) : <div className="text-sm opacity-70">No photos yet.</div>}
      </section>

      {/* Environment Log (remains °F fields for now) */}
      <section>
        <h2 className="text-lg font-semibold">🌡️ Environment Log</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select
            value={envInputs.stage || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, stage: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          >
            <option value="">Stage</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            type="number"
            placeholder="Temp (°F)"
            value={envInputs.temperature || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, temperature: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
          <input
            type="number"
            placeholder="Humidity (%)"
            value={envInputs.humidity || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, humidity: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
          <input
            type="text"
            placeholder="Notes"
            value={envInputs.notes || ""}
            onChange={(e) => setEnvInputs({ ...envInputs, notes: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
        </div>
        <button
          onClick={saveEnvLog}
          className="mt-2 px-4 py-1 rounded accent-bg disabled:opacity-60"
          disabled={!envInputs.stage || envInputs.temperature === undefined || envInputs.humidity === undefined}
        >
          ➕ Save Log
        </button>

        {Array.isArray(logs) && logs.length > 0 ? (
          <div className="mt-4 space-y-2 text-sm">
            {logs.map((log, idx) => (
              <div key={log.id || `log-${idx}`} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded">
                <div className="flex justify-between font-semibold">
                  <span>{log.stage}</span>
                  <span>{fmtWhen(log.timestamp)}</span>
                </div>
                <div>Temp: {log.temperature}°F | RH: {log.humidity}%</div>
                {log.notes && <div className="italic text-xs">{log.notes}</div>}
              </div>
            ))}
          </div>
        ) : <div className="text-sm opacity-70 mt-3">No environment logs yet.</div>}
      </section>
    </div>
  );
}
