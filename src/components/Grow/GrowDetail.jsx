// src/components/Grow/GrowDetail.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth, storage } from "../../firebase-config";
import { ref as storageRef, deleteObject } from "firebase/storage";
import { useConfirm } from "../ui/ConfirmDialog";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];

// Derive Storage path from a Firebase download URL when storagePath is missing
function pathFromDownloadURL(url) {
  try {
    const m = String(url).match(/\/o\/([^?]+)/);
    if (m && m[1]) return decodeURIComponent(m[1]);
  } catch {}
  return null;
}

const normalizeType = (t = "") => {
  const s = String(t || "").toLowerCase();
  if (s.includes("agar")) return "Agar";
  if (s.includes("lc") || s.includes("liquid")) return "LC";
  if (s.includes("grain")) return "Grain Jar";
  if (s.includes("bulk")) return "Bulk";
  return "Other";
};

export default function GrowDetail({
  grows,
  prefs, // temperature unit
  envLogsByGrow,
  onUpdateGrow,
  onAddNote,
  photosByGrow,          // top-level users/{uid}/photos mapped by growId
  onUploadPhoto,
  onUploadStagePhoto,
  onAddEnvLog,           // optional: (growId, logObj) => Promise
  onUpdateEnvLog,        // optional: (growId, logId, patch) => Promise
  onDeleteEnvLog,        // optional: (growId, logId) => Promise
}) {
  const confirm = useConfirm();

  const { growId } = useParams();
  const navigate = useNavigate();

  const goBack = useCallback(() => {
    if (window.history && window.history.length > 1) navigate(-1);
    else navigate("/");
  }, [navigate]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && goBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);

  const growFromProps = useMemo(() => {
    if (!Array.isArray(grows)) return null;
    return grows.find((g) => g.id === growId) || null;
  }, [grows, growId]);

  const [grow, setGrow] = useState(growFromProps);

  // Notes (unit-aware temp/humidity)
  const unit = (prefs?.temperatureUnit || "F").toUpperCase() === "C" ? "C" : "F";
  const [noteText, setNoteText] = useState("");
  const [noteTemp, setNoteTemp] = useState("");
  const [noteRH, setNoteRH] = useState("");

  // Inline note edit/delete
  const [editIdx, setEditIdx] = useState(null);
  const [editText, setEditText] = useState("");

  // Env logs (from props if present)
  const logsFromProps =
    envLogsByGrow && (envLogsByGrow instanceof Map ? envLogsByGrow.get(growId) : envLogsByGrow[growId]);
  const [logs, setLogs] = useState(Array.isArray(logsFromProps) ? logsFromProps : []);

  // Env log composer
  const [envInputs, setEnvInputs] = useState({
    stage: "",
    temperature: "",
    humidity: "",
    notes: "",
  });

  // Env log inline edit/delete
  const [editLogId, setEditLogId] = useState(null);
  const [editLog, setEditLog] = useState({ stage: "", temperature: "", humidity: "", notes: "" });

  // Photos (from props if present – top-level collection filtered by App)
  const photosArrFromProps =
    photosByGrow && (photosByGrow instanceof Map ? photosByGrow.get(growId) : photosByGrow[growId]);
  const [photos, setPhotos] = useState(Array.isArray(photosArrFromProps) ? photosArrFromProps : []);
  const [upload, setUpload] = useState({ stage: "", caption: "", file: null });

  useEffect(() => { if (growFromProps) setGrow(growFromProps); }, [growFromProps]);
  useEffect(() => { if (Array.isArray(logsFromProps)) setLogs(logsFromProps); }, [logsFromProps]);
  useEffect(() => { if (Array.isArray(photosArrFromProps)) setPhotos(photosArrFromProps); }, [photosArrFromProps]);

  // Fallback fetches when Grow not in props
  useEffect(() => {
    if (growFromProps) return;
    (async () => {
      const user = auth.currentUser;
      if (!user || !growId) return;
      const snap = await getDoc(doc(db, "users", user.uid, "grows", growId));
      if (snap.exists()) {
        setGrow({ id: snap.id, ...snap.data() });
        const qEnv = query(
          collection(db, `users/${user.uid}/grows/${growId}/environmentLogs`),
          orderBy("timestamp", "desc"),
        );
        const ls = await getDocs(qEnv);
        setLogs(ls.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    })();
  }, [growId, growFromProps]);

  // generic updater with optimistic local merge
  const callUpdateGrow = async (patch) => {
    if (!growId) return;
    setGrow((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      Object.keys(patch || {}).forEach((k) => {
        if (k.startsWith("stageDates.")) {
          const stageKey = k.split(".")[1];
          next.stageDates = { ...(prev.stageDates || {}), [stageKey]: new Date().toISOString() };
        }
      });
      return next;
    });

    if (typeof onUpdateGrow === "function") {
      await onUpdateGrow(growId, patch);
      return;
    }
    const user = auth.currentUser;
    if (!user) return;
    await updateDoc(doc(db, "users", user.uid, "grows", growId), patch);
  };

  // ----- ACTIONS with confirms -----
  const canStoreToggle = useMemo(() => {
    const t = normalizeType(grow?.type || grow?.growType || "");
    return t === "Agar" || t === "LC";
  }, [grow]);

  const handleAdvanceStage = async () => {
    if (!grow) return;
    const cur = grow.stage || "";
    const idx = STAGES.indexOf(cur);
    const next = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null;
    if (!next) return;
    if (!(await confirm(`Advance stage to "${next}"?`))) return;
    await callUpdateGrow({
      stage: next,
      [`stageDates.${next}`]: serverTimestamp(),
    });
  };

  const handleArchiveToggle = async () => {
    if (!grow) return;
    const status = String(grow.status || "").toLowerCase();
    const next = status === "archived" ? "Active" : "Archived";
    if (!(await confirm(`${status === "archived" ? "Unarchive" : "Archive"} this grow?`))) return;
    await callUpdateGrow({ status: next });
  };

  const handleStoreToggle = async () => {
    if (!grow || !canStoreToggle) return;
    const isStored = String(grow.status || "").toLowerCase() === "stored";
    const next = isStored ? "Active" : "Stored";
    if (!(await confirm(`${isStored ? "Unstore" : "Store"} this grow?`))) return;
    await callUpdateGrow({ status: next });
  };

  const handleDeleteGrow = async () => {
    if (!growId) return;
    if (!(await confirm("Delete this grow? This cannot be undone."))) return;
    const user = auth.currentUser;
    if (!user) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "grows", growId));
      navigate("/");
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

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

    // Optimistic local push into grow.notes
    setGrow((prev) => {
      const list = Array.isArray(prev?.notes) ? prev.notes.slice() : [];
      list.push({ text, date: new Date().toISOString(), ...extras });
      return { ...prev, notes: list };
    });

    setNoteText("");
    setNoteTemp("");
    setNoteRH("");
  };

  // Inline note edit/delete (array on grow doc)
  const beginEditNote = (idx, currentText) => {
    setEditIdx(idx);
    setEditText(currentText || "");
  };
  const cancelEditNote = () => {
    setEditIdx(null);
    setEditText("");
  };
  const saveEditNote = async () => {
    if (editIdx == null) return;
    const newText = editText.trim();
    const nextList = (Array.isArray(grow?.notes) ? grow.notes : []).map((n, i) =>
      i === editIdx ? { ...n, text: newText || n.text, editedAt: new Date().toISOString() } : n
    );
    setGrow((prev) => ({ ...prev, notes: nextList }));
    await callUpdateGrow({ notes: nextList });
    cancelEditNote();
  };
  const deleteNoteAt = async (idx) => {
    if (!(await confirm("Delete this note?"))) return;
    const next = (Array.isArray(grow?.notes) ? grow.notes : []).filter((_, i) => i !== idx);
    setGrow((prev) => ({ ...prev, notes: next }));
    await callUpdateGrow({ notes: next });
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

  // Delete a photo (top-level collection: users/{uid}/photos)
  const handleDeletePhoto = async (p) => {
    if (!p || !p.id) return;
    if (!(await confirm("Delete this photo? This cannot be undone."))) return;

    const user = auth.currentUser;
    if (!user) return;

    const prev = Array.isArray(photos) ? photos : [];
    setPhotos((curr) => (Array.isArray(curr) ? curr.filter((x) => x.id !== p.id) : curr));

    try {
      const storagePath = p.storagePath || pathFromDownloadURL(p.url);
      if (storagePath) {
        try {
          await deleteObject(storageRef(storage, storagePath));
        } catch (err) {
          console.warn("Storage delete warning:", err?.message || err);
        }
      }
      await deleteDoc(doc(db, "users", user.uid, "photos", p.id));

      if (grow?.coverPhotoId === p.id) {
        await callUpdateGrow({
          coverPhotoId: null,
          coverUrl: null,
          coverStoragePath: null,
          coverUpdatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      setPhotos(prev);
      alert(err?.message || String(err));
    }
  };

  // Set Cover Photo
  const handleSetCoverPhoto = async (p) => {
    if (!p) return;
    if (!(await confirm("Set this photo as the cover image?"))) return;
    const storagePath = p.storagePath || pathFromDownloadURL(p.url) || null;

    setGrow((prev) => ({
      ...prev,
      coverPhotoId: p.id || null,
      coverUrl: p.url || null,
      coverStoragePath: storagePath,
    }));

    await callUpdateGrow({
      coverPhotoId: p.id || null,
      coverUrl: p.url || null,
      coverStoragePath: storagePath,
      coverUpdatedAt: serverTimestamp(),
    });
  };

  // Save environment log (composer)
  const saveEnvLog = async () => {
    const { stage, temperature, humidity, notes } = envInputs || {};
    if (!stage || temperature === "" || humidity === "") return;

    const newLog = {
      stage,
      temperature: parseFloat(temperature),
      humidity: parseFloat(humidity),
      notes: (notes || "").trim(),
      timestamp: new Date().toISOString(),
    };

    // optimistic prepend
    const localId = `local-${Date.now()}`;
    setLogs((prev) => [{ id: localId, ...newLog }, ...(prev || [])]);
    setEnvInputs({ stage: "", temperature: "", humidity: "", notes: "" });

    if (typeof onAddEnvLog === "function") {
      await onAddEnvLog(growId, newLog);
      return;
    }
    const user = auth.currentUser;
    if (!user || !growId) return;
    await addDoc(collection(db, `users/${user.uid}/grows/${growId}/environmentLogs`), newLog);
  };

  // Inline edit/delete for environment logs
  const beginEditEnvLog = (log) => {
    setEditLogId(log.id);
    setEditLog({
      stage: log.stage || "",
      temperature: String(log.temperature ?? ""),
      humidity: String(log.humidity ?? ""),
      notes: log.notes || "",
    });
  };
  const cancelEditEnvLog = () => {
    setEditLogId(null);
    setEditLog({ stage: "", temperature: "", humidity: "", notes: "" });
  };
  const saveEditEnvLog = async () => {
    if (!editLogId) return;
    const patch = {
      stage: editLog.stage || "",
      temperature: parseFloat(editLog.temperature),
      humidity: parseFloat(editLog.humidity),
      notes: (editLog.notes || "").trim(),
      editedAt: new Date().toISOString(),
    };

    // optimistic local update
    setLogs((prev) =>
      (prev || []).map((l) => (l.id === editLogId ? { ...l, ...patch } : l))
    );

    // persist
    const isLocal = String(editLogId).startsWith("local-");
    if (!isLocal) {
      if (typeof onUpdateEnvLog === "function") {
        await onUpdateEnvLog(growId, editLogId, patch);
      } else {
        const user = auth.currentUser;
        if (user && growId) {
          await updateDoc(doc(db, `users/${user.uid}/grows/${growId}/environmentLogs/${editLogId}`), patch);
        }
      }
    }
    cancelEditEnvLog();
  };
  const deleteEnvLog = async (log) => {
    if (!(await confirm("Delete this environment log?"))) return;

    // optimistic remove
    setLogs((prev) => (prev || []).filter((l) => l.id !== log.id));

    const isLocal = String(log.id).startsWith("local-");
    if (!isLocal) {
      if (typeof onDeleteEnvLog === "function") {
        await onDeleteEnvLog(growId, log.id);
      } else {
        const user = auth.currentUser;
        if (user && growId) {
          await deleteDoc(doc(db, `users/${user.uid}/grows/${growId}/environmentLogs/${log.id}`));
        }
      }
    }
  };

  if (!grow) return <div className="p-6">Loading grow…</div>;

  const stageIdx = STAGES.indexOf(grow.stage || "");
  const hasNextStage = stageIdx >= 0 && stageIdx < STAGES.length - 1;
  const statusLower = String(grow.status || "").toLowerCase();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <button onClick={goBack} className="chip" title="Go back (Esc)">← Back</button>
        <Link to="/" className="text-sm underline opacity-80 hover:opacity-100">Dashboard</Link>
      </div>

      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">
          🌱 {grow.strain || "Unnamed"}{" "}
          {grow.subName ? <span className="opacity-75">– {grow.subName}</span> : null}{" "}
          <span className="text-sm opacity-70">({grow.stage || "—"})</span>
        </h1>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`chip ${!hasNextStage ? "opacity-50 cursor-not-allowed" : ""}`}
          onClick={() => (hasNextStage ? handleAdvanceStage() : undefined)}
          aria-disabled={!hasNextStage}
          title={hasNextStage ? "Advance to next stage" : "No next stage"}
        >
          Stage +
        </button>

        <button
          type="button"
          className="chip"
          onClick={handleArchiveToggle}
          title={statusLower === "archived" ? "Unarchive" : "Archive"}
        >
          {statusLower === "archived" ? "Unarchive" : "Archive"}
        </button>

        {canStoreToggle && (
          <button
            type="button"
            className="chip"
            onClick={handleStoreToggle}
            title={statusLower === "stored" ? "Unstore" : "Store"}
          >
            {statusLower === "stored" ? "Unstore" : "Store"}
          </button>
        )}

        <button
          type="button"
          className="chip bg-red-600 text-white hover:bg-red-700"
          onClick={handleDeleteGrow}
          title="Delete grow"
        >
          Delete
        </button>
      </div>

      {/* Stage chips (manual set) */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={async () => {
              if (grow.stage === s) return;
              if (!(await confirm(`Set stage to "${s}"?`))) return;
              await callUpdateGrow({ stage: s, [`stageDates.${s}`]: serverTimestamp() });
            }}
            className={`px-3 py-1 rounded-full ${grow.stage === s ? "accent-chip" : "bg-zinc-200 dark:bg-zinc-700"}`}
            aria-pressed={grow.stage === s ? "true" : "false"}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Notes */}
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
          {(grow?.notes || []).map((n, i) => (
            <li key={i} className="border rounded p-2">
              {editIdx === i ? (
                <div className="flex items-start gap-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="flex-1 p-2 border rounded dark:bg-zinc-800"
                    rows={2}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEditNote();
                      if (e.key === "Escape") cancelEditNote();
                    }}
                  />
                  <div className="flex gap-2">
                    <button className="chip" onClick={saveEditNote}>Save</button>
                    <button className="btn-outline" onClick={cancelEditNote}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="whitespace-pre-wrap">{n.text}</div>
                    <div className="text-xs text-zinc-500">
                      {fmtWhen(n.date)}
                      {n.editedAt ? ` · edited ${fmtWhen(n.editedAt)}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button className="chip" onClick={() => beginEditNote(i, n.text)}>Edit</button>
                    <button className="chip bg-red-600 text-white" onClick={() => deleteNoteAt(i)}>Delete</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        {(!grow?.notes || grow.notes.length === 0) && (
          <div className="text-sm opacity-70 mt-2">No notes yet.</div>
        )}
      </section>

      {/* Photos (+ Set Cover) */}
      <section>
        <h2 className="text-lg font-semibold">📸 Photos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
          <select
            value={upload.stage}
            onChange={(e) => setUpload({ ...upload, stage: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          >
            <option value="">Stage (optional)</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
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

          <button
            className="px-3 py-2 rounded accent-bg disabled:opacity-60"
            onClick={doUploadPhoto}
            disabled={!upload.file}
          >
            Upload Photo
          </button>
        </div>

        {Array.isArray(photos) && photos.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos
              .slice()
              .sort((a, b) => String(b.timestamp || 0).localeCompare(String(a.timestamp || 0)))
              .map((p) => {
                const isCover = grow?.coverPhotoId && p.id === grow.coverPhotoId;
                return (
                  <figure
                    key={p.id || p.url}
                    className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800"
                  >
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <img src={p.url} alt={p.caption || "Grow photo"} className="w-full h-40 object-cover" />
                    </a>

                    {/* Stage / Cover labels */}
                    <div className="absolute left-2 top-2 z-10 space-y-1">
                      {p.stage ? (
                        <span className="rounded bg-black/60 px-2 py-0.5 text-xs text-white block">{p.stage}</span>
                      ) : null}
                      {isCover ? (
                        <span className="rounded bg-amber-500/90 px-2 py-0.5 text-[11px] text-black font-semibold block">
                          Cover
                        </span>
                      ) : null}
                    </div>

                    {/* Actions (top-right) */}
                    <div className="absolute right-2 top-2 z-20 flex gap-2">
                      {!isCover && (
                        <button
                          onClick={() => handleSetCoverPhoto(p)}
                          className="rounded-md bg-indigo-600/90 px-2 py-1 text-xs text-white hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          title="Set as cover photo"
                        >
                          Set Cover
                        </button>
                      )}
                      <button
                        onClick={() => handleDeletePhoto(p)}
                        className="rounded-md bg-red-600/90 px-2 py-1 text-xs text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400"
                        aria-label="Delete photo"
                        title="Delete photo"
                      >
                        Delete
                      </button>
                    </div>

                    <figcaption className="p-2 text-xs">
                      <div className="font-medium truncate">{p.caption || "—"}</div>
                      <div className="opacity-70">
                        {p.stage || "General"} · {fmtWhen(p.timestamp)}
                      </div>
                    </figcaption>
                  </figure>
                );
              })}
          </div>
        ) : (
          <div className="text-sm opacity-70">No photos yet.</div>
        )}
      </section>

      {/* Environment Log */}
      <section>
        <h2 className="text-lg font-semibold">🌡️ Environment Log</h2>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select
            value={envInputs.stage}
            onChange={(e) => setEnvInputs({ ...envInputs, stage: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          >
            <option value="">Stage</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Temp (°F)"
            value={envInputs.temperature}
            onChange={(e) => setEnvInputs({ ...envInputs, temperature: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
          <input
            type="number"
            placeholder="Humidity (%)"
            value={envInputs.humidity}
            onChange={(e) => setEnvInputs({ ...envInputs, humidity: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
          <input
            type="text"
            placeholder="Notes"
            value={envInputs.notes}
            onChange={(e) => setEnvInputs({ ...envInputs, notes: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
        </div>

        <button
          onClick={saveEnvLog}
          className="mt-2 px-4 py-1 rounded accent-bg disabled:opacity-60"
          disabled={
            !envInputs.stage ||
            envInputs.temperature === "" ||
            envInputs.humidity === ""
          }
        >
          ➕ Save Log
        </button>

        {Array.isArray(logs) && logs.length > 0 ? (
          <div className="mt-4 space-y-2 text-sm">
            {logs.map((log) => (
              <div key={log.id} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded">
                {editLogId === log.id ? (
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-start">
                    <select
                      value={editLog.stage}
                      onChange={(e) => setEditLog({ ...editLog, stage: e.target.value })}
                      className="p-2 border rounded bg-white dark:bg-zinc-900"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={editLog.temperature}
                      onChange={(e) => setEditLog({ ...editLog, temperature: e.target.value })}
                      placeholder="Temp (°F)"
                      className="p-2 border rounded bg-white dark:bg-zinc-900"
                    />
                    <input
                      type="number"
                      value={editLog.humidity}
                      onChange={(e) => setEditLog({ ...editLog, humidity: e.target.value })}
                      placeholder="Humidity (%)"
                      className="p-2 border rounded bg-white dark:bg-zinc-900"
                    />
                    <input
                      type="text"
                      value={editLog.notes}
                      onChange={(e) => setEditLog({ ...editLog, notes: e.target.value })}
                      placeholder="Notes"
                      className="p-2 border rounded bg-white dark:bg-zinc-900"
                    />
                    <div className="flex gap-2 justify-end">
                      <button className="chip" onClick={saveEditEnvLog}>Save</button>
                      <button className="btn-outline" onClick={cancelEditEnvLog}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <div className="font-semibold">
                        {log.stage} • {fmtWhen(log.timestamp)}
                      </div>
                      <div>Temp: {log.temperature}°F | RH: {log.humidity}%</div>
                      {log.notes && <div className="italic text-xs">{log.notes}</div>}
                    </div>
                    <div className="flex gap-2 self-end md:self-auto">
                      <button className="chip" onClick={() => beginEditEnvLog(log)}>Edit</button>
                      <button className="chip bg-red-600 text-white" onClick={() => deleteEnvLog(log)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm opacity-70 mt-3">No environment logs yet.</div>
        )}
      </section>
    </div>
  );
}
