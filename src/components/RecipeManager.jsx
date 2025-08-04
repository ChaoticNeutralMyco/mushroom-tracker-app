// src/components/RecipeManager.jsx
import React, { useEffect, useState } from "react";
import {
  PlusCircle,
  Trash2,
  Edit,
  Copy,
  CheckCircle,
  XCircle,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { db, auth } from "../firebase-config";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";

export default function RecipeManager() {
  const [supplies, setSupplies] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [selected, setSelected] = useState([]);
  const [batchEdit, setBatchEdit] = useState({ appendName: "", addTags: "" });

  const [newRecipeName, setNewRecipeName] = useState("");
  const [newRecipeTags, setNewRecipeTags] = useState("");
  const [newRecipeItems, setNewRecipeItems] = useState([]);
  const [selectedSupplyId, setSelectedSupplyId] = useState("");
  const [selectedAmount, setSelectedAmount] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({ name: "", tags: "", items: [] });

  useEffect(() => {
    const fetchData = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const suppliesRef = collection(db, "users", user.uid, "supplies");
      const recipesRef = collection(db, "users", user.uid, "recipes");

      const [suppliesSnap, recipesSnap] = await Promise.all([
        getDocs(suppliesRef),
        getDocs(recipesRef),
      ]);

      setSupplies(suppliesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      setRecipes(recipesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    };

    fetchData();
  }, []);

  const addItemToRecipe = () => {
    const amount = parseFloat(selectedAmount);
    if (!selectedSupplyId || isNaN(amount)) return;

    const existing = newRecipeItems.find((i) => i.supplyId === selectedSupplyId);
    const updated = existing
      ? newRecipeItems.map((i) =>
          i.supplyId === selectedSupplyId ? { ...i, amount } : i
        )
      : [...newRecipeItems, { supplyId: selectedSupplyId, amount }];

    setNewRecipeItems(updated);
    setSelectedSupplyId("");
    setSelectedAmount("");
  };

  const addRecipe = async () => {
    const user = auth.currentUser;
    if (!user || !newRecipeName || newRecipeItems.length === 0) return;

    const tags = newRecipeTags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const recipe = {
      name: newRecipeName,
      tags,
      items: newRecipeItems,
      createdAt: new Date().toISOString(),
    };

    const docRef = await addDoc(collection(db, "users", user.uid, "recipes"), recipe);
    setRecipes([...recipes, { id: docRef.id, ...recipe }]);
    setNewRecipeName("");
    setNewRecipeTags("");
    setNewRecipeItems([]);
  };

  const deleteRecipe = async (id) => {
    const user = auth.currentUser;
    if (!user) return;
    await deleteDoc(doc(db, "users", user.uid, "recipes", id));
    setRecipes(recipes.filter((r) => r.id !== id));
    setSelected((prev) => prev.filter((rid) => rid !== id));
  };

  const cloneRecipe = async (recipe) => {
    const user = auth.currentUser;
    if (!user) return;

    const clone = {
      ...recipe,
      name: `${recipe.name} (Copy)`,
      createdAt: new Date().toISOString(),
    };

    delete clone.id;
    const docRef = await addDoc(collection(db, "users", user.uid, "recipes"), clone);
    setRecipes([...recipes, { id: docRef.id, ...clone }]);
  };

  const startEditing = (recipe) => {
    setEditingId(recipe.id);
    setEditData({
      name: recipe.name,
      tags: recipe.tags.join(", "),
      items: [...recipe.items],
    });
  };

  const handleEditItemChange = (supplyId, amount) => {
    const parsed = parseFloat(amount);
    const exists = editData.items.some((i) => i.supplyId === supplyId);
    const updatedItems = exists
      ? editData.items.map((i) =>
          i.supplyId === supplyId ? { ...i, amount: parsed } : i
        )
      : [...editData.items, { supplyId, amount: parsed }];

    setEditData({ ...editData, items: updatedItems });
  };

  const saveEdit = async () => {
    const user = auth.currentUser;
    if (!user || !editingId) return;

    const tags = editData.tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const updated = {
      name: editData.name,
      tags,
      items: editData.items,
      updatedAt: new Date().toISOString(),
    };

    await updateDoc(doc(db, "users", user.uid, "recipes", editingId), updated);
    setRecipes((prev) =>
      prev.map((r) => (r.id === editingId ? { ...r, ...updated } : r))
    );
    setEditingId(null);
  };

  const handleBatchDelete = () => {
    if (!window.confirm(`Delete ${selected.length} selected recipes?`)) return;
    selected.forEach(deleteRecipe);
  };

  const handleBatchEdit = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const tagList = batchEdit.addTags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    await Promise.all(
      selected.map(async (id) => {
        const recipe = recipes.find((r) => r.id === id);
        if (!recipe) return;

        const updatedName = batchEdit.appendName
          ? `${recipe.name}${batchEdit.appendName}`
          : recipe.name;
        const updatedTags = Array.from(new Set([...(recipe.tags || []), ...tagList]));

        await updateDoc(doc(db, "users", user.uid, "recipes", id), {
          name: updatedName,
          tags: updatedTags,
        });

        setRecipes((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, name: updatedName, tags: updatedTags } : r
          )
        );
      })
    );

    setBatchEdit({ appendName: "", addTags: "" });
    setSelected([]);
  };

  const calculateCost = (items) =>
    items.reduce((sum, item) => {
      const supply = supplies.find((s) => s.id === item.supplyId);
      return sum + (supply?.cost || 0) * (item.amount || 0);
    }, 0);

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6 text-gray-900 dark:text-white">
      <div className="bg-white dark:bg-gray-900 p-4 rounded shadow space-y-4">
        <h2 className="text-2xl font-bold">🧪 Recipe Builder</h2>

        {/* Create New Recipe */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            value={newRecipeName}
            onChange={(e) => setNewRecipeName(e.target.value)}
            placeholder="Recipe name"
            className="p-2 border rounded dark:bg-gray-800"
          />
          <input
            value={newRecipeTags}
            onChange={(e) => setNewRecipeTags(e.target.value)}
            placeholder="Tags (comma-separated)"
            className="p-2 border rounded dark:bg-gray-800"
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={selectedSupplyId}
            onChange={(e) => setSelectedSupplyId(e.target.value)}
            className="p-2 border rounded dark:bg-gray-800"
          >
            <option value="">Select supply</option>
            {supplies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.unit})
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.01"
            value={selectedAmount}
            onChange={(e) => setSelectedAmount(e.target.value)}
            placeholder="Amount"
            className="p-2 border rounded w-24 dark:bg-gray-800"
          />
          <button
            onClick={addItemToRecipe}
            className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
          >
            <PlusCircle size={16} /> Add Item
          </button>
        </div>

        <ul className="text-sm space-y-1">
          {newRecipeItems.map((item, i) => {
            const s = supplies.find((s) => s.id === item.supplyId);
            return (
              <li key={i}>
                {s?.name || "Unknown"} - {item.amount} {s?.unit}
              </li>
            );
          })}
        </ul>

        <button
          onClick={addRecipe}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
        >
          Save Recipe
        </button>
      </div>

      {/* Batch Actions */}
      {selected.length > 0 && (
        <div className="bg-yellow-100 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 p-4 rounded flex flex-col md:flex-row items-center justify-between gap-2">
          <div className="text-sm">
            {selected.length} selected
            <button
              className="ml-2 text-blue-500 hover:underline"
              onClick={() => setSelected(recipes.map((r) => r.id))}
            >
              Select All
            </button>
            <button
              className="ml-2 text-red-500 hover:underline"
              onClick={() => setSelected([])}
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={batchEdit.appendName}
              onChange={(e) => setBatchEdit({ ...batchEdit, appendName: e.target.value })}
              placeholder="Append name"
              className="p-1 border rounded dark:bg-gray-800"
            />
            <input
              type="text"
              value={batchEdit.addTags}
              onChange={(e) => setBatchEdit({ ...batchEdit, addTags: e.target.value })}
              placeholder="Add tags"
              className="p-1 border rounded dark:bg-gray-800"
            />
            <button
              onClick={handleBatchEdit}
              className="bg-green-600 text-white px-3 py-1 rounded flex items-center gap-1"
            >
              <CheckCircle size={16} /> Apply
            </button>
            <button
              onClick={handleBatchDelete}
              className="bg-red-600 text-white px-3 py-1 rounded flex items-center gap-1"
            >
              <Trash2 size={16} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Recipe List */}
      <div className="space-y-4">
        {recipes.map((recipe) => {
          const isSelected = selected.includes(recipe.id);
          const isEditing = editingId === recipe.id;

          return (
            <div
              key={recipe.id}
              className="p-4 bg-gray-100 dark:bg-gray-800 rounded shadow flex flex-col"
            >
              <div className="flex items-start justify-between">
                <div className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() =>
                      setSelected((prev) =>
                        isSelected ? prev.filter((id) => id !== recipe.id) : [...prev, recipe.id]
                      )
                    }
                    className="mt-1"
                  />
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        value={editData.name}
                        onChange={(e) =>
                          setEditData({ ...editData, name: e.target.value })
                        }
                        className="p-1 border rounded w-full dark:bg-gray-700"
                      />
                      <input
                        value={editData.tags}
                        onChange={(e) =>
                          setEditData({ ...editData, tags: e.target.value })
                        }
                        className="p-1 border rounded w-full dark:bg-gray-700"
                      />
                      {supplies.map((supply) => {
                        const val =
                          editData.items.find((i) => i.supplyId === supply.id)?.amount || "";
                        return (
                          <div key={supply.id} className="flex items-center gap-2 text-sm">
                            <label className="w-32">{supply.name} ({supply.unit})</label>
                            <input
                              type="number"
                              value={val}
                              onChange={(e) =>
                                handleEditItemChange(supply.id, e.target.value)
                              }
                              className="p-1 border rounded w-24 dark:bg-gray-700"
                            />
                          </div>
                        );
                      })}
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={saveEdit}
                          className="bg-green-600 text-white px-3 py-1 rounded flex items-center gap-1"
                        >
                          <CheckCircle size={16} /> Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="bg-gray-500 text-white px-3 py-1 rounded flex items-center gap-1"
                        >
                          <XCircle size={16} /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h3 className="text-lg font-semibold">{recipe.name}</h3>
                      {recipe.tags?.length > 0 && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Tags: {recipe.tags.join(", ")}
                        </p>
                      )}
                      <ul className="text-sm mt-2 space-y-1">
                        {recipe.items.map((item) => {
                          const s = supplies.find((s) => s.id === item.supplyId);
                          return (
                            <li key={item.supplyId}>
                              {s?.name || "Unknown"} - {item.amount} {s?.unit}
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 font-medium">
                        Total Cost: ${calculateCost(recipe.items).toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>
                {!isEditing && (
                  <div className="flex flex-col items-end gap-1">
                    <button onClick={() => startEditing(recipe)} title="Edit">
                      <Edit size={18} className="text-blue-500 hover:text-blue-700" />
                    </button>
                    <button onClick={() => cloneRecipe(recipe)} title="Clone">
                      <Copy size={18} className="text-purple-500 hover:text-purple-700" />
                    </button>
                    <button onClick={() => deleteRecipe(recipe.id)} title="Delete">
                      <Trash2 size={18} className="text-red-500 hover:text-red-700" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
