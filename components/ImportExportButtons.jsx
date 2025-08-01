import React from "react";

export default function ImportExportButtons() {
  return (
    <div className="flex gap-2 my-4">
      <button className="px-4 py-2 bg-green-500 text-white rounded">Import</button>
      <button className="px-4 py-2 bg-blue-500 text-white rounded">Export</button>
    </div>
  );
}
