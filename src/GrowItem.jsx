import React from 'react';

export default function GrowItem({ grow, onDelete, onSelect }) {
  return (
    <div className="border rounded p-3 mb-2 hover:bg-gray-50 cursor-pointer flex justify-between items-center">
      <div onClick={() => onSelect(grow)}>
        <h3 className="font-bold">{grow.strain}</h3>
        <p>Stage: {grow.stage}</p>
        <p>Started: {grow.startDate}</p>
        <p>COG: ${grow.cog.toFixed(2)}</p>
      </div>
      <button
        onClick={() => onDelete(grow.id)}
        className="text-red-600 hover:text-red-800 font-bold"
        title="Delete grow"
      >
        &times;
      </button>
    </div>
  );
}
