import React, { useMemo, useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { auth, db } from "../../firebase-config.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  writeBatch,
} from "firebase/firestore";

/**
 * BackupImport
 * - Accepts a JSON file produced by BackupExport (format "myco-backup@1")
 * - Validates shape and shows counts
 * - Lets you choose which collections to import
 * - Two modes: Skip existing docs (default) or Overwrite existing (merge)
 * - Runs in batched writes (<=400 per batch)
 *
 * Notes:
 * - Photo binaries are not handled here (metadata only).
 * - Timestamps were serialized in export; we best-effort convert common *At/*Date keys back to Date.
 */

const ISO_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const KNOWN = ["grows", "strains", "tasks", "recipes", "supplies", "notes", "photos"];

function reviveDates(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(reviveDates);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") out[k] = reviveDates(v);
    else if (typeof v === "string") {
      const low = k.toLowerCase();
      if (ISO_RX.test(v) && (low.endsWith("at") || low.endsWith("date"))) out[k] = new Date(v);
      else out[k] = v;
    } else out[k] = v;
  }
  return out;
}

export default function BackupImport() {
  const [fileInfo, setFileInfo] = useState(null); // { name, size }
  const [payload, setPayload] = useState(null);   // parsed object
  const [include, setInclude] = useState({});     // per-collection toggles
  const [mode, setMode] = useState("skip");       // 'skip' | 'overwrite'
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);     // { importedByCol, errors }
  const [error, setError] = useState(null);

  const uid = auth?.currentUser?.uid || null;

  const counts = useMemo(() => {
    const d = payload?.data || {};
    const obj = {};
    for (const k of KNOWN) obj[k] = Array.isArray(d[k]) ? d[k].length : 0;
    return obj;
  }, [payload]);

  const canImport = useMemo(() => {
    if (!uid || !payload) return false;
    return Object.entries(include).some(([k, v]) => v && counts[k] > 0);
  }, [uid, payload, include, counts]);

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    resetState();
    if (!f) return;

    setFileInfo({ name: f.name, size: f.size });
    try {
      const text = await f.text();
      const json = JSON.parse(text);

      if (!json || typeof json !== "object" || !json.data || typeof json.data !== "object") {
        throw new Error("Invalid file: missing top-level 'data'.");
      }
      if (json.meta?.format && json.meta.format !== "myco-backup@1") {
        throw new Error(`Unexpected format '${json.meta.format}'. Expected 'myco-backup@1'.`);
      }

      const toggles = {};
      for (const k of KNOWN) {
        toggles[k] = Array.isArray(json.data[k]) && json.data[k].length > 0;
      }
      setInclude(toggles);
      setPayload(json);
    } catch (err) {
      console.error("Import parse failed:", err);
      setError(err.message || String(err));
    }
  };

  function resetState() {
    setPayload(null);
    setInclude({});
    setMode("skip");
    setBusy(false);
    setResult(null);
    setError(null);
  }

  async function writeCollection(name, rows) {
    if (!uid || !Array.isArray(rows) || rows.length === 0)
      return { imported: 0, skipped: 0 };

    let imported = 0;
    let skipped = 0;

    let batch = writeBatch(db);
    let ops = 0;

    const flush = async () => {
      if (ops > 0) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    };

    for (const raw of rows) {
      const id = raw?.id || undefined;
      const data = reviveDates({ ...raw });
      if (id) delete data.id;

      const ref = id
        ? doc(db, "users", uid, name, id)
        : doc(collection(db, "users", uid, name)); // auto-id when missing

      if (mode === "skip" && id) {
        const exists = await getDoc(ref);
        if (exists.exists()) {
          skipped++;
          continue;
        }
      }

      batch.set(ref, data, { merge: mode === "overwrite" });
      imported++;
      ops++;
      if (ops >= 400) await flush();
    }
    await flush();
    return { imported, skipped };
  }

  const handleImport = async () => {
    if (!uid) {
      alert("You need to be signed in to import data.");
      return;
    }
    if (!payload) {
      alert("Please choose a backup JSON file first.");
      return;
    }
    setBusy(true);
    setResult(null);
    setError(null);

    try {
      const selected = Object.entries(include)
        .filter(([k, v]) => v && counts[k] > 0)
        .map(([k]) => k);

      const importedByCol = {};
      const errors = [];

      for (const col of selected) {
        try {
          const rows = payload.data[col] || [];
          const { imported, skipped } = await writeCollection(col, rows);
          importedByCol[col] = { imported, skipped, total: rows.length };
        } catch (e) {
          console.error(`Failed importing ${col}:`, e);
          importedByCol[col] = { imported: 0, skipped: 0, total: payload.data[col]?.length || 0 };
          errors.push(`${col}: ${e.message || e}`);
        }
      }

      setResult({ importedByCol, errors });
    } catch (err) {
      console.error("Import failed:", err);
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const ToggleRow = ({ id, label }) => (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
      <span className="text-sm text-slate-800 dark:text-slate-200">
        {label}{" "}
        {counts[id] ? (
          <span className="text-slate-500">({counts[id]})</span>
        ) : (
          <span className="text-slate-400">(0)</span>
        )}
      </span>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
        checked={!!include[id]}
        onChange={() => setInclude((s) => ({ ...s, [id]: !s[id] }))}
        disabled={!counts[id]}
      />
    </label>
  );

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 md:p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Import (JSON)
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Load a backup created by the Export tool. Choose collections and whether to overwrite or skip existing docs.
          </p>
        </div>
      </div>

      {/* File picker */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 cursor-pointer">
          <Upload className="h-4 w-4" />
          Choose JSON…
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFile}
          />
        </label>
        {fileInfo && (
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {fileInfo.name} • {(fileInfo.size / 1024).toFixed(1)} KB
          </div>
        )}
        {payload?.meta?.format && (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Format: <code>{payload.meta.format}</code>
          </div>
        )}
      </div>

      {/* Options */}
      {payload && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <ToggleRow id="grows" label="Grows" />
            <ToggleRow id="strains" label="Strains" />
            <ToggleRow id="tasks" label="Tasks" />
            <ToggleRow id="recipes" label="Recipes" />
            <ToggleRow id="supplies" label="Supplies" />
            <ToggleRow id="notes" label="Notes" />
            <ToggleRow id="photos" label="Photos (metadata)" />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="text-sm text-slate-700 dark:text-slate-300 inline-flex items-center gap-2">
              <input
                type="radio"
                name="import-mode"
                value="skip"
                checked={mode === "skip"}
                onChange={() => setMode("skip")}
              />
              Skip existing docs (default)
            </label>
            <label className="text-sm text-slate-700 dark:text-slate-300 inline-flex items-center gap-2">
              <input
                type="radio"
                name="import-mode"
                value="overwrite"
                checked={mode === "overwrite"}
                onChange={() => setMode("overwrite")}
              />
              Overwrite existing (merge)
            </label>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleImport}
              disabled={busy || !canImport}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition"
              title="Import selected collections"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Import Selected
                </>
              )}
            </button>

            {!uid && (
              <div className="inline-flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                Sign in to import.
              </div>
            )}
          </div>

          {/* Result */}
          {result && (
            <div className="mt-4 rounded-lg bg-slate-50 dark:bg-slate-950/40 p-3 text-xs text-slate-700 dark:text-slate-300 space-y-1">
              <div className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Import finished.
              </div>
              {Object.entries(result.importedByCol).map(([col, s]) => (
                <div key={col}>
                  <strong className="capitalize">{col}</strong>: imported {s.imported} / {s.total}
                  {s.skipped ? ` (skipped ${s.skipped})` : ""}
                </div>
              ))}
              {result.errors?.length > 0 && (
                <div className="text-rose-600 dark:text-rose-400">
                  Errors: {result.errors.join("; ")}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
