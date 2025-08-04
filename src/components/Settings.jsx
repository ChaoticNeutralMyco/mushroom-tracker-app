// src/components/Settings.jsx
import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc, deleteField, updateDoc } from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";
import { db, auth } from "../firebase-config";

const Settings = () => {
  const [user] = useAuthState(auth);
  const [theme, setTheme] = useState("default");
  const [fontSize, setFontSize] = useState("medium");
  const [dyslexicFont, setDyslexicFont] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      if (!user) return;
      const prefRef = doc(db, "users", user.uid, "settings", "preferences");
      const snapshot = await getDoc(prefRef);
      if (snapshot.exists()) {
        const data = snapshot.data();
        setTheme(data.theme || "default");
        setFontSize(data.fontSize || "medium");
        setDyslexicFont(data.dyslexicFont || false);
        setReduceMotion(data.reduceMotion || false);
      }
    };
    loadSettings();
  }, [user]);

  const saveSettings = async () => {
    if (!user) return;
    const prefRef = doc(db, "users", user.uid, "settings", "preferences");
    await setDoc(prefRef, {
      theme,
      fontSize,
      dyslexicFont,
      reduceMotion,
    });
    alert("Settings saved. Reload to apply.");
  };

  const clearAllData = async () => {
    if (!user) return;
    const confirmed = window.confirm("Are you sure you want to clear all your data?");
    if (!confirmed) return;

    const collections = ["grows", "recipes", "supplies", "tasks"];
    for (const col of collections) {
      const ref = doc(db, "users", user.uid, "settings", "trash");
      await setDoc(ref, { [col]: deleteField() }, { merge: true });
    }

    alert("Data deleted (soft). You can restore from trash or export first.");
  };

  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow space-y-4">
      <h2 className="text-xl font-semibold dark:text-white">Settings</h2>

      <div className="space-y-2">
        <label className="block text-sm dark:text-white">Theme</label>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="w-full p-2 border rounded dark:bg-gray-700 dark:text-white"
        >
          <option value="default">Default</option>
          <option value="high-contrast">High Contrast</option>
          <option value="pastel">Pastel</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="block text-sm dark:text-white">Font Size</label>
        <select
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value)}
          className="w-full p-2 border rounded dark:bg-gray-700 dark:text-white"
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm dark:text-white">
          <input
            type="checkbox"
            checked={dyslexicFont}
            onChange={(e) => setDyslexicFont(e.target.checked)}
          />
          Dyslexia-friendly font
        </label>
        <label className="flex items-center gap-2 text-sm dark:text-white">
          <input
            type="checkbox"
            checked={reduceMotion}
            onChange={(e) => setReduceMotion(e.target.checked)}
          />
          Reduce motion/animations
        </label>
      </div>

      <div className="flex gap-2">
        <button
          onClick={saveSettings}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Save Settings
        </button>
        <button
          onClick={clearAllData}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Clear All Data
        </button>
      </div>
    </div>
  );
};

export default Settings;
