import React from 'react';

export default function GrowDetails({ grow, onClose }) {
  if (!grow) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex justify-center items-center p-4">
      <div className="bg-white rounded p-6 max-w-md w-full relative shadow-lg">
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-gray-600 hover:text-gray-900 text-xl font-bold"
          title="Close"
        >
          &times;
        </button>

        <h2 className="text-2xl font-bold mb-4">{grow.strain}</h2>
        <p><strong>Stage:</strong> {grow.stage}</p>
        <p><strong>Start Date:</strong> {grow.startDate}</p>
        <p><strong>Cost of Goods (COG):</strong> ${grow.cog.toFixed(2)}</p>
        <p><strong>Notes:</strong></p>
        <p className="whitespace-pre-wrap">{grow.notes || 'No notes'}</p>
      </div>
    </div>
  );
}
