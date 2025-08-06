import React, { useState, useEffect } from "react";
import { db, auth } from "../firebase-config";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";

export default function GrowForm({
  grows = [],
  setGrows = () => {},
  editingGrow,
  setEditingGrow = () => {},
}) {
  const [strain, setStrain] = useState("");
  const [stage, setStage] = useState("Inoculated");
  const [createdAt, setCreatedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [parentGrowId, setParentGrowId] = useState("");
  const [recipeId, setRecipeId] = useState("");

  useEffect(() => {
    if (editingGrow && editingGrow.id) {
      setStrain(editingGrow.strain || "");
      setStage(editingGrow.stage || "Inoculated");

      const rawDate = editingGrow.createdAt;
      const normalizedDate =
        rawDate instanceof Date
          ? rawDate.toISOString().substring(0, 10)
          : rawDate?.toDate?.().toISOString().substring(0, 10) || "";

      setCreatedAt(normalizedDate);
      setNotes(editingGrow.notes || "");
      setParentGrowId(editingGrow.parentGrowId || "");
      setRecipeId(editingGrow.recipeId || "");
    } else {
      setStrain("");
      setStage("Inoculated");
      setCreatedAt(new Date().toISOString().substring(0, 10));
      setNotes("");
      setParentGrowId("");
      setRecipeId("");
    }
  }, [editingGrow]);

  const generateUniqueStrainName = () => {
    const dateStr = createdAt || new Date().toISOString().substring(0, 10);
    const baseStrain = strain.trim();
    const matching = grows.filter(
      (g) =>
        g.strain.startsWith(baseStrain) &&
        (g.createdAt === dateStr ||
          g.createdAt?.toDate?.()?.toISOString().substring(0, 10) === dateStr)
    );

    if (matching.length === 0) return baseStrain;
    return `${baseStrain} #${matching.length + 1}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    let strainName = strain.trim();
    if (!editingGrow?.id) {
      strainName = generateUniqueStrainName();
    }

    const growData = {
      strain: strainName,
      stage,
      createdAt: createdAt || new Date().toISOString().substring(0, 10),
      notes,
      parentGrowId,
      recipeId,
      stageDates: { Inoculated: createdAt || new Date().toISOString() },
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingGrow && editingGrow.id) {
        const growRef = doc(db, `users/${user.uid}/grows`, editingGrow.id);
        await updateDoc(growRef, growData);
        setGrows((prev) =>
          prev.map((g) => (g.id === editingGrow.id ? { ...g, ...growData } : g))
        );
      } else {
        const growsCol = collection(db, "users", user.uid, "grows");
        const docRef = await addDoc(growsCol, {
          ...growData,
          createdAt: createdAt || new Date().toISOString().substring(0, 10),
        });
        setGrows((prev) => [...prev, { id: docRef.id, ...growData }]);
      }
      setEditingGrow(null);
    } catch (err) {
      console.error("Error saving grow:", err);
    }
  };

  return (
    <div className="bg-gray-800 text-white p-6 rounded-lg shadow mb-6">
      <h2 className="text-xl font-bold mb-4">
        {editingGrow?.id ? "Edit Grow" : "Add New Grow"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Strain</label>
          <input
            type="text"
            value={strain}
            onChange={(e) => setStrain(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-3 py-2"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Stage</label>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-3 py-2"
          >
            {["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              )
            )}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">Date Created</label>
          <input
            type="date"
            value={createdAt}
            onChange={(e) => setCreatedAt(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-3 py-2"
            rows="3"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Spawned From (Optional)</label>
          <select
            value={parentGrowId}
            onChange={(e) => setParentGrowId(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-3 py-2"
          >
            <option value="">Select parent grow</option>
            {grows.map((grow) => (
              <option key={grow.id} value={grow.id}>
                {grow.strain}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">Recipe (Optional)</label>
          <select
            value={recipeId}
            onChange={(e) => setRecipeId(e.target.value)}
            className="w-full bg-gray-700 text-white rounded px-3 py-2"
          >
            <option value="">Select recipe</option>
            {[...new Set(grows.map((g) => g.recipeId))]
              .filter((id) => id)
              .map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
          </select>
        </div>

        <div className="flex gap-4">
          <button
            type="submit"
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
          >
            {editingGrow?.id ? "Update" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => setEditingGrow(null)}
            className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
