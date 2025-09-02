import React, { useEffect, useMemo, useState } from "react";
import { Download, Loader2, CheckCircle2 } from "lucide-react";
import { auth, db } from "../../firebase-config.js";
import {
  collection,
  getDocs,
  // getCountFromServer may not exist in older SDKs; we detect at runtime
} from "firebase/firestore";

const KNOWN = ["grows", "strains", "tasks", "recipes", "supplies", "notes", "photos"];

// Convert any Date or Firestore Timestamp to ISO string; recurse arrays/objects.
function dehydrate(value) {
  if (value == null) return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString(); // Timestamp
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(dehydrate);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = dehydrate(v);
    return out;
  }
  return value;
}

async function countCollectionSafe(colRef) {
  try {
    // Prefer fast server-side count if available
    const mod = await import("firebase/firestore");
    if (typeof mod.getCountFromServer === "function") {
      const snap = await mod.getCountFromServer(colRef);
      // new SDKs: snap.data().count ; older: snap.data()?.count
      const data = snap.data ? snap.data() : {};
      const c = (data && (data.count ?? data?.aggregate?.count)) ?? 0;
      return typeof c === "number" ? c : 0;
    }
  } catch {
    // ignore and fall back
  }
  // Fallback: read doc refs and count
  const snap = await getDocs(colRef);
  return snap.size ?? snap.docs.length ?? 0;
}

export default function BackupExport({
  grows,
  strains,
  tasks,
  recipes,
  supplies,
  notes,
  photos,
}) {
  const uid = auth?.currentUser?.uid || null;

  const hydrated = useMemo(
    () => ({ grows, strains, tasks, recipes, supplies, notes, photos }),
    [grows, strains, tasks, recipes, supplies, notes, photos]
  );

  const [include, setInclude] = useState(() => {
    const initial = {};
    for (const k of KNOWN) {
      const arr = hydrated[k];
      initial[k] = Array.isArray(arr) ? arr.length > 0 : true; // default ON
    }
    return initial;
  });

  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { fileName, counts }
  const [counts, setCounts] = useState(() => {
    const m = {};
    for (const k of KNOWN) m[k] = Array.isArray(hydrated[k]) ? hydrated[k].length : null; // null = unknown yet
    return m;
  });

  // Fetch counts for any collections that weren't hydrated
  useEffect(() => {
    let alive = true;
    if (!uid) {
      setCounts((prev) => {
        const m = { ...prev };
        for (const k of KNOWN) if (m[k] == null) m[k] = 0;
        return m;
      });
      return;
    }
    (async () => {
      const next = { ...counts };
      for (const name of KNOWN) {
        if (next[name] != null) continue; // already known (from hydrated)
        try {
          const colRef = collection(db, "users", uid, name);
          next[name] = await countCollectionSafe(colRef);
          if (!alive) return;
          setCounts((prev) => ({ ...prev, [name]: next[name] }));
        } catch {
          if (!alive) return;
          setCounts((prev) => ({ ...prev, [name]: 0 }));
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  async function fetchIfNeeded(name) {
    if (Array.isArray(hydrated[name])) return hydrated[name];
    if (!uid) return [];
    const snap = await getDocs(collection(db, "users", uid, name));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function buildPayload() {
    const data = {};
    const resultCounts = {};
    for (const name of KNOWN) {
      if (!include[name]) {
        data[name] = [];
        resultCounts[name] = 0;
        continue;
      }
      const rows = await fetchIfNeeded(name);
      data[name] = rows.map((r) => dehydrate(r));
      resultCounts[name] = data[name].length;
    }
    const payload = {
      meta: {
        format: "myco-backup@1",
        exportedAt: new Date().toISOString(),
        app: "Myco Tracker",
        uid: uid || null,
      },
      data,
    };
    return { payload, counts: resultCounts };
  }

  async function handleDownload() {
    setBusy(true);
    setDone(null);
    try {
      const { payload, counts: resultCounts } = await buildPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `myco-backup-${ts}.json`;

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 0);

      setDone({ fileName, counts: resultCounts });
    } catch (e) {
      console.error(e);
      alert(`Export failed: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  const ToggleRow = ({ id, label }) => {
    const n = counts[id];
    const suffix =
      n == null ? "…" : typeof n === "number" ? `(${n})` : "";
    return (
      <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
        <span className="text-sm text-slate-800 dark:text-slate-200">
          {label} {suffix && <span className="text-slate-500">{suffix}</span>}
        </span>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
          checked={!!include[id]}
          onChange={() => setInclude((s) => ({ ...s, [id]: !s[id] }))}
        />
      </label>
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 md:p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Export (JSON)
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Download a full backup of your data as a single JSON file. Choose which
            collections to include.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <ToggleRow id="grows" label="Grows" />
        <ToggleRow id="strains" label="Strains" />
        <ToggleRow id="tasks" label="Tasks" />
        <ToggleRow id="recipes" label="Recipes" />
        <ToggleRow id="supplies" label="Supplies" />
        <ToggleRow id="notes" label="Notes" />
        <ToggleRow id="photos" label="Photos (meta)" />
      </div>

      <div className="mt-4">
        <button
          onClick={handleDownload}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition"
          title="Download JSON backup"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Download Full Backup (JSON)
            </>
          )}
        </button>
      </div>

      {done && (
        <div className="mt-4 rounded-lg bg-slate-50 dark:bg-slate-950/40 p-3 text-xs text-slate-700 dark:text-slate-300 space-y-1">
          <div className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Exported <strong>{done.fileName}</strong>
          </div>
          <div>
            Counts:&nbsp;
            {Object.entries(done.counts)
              .map(([k, v]) => `${k}:${v}`)
              .join("  ")}
          </div>
        </div>
      )}
    </div>
  );
}
