// src/components/Settings.jsx
<<<<<<< HEAD
import React from "react";

export default function Settings({ darkMode, setDarkMode }) {
  return (
    <button
      onClick={() => setDarkMode(!darkMode)}
      className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded text-sm"
    >
      {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
    </button>
=======
import React, { useState, useEffect } from "react";
import { db, auth } from "../firebase-config";
import {
  collection,
  deleteDoc,
  getDocs,
  doc,
  setDoc,
  addDoc,
  Timestamp,
  getDoc,
} from "firebase/firestore";

export default function Settings() {
  const [trash, setTrash] = useState([]);
  const [prefs, setPrefs] = useState({
    theme: "default",
    fontSize: "medium",
    dyslexicFont: false,
    reduceMotion: false,
  });

  useEffect(() => {
    fetchTrash();
    fetchPreferences();
  }, []);

  const fetchTrash = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const trashRef = collection(db, "users", user.uid, "settings", "trash");
    const snap = await getDocs(trashRef);
    setTrash(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  };

  const fetchPreferences = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const ref = doc(db, "users", user.uid, "settings", "preferences");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      setPrefs(data);
      applyPreferences(data);
    }
  };

  const applyPreferences = (prefs) => {
    document.body.dataset.theme = prefs.theme || "default";
    document.documentElement.style.fontSize =
      prefs.fontSize === "small"
        ? "14px"
        : prefs.fontSize === "large"
        ? "18px"
        : "16px";
    document.body.classList.toggle("dyslexia-font", prefs.dyslexicFont);
    document.body.classList.toggle("reduce-motion", prefs.reduceMotion);
  };

  const savePreferences = async (updated) => {
    const user = auth.currentUser;
    if (!user) return;
    const newPrefs = { ...prefs, ...updated };
    setPrefs(newPrefs);
    applyPreferences(newPrefs);
    await setDoc(doc(db, "users", user.uid, "settings", "preferences"), newPrefs);
  };

  const clearAllData = async () => {
    if (!window.confirm("This will move all grows, recipes, and supplies to Trash. Continue?"))
      return;

    const user = auth.currentUser;
    if (!user) return;

    const moveToTrash = async (collectionName) => {
      const ref = collection(db, `users/${user.uid}/${collectionName}`);
      const snap = await getDocs(ref);

      for (const docSnap of snap.docs) {
        const item = docSnap.data();
        await setDoc(
          doc(db, `users/${user.uid}/settings/trash`, `${collectionName}_${docSnap.id}`),
          { ...item, originalCollection: collectionName, deletedAt: Timestamp.now() }
        );
        await deleteDoc(doc(db, `users/${user.uid}/${collectionName}`, docSnap.id));
      }
    };

    await Promise.all(["grows", "recipes", "supplies"].map(moveToTrash));
    fetchTrash();
    alert("🗑️ All data moved to trash.");
  };

  const restoreItem = async (item) => {
    const user = auth.currentUser;
    if (!user) return;
    await setDoc(
      doc(db, `users/${user.uid}/${item.originalCollection}/${item.id}`),
      item
    );
    await deleteDoc(doc(db, `users/${user.uid}/settings/trash`, item.id));
    fetchTrash();
  };

  const permanentlyDelete = async (item) => {
    const user = auth.currentUser;
    if (!user) return;
    if (!window.confirm("Permanently delete this item? This cannot be undone.")) return;
    await deleteDoc(doc(db, `users/${user.uid}/settings/trash`, item.id));
    fetchTrash();
  };

  return (
    <div className="p-6 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white max-w-3xl mx-auto rounded-2xl shadow space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">⚙️ Settings</h2>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold">🎨 Theme & Accessibility</h3>

        <label className="block">
          Color Theme:
          <select
            value={prefs.theme}
            onChange={(e) => savePreferences({ theme: e.target.value })}
            className="block mt-1 border p-2 rounded bg-white dark:bg-zinc-800"
          >
            <option value="default">Default</option>
            <option value="high-contrast">High Contrast</option>
            <option value="pastel">Pastel</option>
          </select>
        </label>

        <label className="block">
          Font Size:
          <select
            value={prefs.fontSize}
            onChange={(e) => savePreferences({ fontSize: e.target.value })}
            className="block mt-1 border p-2 rounded bg-white dark:bg-zinc-800"
          >
            <option value="small">Small</option>
            <option value="medium">Medium (Default)</option>
            <option value="large">Large</option>
          </select>
        </label>

        <label className="block">
          <input
            type="checkbox"
            checked={prefs.dyslexicFont}
            onChange={(e) => savePreferences({ dyslexicFont: e.target.checked })}
            className="mr-2"
          />
          Enable Dyslexia-Friendly Font
        </label>

        <label className="block">
          <input
            type="checkbox"
            checked={prefs.reduceMotion}
            onChange={(e) => savePreferences({ reduceMotion: e.target.checked })}
            className="mr-2"
          />
          Reduce Motion / Animations
        </label>
      </div>

      <button
        onClick={clearAllData}
        className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded shadow"
      >
        🧹 Clear All Data (Grows, Recipes, Supplies)
      </button>

      <div>
        <h3 className="text-xl font-semibold mt-6 mb-2">🗑️ Trash (Deleted Items)</h3>
        {trash.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">Trash is empty.</p>
        ) : (
          <ul className="space-y-2">
            {trash.map((item) => (
              <li
                key={item.id}
                className="border dark:border-zinc-600 p-4 rounded bg-zinc-50 dark:bg-zinc-800 flex justify-between items-center"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {item.strain || item.name || item.id}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Deleted from <strong>{item.originalCollection}</strong> on{" "}
                    {item.deletedAt?.toDate().toLocaleDateString() || "unknown"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => restoreItem(item)}
                    className="text-green-500 hover:underline text-sm"
                  >
                    ♻️ Restore
                  </button>
                  <button
                    onClick={() => permanentlyDelete(item)}
                    className="text-red-500 hover:underline text-sm"
                  >
                    ❌ Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
>>>>>>> be7d1a18 (Initial commit with final polished version)
  );
}
