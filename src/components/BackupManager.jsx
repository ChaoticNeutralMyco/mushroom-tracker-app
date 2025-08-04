// src/components/BackupManager.jsx
import React from 'react';
import { db, auth } from '../firebase-config';
import {
  collection,
  getDocs,
  setDoc,
  doc,
} from 'firebase/firestore';
import { FileDown, FileUp } from 'lucide-react';

export default function BackupManager() {
  const handleExport = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const growsSnap = await getDocs(collection(db, `users/${user.uid}/grows`));
    const tasksSnap = await getDocs(collection(db, `users/${user.uid}/tasks`));
    const settingsSnap = await getDocs(collection(db, `users/${user.uid}/settings`));

    const grows = growsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const tasks = tasksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const settings = settingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const backup = { grows, tasks, settings };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `chaotic_backup_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event) => {
    const user = auth.currentUser;
    if (!user) return;

    const file = event.target.files[0];
    if (!file) return;

    const text = await file.text();
    const data = JSON.parse(text);

    if (data.grows) {
      for (const grow of data.grows) {
        await setDoc(doc(db, `users/${user.uid}/grows/${grow.id}`), grow);
      }
    }

    if (data.tasks) {
      for (const task of data.tasks) {
        await setDoc(doc(db, `users/${user.uid}/tasks/${task.id}`), task);
      }
    }

    if (data.settings) {
      for (const setting of data.settings) {
        await setDoc(doc(db, `users/${user.uid}/settings/${setting.id}`), setting);
      }
    }

    alert('✅ Import complete!');
  };

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow space-y-6">
      <h2 className="text-2xl font-bold">📦 Backup & Restore</h2>

      <div className="flex flex-wrap gap-4">
        <button
          onClick={handleExport}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded shadow transition focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <FileDown className="w-5 h-5" />
          Export Backup
        </button>

        <label className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded shadow cursor-pointer transition focus-within:ring-2 focus-within:ring-green-400">
          <FileUp className="w-5 h-5" />
          Import Backup
          <input
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </label>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        This will export or import all your grows, tasks, and user settings in a single file.
        Be sure to save your backup in a secure location.
      </p>
    </div>
  );
}
