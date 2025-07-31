import React from "react";

export default function GrowDetail({ grow, onClose }) {
  if (!grow) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-full max-w-lg relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-gray-500 hover:text-red-500 text-xl font-bold"
        >
          ×
        </button>

        <h2 className="text-2xl font-semibold text-blue-700 mb-4">
          {grow.name}
        </h2>

        <div className="space-y-2 text-sm text-gray-700 dark:text-gray-200">
          <p><strong>Strain:</strong> {grow.strain || "N/A"}</p>
          <p><strong>Stage:</strong> {grow.stage}</p>
          <p><strong>Date Started:</strong> {grow.date}</p>
          <p><strong>Cost:</strong> ${grow.cost || 0}</p>
          <p><strong>Yield:</strong> {grow.yield || 0}g</p>
          <p><strong>Notes:</strong> {grow.notes || "None"}</p>
        </div>

        <div className="mt-4 text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
