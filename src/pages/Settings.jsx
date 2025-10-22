// src/pages/Settings.jsx
// Restored original Settings with your preferences logic; adds safe fallbacks for Delete All & Clear Cache.
import React, { useCallback, useEffect, useState } from "react";
import { auth, db } from "../firebase-config";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { deleteAllUserData, clearAllLocalCaches } from "../lib/delete-all";

/** Accent palette (removed 'chaotic'; added teal, indigo, sky) */
const ACCENTS = [
  { id: "emerald", label: "Emerald", hex600: "#059669" },
  { id: "violet",  label: "Violet",  hex600: "#7c3aed" },
  { id: "amber",   label: "Amber",   hex600: "#d97706" },
  { id: "rose",    label: "Rose",    hex600: "#e11d48" },
  { id: "slate",   label: "Slate",   hex600: "#475569" },
  { id: "teal",    label: "Teal",    hex600: "#0d9488" },
  { id: "indigo",  label: "Indigo",  hex600: "#4f46e5" },
  { id: "sky",     label: "Sky",     hex600: "#0284c7" },
];

const MODES = [
  { id: "system", label: "System" },
  { id: "light",  label: "Light"  },
  { id: "dark",   label: "Dark"   },
];

const TABS = [
  { id: "general", label: "General"  },
  { id: "data",    label: "Data"     },
  { id: "adv",     label: "Advanced" },
];

const defaultPrefs = {
  mode: "system",
  accent: "emerald",
  themeStyle: "default", // "default" | "chaotic"  (stored locally too)
  stageReminders: false,
  taskDigestTime: "09:00",
  stageMaxDays: { Inoculated: 0, Fruiting: 0 },

  // Units
  temperatureUnit: "F",
  autoConvertEnvNotes: true,

  // NEW: control the guide menu and onboarding
  guideEnabled: true,
};

function applyThemeDOM(prefs) {
  const root = document.documentElement;
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  const isSystemDark = mq ? mq.matches : false;
  const dark = prefs.mode === "dark" || (prefs.mode === "system" && isSystemDark);

  root.classList.toggle("dark", !!dark);
  ["theme-emerald","theme-violet","theme-amber","theme-rose","theme-slate","theme-teal","theme-indigo","theme-sky","theme-chaotic"].forEach((c) => root.classList.remove(c));
  root.classList.add(`theme-${prefs.accent || "emerald"}`);
}

function syncThemeStyle(style) {
  const enable = style === "chaotic";
  const root = document.documentElement;
  root.classList.toggle("bg-chaotic", enable);
  try { localStorage.setItem("cn_theme_style", enable ? "chaotic" : "default"); } catch {}
}

export default function Settings({
  preferences: externalPrefs,
  onSavePreferences,
  onExportJSON,
  onImportJSON,
  onClearAllData,
}) {
  const [activeTab, setActiveTab] = useState("general");
  const [prefs, setPrefs] = useState(defaultPrefs);
  const [busy, setBusy] = useState(false);
  const uid = auth.currentUser?.uid || null;

  useEffect(() => {
    let isMounted = true;
    (async () => {
      let next = defaultPrefs;

      if (externalPrefs) {
        next = { ...defaultPrefs, ...externalPrefs };
      } else if (!uid) {
        try {
          const ls = localStorage.getItem("preferences");
          if (ls) next = { ...defaultPrefs, ...JSON.parse(ls) };
        } catch {}
      } else {
        const ref = doc(db, "users", uid, "settings", "preferences");
        const snap = await getDoc(ref);
        next = snap.exists() ? { ...defaultPrefs, ...snap.data() } : defaultPrefs;
        if (!snap.exists()) await setDoc(ref, next, { merge: true });
      }

      // Load local theme style toggle
      try {
        const localStyle = localStorage.getItem("cn_theme_style");
        if (localStyle) next = { ...next, themeStyle: localStyle };
      } catch {}

      if (isMounted) {
        setPrefs(next);
        applyThemeDOM(next);
        syncThemeStyle(next.themeStyle);
      }
    })();
    return () => { isMounted = false; };
  }, [uid, externalPrefs]);

  const savePrefs = useCallback(
    async (next) => {
      setPrefs(next);
      try { localStorage.setItem("preferences", JSON.stringify(next)); } catch {}
      if (onSavePreferences) {
        onSavePreferences(next);
      } else {
        applyThemeDOM(next);
        syncThemeStyle(next.themeStyle);
        if (uid) await setDoc(doc(db, "users", uid, "settings", "preferences"), next, { merge: true });
      }
    },
    [onSavePreferences, uid]
  );

  const setMode   = (modeId)   => savePrefs({ ...prefs, mode: modeId });
  const setAccent = (accentId) => {
    const exists = ACCENTS.some((a) => a.id === accentId);
    const id = exists ? accentId : "emerald";
    try { localStorage.setItem("cn_last_accent", id); } catch {}
    savePrefs({ ...prefs, accent: id });
  };

  const setThemeStyle = (styleId) => {
    let style = styleId === "chaotic" ? "chaotic" : "default";
    if (style === "default") {
      try {
        const last = localStorage.getItem("cn_last_accent");
        if (last && last !== prefs.accent) {
          savePrefs({ ...prefs, themeStyle: style, accent: last });
          return;
        }
      } catch {}
    }
    savePrefs({ ...prefs, themeStyle: style });
  };

  // Units
  const setTempUnit   = (u) => savePrefs({ ...prefs, temperatureUnit: u === "C" ? "C" : "F" });
  const setAutoConvert= (en) => savePrefs({ ...prefs, autoConvertEnvNotes: !!en });

  // Reminders
  const setRemindersEnabled = (en) => savePrefs({ ...prefs, stageReminders: !!en });
  const setDigestTime = (hhmm) => savePrefs({ ...prefs, taskDigestTime: hhmm || "09:00" });
  const setStageDays = (stage, days) => {
    const n = Math.max(0, Number(days) || 0);
    savePrefs({ ...prefs, stageMaxDays: { ...(prefs.stageMaxDays || {}), [stage]: n } });
  };
  const clearFired = () => { try { localStorage.removeItem("remindersFired_v1"); } catch {} };
  const sendTest = () => {
    window.dispatchEvent(new CustomEvent("cn-test-reminder", {
      detail: { title: "CNM — test reminder", body: "If you can see this, reminders can display on this device." },
    }));
  };

  // Guide toggle
  const setGuideEnabled = (enabled) => savePrefs({ ...prefs, guideEnabled: !!enabled });

  // ------- Danger Zone fallbacks (keep your props if provided) -------
  async function handleClearLocal() {
    setBusy(true);
    try {
      await clearAllLocalCaches(); // wipes LS/SS + common IndexedDBs
      alert("Local cache cleared. You can refresh the page.");
    } catch (e) {
      console.error(e);
      try { localStorage.clear(); } catch {}
      alert("Local cache clearing hit an error; best-effort fallback applied.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAll() {
    if (typeof onClearAllData === "function") {
      return onClearAllData();
    }
    const ok = window.confirm(
      "Delete ALL your data (grows, recipes, supplies, labels, strains, tasks, queue, etc.)? This cannot be undone."
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = await deleteAllUserData();
      alert(
        `Deleted your data.\nFirestore docs removed: ${result.deleted}\nStorage purge attempted: ${
          result.deletedFiles ? "yes" : "skipped/disabled"
        }\n\nRefresh the page to start clean.`
      );
    } catch (e) {
      console.error(e);
      alert("Failed to delete all data. Are you signed in?");
    } finally {
      setBusy(false);
    }
  }

  const remindersOn = !!prefs.stageReminders;
  const digestTime = String(prefs.taskDigestTime || "09:00");
  const daysInoc   = Number(prefs.stageMaxDays?.Inoculated || 0);
  const daysFruit  = Number(prefs.stageMaxDays?.Fruiting || 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>

      <div role="tablist" aria-label="Settings Sections" className="flex flex-wrap gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={`chip ${activeTab === t.id ? "chip--active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <section role="tabpanel" aria-label="General settings" className="space-y-8">
          <div>
            <h2 className="text-lg font-medium mb-3">Theme Mode</h2>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className={`chip ${prefs.mode === m.id ? "chip--active" : ""}`}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              <span className="font-medium">System</span> follows your OS preference automatically.
            </p>
          </div>

          {/* Theme Style: controls background only */}
          <div>
            <h2 className="text-lg font-medium mb-3">Theme Style</h2>
            <div className="flex flex-wrap gap-2" data-tour="theme-style">
              <button
                className={`chip ${prefs.themeStyle !== "chaotic" ? "chip--active" : ""}`}
                onClick={() => setThemeStyle("default")}
              >
                Default
              </button>
              <button
                className={`chip ${prefs.themeStyle === "chaotic" ? "chip--active" : ""}`}
                onClick={() => setThemeStyle("chaotic")}
              >
                Chaotic
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Chaotic keeps the mountains background regardless of accent.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-medium mb-3">Accent Color</h2>
            <div className="flex flex-wrap gap-2" data-tour="accent-color">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  className={`chip ${prefs.accent === a.id ? "chip--active" : ""}`}
                  onClick={() => setAccent(a.id)}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.hex600 }} />
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              Change the accent without affecting the Chaotic background.
            </p>
          </div>

          {/* NEW: Guide menu & onboarding toggle */}
          <div>
            <h2 className="text-lg font-medium mb-3">Guided tour &amp; Help menu</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={`chip ${prefs.guideEnabled ? "chip--active" : ""}`}
                onClick={() => setGuideEnabled(true)}
              >
                On
              </button>
              <button
                className={`chip ${!prefs.guideEnabled ? "chip--active" : ""}`}
                onClick={() => setGuideEnabled(false)}
              >
                Off
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              When Off, the bottom-left help button is hidden and onboarding will not auto-open.
            </p>
          </div>

          {/* Units */}
          <div>
            <h2 className="text-lg font-medium mb-3">Units</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button className={`chip ${String(prefs.temperatureUnit || "F").toUpperCase() === "F" ? "chip--active" : ""}`} onClick={() => setTempUnit("F")}>
                Fahrenheit (°F)
              </button>
              <button className={`chip ${String(prefs.temperatureUnit || "F").toUpperCase() === "C" ? "chip--active" : ""}`} onClick={() => setTempUnit("C")}>
                Celsius (°C)
              </button>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!prefs.autoConvertEnvNotes} onChange={(e) => setAutoConvert(e.target.checked)} />
              Also store a °C copy for analytics
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Notes always save a canonical Fahrenheit value. Enabling this also saves a converted Celsius value.
            </p>
          </div>

          {/* Reminders */}
          <div>
            <h2 className="text-lg font-medium mb-3">Task Reminders</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
              Local (device-only) reminders for stage windows.
            </p>

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button className={`chip ${!remindersOn ? "chip--active" : ""}`} onClick={() => setRemindersEnabled(false)}>Off</button>
              <button className={`chip ${remindersOn ? "chip--active" : ""}`} onClick={() => setRemindersEnabled(true)}>On</button>
              <button className="btn-outline text-xs ml-2" onClick={sendTest}>Send test notification</button>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-3">
              <label className="text-sm text-slate-600 dark:text-slate-300">Daily digest time</label>
              <input
                type="time"
                value={digestTime}
                onChange={(e) => setDigestTime(e.target.value)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <label className="w-36 text-sm text-slate-600 dark:text-slate-300">Inoculated (days)</label>
                <input
                  type="number" min="0" step="1"
                  value={Number.isFinite(daysInoc) ? daysInoc : 0}
                  onChange={(e) => setStageDays("Inoculated", e.target.value)}
                  className="w-28 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-36 text-sm text-slate-600 dark:text-slate-300">Fruiting (days)</label>
                <input
                  type="number" min="0" step="1"
                  value={Number.isFinite(daysFruit) ? daysFruit : 0}
                  onChange={(e) => setStageDays("Fruiting", e.target.value)}
                  className="w-28 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="btn-outline text-xs" onClick={clearFired}>Clear fired reminders</button>
              <span className="text-xs text-slate-500 dark:text-slate-400">(Only clears local “already notified” memory on this device)</span>
            </div>
          </div>
        </section>
      )}

      {activeTab === "data" && (
        <section role="tabpanel" aria-label="Data settings" className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline" onClick={onExportJSON}>Export JSON</button>
            <button type="button" className="btn" onClick={onImportJSON}>Import JSON</button>
            <button type="button" className="btn-accent" onClick={onExportJSON}>Backup Now</button>
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
                type="button" className="btn-outline"
                onClick={() => {
                  try { localStorage.removeItem("preferences"); } catch {}
                  savePrefs(defaultPrefs);
                }}
                disabled={busy}
              >
                Reset Theme Preferences
              </button>
              <button type="button" className="btn" onClick={handleClearLocal} disabled={busy}>
                Clear Local Cache
              </button>
              <button type="button" className="btn-accent" onClick={handleDeleteAll} disabled={busy}>
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
