import React, { useState, useEffect } from "react";
import { db, auth } from "./firebase-config";
import { collection, addDoc, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";

const GrowForm = ({ selectedGrow, clearSelection }) => {
  const [user] = useAuthState(auth);
  const [formData, setFormData] = useState({
    strain: "",
    stage: "Inoculation",
    notes: "",
  });

  useEffect(() => {
    if (selectedGrow) {
      setFormData(selectedGrow);
    }
  }, [selectedGrow]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    const growRef = collection(db, "users", user.uid, "grows");

    try {
      if (selectedGrow?.id) {
        const docRef = doc(growRef, selectedGrow.id);
        await updateDoc(docRef, { ...formData, updatedAt: serverTimestamp() });
      } else {
        await addDoc(growRef, {
          ...formData,
          createdAt: serverTimestamp(),
        });
      }

      setFormData({ strain: "", stage: "Inoculation", notes: "" });
      clearSelection();
    } catch (error) {
      console.error("Error saving grow:", error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-white dark:bg-gray-800 rounded-xl shadow">
      <h2 className="text-xl font-semibold">{selectedGrow ? "Edit Grow" : "New Grow"}</h2>
      <input
        name="strain"
        value={formData.strain}
        onChange={handleChange}
        placeholder="Strain"
        className="w-full p-2 border rounded"
      />
      <select
        name="stage"
        value={formData.stage}
        onChange={handleChange}
        className="w-full p-2 border rounded"
      >
        <option>Inoculation</option>
        <option>Colonization</option>
        <option>Fruiting</option>
        <option>Harvest</option>
        <option>Completed</option>
      </select>
      <textarea
        name="notes"
        value={formData.notes}
        onChange={handleChange}
        placeholder="Notes"
        className="w-full p-2 border rounded"
      />
      <div className="flex space-x-2">
        <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded">
          {selectedGrow ? "Update" : "Add"}
        </button>
        {selectedGrow && (
          <button type="button" onClick={clearSelection} className="px-4 py-2 bg-gray-500 text-white rounded">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

export default GrowForm;
