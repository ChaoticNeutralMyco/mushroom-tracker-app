import React from "react";

export default function GrowList({ grows, setGrows }) {
  const deleteGrow = (id) => {
    setGrows(grows.filter((grow) => grow.id !== id));
  };

  return (
    <div className="space-y-2">
      {grows.map((grow) => (
        <div
          key={grow.id}
          className="bg-white dark:bg-gray-800 p-3 rounded shadow flex justify-between items-center"
        >
          <div>
            <p className="font-semibold">{grow.strain}</p>
            <p className="text-sm text-gray-500">
              Stage: {grow.stage} | Cost: {grow.cost} | Yield: {grow.yield}
            </p>
          </div>
          <button
            onClick={() => deleteGrow(grow.id)}
            className="bg-red-500 text-white px-2 py-1 rounded"
          >
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}
