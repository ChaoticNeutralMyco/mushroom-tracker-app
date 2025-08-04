<<<<<<< HEAD
import React, { useRef } from "react";
import { saveAs } from "file-saver";

export default function ImportExportButtons({ grows, setGrows }) {
  const fileInputRef = useRef();

  const exportData = () => {
    const blob = new Blob([JSON.stringify(grows, null, 2)], {
      type: "application/json",
    });
    saveAs(blob, "mushroom-grows.json");
  };

  const importData = (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== "application/json") {
      alert("Please select a valid .json file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedGrows = JSON.parse(event.target.result);
        if (Array.isArray(importedGrows)) {
          setGrows(importedGrows);
          alert("Data imported successfully!");
        } else {
          alert("Invalid data format");
        }
      } catch {
        alert("Error parsing JSON file");
      }
=======
// src/components/ImportExportButtons.jsx
import React from 'react';
import { db, auth } from '../firebase-config';
import {
  collection,
  getDocs,
  doc,
  setDoc,
} from 'firebase/firestore';

export default function ImportExportButtons({ setGrows }) {
  const handleExport = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const growsSnap = await getDocs(collection(db, `users/${user.uid}/grows`));
    const tasksSnap = await getDocs(collection(db, `users/${user.uid}/tasks`));
    const strainsSnap = await getDocs(collection(db, `users/${user.uid}/strains`));

    const grows = growsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const tasks = tasksSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const strains = strainsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const data = { grows, tasks, strains };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mushroom_backup_${new Date().toISOString()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event) => {
    const user = auth.currentUser;
    if (!user) return;

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = JSON.parse(e.target.result);

      for (const grow of data.grows || []) {
        const growRef = doc(db, `users/${user.uid}/grows`, grow.id);
        await setDoc(growRef, grow);
      }

      for (const task of data.tasks || []) {
        const taskRef = doc(db, `users/${user.uid}/tasks`, task.id);
        await setDoc(taskRef, task);
      }

      for (const strain of data.strains || []) {
        const strainRef = doc(db, `users/${user.uid}/strains`, strain.id);
        await setDoc(strainRef, strain);
      }

      alert("✅ Data imported successfully!");
>>>>>>> be7d1a18 (Initial commit with final polished version)
    };
    reader.readAsText(file);
  };

  return (
<<<<<<< HEAD
    <div className="flex items-center gap-4 mt-4">
      <button
        onClick={exportData}
        className="px-4 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700 transition"
      >
        Export Grows
      </button>

      <button
        onClick={() => fileInputRef.current.click()}
        className="px-4 py-2 bg-green-600 text-white rounded shadow hover:bg-green-700 transition"
      >
        Import Grows
      </button>

      <input
        type="file"
        accept="application/json"
        ref={fileInputRef}
        onChange={importData}
        className="hidden"
      />
=======
    <div className="my-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-4 max-w-3xl mx-auto bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow">
      <button
        onClick={handleExport}
        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 rounded w-full sm:w-auto"
      >
        ⬇️ Export Backup
      </button>

      <label className="bg-green-600 hover:bg-green-700 text-white font-semibold px-5 py-2 rounded cursor-pointer text-center w-full sm:w-auto">
        ⬆️ Import Backup
        <input
          type="file"
          accept="application/json"
          onChange={handleImport}
          className="hidden"
        />
      </label>
>>>>>>> be7d1a18 (Initial commit with final polished version)
    </div>
  );
}
