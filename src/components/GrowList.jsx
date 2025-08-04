<<<<<<< HEAD
import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  query,
  orderBy,
} from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";

const GrowList = ({ onEdit }) => {
  const [grows, setGrows] = useState([]);
  const [user] = useAuthState(auth);

  useEffect(() => {
    if (!user) return;
    const growsRef = collection(db, "users", user.uid, "grows");
    const q = query(growsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setGrows(items);
    });

    return unsubscribe;
  }, [user]);

  const handleDelete = async (id) => {
    const docRef = doc(db, "users", user.uid, "grows", id);
    await deleteDoc(docRef);
  };

  return (
    <div className="space-y-2 p-4">
      <h2 className="text-xl font-semibold">Your Grows</h2>
      {grows.map((grow) => (
        <div key={grow.id} className="p-3 border rounded shadow-sm bg-white dark:bg-gray-700">
          <p><strong>Strain:</strong> {grow.strain}</p>
          <p><strong>Stage:</strong> {grow.stage}</p>
          <p className="text-sm text-gray-500">{grow.notes}</p>
          <div className="flex space-x-2 mt-2">
            <button onClick={() => onEdit(grow)} className="px-3 py-1 bg-blue-500 text-white rounded">Edit</button>
            <button onClick={() => handleDelete(grow.id)} className="px-3 py-1 bg-red-500 text-white rounded">Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default GrowList;
=======
// src/components/GrowList.jsx
import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase-config";
import {
  collection,
  getDocs,
  doc,
  deleteDoc,
  updateDoc,
  getDoc,
  addDoc,
  Timestamp,
} from "firebase/firestore";
import GrowNotesModal from "./GrowNotesModal";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];

export default function GrowList({ grows, setGrows, setEditingGrow }) {
  const [recipes, setRecipes] = useState([]);
  const [supplies, setSupplies] = useState({});
  const [expandedGrowIds, setExpandedGrowIds] = useState([]);
  const [showNotesGrowId, setShowNotesGrowId] = useState(null);
  const [selectedGrows, setSelectedGrows] = useState([]);
  const [batchEdit, setBatchEdit] = useState({ strain: "", stage: "" });

  useEffect(() => {
    const fetchData = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const recipeSnap = await getDocs(collection(db, "users", user.uid, "recipes"));
      setRecipes(recipeSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

      const supplySnap = await getDocs(collection(db, "users", user.uid, "supplies"));
      const supplyMap = {};
      supplySnap.docs.forEach((doc) => {
        supplyMap[doc.id] = doc.data();
      });
      setSupplies(supplyMap);
    };

    fetchData();
  }, []);

  const calculateRecipeCost = (recipeId) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe?.items) return 0;
    return recipe.items.reduce((total, item) => {
      const supply = supplies[item.supplyId];
      return total + (parseFloat(supply?.cost || 0) * parseFloat(item.amount || 0));
    }, 0);
  };

  const handleDelete = async (growId) => {
    const user = auth.currentUser;
    if (!user) return;

    const growRef = doc(db, "users", user.uid, "grows", growId);
    const growSnap = await getDoc(growRef);
    if (!growSnap.exists()) return;

    await addDoc(collection(db, "users", user.uid, "settings", "trash", "grows"), {
      ...growSnap.data(),
      deletedAt: Timestamp.now(),
      originalId: growId,
    });

    await deleteDoc(growRef);
    setGrows((prev) => prev.filter((g) => g.id !== growId));
    setSelectedGrows((prev) => prev.filter((id) => id !== growId));
  };

  const handleBatchDelete = () => {
    if (!window.confirm(`Delete ${selectedGrows.length} selected grows?`)) return;
    selectedGrows.forEach((id) => handleDelete(id));
  };

  const handleBatchEdit = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const updates = {};
    if (batchEdit.strain) updates.strain = batchEdit.strain;
    if (batchEdit.stage) updates.stage = batchEdit.stage;

    const updatedGrows = [...grows];

    await Promise.all(
      selectedGrows.map(async (growId) => {
        const growRef = doc(db, "users", user.uid, "grows", growId);
        await updateDoc(growRef, updates);
        const index = updatedGrows.findIndex((g) => g.id === growId);
        if (index !== -1) updatedGrows[index] = { ...updatedGrows[index], ...updates };
      })
    );

    setGrows(updatedGrows);
    setSelectedGrows([]);
    setBatchEdit({ strain: "", stage: "" });
    alert("✅ Grows updated.");
  };

  const getGrowById = (id) => grows.find((g) => g.id === id);
  const getChildrenOf = (parentId) => grows.filter((g) => g.parentGrowId === parentId);
  const toggleExpand = (growId) => {
    setExpandedGrowIds((prev) =>
      prev.includes(growId) ? prev.filter((id) => id !== growId) : [...prev, growId]
    );
  };

  const exportLogbook = async (grow) => {
    const user = auth.currentUser;
    if (!user) return;

    const noteSnap = await getDoc(doc(db, "users", user.uid, "grows", grow.id));
    const growData = noteSnap.data();

    const lines = [];
    lines.push(`📘 Grow Logbook for "${grow.strain}"`);
    lines.push(`Inoculated: ${grow.inoculation || "N/A"}`);
    lines.push(`Stage: ${grow.stage || "N/A"}`);
    if (grow.parentGrowId) {
      lines.push(`Spawned from: ${getGrowById(grow.parentGrowId)?.strain || grow.parentGrowId}`);
    }
    lines.push("");
    lines.push("📆 Stage History:");
    STAGES.forEach((stage) => {
      const date = grow.stageDates?.[stage];
      if (date) lines.push(`- ${stage}: ${date}`);
    });

    lines.push("\n📝 Notes:");
    if (growData?.notes?.length > 0) {
      growData.notes.forEach((note) => {
        lines.push(`- [${note.timestamp}] ${note.content}`);
      });
    } else {
      lines.push("No notes found.");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const filename = `grow-log-${grow.strain?.replace(/\s+/g, "_") || grow.id}.txt`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    link.remove();
  };

  const renderGrowTree = (grow) => {
    const cost = grow.recipeId
      ? calculateRecipeCost(grow.recipeId)
      : parseFloat(grow.cost || 0);
    const children = getChildrenOf(grow.id);
    const isExpanded = expandedGrowIds.includes(grow.id);
    const stageIndex = STAGES.indexOf(grow.stage);
    const progressPercent = stageIndex >= 0 ? ((stageIndex + 1) / STAGES.length) * 100 : 0;
    const isSelected = selectedGrows.includes(grow.id);

    return (
      <div key={grow.id} className="ml-4 border-l-2 pl-4 border-zinc-300 dark:border-zinc-600">
        <div className="p-3 bg-zinc-100 dark:bg-zinc-800 rounded-xl shadow space-y-2 mb-2">
          <div className="flex justify-between items-start gap-4">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() =>
                setSelectedGrows((prev) =>
                  isSelected ? prev.filter((id) => id !== grow.id) : [...prev, grow.id]
                )
              }
              className="mt-2"
            />
            <div className="flex-1">
              <h3 className="text-lg font-semibold">🍄 {grow.strain || "Unnamed"}</h3>
              <p className="text-sm">Inoculated: {grow.inoculation?.substring(0, 10) || "N/A"}</p>
              <p className="text-sm">Stage: {grow.stage || "N/A"}</p>
              <p className="text-sm">Cost: ${cost.toFixed(2)}</p>
              <div className="w-full bg-zinc-300 rounded-full h-2 mt-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {grow.parentGrowId && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Spawned from: {getGrowById(grow.parentGrowId)?.strain || grow.parentGrowId}
                </p>
              )}
              {children.length > 0 && (
                <button
                  onClick={() => toggleExpand(grow.id)}
                  className="text-sm text-blue-400 hover:underline mt-1"
                >
                  {isExpanded
                    ? `Hide ${children.length} descendant(s)`
                    : `Show ${children.length} descendant(s)`}
                </button>
              )}
            </div>
            <div className="flex flex-col items-end space-y-1 text-sm">
              <button onClick={() => setEditingGrow(grow)} className="text-blue-500 hover:underline">Edit</button>
              <button onClick={() => setShowNotesGrowId(grow.id)} className="text-yellow-500 hover:underline">Notes</button>
              <button onClick={() => exportLogbook(grow)} className="text-green-600 hover:underline">📘 Logbook</button>
              <button onClick={() => handleDelete(grow.id)} className="text-red-500 hover:underline">Delete</button>
            </div>
          </div>
        </div>
        {isExpanded && children.map((child) => renderGrowTree(child))}
      </div>
    );
  };

  const topLevelGrows = grows.filter((g) => !g.parentGrowId);

  return (
    <div className="p-4 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow space-y-4">
      <h2 className="text-2xl font-bold">📋 Grow List</h2>

      {selectedGrows.length > 0 && (
        <div className="bg-yellow-100 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 p-3 rounded space-y-2 sm:space-y-0 sm:flex sm:items-center sm:justify-between">
          <div className="text-sm space-x-2">
            <strong>{selectedGrows.length}</strong> selected
            <button onClick={() => setSelectedGrows([])} className="text-red-500 hover:underline ml-2">Clear</button>
            <button onClick={() => setSelectedGrows(grows.map((g) => g.id))} className="text-blue-500 hover:underline ml-2">Select All</button>
          </div>
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <input
              type="text"
              placeholder="New Strain"
              value={batchEdit.strain}
              onChange={(e) => setBatchEdit({ ...batchEdit, strain: e.target.value })}
              className="p-1 rounded border dark:bg-zinc-800"
            />
            <select
              value={batchEdit.stage}
              onChange={(e) => setBatchEdit({ ...batchEdit, stage: e.target.value })}
              className="p-1 rounded border dark:bg-zinc-800"
            >
              <option value="">Set Stage</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button onClick={handleBatchEdit} className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">✅ Apply</button>
            <button onClick={handleBatchDelete} className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700">🗑️ Delete</button>
          </div>
        </div>
      )}

      {topLevelGrows.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">No grows to show.</p>
      ) : (
        <div className="space-y-2">
          {topLevelGrows.map((grow) => renderGrowTree(grow))}
        </div>
      )}

      {showNotesGrowId && (
        <GrowNotesModal
          growId={showNotesGrowId}
          onClose={() => setShowNotesGrowId(null)}
        />
      )}
    </div>
  );
}
>>>>>>> be7d1a18 (Initial commit with final polished version)
