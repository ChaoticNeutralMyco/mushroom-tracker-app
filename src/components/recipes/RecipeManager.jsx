// src/components/recipes/RecipeManager.jsx
import React, { useState, useEffect } from "react";
import {
  Copy,
  Trash2,
  Edit,
  PlusCircle,
  CheckCircle,
  XCircle,
  Tag,
} from "lucide-react";
import { db, auth } from "../../firebase-config";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

const byName = (a, b) =>
  String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
    sensitivity: "base",
  });

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

  // ---- LIVE SNAPSHOTS (auth-aware) ----
  useEffect(() => {
    let unsubs = [];
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      // cleanup any prior listeners when auth changes
      unsubs.forEach((fn) => fn && fn());
      unsubs = [];

      if (!u) {
        setSupplies([]);
        setRecipes([]);
        return;
      }

      const supRef = collection(db, "users", u.uid, "supplies");
      const recRef = collection(db, "users", u.uid, "recipes");

      const unsub1 = onSnapshot(supRef, (snap) => {
        setSupplies(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byName)
        );
      });

      const unsub2 = onSnapshot(recRef, (snap) => {
        setRecipes(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byName)
        );
      });

      unsubs.push(unsub1, unsub2);
    });

    return () => {
      unsubAuth();
      unsubs.forEach((fn) => fn && fn());
    };
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

    await addDoc(collection(db, "users", user.uid, "recipes"), {
      name: newRecipeName.trim(),
      tags,
      items: newRecipeItems,
      createdAt: new Date().toISOString(),
    });

    // snapshots will update UI
    setNewRecipeName("");
    setNewRecipeTags("");
    setNewRecipeItems([]);
  };

  const deleteRecipe = async (id) => {
    const user = auth.currentUser;
    if (!user) return;
    await deleteDoc(doc(db, "users", user.uid, "recipes", id));
    setSelected((prev) => prev.filter((rid) => rid !== id)); // keep selection tidy
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

    await addDoc(collection(db, "users", user.uid, "recipes"), clone);
    // snapshots will reflect the clone
  };

  const startEditing = (recipe) => {
    setEditingId(recipe.id);
    setEditData({
      name: recipe.name,
      tags: (recipe.tags || []).join(", "),
      items: [...(recipe.items || [])],
    });
  };

  const handleEditItemChange = (supplyId, amount) => {
    const parsed = parseFloat(amount || 0);
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

    await updateDoc(doc(db, "users", user.uid, "recipes", editingId), {
      name: editData.name.trim(),
      tags,
      items: editData.items,
      updatedAt: new Date().toISOString(),
    });

    setEditingId(null); // snapshots update the row
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
        const updatedTags = Array.from(
          new Set([...(recipe.tags || []), ...tagList])
        );

        await updateDoc(doc(db, "users", user.uid, "recipes", id), {
          name: updatedName,
          tags: updatedTags,
        });
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
          <div className="flex gap-2">
            <select
              value={selectedSupplyId}
              onChange={(e) => setSelectedSupplyId(e.target.value)}
              className="p-2 border rounded dark:bg-gray-800 flex-1"
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
              placeholder="Amt"
              className="p-2 border rounded w-24 dark:bg-gray-800"
            />
            <button
              onClick={addItemToRecipe}
              className="flex items-center gap-1 bg-blue-600 text-white px-3 rounded hover:bg-blue-700"
              title="Add item"
            >
              <PlusCircle size={16} />
            </button>
          </div>
        </div>

        {/* Current new items */}
        {!!newRecipeItems.length && (
          <div className="flex flex-wrap gap-2 text-sm">
            {newRecipeItems.map((item, i) => {
              const s = supplies.find((x) => x.id === item.supplyId);
              return (
                <span
                  key={i}
                  className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800"
                >
                  {s?.name || "Unknown"} — {item.amount} {s?.unit}
                </span>
              );
            })}
          </div>
        )}

        <button
          onClick={addRecipe}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
        >
          Save Recipe
        </button>
      </div>

      {/* Batch Actions */}
      {selected.length > 0 && (
        <div className="bg-yellow-100 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 p-3 rounded flex flex-col md:flex-row items-center justify-between gap-2">
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
              onChange={(e) =>
                setBatchEdit({ ...batchEdit, appendName: e.target.value })
              }
              placeholder="Append name"
              className="p-1 border rounded dark:bg-gray-800"
            />
            <input
              type="text"
              value={batchEdit.addTags}
              onChange={(e) =>
                setBatchEdit({ ...batchEdit, addTags: e.target.value })
              }
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

      {/* Recipe List (compact, alphabetical) */}
      <div className="space-y-3">
        {recipes.map((recipe) => {
          const isSelected = selected.includes(recipe.id);
          const isEditing = editingId === recipe.id;
          const total = (recipe.items || []).reduce((sum, item) => {
            const s = supplies.find((x) => x.id === item.supplyId);
            return sum + (s?.cost || 0) * (item.amount || 0);
          }, 0);

          return (
            <div
              key={recipe.id}
              className="p-3 bg-gray-100 dark:bg-gray-800 rounded shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() =>
                      setSelected((prev) =>
                        isSelected
                          ? prev.filter((id) => id !== recipe.id)
                          : [...prev, recipe.id]
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

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {supplies.map((supply) => {
                          const val =
                            editData.items.find((i) => i.supplyId === supply.id)
                              ?.amount || "";
                          return (
                            <label
                              key={supply.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <span className="w-36 truncate">
                                {supply.name} ({supply.unit})
                              </span>
                              <input
                                type="number"
                                value={val}
                                onChange={(e) =>
                                  handleEditItemChange(supply.id, e.target.value)
                                }
                                className="p-1 border rounded w-24 dark:bg-gray-700"
                              />
                            </label>
                          );
                        })}
                      </div>

                      <div className="flex gap-2 mt-1">
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
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">{recipe.name}</h3>
                        <span className="text-xs opacity-70">
                          Total Cost: ${total.toFixed(2)}
                        </span>
                      </div>

                      {!!(recipe.tags || []).length && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Tag size={14} className="opacity-70" />
                          {(recipe.tags || []).map((t) => (
                            <span
                              key={t}
                              className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 text-xs mt-1">
                        {(recipe.items || []).map((item) => {
                          const s = supplies.find((x) => x.id === item.supplyId);
                          return (
                            <span
                              key={item.supplyId}
                              className="px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-700"
                              title={`${s?.name || "Unknown"} — ${item.amount} ${
                                s?.unit
                              }`}
                            >
                              {s?.name || "Unknown"} — {item.amount} {s?.unit}
                            </span>
                          );
                        })}
                      </div>
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
