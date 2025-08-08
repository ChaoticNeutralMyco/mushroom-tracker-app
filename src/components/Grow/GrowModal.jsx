import React from "react";
import GrowForm from "./GrowForm";

export default function GrowModal({ isOpen, onClose, editingGrow, onGrowAdded, setEditingGrow }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
      <div className="bg-gray-900 text-white p-6 rounded-lg shadow-lg w-full max-w-2xl relative">
        <button
          className="absolute top-2 right-2 text-gray-400 hover:text-white"
          onClick={onClose}
        >
          ✕
        </button>
        <GrowForm
          editingGrow={editingGrow}
          setEditingGrow={setEditingGrow}
          onGrowAdded={() => {
            onGrowAdded();
            onClose(); // close after submit
          }}
          onClose={onClose} // ✅ pass this so × and Cancel work
        />
      </div>
    </div>
  );
}
