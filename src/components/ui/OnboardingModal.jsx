// src/components/OnboardingModal.jsx
import React, { useState } from "react";
import { auth, db } from "../../firebase-config";
import { doc, setDoc } from "firebase/firestore";

export default function OnboardingModal({ visible, onClose }) {
  const [saving, setSaving] = useState(false);

  const handleClose = async () => {
    setSaving(true);
    const user = auth.currentUser;
    if (user) {
      const settingsRef = doc(db, "users", user.uid, "settings", "preferences");
      await setDoc(settingsRef, { hasSeenOnboarding: true }, { merge: true });
    }
    setSaving(false);
    onClose();
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl max-w-md w-full p-6 text-zinc-900 dark:text-white">
        <h2 className="text-2xl font-bold mb-4">👋 Welcome to Chaotic Mycology</h2>
        <p className="mb-4 text-zinc-700 dark:text-zinc-300">
          This app helps you track your mushroom cultivation from spore to harvest. You can:
        </p>
        <ul className="list-disc list-inside text-zinc-600 dark:text-zinc-400 space-y-1 mb-6">
          <li>📋 Add and manage your grows</li>
          <li>📸 Upload photos and stage history</li>
          <li>📝 Track tasks and reminders</li>
          <li>📈 View analytics and yields</li>
          <li>🧪 Monitor costs and recipes</li>
        </ul>
        <button
          onClick={handleClose}
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md font-semibold transition"
        >
          {saving ? "Saving..." : "Let's Get Started!"}
        </button>
      </div>
    </div>
  );
}
