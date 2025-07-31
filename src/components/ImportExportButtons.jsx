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
    };
    reader.readAsText(file);
  };

  return (
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
    </div>
  );
}
