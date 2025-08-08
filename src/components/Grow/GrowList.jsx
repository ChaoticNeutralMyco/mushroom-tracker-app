import React from "react";
import { doc, deleteDoc } from "firebase/firestore";
import { db, auth } from "../../firebase-config";

export default function GrowList({
  grows = [],
  setGrows,
  setEditingGrow,
  // NEW: let App control whether this component shows its own add button
  showAddButton = true,
}) {
  const uid = auth.currentUser?.uid;

  const handleDelete = async (id) => {
    if (!uid) return;
    await deleteDoc(doc(db, "users", uid, "grows", id));
    setGrows((prev) =>
      (Array.isArray(prev) ? prev : []).filter((grow) => grow.id !== id)
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">My Grows</h2>
        {showAddButton && (
          <button
            onClick={() => setEditingGrow({})}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
            aria-label="Add grow"
          >
            ➕ Add Grow
          </button>
        )}
      </div>

      {grows.map((grow) => {
        const isInactive =
          grow.status === "Archived" || grow.status === "Contaminated";
        return (
          <div
            key={grow.id}
            className={`${
              isInactive ? "bg-gray-700" : "bg-gray-800"
            } text-white p-4 rounded shadow space-y-2`}
          >
            <div className="flex justify-between">
              <div>
                <strong>{grow.abbreviation || grow.strain}</strong> — {grow.stage}
                <div className="text-sm text-gray-400">
                  {grow.createdAt} — {grow.growType} — {grow.status}
                </div>
                {grow.growType !== "Bulk" && (
                  <div className="text-sm text-gray-300">
                    Volume: {grow.amountAvailable} / {grow.initialVolume}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                {!isInactive && (
                  <button
                    onClick={() => setEditingGrow(grow)}
                    className="text-yellow-400 hover:text-yellow-300"
                    aria-label="Edit grow"
                  >
                    ✏️
                  </button>
                )}
                <button
                  onClick={() => handleDelete(grow.id)}
                  className="text-red-500 hover:text-red-400"
                  aria-label="Delete grow"
                >
                  🗑️
                </button>
              </div>
            </div>
            {grow.notes && (
              <div className="text-sm text-gray-200">{grow.notes}</div>
            )}
          </div>
        );
      })}

      {grows.length === 0 && (
        <div className="text-sm text-gray-400">No grows yet.</div>
      )}
    </div>
  );
}
