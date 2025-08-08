// src/pages/Settings.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc,
  serverTimestamp,
  query,
  where,
} from "firebase/firestore";
import { db, auth } from "../firebase-config";

// Lives in the same folder as this file
import ClearGrowDataButton from "./ClearGrowDataButton";

/**
 * Settings Page
 * - Prop-driven for existing preferences (App.jsx owns listeners)
 * - Can use onSavePrefs (if provided) to persist + apply theme immediately
 * - Otherwise, writes directly to Firestore here
 *
 * Accepted props (supports both old/new):
 *  - preferences | prefs: object
 *  - onSaved?: function
 *  - onSavePrefs?: function
 *  - applyAppearance?: function
 */
export default function Settings({
  preferences,
  prefs,
  onSaved,
  onSavePrefs,
  applyAppearance,
}) {
  const incoming = preferences ?? prefs ?? {};
  // ---------- Local state mirrored from props (with safe defaults) ----------
  const [notifTime, setNotifTime] = useState("09:00");
  const [highlightOverdue, setHighlightOverdue] = useState(true);
  const [enableStageReminders, setEnableStageReminders] = useState(false);

  const [exportFormat, setExportFormat] = useState("csv");
  const [deleteConfirmations, setDeleteConfirmations] = useState("bulk");
  const [anonymousAnalytics, setAnonymousAnalytics] = useState(false);

  const [enableBackup, setEnableBackup] = useState(false);
  const [backupFrequency, setBackupFrequency] = useState("weekly");
  const [backupDestination, setBackupDestination] = useState("local");

  const [developerMode, setDeveloperMode] = useState(false);
  const [showOnboardingAgain, setShowOnboardingAgain] = useState(false);

  const [saving, setSaving] = useState(false);
  const [wiping, setWiping] = useState(false);

  // Hydrate from props when they arrive/update
  useEffect(() => {
    if (!incoming) return;
    setNotifTime(incoming.notifTime ?? "09:00");
    setHighlightOverdue(!!incoming.highlightOverdue);
    setEnableStageReminders(!!incoming.enableStageReminders);

    setExportFormat(incoming.exportFormat ?? "csv");
    setDeleteConfirmations(incoming.deleteConfirmations ?? "bulk");
    setAnonymousAnalytics(!!incoming.anonymousAnalytics);

    setEnableBackup(!!incoming.enableBackup);
    setBackupFrequency(incoming.backupFrequency ?? "weekly");
    setBackupDestination(incoming.backupDestination ?? "local");

    setDeveloperMode(!!incoming.developerMode);
    setShowOnboardingAgain(!!incoming.showOnboardingAgain);
  }, [incoming]);

  const uid = useMemo(() => auth.currentUser?.uid || null, [auth?.currentUser]);

  // Build the payload from current state
  const buildPrefs = () => ({
    notifTime,
    highlightOverdue,
    enableStageReminders,
    exportFormat,
    deleteConfirmations,
    anonymousAnalytics,
    enableBackup,
    backupFrequency,
    backupDestination,
    developerMode,
    showOnboardingAgain,
    updatedAt: serverTimestamp(),
  });

  // ---------- Actions ----------
  const saveSettings = async () => {
    if (!uid) {
      alert("You must be signed in to save settings.");
      return;
    }
    try {
      setSaving(true);
      const newPrefs = buildPrefs();

      if (typeof onSavePrefs === "function") {
        // Prefer App-managed save so it can also apply theme instantly
        await onSavePrefs(newPrefs);
        if (typeof applyAppearance === "function") {
          // Apply locally right away for instant UI feedback
          try {
            const now = { ...incoming, ...newPrefs };
            // remove serverTimestamp for local apply
            delete now.updatedAt;
            applyAppearance(now);
          } catch {}
        }
      } else {
        // Fallback: write directly here
        const prefRef = doc(db, "users", uid, "settings", "preferences");
        await setDoc(prefRef, newPrefs, { merge: true });
      }

      if (typeof onSaved === "function") onSaved();
      alert("Settings saved.");
    } catch (e) {
      console.error(e);
      alert(`Failed to save settings: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Full wipe (moves everything to Trash first, then deletes)
  const handleClearAllData = async () => {
    if (wiping) return;
    const step1 = window.confirm(
      "This will delete ALL grows, recipes, supplies and linked tasks/photos/notes. Items will be moved to Trash first. Continue?"
    );
    if (!step1) return;
    const step2 = window.confirm("Are you 100% sure? This is a destructive action.");
    if (!step2) return;

    try {
      setWiping(true);
      if (!uid) throw new Error("Not signed in.");

      const addToTrash = async (payload) => {
        const trashRef = doc(collection(db, "users", uid, "settings", "trash"));
        await setDoc(trashRef, {
          ...payload,
          deletedAt: serverTimestamp(),
          source: "clearAllData",
        });
      };

      // 1) Get grows (we also need to delete linked collections per grow)
      const growsSnap = await getDocs(collection(db, "users", uid, "grows"));
      const growIds = [];
      for (const d of growsSnap.docs) {
        await addToTrash({ type: "grow", id: d.id, data: d.data() });
        growIds.push(d.id);
      }

      // 2) Delete linked docs for each grow (tasks, photos, notes)
      const linked = [
        { name: "tasks", field: "growId" },
        { name: "photos", field: "growId" },
        { name: "notes", field: "growId" },
      ];

      for (const { name, field } of linked) {
        for (const gid of growIds) {
          const col = collection(db, "users", uid, name);
          const snap = await getDocs(query(col, where(field, "==", gid)));
          if (!snap.empty) {
            let batch = writeBatch(db);
            let count = 0;
            for (const d of snap.docs) {
              await addToTrash({ type: name.slice(0, -1), id: d.id, data: d.data() });
              batch.delete(doc(db, "users", uid, name, d.id));
              count++;
              if (count >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                count = 0;
              }
            }
            if (count > 0) await batch.commit();
          }
        }
      }

      // 3) Delete grows
      {
        let batch = writeBatch(db);
        let count = 0;
        for (const d of growsSnap.docs) {
          batch.delete(doc(db, "users", uid, "grows", d.id));
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      }

      // 4) Recipes
      const recipesSnap = await getDocs(collection(db, "users", uid, "recipes"));
      {
        let batch = writeBatch(db);
        let count = 0;
        for (const d of recipesSnap.docs) {
          await addToTrash({ type: "recipe", id: d.id, data: d.data() });
          batch.delete(doc(db, "users", uid, "recipes", d.id));
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      }

      // 5) Supplies
      const suppliesSnap = await getDocs(collection(db, "users", uid, "supplies"));
      {
        let batch = writeBatch(db);
        let count = 0;
        for (const d of suppliesSnap.docs) {
          await addToTrash({ type: "supply", id: d.id, data: d.data() });
          batch.delete(doc(db, "users", uid, "supplies", d.id));
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      }

      alert("All data cleared (moved to Trash).");
    } catch (e) {
      console.error(e);
      alert(`Failed to clear data: ${e.message}`);
    } finally {
      setWiping(false);
    }
  };

  // ---------- Render ----------
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">
        Chaotic Neutral Tracker
      </h1>

      {/* Notifications */}
      <section className="mb-10">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
          Notifications
        </h2>
        <div className="space-y-4">
          <div className="sm:w-64">
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
              Daily reminder time
            </label>
            <input
              type="time"
              value={notifTime}
              onChange={(e) => setNotifTime(e.target.value)}
              className="w-full rounded-lg border border-transparent bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={highlightOverdue}
              onChange={(e) => setHighlightOverdue(e.target.checked)}
            />
            <span className="text-sm text-gray-800 dark:text-gray-200">
              Highlight overdue tasks
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enableStageReminders}
              onChange={(e) => setEnableStageReminders(e.target.checked)}
            />
            <span className="text-sm text-gray-800 dark:text-gray-200">
              Enable stage-duration reminders
            </span>
          </label>
        </div>
      </section>

      {/* Data & Privacy */}
      <section className="mb-10">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
          Data & Privacy
        </h2>
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
              Export format (default)
            </label>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              className="w-full rounded-lg border border-transparent bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-gray-100 px-3 py-2"
            >
              <option value="csv">csv</option>
              <option value="json">json</option>
              <option value="pdf">pdf</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
              Delete confirmations
            </label>
            <select
              value={deleteConfirmations}
              onChange={(e) => setDeleteConfirmations(e.target.value)}
              className="w-full rounded-lg border border-transparent bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-gray-100 px-3 py-2"
            >
              <option value="bulk">Bulk only</option>
              <option value="always">Always</option>
              <option value="never">Never</option>
            </select>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={anonymousAnalytics}
              onChange={(e) => setAnonymousAnalytics(e.target.checked)}
            />
            <span className="text-sm text-gray-800 dark:text-gray-200">
              Anonymous analytics
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enableBackup}
              onChange={(e) => setEnableBackup(e.target.checked)}
            />
            <span className="text-sm text-gray-800 dark:text-gray-200">
              Enable backup
            </span>
          </label>

          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                Backup frequency
              </label>
              <select
                value={backupFrequency}
                onChange={(e) => setBackupFrequency(e.target.value)}
                className="w-full rounded-lg border border-transparent bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-gray-100 px-3 py-2"
                disabled={!enableBackup}
              >
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
                Destination
              </label>
              <select
                value={backupDestination}
                onChange={(e) => setBackupDestination(e.target.value)}
                className="w-full rounded-lg border border-transparent bg-gray-100 dark:bg-zinc-800 text-gray-900 dark:text-gray-100 px-3 py-2"
                disabled={!enableBackup}
              >
                <option value="local">local</option>
                <option value="cloud">cloud</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Advanced */}
      <section className="mb-10">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Advanced</h2>
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={developerMode}
              onChange={(e) => setDeveloperMode(e.target.checked)}
            />
            <span className="text-sm text-gray-800 dark:text-gray-200">
              Developer mode (show IDs, extra logs)
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={showOnboardingAgain}
              onChange={(e) => setShowOnboardingAgain(e.target.checked)}
            />
            <span className="text-sm text-gray-800 dark:text-gray-200">
              Show onboarding again
            </span>
          </label>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-medium shadow"
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>

        {/* Clears ONLY grows/tasks/photos/notes; recipes & supplies kept */}
        <ClearGrowDataButton />

        <button
          data-testid="clear-all-data"
          onClick={handleClearAllData}
          disabled={wiping}
          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium shadow"
        >
          {wiping ? "Clearing…" : "Clear All Data"}
        </button>
      </div>
    </div>
  );
}
