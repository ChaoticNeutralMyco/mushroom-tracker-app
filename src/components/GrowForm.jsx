// src/components/GrowForm.jsx
import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase-config";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";

const GrowForm = ({ grows, setGrows, editingGrow, setEditingGrow }) => {
  const [user] = useAuthState(auth);
  const [recipes, setRecipes] = useState([]);
  const [strains, setStrains] = useState([]);

  const [form, setForm] = useState({
    strain: "",
    stage: "Inoculated",
    notes: "",
    parentGrowId: "",
    recipeId: "",
    createdDate: new Date().toISOString().substring(0, 10),
  });

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      const recipeSnapshot = await getDocs(collection(db, "users", user.uid, "recipes"));
      const strainSnapshot = await getDocs(collection(db, "users", user.uid, "strains"));

      setRecipes(recipeSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setStrains(strainSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };

    fetchData();
  }, [user]);

  useEffect(() => {
    if (editingGrow) {
      setForm({
        strain: editingGrow.strain || "",
        stage: editingGrow.stage || "Inoculated",
        notes: editingGrow.notes || "",
        parentGrowId: editingGrow.parentGrowId || "",
        recipeId: editingGrow.recipeId || "",
        createdDate: editingGrow.createdAt
          ? new Date(editingGrow.createdAt.seconds * 1000).toISOString().substring(0, 10)
          : new Date().toISOString().substring(0, 10),
      });
    } else {
      setForm({
        strain: "",
        stage: "Inoculated",
        notes: "",
        parentGrowId: "",
        recipeId: "",
        createdDate: new Date().toISOString().substring(0, 10),
      });
    }
  }, [editingGrow]);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    const growsRef = collection(db, "users", user.uid, "grows");

    const growData = {
      ...form,
      yieldWet: editingGrow?.yieldWet || 0,
      yieldDry: editingGrow?.yieldDry || 0,
      updatedAt: serverTimestamp(),
      createdAt: Timestamp.fromDate(new Date(form.createdDate)),
      stageDates: {
        ...(editingGrow?.stageDates || {}),
        [form.stage]: new Date(form.createdDate).toISOString(),
      },
    };

    try {
      if (editingGrow?.id) {
        const docRef = doc(growsRef, editingGrow.id);
        await updateDoc(docRef, growData);
        setGrows((prev) =>
          prev.map((g) => (g.id === editingGrow.id ? { ...g, ...growData } : g))
        );
      } else {
        const docRef = await addDoc(growsRef, growData);
        const newGrow = { id: docRef.id, ...growData };
        setGrows((prev) => [...prev, newGrow]);
      }

      setForm({
        strain: "",
        stage: "Inoculated",
        notes: "",
        parentGrowId: "",
        recipeId: "",
        createdDate: new Date().toISOString().substring(0, 10),
      });
      setEditingGrow(null);
    } catch (err) {
      console.error("Error saving grow:", err);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 p-4 bg-white dark:bg-zinc-800 rounded-xl shadow"
    >
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
        {editingGrow ? "Edit Grow" : "New Grow"}
      </h2>

      {/* Strain */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Strain
        </label>
        <select
          name="strain"
          value={form.strain}
          onChange={handleChange}
          className="w-full p-2 border rounded dark:bg-zinc-700 dark:text-white"
        >
          <option value="">Select strain</option>
          {strains.map((strain) => (
            <option key={strain.id} value={strain.name}>
              {strain.name}
            </option>
          ))}
        </select>
      </div>

      {/* Stage */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Stage
        </label>
        <select
          name="stage"
          value={form.stage}
          onChange={handleChange}
          className="w-full p-2 border rounded dark:bg-zinc-700 dark:text-white"
        >
          <option>Inoculated</option>
          <option>Colonizing</option>
          <option>Colonized</option>
          <option>Fruiting</option>
          <option>Harvested</option>
        </select>
      </div>

      {/* Created Date */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Date Created
        </label>
        <input
          type="date"
          name="createdDate"
          value={form.createdDate}
          onChange={handleChange}
          className="w-full p-2 border rounded dark:bg-zinc-700 dark:text-white"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Notes
        </label>
        <textarea
          name="notes"
          value={form.notes}
          onChange={handleChange}
          placeholder="Notes"
          className="w-full p-2 border rounded dark:bg-zinc-700 dark:text-white"
        />
      </div>

      {/* Parent Grow */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Spawned From (Optional)
        </label>
        <select
          name="parentGrowId"
          value={form.parentGrowId}
          onChange={handleChange}
          className="w-full p-2 border rounded dark:bg-zinc-700 dark:text-white"
        >
          <option value="">Select parent grow</option>
          {grows.map((g) => (
            <option key={g.id} value={g.id}>
              {g.strain}
            </option>
          ))}
        </select>
      </div>

      {/* Recipe */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Recipe (Optional)
        </label>
        <select
          name="recipeId"
          value={form.recipeId}
          onChange={handleChange}
          className="w-full p-2 border rounded dark:bg-zinc-700 dark:text-white"
        >
          <option value="">Select recipe</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {/* Buttons */}
      <div className="flex space-x-2 pt-2">
        <button
          type="submit"
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded shadow"
        >
          {editingGrow ? "Update" : "Add"}
        </button>
        {editingGrow && (
          <button
            type="button"
            onClick={() => setEditingGrow(null)}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded shadow"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

export default GrowForm;
