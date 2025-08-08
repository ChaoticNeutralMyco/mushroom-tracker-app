// src/components/tools/ImportExportButtons.jsx
import React from "react";
import { FileDown, FileUp } from "lucide-react";

// Fallback-only Firebase bits (used if App doesn't pass data/handlers yet)
import { auth, db } from "../../firebase-config";
import {
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc,
} from "firebase/firestore";

// Save-as helper
import { saveAs } from "file-saver";

/**
 * ImportExportButtons
 *
 * Preferred (prop-driven) usage — NO reads here:
 *   <ImportExportButtons
 *     grows={grows} tasks={tasks} recipes={recipes} supplies={supplies}
 *     photos={photos} notes={notes} strains={strains} prefs={prefs}
 *     onImportData={(data) => ...} // optional: App handles the write
 *   />
 *
 * Fallback (legacy) — if props/handlers are missing, this component will:
 *   - read all collections from Firestore on export
 *   - write them back on import (including settings/preferences doc)
 */
export default function ImportExportButtons({
  // Prop-driven export data (arrays or objects). If provided, no reads occur.
  grows,
  tasks,
  recipes,
  supplies,
  photos,
  notes,
  strains,
  prefs, // preferences doc (object)
  // Optional: let App own the import behavior
  onImportData,
  className = "",
}) {
  const handleExport = async () => {
    // If App passes data, build export from props only
    const hasPropData =
      Array.isArray(grows) ||
      Array.isArray(tasks) ||
      Array.isArray(recipes) ||
      Array.isArray(supplies) ||
      Array.isArray(photos) ||
      Array.isArray(notes) ||
      Array.isArray(strains) ||
      !!prefs;

    let exportData;

    if (hasPropData) {
      exportData = {
        grows: grows || [],
        tasks: tasks || [],
        recipes: recipes || [],
        supplies: supplies || [],
        photos: photos || [],
        notes: notes || [],
        strains: strains || [],
        prefs: prefs || {}, // single doc
      };
    } else {
      // Fallback: read from Firestore
      const user = auth.currentUser;
      if (!user) return;

      const names = [
        "grows",
        "tasks",
        "recipes",
        "supplies",
        "photos",
        "notes",
        "strains",
      ];
      const out = {};
      for (const name of names) {
        const ref = collection(db, "users", user.uid, name);
        const snapshot = await getDocs(ref);
        out[name] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      }

      // Pull settings/preferences doc if present
      try {
        const prefRef = doc(db, "users", user.uid, "settings", "preferences");
        const snap = await getDocs(collection(db, "users", user.uid, "settings"));
        const maybePref = snap.docs.find((d) => d.id === "preferences");
        out.prefs = maybePref ? { ...maybePref.data() } : {};
      } catch {
        out.prefs = {};
      }

      exportData = out;
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    saveAs(blob, `backup-${new Date().toISOString()}.json`);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const importData = JSON.parse(text);

    // If App wants to own the import flow, hand it off.
    if (typeof onImportData === "function") {
      await onImportData(importData);
      alert("Import complete!");
      e.target.value = "";
      return;
    }

    // Fallback: commit to Firestore directly
    const user = auth.currentUser;
    if (!user) return;

    const batch = writeBatch(db);

    // Collections (arrays of docs with ids)
    const arrayKeys = [
      "grows",
      "tasks",
      "recipes",
      "supplies",
      "photos",
      "notes",
      "strains",
    ];
    for (const key of arrayKeys) {
      const arr = Array.isArray(importData[key]) ? importData[key] : [];
      for (const item of arr) {
        const itemRef = doc(db, "users", user.uid, key, item.id || crypto.randomUUID());
        batch.set(itemRef, item);
      }
    }

    // Preferences doc (single object)
    const prefsObj =
      importData.prefs ||
      // Back-compat: some exports used an array "settings" with {id:"preferences",...}
      (Array.isArray(importData.settings)
        ? importData.settings.find((d) => d?.id === "preferences")
        : null) ||
      null;

    if (prefsObj && typeof prefsObj === "object") {
      const prefRef = doc(db, "users", user.uid, "settings", "preferences");
      batch.set(prefRef, prefsObj);
    }

    await batch.commit();
    alert("Import complete!");
    e.target.value = "";
  };

  return (
    <div className={`flex gap-4 items-center ${className}`}>
      <button
        onClick={handleExport}
        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-green-600"
        aria-label="Export all data to a JSON backup"
      >
        <FileDown className="w-4 h-4" />
        Export Data
      </button>

      <label
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-600"
        aria-label="Import data from a JSON file"
        tabIndex={0}
      >
        <FileUp className="w-4 h-4" />
        Import Data
        <input
          type="file"
          accept=".json,application/json"
          onChange={handleImport}
          className="hidden"
        />
      </label>
    </div>
  );
}
