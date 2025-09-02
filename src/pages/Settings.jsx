import React, { useCallback, useEffect, useMemo, useState } from "react";
import { auth, db } from "../firebase-config";
import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";

/**
 * Accent options and preview swatches (600 tone).
 * Keep hex in sync with index.css theme-* --_accent-600 values.
 */
const ACCENTS = [
  { id: "emerald", label: "Emerald", hex600: "#059669" },
  { id: "violet",  label: "Violet",  hex600: "#7c3aed" },
  { id: "amber",   label: "Amber",   hex600: "#d97706" },
  { id: "rose",    label: "Rose",    hex600: "#e11d48" },
  { id: "slate",   label: "Slate",   hex600: "#475569" },
];

const MODES = [
  { id: "system", label: "System" },
  { id: "light",  label: "Light"  },
  { id: "dark",   label: "Dark"   },
];

const TABS = [
  { id: "general", label: "General" },
  { id: "data",    label: "Data" },
  { id: "adv",     label: "Advanced" },
];

const defaultPrefs = {
  mode: "system",      // "system" | "light" | "dark"
  accent: "emerald",   // matches ACCENTS ids
};

/**
 * Apply theme classes directly (used if App-level callback not provided).
 * - Adds .dark for dark mode
 * - Adds one of .theme-emerald|violet|amber|rose|slate
 */
function applyThemeDOM(prefs) {
  const root = document.documentElement;

  // Mode
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  const isSystemDark = mq ? mq.matches : false;
  const dark =
    prefs.mode === "dark" || (prefs.mode === "system" && isSystemDark);

  root.classList.toggle("dark", !!dark);

  // Accent theme class
  const accentClasses = [
    "theme-emerald",
    "theme-violet",
    "theme-amber",
    "theme-rose",
    "theme-slate",
  ];
  accentClasses.forEach((c) => root.classList.remove(c));
  root.classList.add(`theme-${prefs.accent || "emerald"}`);
}

export default function Settings({
  /** Optional props from App (use if provided to avoid duplicate state) */
  preferences: externalPrefs,
  onSavePreferences, // (nextPrefs) => void
  // Optional callbacks for data actions (kept minimal; no-ops if absent)
  onExportJSON,
  onImportJSON,
  onClearAllData,
}) {
  const [activeTab, setActiveTab] = useState("general");

  // Internal prefs state mirrors external if provided, or loads Firestore once
  const [prefs, setPrefs] = useState(defaultPrefs);
  const uid = auth.currentUser?.uid || null;

  // Load preferences from Firestore if no external prefs provided
  useEffect(() => {
    let unsub = null;
    let isMounted = true;

    const bootstrap = async () => {
      if (externalPrefs) {
        setPrefs((p) => ({ ...p, ...externalPrefs }));
        return;
      }
      if (!uid) {
        // Use localStorage fallback if signed-out view
        try {
          const ls = localStorage.getItem("preferences");
          if (ls) setPrefs({ ...defaultPrefs, ...JSON.parse(ls) });
        } catch {}
        return;
      }
      // One-time fetch; App owns live listeners elsewhere
      const ref = doc(db, "users", uid, "settings", "preferences");
      const snap = await getDoc(ref);
      const next = snap.exists()
        ? { ...defaultPrefs, ...snap.data() }
        : defaultPrefs;

      if (!snap.exists()) {
        await setDoc(ref, next, { merge: true });
      }
      if (isMounted) setPrefs(next);
    };

    bootstrap();

    return () => {
      isMounted = false;
      if (typeof unsub === "function") unsub();
    };
  }, [uid, externalPrefs]);

  // Keep DOM/theme in sync if there is no parent handler controlling it.
  useEffect(() => {
    if (!onSavePreferences && prefs) {
      applyThemeDOM(prefs);
    }
  }, [onSavePreferences, prefs]);

  // If using system mode, react to OS change (only when not App-controlled)
  useEffect(() => {
    if (onSavePreferences) return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = () => {
      if (prefs.mode === "system") applyThemeDOM(prefs);
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [onSavePreferences, prefs]);

  const savePrefs = useCallback(
    async (next) => {
      setPrefs(next);

      // Mirror to localStorage (fast)
      try {
        localStorage.setItem("preferences", JSON.stringify(next));
      } catch {}

      if (onSavePreferences) {
        // Let App own persistence + DOM toggles to avoid double-work
        onSavePreferences(next);
        return;
      }

      // Local DOM update if App isn't handling it
      applyThemeDOM(next);

      // Firestore persistence (lightweight, merge)
      if (!uid) return;
      try {
        await setDoc(
          doc(db, "users", uid, "settings", "preferences"),
          next,
          { merge: true }
        );
      } catch (e) {
        // Non-fatal; preference still lives in localStorage and DOM
        // console.warn("Failed to persist preferences:", e);
      }
    },
    [onSavePreferences, uid]
  );

  const setMode = useCallback(
    (modeId) => savePrefs({ ...prefs, mode: modeId }),
    [prefs, savePrefs]
  );

  const setAccent = useCallback(
    (accentId) => {
      // Guard unknown accents
      const exists = ACCENTS.some((a) => a.id === accentId);
      const next = { ...prefs, accent: exists ? accentId : "emerald" };
      savePrefs(next);
    },
    [prefs, savePrefs]
  );

  // Derived helpers
  const isActiveTab = useCallback((id) => activeTab === id, [activeTab]);
  const modeIs = useCallback((id) => prefs.mode === id, [prefs.mode]);
  const accentIs = useCallback((id) => prefs.accent === id, [prefs.accent]);

  // Minimal Data/Advanced buttons call optional handlers
  const onExport = useCallback(() => onExportJSON && onExportJSON(), [onExportJSON]);
  const onImport = useCallback(() => onImportJSON && onImportJSON(), [onImportJSON]);
  const onClear  = useCallback(() => onClearAllData && onClearAllData(), [onClearAllData]);

  // Accent chip content (swatch + label)
  const AccentChip = useCallback(({ a }) => (
    <button
      type="button"
      className={`chip ${accentIs(a.id) ? "chip--active" : ""}`}
      aria-pressed={accentIs(a.id)}
      aria-label={`Set accent ${a.label}`}
      onClick={() => setAccent(a.id)}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: a.hex600 }}
        aria-hidden="true"
      />
      <span>{a.label}</span>
    </button>
  ), [accentIs, setAccent]);

  // Mode chip content
  const ModeChip = useCallback(({ m }) => (
    <button
      type="button"
      className={`chip ${modeIs(m.id) ? "chip--active" : ""}`}
      aria-pressed={modeIs(m.id)}
      onClick={() => setMode(m.id)}
    >
      {m.label}
    </button>
  ), [modeIs, setMode]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>

      {/* Section Tabs */}
      <div role="tablist" aria-label="Settings Sections" className="flex flex-wrap gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActiveTab(t.id)}
            className={`chip ${isActiveTab(t.id) ? "chip--active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Panels */}
      {activeTab === "general" && (
        <section role="tabpanel" aria-label="General settings" className="space-y-8">
          {/* Theme Mode */}
          <div>
            <h2 className="text-lg font-medium mb-3">Theme Mode</h2>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <ModeChip key={m.id} m={m} />
              ))}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              <span className="font-medium">System</span> follows your OS preference automatically.
            </p>
          </div>

          {/* Accent Color */}
          <div>
            <h2 className="text-lg font-medium mb-3">Accent Color</h2>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => (
                <AccentChip key={a.id} a={a} />
              ))}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Selected items and primary actions use the accent.
            </p>
          </div>
        </section>
      )}

      {activeTab === "data" && (
        <section role="tabpanel" aria-label="Data settings" className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline" onClick={onExport}>
              Export JSON
            </button>
            <button type="button" className="btn" onClick={onImport}>
              Import JSON
            </button>
            <button type="button" className="btn-accent" onClick={onExport}>
              Backup Now
            </button>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Exports and backups include grows, recipes, supplies, tasks, and preferences.
          </p>
        </section>
      )}

      {activeTab === "adv" && (
        <section role="tabpanel" aria-label="Advanced settings" className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-lg font-medium">Danger Zone</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  try {
                    localStorage.removeItem("preferences");
                  } catch {}
                  // Reset to defaults
                  savePrefs(defaultPrefs);
                }}
              >
                Reset Theme Preferences
              </button>

              <button
                type="button"
                className="btn"
                onClick={() => {
                  // Clear local storage cache (non-destructive to Firestore data)
                  try {
                    localStorage.clear();
                  } catch {}
                }}
              >
                Clear Local Cache
              </button>

              <button type="button" className="btn-accent" onClick={onClear}>
                Delete All Data
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Deleting data cannot be undone. Make sure you have an export/backup first.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
