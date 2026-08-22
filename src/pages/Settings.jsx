// src/pages/Settings.jsx
// settings-v58-consolidated-control-center
// Centralizes active account, appearance, accessibility, workflow, reminder,
// environment, data-safety, label-default, and desktop update controls.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SubscriptionPage from "./SubscriptionPage.jsx";
import { auth, db } from "../firebase-config";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { deleteAllUserData, clearAllLocalCaches, deleteGrowDataOnly } from "../lib/delete-all";
import {
  buildUserDataBackup,
  importUserDataBackup,
  normalizeBackupPayload,
} from "../lib/user-data-backup";
import { useConfirm } from "../components/ui/ConfirmDialog";
import {
  getNotificationPermission,
  requestNotificationPermission,
} from "../lib/reminder-utils";
import { TOUR_CONTROL_EVENT } from "../utils/tourSteps";
import {
  DEFAULT_ACCENT,
  DEFAULT_APP_PREFERENCES,
  SUPPORTED_ACCENTS,
  getPreferenceDomClasses,
  normalizeAppPreferences,
} from "../lib/app-preferences";
import {
  DEFAULT_ENVIRONMENT_TARGETS,
  ENVIRONMENT_TARGET_STAGES,
  formatTemperatureValue,
  normalizeEnvironmentTargets,
  temperatureToFahrenheit,
} from "../lib/environmentTargets";

/** Accent palette */
const ACCENTS = [
  { id: "emerald", label: "Emerald", hex600: "#059669" },
  { id: "violet", label: "Violet", hex600: "#7c3aed" },
  { id: "amber", label: "Amber", hex600: "#d97706" },
  { id: "rose", label: "Rose", hex600: "#e11d48" },
  { id: "slate", label: "Slate", hex600: "#475569" },
  { id: "teal", label: "Teal", hex600: "#0d9488" },
  { id: "indigo", label: "Indigo", hex600: "#4f46e5" },
  { id: "sky", label: "Sky", hex600: "#0284c7" },
];

const MODES = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const TABS = [
  { id: "general", label: "General" },
  { id: "subscription", label: "Subscription" },
  { id: "labels", label: "Labels" },
  { id: "data", label: "Data" },
  { id: "adv", label: "Advanced" },
];

const defaultPrefs = normalizeAppPreferences(DEFAULT_APP_PREFERENCES, {
  systemDark: false,
});


function getRequestedSettingsTab() {
  try {
    const requested = new URLSearchParams(window.location.search || "").get(
      "settingsTab"
    );
    return TABS.some((tab) => tab.id === requested) ? requested : "general";
  } catch {
    return "general";
  }
}

const FONT_SCALE_OPTIONS = [
  { id: "small", label: "Standard" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];

// LocalStorage keys used by LabelPrint.jsx
const LS_LABEL_TEMPLATE = "labels.template"; // "5160" | "5167"
const LS_LABEL_CODE = "labels.codeType"; // "qr" | "none"
const LS_LABEL_GRID = "labels.gridOverlay"; // "1" | "0"
const LS_WM_ENABLED = "labels.watermark.enabled"; // "1" | "0"
const LS_WM_URL = "labels.watermark.url"; // string

function getSystemDark() {
  return !!window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
}

function applyThemeDOM(input) {
  const prefs = normalizeAppPreferences(input, { systemDark: getSystemDark() });
  const classes = getPreferenceDomClasses(prefs, { systemDark: getSystemDark() });
  const root = document.documentElement;

  SUPPORTED_ACCENTS.forEach((accent) => root.classList.remove(`theme-${accent}`));
  root.classList.add(`theme-${prefs.accent || DEFAULT_ACCENT}`);
  root.classList.toggle("dark", classes.dark);
  root.classList.toggle("bg-chaotic", classes.chaotic);
  root.classList.toggle("compact", classes.compact);
  root.classList.toggle("reduce-motion", classes.reduceMotion);
  root.classList.toggle("font-dyslexia", classes.dyslexiaFont);
  root.classList.toggle("high-contrast", classes.highContrast);
  root.classList.toggle("large-taps", classes.largeTaps);

  ["small", "medium", "large"].forEach((scale) =>
    root.classList.remove(`font-scale-${scale}`)
  );
  root.classList.add(`font-scale-${classes.fontScale}`);

  try {
    localStorage.setItem("cn_theme_style", prefs.themeStyle);
  } catch {}

  return prefs;
}

export default function Settings({
  preferences: externalPrefs,
  onSavePreferences,
  onExportJSON, // if provided, used for backup download
  onImportJSON,
  onClearAllData,
  activeGrowCount = 0,
}) {
  const [activeTab, setActiveTab] = useState(getRequestedSettingsTab);
  const [prefs, setPrefs] = useState(defaultPrefs);
  const [environmentTargetStage, setEnvironmentTargetStage] = useState("Fruiting");
  const [environmentTargetsDraft, setEnvironmentTargetsDraft] = useState(() =>
    normalizeEnvironmentTargets(defaultPrefs.environmentTargets)
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const uid = auth.currentUser?.uid || null;
  const confirm = useConfirm();
  const importInputRef = useRef(null);
  const [dataProgress, setDataProgress] = useState("");
  const [notificationPermission, setNotificationPermission] = useState(() =>
    getNotificationPermission()
  );

  const noticeToneClass = useMemo(() => ({
    success: "border border-[rgba(var(--_accent-rgb),0.35)] bg-[rgba(var(--_accent-rgb),0.10)] text-zinc-900 dark:text-zinc-100",
    error: "border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200",
    warning: "border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200",
    info: "border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 text-zinc-800 dark:text-zinc-200",
  }), []);

  const pushNotice = useCallback((message, tone = "success") => {
    setNotice({ message, tone });
  }, []);

  // Delete-all confirmation modal state
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState("");

  // Simple status for updater button
  // null | "checking" | "available" | "none" | "error"
  const [updateStatus, setUpdateStatus] = useState(null);

  // ---- Labels state (kept in this file; read by LabelPrint via LS) ----
  const [labelTemplate, setLabelTemplate] = useState(() => {
    try {
      return localStorage.getItem(LS_LABEL_TEMPLATE) || "5160";
    } catch {}
    return "5160";
  });
  const [labelCode, setLabelCode] = useState(() => {
    try {
      return localStorage.getItem(LS_LABEL_CODE) || "qr";
    } catch {}
    return "qr";
  });
  const [labelGrid, setLabelGrid] = useState(() => {
    try {
      return localStorage.getItem(LS_LABEL_GRID) === "1";
    } catch {}
    return false;
  });
  const [wmEnabled, setWmEnabled] = useState(() => {
    try {
      return localStorage.getItem(LS_WM_ENABLED) !== "0";
    } catch {}
    return true;
  });
  const [wmUrl, setWmUrl] = useState(() => {
    try {
      return localStorage.getItem(LS_WM_URL) || "";
    } catch {}
    return "";
  });

  // ---- Initial load: prefs + labels (Firestore mirrors) ----
  useEffect(() => {
    let isMounted = true;
    (async () => {
      let rawNext = defaultPrefs;

      if (externalPrefs) {
        rawNext = { ...defaultPrefs, ...externalPrefs };
      } else if (!uid) {
        try {
          const ls = localStorage.getItem("preferences");
          if (ls) rawNext = { ...defaultPrefs, ...JSON.parse(ls) };
        } catch {}
      } else {
        const ref = doc(db, "users", uid, "settings", "preferences");
        const snap = await getDoc(ref);
        rawNext = snap.exists() ? { ...defaultPrefs, ...snap.data() } : defaultPrefs;
      }

      if (!rawNext.themeStyle) {
        try {
          rawNext = {
            ...rawNext,
            themeStyle:
              localStorage.getItem("cn_theme_style") ||
              DEFAULT_APP_PREFERENCES.themeStyle,
          };
        } catch {}
      }

      const next = normalizeAppPreferences(rawNext, {
        systemDark: getSystemDark(),
      });

      // If Firestore has labels, mirror them locally
      const labels = (next && next.labels) || {};
      if (typeof labels === "object") {
        if (typeof labels.template === "string") setLabelTemplate(labels.template === "5167" ? "5167" : "5160");
        if (typeof labels.code === "string") setLabelCode(labels.code === "none" ? "none" : "qr");
        if (typeof labels.grid === "boolean") setLabelGrid(!!labels.grid);
        if (typeof labels.watermark === "boolean") setWmEnabled(!!labels.watermark);
        if (typeof labels.watermarkUrl === "string") setWmUrl(labels.watermarkUrl || "");
      }

      if (isMounted) {
        setPrefs(next);
        setEnvironmentTargetsDraft(next.environmentTargets);
        applyThemeDOM(next);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [uid, externalPrefs]);

  useEffect(() => {
    setEnvironmentTargetsDraft(
      normalizeEnvironmentTargets(prefs?.environmentTargets || {})
    );
  }, [prefs?.environmentTargets]);

  useEffect(() => {
    const syncSettingsTabFromLocation = () => {
      const requestedTab = getRequestedSettingsTab();
      if (requestedTab !== "general" || window.location.search.includes("settingsTab=")) {
        setActiveTab(requestedTab);
      }
    };

    window.addEventListener("popstate", syncSettingsTabFromLocation);
    syncSettingsTabFromLocation();

    return () =>
      window.removeEventListener("popstate", syncSettingsTabFromLocation);
  }, []);

  useEffect(() => {
    const handleSettingsTabRequest = (event) => {
      const requestedTab =
        typeof event?.detail === "string"
          ? event.detail
          : event?.detail?.tab;

      if (TABS.some((tab) => tab.id === requestedTab)) {
        setActiveTab(requestedTab);
      }
    };

    window.addEventListener("cn:settings-tab", handleSettingsTabRequest);
    return () =>
      window.removeEventListener("cn:settings-tab", handleSettingsTabRequest);
  }, []);

  useEffect(() => {
    const syncPermission = () => setNotificationPermission(getNotificationPermission());
    syncPermission();
    document.addEventListener("visibilitychange", syncPermission);
    window.addEventListener("focus", syncPermission);
    return () => {
      document.removeEventListener("visibilitychange", syncPermission);
      window.removeEventListener("focus", syncPermission);
    };
  }, []);

  // ---- Persist Labels to localStorage immediately on change ----
  useEffect(() => {
    try {
      localStorage.setItem(LS_LABEL_TEMPLATE, labelTemplate);
    } catch {}
  }, [labelTemplate]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_LABEL_CODE, labelCode);
    } catch {}
  }, [labelCode]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_LABEL_GRID, labelGrid ? "1" : "0");
    } catch {}
  }, [labelGrid]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_WM_ENABLED, wmEnabled ? "1" : "0");
    } catch {}
  }, [wmEnabled]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_WM_URL, wmUrl || "");
    } catch {}
  }, [wmUrl]);

  // ---- Save active app preferences ----
  const savePrefs = useCallback(
    async (next) => {
      const normalizedNext = normalizeAppPreferences(
        { ...prefs, ...next },
        { systemDark: getSystemDark() }
      );
      setPrefs(normalizedNext);
      applyThemeDOM(normalizedNext);
      try {
        localStorage.setItem("preferences", JSON.stringify(normalizedNext));
        localStorage.setItem(
          "cn_last_accent",
          normalizedNext.accent || DEFAULT_ACCENT
        );
        localStorage.setItem("cn_theme_style", normalizedNext.themeStyle);
      } catch {}
      if (onSavePreferences) {
        await onSavePreferences(normalizedNext);
      } else if (uid) {
        await setDoc(
          doc(db, "users", uid, "settings", "preferences"),
          normalizedNext,
          { merge: true }
        );
      }
      return normalizedNext;
    },
    [onSavePreferences, prefs, uid]
  );

  const setMode = (modeId) => savePrefs({ ...prefs, mode: modeId });
  const setAccent = (accentId) => {
    const exists = ACCENTS.some((a) => a.id === accentId);
    const id = exists ? accentId : "emerald";
    try {
      localStorage.setItem("cn_last_accent", id);
    } catch {}
    savePrefs({ ...prefs, accent: id });
  };
  const setThemeStyle = (styleId) => {
    const style = styleId === "chaotic" ? "chaotic" : "default";
    if (style === "default") {
      try {
        const last = localStorage.getItem("cn_last_accent");
        if (last && last !== prefs.accent) {
          savePrefs({ themeStyle: style, accent: last });
          return;
        }
      } catch {}
    }
    savePrefs({ themeStyle: style });
  };

  const setFontScale = (fontScale) => savePrefs({ fontScale });
  const setBooleanPreference = (key, enabled) =>
    savePrefs({ [key]: !!enabled });
  const setSplashDuration = (value) =>
    savePrefs({ splashMinMs: Math.max(0, Number(value) || 0) });

  // Units
  const setTempUnit = (u) => savePrefs({ temperatureUnit: u === "C" ? "C" : "F" });
  const setAutoConvert = (en) => savePrefs({ autoConvertEnvNotes: !!en });

  const selectedEnvironmentTarget =
    environmentTargetsDraft?.[environmentTargetStage] ||
    normalizeEnvironmentTargets()[environmentTargetStage];

  const environmentTemperatureUnit =
    String(prefs.temperatureUnit || "F").toUpperCase() === "C" ? "C" : "F";

  const environmentTemperatureInputValue = (field) =>
    formatTemperatureValue(
      selectedEnvironmentTarget?.[field],
      environmentTemperatureUnit
    );

  const updateEnvironmentTarget = (field, rawValue) => {
    setEnvironmentTargetsDraft((current) => {
      const normalized = normalizeEnvironmentTargets(current || {});
      const stageTarget = { ...(normalized[environmentTargetStage] || {}) };

      if (field === "tempMinF" || field === "tempMaxF") {
        const converted = temperatureToFahrenheit(
          rawValue,
          environmentTemperatureUnit
        );
        stageTarget[field] = rawValue === "" || converted === null ? "" : String(converted);
      } else if (field === "notes") {
        stageTarget.notes = String(rawValue || "");
      } else {
        const number = rawValue === "" ? "" : Number(rawValue);
        stageTarget[field] =
          rawValue === "" || !Number.isFinite(number) ? "" : String(number);
      }

      return {
        ...normalized,
        [environmentTargetStage]: stageTarget,
      };
    });
  };

  const validateEnvironmentTargets = (targets) => {
    for (const stage of ENVIRONMENT_TARGET_STAGES) {
      const target = targets?.[stage] || {};
      const tempMin = target.tempMinF === "" ? null : Number(target.tempMinF);
      const tempMax = target.tempMaxF === "" ? null : Number(target.tempMaxF);
      const humidityMin =
        target.humidityMin === "" ? null : Number(target.humidityMin);
      const humidityMax =
        target.humidityMax === "" ? null : Number(target.humidityMax);

      if (tempMin !== null && tempMax !== null && tempMin > tempMax) {
        return `${stage}: minimum temperature cannot exceed maximum temperature.`;
      }
      if (
        humidityMin !== null &&
        (humidityMin < 0 || humidityMin > 100)
      ) {
        return `${stage}: minimum humidity must be between 0% and 100%.`;
      }
      if (
        humidityMax !== null &&
        (humidityMax < 0 || humidityMax > 100)
      ) {
        return `${stage}: maximum humidity must be between 0% and 100%.`;
      }
      if (
        humidityMin !== null &&
        humidityMax !== null &&
        humidityMin > humidityMax
      ) {
        return `${stage}: minimum humidity cannot exceed maximum humidity.`;
      }
    }
    return "";
  };

  const saveEnvironmentTargets = async () => {
    const normalized = normalizeEnvironmentTargets(environmentTargetsDraft || {});
    const validationMessage = validateEnvironmentTargets(normalized);
    if (validationMessage) {
      pushNotice(validationMessage, "error");
      return;
    }

    await savePrefs({ environmentTargets: normalized });
    setEnvironmentTargetsDraft(normalized);
    pushNotice("Environment targets saved.", "success");
  };

  const restoreEnvironmentTargetDefaults = () => {
    setEnvironmentTargetsDraft(
      normalizeEnvironmentTargets(DEFAULT_ENVIRONMENT_TARGETS)
    );
    pushNotice(
      "Recommended defaults restored in the editor. Save environment targets to apply them.",
      "info"
    );
  };

  // Reminders
  const setTaskRemindersEnabled = (enabled) =>
    savePrefs({ taskReminders: !!enabled });
  const setStageRemindersEnabled = (enabled) =>
    savePrefs({ stageReminders: !!enabled });
  const setStageReminderTime = (hhmm) =>
    savePrefs({ stageReminderTime: hhmm || "09:00" });
  const setStageDays = (stage, days) => {
    const n = Math.max(0, Number(days) || 0);
    savePrefs({
      stageMaxDays: { ...(prefs.stageMaxDays || {}), [stage]: n },
    });
  };
  const clearFired = () => {
    try {
      localStorage.removeItem("remindersFired_v1");
      pushNotice("Stage reminder history cleared on this device.", "success");
    } catch {
      pushNotice("Could not clear stage reminder history.", "warning");
    }
  };
  const enableBrowserNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotificationPermission(result);

    if (result === "granted") {
      pushNotice("Browser notifications enabled on this device.", "success");
    } else if (result === "denied") {
      pushNotice(
        "Notifications are blocked in this browser or device settings. In-app reminders will still appear while the app is open.",
        "warning"
      );
    } else if (result === "unsupported") {
      pushNotice(
        "Browser notifications are not available here. In-app reminders will still appear while the app is open.",
        "info"
      );
    }
  };
  const sendTest = () => {
    window.dispatchEvent(
      new CustomEvent("cn-test-reminder", {
        detail: {
          title: "CNM — test reminder",
          body: "If you can see this, reminders can display on this device.",
        },
      })
    );
  };
  const setGuideEnabled = (enabled) => savePrefs({ guideEnabled: !!enabled });
  const sendTourControl = (action) => {
    if (prefs.guideEnabled === false) {
      pushNotice("Turn guided tours on before replaying or resetting them.", "info");
      return;
    }

    window.dispatchEvent(
      new CustomEvent(TOUR_CONTROL_EVENT, {
        detail: { action, routeKey: "settings" },
      })
    );

    pushNotice(
      action === "reset-all"
        ? "All page tours were reset. Each page will guide you again on its next visit."
        : "Replaying the Settings guide.",
      "success"
    );
  };

  // ---- JSON export/import ----
  const downloadBackup = useCallback((backup) => {
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cnm-user-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportJSON = useCallback(async () => {
    if (!uid) {
      pushNotice("You must be signed in to export your data.", "warning");
      return;
    }

    setBusy(true);
    setDataProgress("Preparing backup…");
    try {
      if (typeof onExportJSON === "function") {
        await onExportJSON();
        pushNotice("Backup download started.", "success");
        return;
      }

      const backup = await buildUserDataBackup({
        db,
        uid,
        localStorage,
        progress: setDataProgress,
      });
      downloadBackup(backup);
      pushNotice(
        `Backup downloaded with ${backup.summary.totalDocumentCount} records. Uploaded image files are not embedded in the JSON file.`,
        "success"
      );
    } catch (error) {
      console.error("Backup export failed:", error);
      pushNotice("Backup failed. No data was changed.", "error");
    } finally {
      setBusy(false);
      setDataProgress("");
    }
  }, [downloadBackup, onExportJSON, pushNotice, uid]);

  const handleImportSelected = useCallback(
    async (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;

      if (!uid) {
        pushNotice("You must be signed in to import a backup.", "warning");
        return;
      }

      try {
        if (typeof onImportJSON === "function") {
          await onImportJSON(file);
          pushNotice("Import completed.", "success");
          return;
        }

        const payload = JSON.parse(await file.text());
        const preview = normalizeBackupPayload(payload);
        if (preview.summary.totalDocumentCount === 0) {
          pushNotice("That backup does not contain any supported app records.", "warning");
          return;
        }

        const ok = await confirm({
          title: "Import backup?",
          message:
            `This will merge ${preview.summary.totalDocumentCount} records into the signed-in account. ` +
            "Records with matching IDs will be updated; unrelated current records will remain. " +
            "JSON backups contain photo metadata but do not contain the uploaded image files themselves.",
          confirmLabel: "Import backup",
          cancelLabel: "Cancel",
          tone: "warning",
        });
        if (!ok) return;

        setBusy(true);
        setDataProgress("Preparing import…");
        const result = await importUserDataBackup({
          db,
          uid,
          payload,
          localStorage,
          progress: setDataProgress,
        });

        const skipped = result.skippedCollections.length
          ? ` Unsupported collections skipped: ${result.skippedCollections.join(", ")}.`
          : "";
        pushNotice(
          `Imported ${result.restoredDocuments} records. Refresh the app to reload restored data.${skipped}`,
          result.skippedCollections.length ? "warning" : "success"
        );
      } catch (error) {
        console.error("Backup import failed:", error);
        pushNotice(
          error instanceof SyntaxError
            ? "Import failed because the selected file is not valid JSON."
            : `Import failed: ${error?.message || "The backup could not be restored."}`,
          "error"
        );
      } finally {
        setBusy(false);
        setDataProgress("");
      }
    },
    [confirm, onImportJSON, pushNotice, uid]
  );

  // ---- Danger-zone helpers ----
  async function handleClearLocal() {
    setBusy(true);
    try {
      await clearAllLocalCaches();
      pushNotice("Local cache cleared. You can refresh the page.", "success");
    } catch (e) {
      console.error(e);
      try {
        localStorage.clear();
      } catch {}
      pushNotice("Local cache clearing hit an error; a best-effort fallback was applied.", "warning");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteGrowOnly() {
    if (!uid) {
      pushNotice("You must be signed in.", "warning");
      return;
    }
    const ok = await confirm({
      title: "Delete grow data only?",
      message:
        "Delete grow records, tasks, notes, photo metadata/files, cleanup queue items, and post-processing history? Recipes, supplies, strains, and settings will remain.",
      confirmLabel: "Delete grow data",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await deleteGrowDataOnly();
      pushNotice(
        `Grow data deleted. Firestore docs removed: ${res.deleted}. Storage files removed: ${res.deletedFiles || 0}.`,
        "success"
      );
    } catch (e) {
      console.error(e);
      pushNotice("Failed to delete grow data.", "error");
    } finally {
      setBusy(false);
    }
  }

  // New Delete-All flow: backup prompt + type-to-confirm modal
  function handleDeleteAll() {
    if (typeof onClearAllData === "function") return onClearAllData();
    setShowDeleteAllModal(true);
    setTypedConfirm("");
  }

  async function confirmDeleteAll() {
    if (typedConfirm !== "DELETE") return;
    setBusy(true);
    try {
      const result = await deleteAllUserData();
      pushNotice(
        `Deleted your data. Firestore docs removed: ${result.deleted}. Storage purge attempted: ${result.deletedFiles ? "yes" : "skipped/disabled"}. Refresh the page to start clean.`,
        "success"
      );
    } catch (e) {
      console.error(e);
      pushNotice("Failed to delete all data. Are you signed in?", "error");
    } finally {
      setBusy(false);
      setShowDeleteAllModal(false);
      setTypedConfirm("");
    }
  }

  // Desktop-only: check for updates via Tauri updater plugin (no-op in web builds)
  const handleCheckForUpdates = async () => {
    try {
      // Guard: only run in Tauri desktop
      const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
      if (!tauri || !tauri.core || typeof tauri.core.invoke !== "function") {
        pushNotice("Check for updates is only available in the installed desktop app.", "info");
        return;
      }

      setUpdateStatus("checking");

      // Call the updater plugin command.
      // This mirrors the @tauri-apps/plugin-updater `check()` behavior.
      const result = await tauri.core.invoke("plugin:updater|check");

      console.log("Updater check result:", result);

      // Try to support different shapes defensively
      const available =
        (result && typeof result === "object" && "available" in result && !!result.available) ||
        (result && typeof result === "object" && result.response && result.response.available);

      if (available) {
        setUpdateStatus("available");
        pushNotice("An update is available. The desktop updater will follow your configured behavior.", "success");
      } else {
        setUpdateStatus("none");
        pushNotice("You are already on the latest desktop version.", "info");
      }
    } catch (err) {
      console.error("Update check failed:", err);
      setUpdateStatus("error");
      pushNotice("Couldn't check for updates. Make sure you're online and that updater is configured.", "error");
    }
  };

  // Derived for reminders UI
  const taskRemindersOn = prefs.taskReminders !== false;
  const stageRemindersOn = !!prefs.stageReminders;
  const stageReminderTime = String(prefs.stageReminderTime || "09:00");
  const daysInoc = Number(prefs.stageMaxDays?.Inoculated || 0);
  const daysFruit = Number(prefs.stageMaxDays?.Fruiting || 0);
  const notificationStatusLabel =
    notificationPermission === "granted"
      ? "Browser notifications enabled"
      : notificationPermission === "denied"
        ? "Blocked by browser or device settings"
        : notificationPermission === "unsupported"
          ? "Browser notifications unavailable; in-app alerts will be used"
          : "Browser notification permission not requested";

  const currentUser = auth.currentUser;
  const accountEmail = currentUser?.email || "Signed-in account";
  const providerLabel = Array.from(
    new Set(
      (currentUser?.providerData || [])
        .map((provider) => provider?.providerId)
        .filter(Boolean)
    )
  )
    .map((providerId) =>
      providerId === "password"
        ? "Email and password"
        : providerId === "google.com"
          ? "Google"
          : providerId
    )
    .join(", ") || "Firebase Authentication";

  const resetAppPreferences = async () => {
    const ok = await confirm({
      title: "Reset app preferences?",
      message:
        "This resets appearance, accessibility, startup, reminder, environment, and tour preferences. Your grows, inventory, tasks, photos, and label defaults are not deleted.",
      confirmLabel: "Reset preferences",
      cancelLabel: "Cancel",
      tone: "warning",
    });
    if (!ok) return;

    const reset = normalizeAppPreferences(
      {
        ...DEFAULT_APP_PREFERENCES,
        ...(prefs.labels ? { labels: prefs.labels } : {}),
      },
      { systemDark: getSystemDark() }
    );
    await savePrefs(reset);
    setEnvironmentTargetsDraft(reset.environmentTargets);
    pushNotice("App preferences reset to defaults.", "success");
  };

  // Save Label Defaults → mirror labels to preferences.labels in Firestore
  const saveLabelDefaults = async () => {
    try {
      const labels = {
        template: labelTemplate,
        code: labelCode,
        grid: !!labelGrid,
        watermark: !!wmEnabled,
        watermarkUrl: wmUrl || "",
      };
      // localStorage already updated by effects above
      if (uid) {
        await setDoc(doc(db, "users", uid, "settings", "preferences"), { labels }, { merge: true });
      } else {
        // also stash in local "preferences" blob for non-authed sessions
        const raw = localStorage.getItem("preferences");
        const cur = raw ? JSON.parse(raw) : {};
        const merged = { ...cur, labels };
        localStorage.setItem("preferences", JSON.stringify(merged));
      }
      pushNotice("Label defaults saved.", "success");
    } catch (e) {
      console.warn("Saving label defaults failed:", e);
      pushNotice("Could not save label defaults. They still persist locally on this device.", "warning");
    }
  };

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

      {notice ? (
        <div className={`mb-6 rounded-xl px-4 py-3 text-sm ${noticeToneClass[notice.tone] || noticeToneClass.info}`}>
          <div className="flex items-start justify-between gap-3">
            <span>{notice.message}</span>
            <button type="button" className="chip !px-2 !py-0.5" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        </div>
      ) : null}

      {/* GENERAL */}
      {activeTab === "general" && (
        <section role="tabpanel" aria-label="General settings" className="space-y-8">
          <div
            data-testid="settings-account-summary"
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 p-4"
          >
            <h2 className="text-lg font-medium mb-3">Account &amp; Sync</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Signed in as</dt>
                <dd className="font-medium break-all">{accountEmail}</dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Sign-in method</dt>
                <dd className="font-medium">{providerLabel}</dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Email status</dt>
                <dd className="font-medium">
                  {currentUser?.email
                    ? currentUser.emailVerified
                      ? "Verified"
                      : "Not verified"
                    : "Not provided"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 dark:text-slate-400">Preference storage</dt>
                <dd className="font-medium">
                  {uid ? "Synced to this account and cached on this device" : "Stored on this device"}
                </dd>
              </div>
            </dl>
          </div>

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

          {/* Theme Style */}
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

          {/* Accent */}
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

          <div data-testid="settings-accessibility-controls">
            <h2 className="text-lg font-medium mb-3">Accessibility &amp; Layout</h2>
            <div className="space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <div>
                <div className="text-sm font-medium mb-2">Text size</div>
                <div className="flex flex-wrap gap-2">
                  {FONT_SCALE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`chip ${prefs.fontScale === option.id ? "chip--active" : ""}`}
                      onClick={() => setFontScale(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  {
                    key: "dyslexiaFont",
                    label: "Reading-friendly font spacing",
                    help: "Uses a clearer system font stack with wider letter and line spacing.",
                  },
                  {
                    key: "reduceMotion",
                    label: "Reduce motion",
                    help: "Disables nonessential animations and transitions.",
                  },
                  {
                    key: "compactUI",
                    label: "Compact layout",
                    help: "Reduces common control and panel spacing.",
                  },
                  {
                    key: "highContrast",
                    label: "Higher contrast",
                    help: "Strengthens borders and surface separation.",
                  },
                  {
                    key: "largeTaps",
                    label: "Larger tap targets",
                    help: "Increases the minimum size of buttons and form controls.",
                  },
                ].map((option) => (
                  <label
                    key={option.key}
                    className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={!!prefs[option.key]}
                      onChange={(event) =>
                        setBooleanPreference(option.key, event.target.checked)
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {option.help}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Guide toggle */}
          <div data-tour="guide-controls">
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
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="chip"
                onClick={() => sendTourControl("replay")}
                disabled={prefs.guideEnabled === false}
              >
                Replay Settings guide
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => sendTourControl("reset-all")}
                disabled={prefs.guideEnabled === false}
              >
                Restart all page tours
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              When Off, the bottom-left help button is hidden and page tours do not auto-open.
            </p>
          </div>

          <div data-testid="settings-startup-workflow">
            <h2 className="text-lg font-medium mb-3">Startup &amp; Workflow</h2>
            <div className="space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Startup splash screen</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Show the branded loading screen while account preferences and live data connect.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`chip ${prefs.showSplashOnLoad ? "chip--active" : ""}`}
                    onClick={() => setBooleanPreference("showSplashOnLoad", true)}
                  >
                    On
                  </button>
                  <button
                    type="button"
                    className={`chip ${!prefs.showSplashOnLoad ? "chip--active" : ""}`}
                    onClick={() => setBooleanPreference("showSplashOnLoad", false)}
                  >
                    Off
                  </button>
                </div>
              </div>

              {prefs.showSplashOnLoad ? (
                <label className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-slate-600 dark:text-slate-300">Minimum splash duration</span>
                  <select
                    value={String(prefs.splashMinMs || 1200)}
                    onChange={(event) => setSplashDuration(event.target.value)}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                  >
                    <option value="600">0.6 seconds</option>
                    <option value="1200">1.2 seconds</option>
                    <option value="2000">2 seconds</option>
                  </select>
                </label>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <div>
                  <div className="text-sm font-medium">Automatically stamp stage dates</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Records today&apos;s date the first time a grow enters a stage, unless that stage date is locked.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`chip ${prefs.autoStampStageDates ? "chip--active" : ""}`}
                    onClick={() => setBooleanPreference("autoStampStageDates", true)}
                  >
                    On
                  </button>
                  <button
                    type="button"
                    className={`chip ${!prefs.autoStampStageDates ? "chip--active" : ""}`}
                    onClick={() => setBooleanPreference("autoStampStageDates", false)}
                  >
                    Off
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Units */}
          <div data-tour="units-block">
            <h2 className="text-lg font-medium mb-3">Units</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={`chip ${String(prefs.temperatureUnit || "F").toUpperCase() === "F" ? "chip--active" : ""}`}
                onClick={() => setTempUnit("F")}
              >
                Fahrenheit (°F)
              </button>
              <button
                className={`chip ${String(prefs.temperatureUnit || "F").toUpperCase() === "C" ? "chip--active" : ""}`}
                onClick={() => setTempUnit("C")}
              >
                Celsius (°C)
              </button>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!prefs.autoConvertEnvNotes}
                onChange={(e) => setAutoConvert(e.target.checked)}
              />
              Also store a °C copy for analytics
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Notes always save a canonical Fahrenheit value. Enabling this also saves a converted Celsius value.
            </p>
          </div>

          {/* Environment targets */}
          <div
            className="space-y-4"
            data-testid="environment-targets-editor"
          >
            <div>
              <h2 className="text-lg font-medium">Environment Targets</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Set global temperature and humidity ranges by grow stage. Temperature
                inputs follow your selected unit and are stored canonically in Fahrenheit.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1 md:col-span-2">
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Stage
                </span>
                <select
                  data-testid="environment-target-stage-select"
                  value={environmentTargetStage}
                  onChange={(e) => setEnvironmentTargetStage(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                >
                  {ENVIRONMENT_TARGET_STAGES.map((stageName) => (
                    <option key={stageName} value={stageName}>
                      {stageName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Minimum temperature (°{environmentTemperatureUnit})
                </span>
                <input
                  data-testid="environment-target-temp-min"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={environmentTemperatureInputValue("tempMinF")}
                  onChange={(e) =>
                    updateEnvironmentTarget("tempMinF", e.target.value)
                  }
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Maximum temperature (°{environmentTemperatureUnit})
                </span>
                <input
                  data-testid="environment-target-temp-max"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={environmentTemperatureInputValue("tempMaxF")}
                  onChange={(e) =>
                    updateEnvironmentTarget("tempMaxF", e.target.value)
                  }
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Minimum humidity (%)
                </span>
                <input
                  data-testid="environment-target-humidity-min"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  value={selectedEnvironmentTarget?.humidityMin || ""}
                  onChange={(e) =>
                    updateEnvironmentTarget("humidityMin", e.target.value)
                  }
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1">
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Maximum humidity (%)
                </span>
                <input
                  data-testid="environment-target-humidity-max"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  value={selectedEnvironmentTarget?.humidityMax || ""}
                  onChange={(e) =>
                    updateEnvironmentTarget("humidityMax", e.target.value)
                  }
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Stage guidance
                </span>
                <textarea
                  data-testid="environment-target-notes"
                  rows={3}
                  value={selectedEnvironmentTarget?.notes || ""}
                  onChange={(e) =>
                    updateEnvironmentTarget("notes", e.target.value)
                  }
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                  placeholder="Optional stage-specific guidance"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="environment-target-save"
                className="btn btn-accent"
                onClick={saveEnvironmentTargets}
              >
                Save Environment Targets
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={restoreEnvironmentTargetDefaults}
              >
                Restore Recommended Defaults
              </button>
            </div>
          </div>

          {/* Reminders */}
          <div data-tour="reminders-block">
            <h2 className="text-lg font-medium mb-2">Reminders</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Task and grow-stage reminders run while the app is open. Enable browser notifications for system alerts; otherwise the app uses an in-app reminder.
            </p>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 mb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Notification permission</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {notificationStatusLabel}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {notificationPermission === "default" && (
                    <button
                      type="button"
                      className="btn-outline text-xs"
                      onClick={enableBrowserNotifications}
                    >
                      Enable browser notifications
                    </button>
                  )}
                  <button type="button" className="btn-outline text-xs" onClick={sendTest}>
                    Send test reminder
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 mb-4">
              <div className="text-sm font-medium mb-1">Task reminders</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Uses each task's due date and reminder lead time. A task is notified once for its current schedule, including when overdue.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={`chip ${!taskRemindersOn ? "chip--active" : ""}`}
                  onClick={() => setTaskRemindersEnabled(false)}
                >
                  Off
                </button>
                <button
                  type="button"
                  className={`chip ${taskRemindersOn ? "chip--active" : ""}`}
                  onClick={() => setTaskRemindersEnabled(true)}
                >
                  On
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="text-sm font-medium mb-1">Grow-stage window reminders</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Optional reminders for configured inoculation-check and fruiting-to-harvest windows.
              </p>

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  type="button"
                  className={`chip ${!stageRemindersOn ? "chip--active" : ""}`}
                  onClick={() => setStageRemindersEnabled(false)}
                >
                  Off
                </button>
                <button
                  type="button"
                  className={`chip ${stageRemindersOn ? "chip--active" : ""}`}
                  onClick={() => setStageRemindersEnabled(true)}
                >
                  On
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3 mb-3">
                <label className="text-sm text-slate-600 dark:text-slate-300">
                  Stage reminder time
                </label>
                <input
                  type="time"
                  value={stageReminderTime}
                  onChange={(event) => setStageReminderTime(event.target.value)}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <label className="w-36 text-sm text-slate-600 dark:text-slate-300">
                    Inoculated (days)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={Number.isFinite(daysInoc) ? daysInoc : 0}
                    onChange={(event) => setStageDays("Inoculated", event.target.value)}
                    className="w-28 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-36 text-sm text-slate-600 dark:text-slate-300">
                    Fruiting (days)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={Number.isFinite(daysFruit) ? daysFruit : 0}
                    onChange={(event) => setStageDays("Fruiting", event.target.value)}
                    className="w-28 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-outline text-xs" onClick={clearFired}>
                  Clear stage reminder history
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Clears only this device's grow-stage reminder history.
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SUBSCRIPTION */}
      {activeTab === "subscription" && (
        <section
          role="tabpanel"
          aria-label="Subscription settings"
          data-testid="settings-subscription-panel"
        >
          <SubscriptionPage activeGrowCount={activeGrowCount} />
        </section>
      )}

      {/* LABELS */}
      {activeTab === "labels" && (
        <section role="tabpanel" aria-label="Label settings" className="space-y-6">
          <h2 className="text-lg font-medium">Label Defaults</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Template */}
            <div className="space-y-2">
              <div className="text-sm opacity-70">Template</div>
              <select
                className="rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2"
                value={labelTemplate}
                onChange={(e) => setLabelTemplate(e.target.value === "5167" ? "5167" : "5160")}
              >
                <option value="5160">Avery 5160 / 8160 (2.625″ × 1″)</option>
                <option value="5167">Avery 5167 (1.75″ × 0.5″)</option>
              </select>
            </div>

            {/* Code type */}
            <div className="space-y-2">
              <div className="text-sm opacity-70">Code Type</div>
              <select
                className="rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2"
                value={labelCode}
                onChange={(e) => setLabelCode(e.target.value === "none" ? "none" : "qr")}
              >
                <option value="qr">QR</option>
                <option value="none">None</option>
              </select>
            </div>

            {/* Grid overlay */}
            <label className="inline-flex items-center gap-2 select-none">
              <input
                type="checkbox"
                className="h-4 w-4 align-middle"
                checked={labelGrid}
                onChange={(e) => setLabelGrid(e.target.checked)}
              />
              <span className="text-sm">Show grid overlay in preview</span>
            </label>

            {/* Watermark toggle */}
            <label className="inline-flex items-center gap-2 select-none">
              <input
                type="checkbox"
                className="h-4 w-4 align-middle"
                checked={wmEnabled}
                onChange={(e) => setWmEnabled(e.target.checked)}
              />
              <span className="text-sm">Enable watermark</span>
            </label>

            {/* Watermark URL */}
            <div className="space-y-2 md:col-span-2">
              <div className="text-sm opacity-70">Watermark URL (PNG/SVG/data:)</div>
              <input
                className="w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2"
                placeholder="https://… or data:image/png;base64,…"
                value={wmUrl}
                onChange={(e) => setWmUrl(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              className="mt-2 px-3 py-2 rounded-lg btn-accent"
              onClick={saveLabelDefaults}
            >
              Save Label Defaults
            </button>
          </div>
        </section>
      )}

      {/* DATA */}
      {activeTab === "data" && (
        <section role="tabpanel" aria-label="Data settings" className="space-y-6">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportSelected}
          />

          <div data-testid="settings-storage-overview" className="space-y-3">
            <h2 className="text-lg font-medium">Storage &amp; Persistence</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-sm font-medium">App records</div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Grows, tasks, recipes, inventory, sales history, and preferences are stored in Firestore under your account.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-sm font-medium">Uploaded images</div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Grow and strain image files are stored in Firebase Storage with Firestore metadata for traceability.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-sm font-medium">This device</div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  A local cache keeps preferences and app data responsive. Clearing it does not delete cloud records.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-medium">Backup and Restore</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-accent"
                onClick={handleExportJSON}
                disabled={busy}
              >
                {busy && dataProgress ? "Working…" : "Download JSON Backup"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => importInputRef.current?.click()}
                disabled={busy}
              >
                Import JSON Backup
              </button>
            </div>
            {dataProgress ? (
              <p className="text-sm font-medium text-[rgb(var(--_accent-rgb))]">
                {dataProgress}
              </p>
            ) : null}
            <p className="text-sm text-slate-500 dark:text-slate-400">
              The backup includes current grow, recipe, supply, task, photo metadata, strain, storage-location, cleanup, post-processing, sales-history, and settings records. Import uses a safe merge: matching document IDs are updated and unrelated current records remain.
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Uploaded image files are stored separately in Firebase Storage and are not embedded in the JSON backup. Subscription and billing data are also excluded.
            </p>
          </div>
        </section>
      )}

      {/* ADVANCED */}
      {activeTab === "adv" && (
        <section role="tabpanel" aria-label="Advanced settings" className="space-y-6">
          {/* Updates block */}
          <div className="space-y-3">
            <h2 className="text-lg font-medium">Desktop Updates</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Check for updates to the installed desktop app. This only works in the Tauri desktop build.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn"
                onClick={handleCheckForUpdates}
                disabled={busy || updateStatus === "checking"}
              >
                {updateStatus === "checking" ? "Checking…" : "Check for desktop updates"}
              </button>
              {updateStatus === "available" && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  Update available — follow any prompts in the desktop app.
                </span>
              )}
              {updateStatus === "none" && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  You&apos;re on the latest version.
                </span>
              )}
              {updateStatus === "error" && (
                <span className="text-xs text-rose-500 dark:text-rose-400">
                  Error checking for updates. See console for details.
                </span>
              )}
            </div>
          </div>

          {/* Danger Zone (unchanged logic) */}
          <div className="space-y-3">
            <h2 className="text-lg font-medium">Danger Zone</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-outline"
                onClick={resetAppPreferences}
                disabled={busy}
              >
                Reset App Preferences
              </button>
              <button type="button" className="btn" onClick={handleClearLocal} disabled={busy}>
                Clear Local Cache
              </button>

              {/* NEW: Delete Grow Data Only */}
              <button type="button" className="btn-accent" onClick={handleDeleteGrowOnly} disabled={busy}>
                Delete Grow Data Only
              </button>

              {/* Updated: Delete All Data opens modal */}
              <button type="button" className="btn-accent" onClick={handleDeleteAll} disabled={busy}>
                Delete All Data
              </button>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Resetting preferences does not delete records. Data deletion cannot be undone, so download a JSON backup first and separately preserve any uploaded images you need.
            </p>
          </div>
        </section>
      )}

      {/* Delete-All Modal with Backup + Type-to-Confirm */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-zinc-900">
            <h3 className="text-lg font-semibold text-rose-600 dark:text-rose-400">Delete ALL Data</h3>
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
              This will permanently delete <strong>all</strong> app data and uploaded Storage files. The JSON backup can restore database records, but it does not contain the uploaded image files themselves.
            </p>

            <div className="mt-4 flex gap-2">
              <button
                className="btn-outline text-sm"
                onClick={handleExportJSON}
                disabled={busy}
              >
                Download Backup
              </button>
            </div>

            <div className="mt-4">
              <label className="text-sm block mb-1">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </label>
              <input
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                placeholder="DELETE"
                value={typedConfirm}
                onChange={(e) => setTypedConfirm(e.target.value)}
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="btn-outline"
                onClick={() => {
                  setShowDeleteAllModal(false);
                  setTypedConfirm("");
                }}
              >
                Cancel
              </button>
              <button
                className="btn bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                disabled={busy || typedConfirm !== "DELETE"}
                onClick={confirmDeleteAll}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
