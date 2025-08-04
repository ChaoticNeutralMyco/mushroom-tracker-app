import React, { useState, useEffect } from "react";
<<<<<<< HEAD
import { db, auth } from "../firebase";
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
=======
import { db, auth } from "../firebase-config";
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  Timestamp,
  getDocs,
} from "firebase/firestore";

export default function GrowForm({ grows, setGrows, editingGrow, setEditingGrow }) {
  const [strainId, setStrainId] = useState("");
  const [strainName, setStrainName] = useState("");
  const [inoculation, setInoculation] = useState("");
  const [parentGrowId, setParentGrowId] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [stage, setStage] = useState("");
  const [recipes, setRecipes] = useState([]);
  const [strains, setStrains] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const recipeSnap = await getDocs(collection(db, "users", user.uid, "recipes"));
      setRecipes(recipeSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

      const strainSnap = await getDocs(collection(db, "users", user.uid, "strains"));
      setStrains(strainSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (editingGrow) {
      setStrainId(editingGrow.strainId || "");
      setStrainName(editingGrow.strain || "");
      setInoculation(editingGrow.inoculation?.substring(0, 10) || "");
      setParentGrowId(editingGrow.parentGrowId || "");
      setRecipeId(editingGrow.recipeId || "");
      setStage(editingGrow.stage || "");
    } else {
      setStrainId("");
      setStrainName("");
      setInoculation("");
      setParentGrowId("");
      setRecipeId("");
      setStage("");
    }
  }, [editingGrow]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user || !strainId || !strainName) return;

    const growData = {
      strain: strainName,
      strainId,
      inoculation,
      parentGrowId: parentGrowId || "",
      recipeId: recipeId || "",
      stage: stage || "",
      createdAt: Timestamp.now(),
      stageDates: stage ? { [stage]: new Date().toISOString().substring(0, 10) } : {},
    };

    if (editingGrow) {
      const growRef = doc(db, "users", user.uid, "grows", editingGrow.id);
      await updateDoc(growRef, growData);
      setGrows((prev) =>
        prev.map((g) => (g.id === editingGrow.id ? { ...g, ...growData } : g))
      );
      setEditingGrow(null);
    } else {
      const growRef = await addDoc(collection(db, "users", user.uid, "grows"), growData);
      setGrows((prev) => [...prev, { id: growRef.id, ...growData }]);
    }

    setStrainId("");
    setStrainName("");
    setInoculation("");
    setParentGrowId("");
    setRecipeId("");
    setStage("");
  };

  const handleStrainSelect = (e) => {
    const selected = strains.find((s) => s.id === e.target.value);
    setStrainId(selected?.id || "");
    setStrainName(selected?.name || "");
  };

  return (
    <div className="p-4 mb-6 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow space-y-4">
      <h2 className="text-xl font-bold">
        {editingGrow ? "✏️ Edit Grow" : "➕ Add New Grow"}
      </h2>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <select
          value={strainId}
          onChange={handleStrainSelect}
          required
          className="p-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="">Select Strain</option>
          {strains.map((strain) => (
            <option key={strain.id} value={strain.id}>
              {strain.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          placeholder="Inoculation Date"
          value={inoculation}
          onChange={(e) => setInoculation(e.target.value)}
          className="p-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-sm"
        />

        <select
          value={parentGrowId}
          onChange={(e) => setParentGrowId(e.target.value)}
          className="p-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="">No Parent (Spawn Source)</option>
          {grows.map((g) => (
            <option key={g.id} value={g.id}>
              {g.strain || g.id}
            </option>
          ))}
        </select>

        <select
          value={recipeId}
          onChange={(e) => setRecipeId(e.target.value)}
          className="p-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="">Select Recipe</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name || r.id}
            </option>
          ))}
        </select>

        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="p-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="">Stage (Optional)</option>
          {["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="col-span-1 sm:col-span-2 bg-blue-600 text-white text-sm font-semibold py-2 rounded hover:bg-blue-700 transition"
        >
          {editingGrow ? "✅ Update Grow" : "➕ Add Grow"}
        </button>
      </form>
    </div>
  );
}
>>>>>>> be7d1a18 (Initial commit with final polished version)
