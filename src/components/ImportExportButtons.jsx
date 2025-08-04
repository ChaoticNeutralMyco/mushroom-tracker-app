// src/components/ImportExportButtons.jsx
import React from "react";
import { db, auth } from "../firebase-config";
import { collection, addDoc } from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";

const ImportExportButtons = ({ grows, setGrows }) => {
  const [user] = useAuthState(auth);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(grows, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mushroom_grows_backup.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        const growsRef = collection(db, "users", user.uid, "grows");
        const newGrows = [];

        for (const grow of data) {
          const { id, ...growData } = grow; // exclude id
          const docRef = await addDoc(growsRef, growData);
          newGrows.push({ id: docRef.id, ...growData });
        }

        setGrows((prev) => [...prev, ...newGrows]);
        alert("Import successful.");
      } catch (err) {
        alert("Import failed: Invalid JSON");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow flex gap-4 items-center">
      <button
        onClick={handleExport}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        Export
      </button>
      <label className="cursor-pointer px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
        Import
        <input
          type="file"
          accept="application/json"
          onChange={handleImport}
          className="hidden"
        />
      </label>
    </div>
  );
};

export default ImportExportButtons;
