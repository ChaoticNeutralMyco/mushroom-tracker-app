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
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
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
import {
  canonicalUnit,
  convert,
  formatAmount,
  MASS_UNITS,
  VOLUME_UNITS,
  COUNT_UNITS,
  areCompatible,
} from "../../lib/units";
import { useConfirm } from "../ui/ConfirmDialog";

const byName = (a, b) =>
  String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
    sensitivity: "base",
  });

const ALL_UNITS = [
  ...new Set([...MASS_UNITS, ...VOLUME_UNITS, ...COUNT_UNITS]),
];

export default function RecipeManager() {
  const [supplies, setSupplies] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [selected, setSelected] = useState([]);
  const [batchEdit, setBatchEdit] = useState({ appendName: "", addTags: "" });

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newRecipeName, setNewRecipeName] = useState("");
  const [newRecipeTags, setNewRecipeTags] = useState("");
  const [newRecipeItems, setNewRecipeItems] = useState([]);
  const [newRecipeInstructions, setNewRecipeInstructions] = useState("");
  const [newRecipeYield, setNewRecipeYield] = useState(1);
  const [newRecipeServingLabel, setNewRecipeServingLabel] = useState("");
  const [selectedSupplyId, setSelectedSupplyId] = useState("");
  const [selectedAmount, setSelectedAmount] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");

  // Edit recipe
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({
    name: "",
    tags: "",
    items: [],
    instructions: "",
    yield: 1,
    servingLabel: "",
  });

  // UI expand per-recipe
  const [expandedId, setExpandedId] = useState(null);
  const [servings, setServings] = useState(1);

  // Shortage confirm modal (kept for future reuse; not triggered here)
  const [shortageModal, setShortageModal] = useState({
    show: false,
    items: [],
    recipeId: null,
    recipeName: "",
    servingLabel: "",
    targetServings: 1,
  });

  const confirm = useConfirm();

  // ---- LIVE SNAPSHOTS (auth-aware) ----
  useEffect(() => {
    let unsubs = [];
    const unsubAuth = onAuthStateChanged(auth, (u) => {
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

  // ----- Helpers -----
  const supplyById = (id) => supplies.find((s) => s.id === id) || null;

  const costForItems = (items) =>
    (items || []).reduce((sum, item) => {
      const s = supplyById(item.supplyId);
      if (!s) return sum;
      const normalized = Number(item.amount || 0);
      return sum + Number(s.cost || 0) * normalized;
    }, 0);

  const logAudit = async (supplyId, action, amount, note = "") => {
    const user = auth.currentUser;
    if (!user) return;
    await addDoc(collection(db, "users", user.uid, "supply_audits"), {
      supplyId,
      action,
      amount,
      note,
      timestamp: new Date().toISOString(),
    });
  };

  // Compute scaled amounts (for on-screen table only)
  const computeConsumption = (recipe, targetServings) => {
    const baseYield = Number(recipe.yield) > 0 ? Number(recipe.yield) : 1;
    const factor =
      (Number(targetServings) > 0 ? Number(targetServings) : baseYield) /
      baseYield;

    const rows = (recipe.items || [])
      .map((it) => {
        const s = supplyById(it.supplyId);
        if (!s) return null;

        const stockUnit = canonicalUnit(s.unit || "");
        let need = Number(it.amount || 0) * factor; // normalized (recipe items already in stock units)
        if (stockUnit === "count") need = Math.ceil(need);

        return {
          supplyId: s.id,
          name: s.name,
          unit: s.unit || "",
          need,
        };
      })
      .filter(Boolean);

    return rows;
  };

  // --------- Create modal logic ----------
  const resetCreateForm = () => {
    setNewRecipeName("");
    setNewRecipeTags("");
    setNewRecipeItems([]);
    setNewRecipeInstructions("");
    setNewRecipeYield(1);
    setNewRecipeServingLabel("");
    setSelectedSupplyId("");
    setSelectedAmount("");
    setSelectedUnit("");
  };

  const addItemToRecipe = () => {
    const amountEntered = parseFloat(selectedAmount);
    if (!selectedSupplyId || !Number.isFinite(amountEntered)) return;

    const s = supplyById(selectedSupplyId);
    if (!s) return;

    const unitEntered = canonicalUnit(selectedUnit || s.unit || "");
    const stockUnit = canonicalUnit(s.unit || "");

    const normalized = areCompatible(unitEntered, stockUnit)
      ? convert(amountEntered, unitEntered, stockUnit)
      : amountEntered;

    const newIt = {
      supplyId: selectedSupplyId,
      amount: Number(normalized) || 0, // normalized to stock unit
      unit: unitEntered || stockUnit,
      amountDisplay: amountEntered,
    };

    setNewRecipeItems((prev) => [...prev, newIt]);
    setSelectedSupplyId("");
    setSelectedAmount("");
    setSelectedUnit("");
  };

  const createRecipe = async () => {
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
      instructions: newRecipeInstructions || "",
      yield: Number(newRecipeYield) > 0 ? Number(newRecipeYield) : 1,
      servingLabel: (newRecipeServingLabel || "").trim(),
      createdAt: new Date().toISOString(),
    });

    resetCreateForm();
    setShowCreate(false);
  };

  // --------- Edit / Save ----------
  const deleteRecipe = async (id) => {
    const user = auth.currentUser;
    if (!user) return;
    await deleteDoc(doc(db, "users", user.uid, "recipes", id));
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

    await addDoc(collection(db, "users", user.uid, "recipes"), clone);
  };

  const startEditing = (recipe) => {
    setEditingId(recipe.id);
    setEditData({
      name: recipe.name,
      tags: (recipe.tags || []).join(", "),
      items: [...(recipe.items || [])],
      instructions: recipe.instructions || "",
      yield: recipe.yield || 1,
      servingLabel: recipe.servingLabel || "",
    });
  };

  const updateEditItem = (supplyId, amountDisplay, unitDisplay) => {
    const s = supplyById(supplyId);
    if (!s) return;
    const stockUnit = canonicalUnit(s.unit || "");
    const unit = canonicalUnit(unitDisplay || stockUnit);

    const normalized = areCompatible(unit, stockUnit)
      ? convert(Number(amountDisplay || 0), unit, stockUnit)
      : Number(amountDisplay || 0);

    const idx = editData.items.findIndex((i) => i.supplyId === supplyId);
    const nextItem = {
      supplyId,
      amount: Number(normalized) || 0, // normalized to stock unit
      unit,
      amountDisplay: Number(amountDisplay || 0),
    };

    let items;
    if (idx >= 0) {
      items = [...editData.items];
      items[idx] = nextItem;
    } else {
      items = [...editData.items, nextItem];
    }
    setEditData({ ...editData, items });
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
      instructions: editData.instructions || "",
      yield: Number(editData.yield) > 0 ? Number(editData.yield) : 1,
      servingLabel: (editData.servingLabel || "").trim(),
      updatedAt: new Date().toISOString(),
    });

    setEditingId(null);
  };

  const saveInstructions = async (recipeId, text) => {
    const user = auth.currentUser;
    if (!user) return;
    await updateDoc(doc(db, "users", user.uid, "recipes", recipeId), {
      instructions: text || "",
    });
  };

  const handleBatchDelete = async () => {
    if (!selected.length) return;
    const ok = await confirm(`Delete ${selected.length} selected recipes?`);
    if (!ok) return;
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

  // --- UI helpers ---
  const renderScaledTable = (recipe) => {
    const baseYield = Number(recipe.yield) > 0 ? Number(recipe.yield) : 1;
    const targetServings = Number(servings) > 0 ? Number(servings) : baseYield;
    const factor = targetServings / baseYield;

    const label = (recipe.servingLabel || "").trim();
    const labelText =
      targetServings === 1
        ? label || "serving"
        : label
        ? label
        : "servings";

    return (
      <table className="w-full text-sm border border-zinc-200 dark:border-zinc-700">
        <thead className="bg-zinc-100 dark:bg-zinc-800">
          <tr>
            <th className="p-2 text-left">Item</th>
            <th className="p-2 text-left">
              Amount for {formatAmount(targetServings)} {labelText}
            </th>
            <th className="p-2 text-left">Stock Unit</th>
          </tr>
        </thead>
        <tbody>
          {(recipe.items || []).map((it) => {
            const s = supplyById(it.supplyId);
            const unitShow = it.unit || s?.unit || "";
            const base =
              it.amountDisplay != null
                ? Number(it.amountDisplay)
                : Number(convert(Number(it.amount || 0), s?.unit, unitShow));
            const amtShow = Number.isFinite(base) ? base : 0;

            let scaled = amtShow * factor;
            const unitCanonical = canonicalUnit(unitShow);
            if (unitCanonical === "count") {
              scaled = Math.ceil(scaled);
            }

            return (
              <tr
                key={it.supplyId}
                className="border-t border-zinc-200 dark:border-zinc-700"
              >
                <td className="p-2">{s?.name || "Unknown"}</td>
                <td className="p-2">
                  {unitCanonical === "count"
                    ? `${scaled} ${unitShow}`
                    : `${formatAmount(scaled)} ${unitShow}`}
                </td>
                <td className="p-2">{s?.unit || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  // ---------------- RENDER ----------------
  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6 text-gray-900 dark:text-white">
      {/* Header + New Recipe button */}
      <div className="bg-white dark:bg-gray-900 p-4 rounded shadow flex items-center justify-between">
        <h2 className="text-2xl font-bold">🧪 Recipes</h2>
        <button
          onClick={() => {
            resetCreateForm();
            setShowCreate(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow"
        >
          <PlusCircle size={16} />
          New Recipe
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

      {/* Recipe List */}
      <div className="space-y-3">
        {recipes.map((recipe) => {
          const isSelected = selected.includes(recipe.id);
          const isEditing = editingId === recipe.id;
          const total = costForItems(recipe.items || []);
          const expanded = expandedId === recipe.id;
          const baseYield = Number(recipe.yield) > 0 ? Number(recipe.yield) : 1;
          const servingLabel = (recipe.servingLabel || "").trim();

          return (
            <div
              key={recipe.id}
              className="p-3 bg-gray-100 dark:bg-gray-800 rounded shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3 w-full">
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

                  {/* Header (click to expand) */}
                  <div className="flex-1">
                    <button
                      onClick={() => {
                        const willExpand = expanded ? null : recipe.id;
                        setExpandedId(willExpand);
                        if (!expanded) setServings(baseYield);
                      }}
                      className="flex items-center gap-2"
                    >
                      {expanded ? (
                        <ChevronDown size={18} />
                      ) : (
                        <ChevronRight size={18} />
                      )}
                      <h3 className="text-base font-semibold">{recipe.name}</h3>
                      <span className="text-xs opacity-70">
                        Total Cost: ${total.toFixed(2)}
                      </span>
                    </button>

                    {/* Tags */}
                    {!isEditing && !!(recipe.tags || []).length && (
                      <div className="flex flex-wrap items-center gap-2 mt-1">
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

                    {/* Expanded content */}
                    {expanded && !isEditing && (
                      <div className="mt-3 space-y-4">
                        {/* Servings control (view-only; batch button removed) */}
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-sm opacity-70">
                            Base yield: {baseYield}{" "}
                            {servingLabel
                              ? servingLabel
                              : baseYield === 1
                              ? "serving"
                              : "servings"}
                          </span>
                          <span className="text-sm opacity-70 ml-2">
                            Target servings{servingLabel ? ` (${servingLabel})` : ""}:
                          </span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            className="w-24 rounded border dark:bg-gray-700 p-1 text-sm"
                            value={servings}
                            onChange={(e) =>
                              setServings(
                                Math.max(1, Math.floor(Number(e.target.value)))
                              )
                            }
                          />
                          {/* Make batch button removed per request */}
                        </div>

                        {renderScaledTable(recipe)}

                        {/* Instructions Inline */}
                        <div>
                          <h4 className="text-sm font-medium mt-4 mb-1">
                            Recipe Steps / Instructions
                          </h4>
                          <textarea
                            defaultValue={recipe.instructions || ""}
                            onBlur={async (e) => {
                              await saveInstructions(recipe.id, e.target.value);
                            }}
                            className="w-full min-h=[140px] rounded border dark:bg-gray-700 p-2 text-sm"
                            placeholder="Write step-by-step instructions… (auto-saves on blur)"
                          />
                        </div>
                      </div>
                    )}

                    {/* Editing mode */}
                    {isEditing && (
                      <div className="space-y-2 mt-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            value={editData.name}
                            onChange={(e) =>
                              setEditData({ ...editData, name: e.target.value })
                            }
                            className="p-1 border rounded w-full dark:bg-gray-700"
                            placeholder="Recipe name"
                          />
                          <input
                            value={editData.tags}
                            onChange={(e) =>
                              setEditData({ ...editData, tags: e.target.value })
                            }
                            className="p-1 border rounded w-full dark:bg-gray-700"
                            placeholder="Tags"
                          />
                          <input
                            type="text"
                            value={editData.servingLabel}
                            onChange={(e) =>
                              setEditData({
                                ...editData,
                                servingLabel: e.target.value,
                              })
                            }
                            className="p-1 border rounded w-full dark:bg-gray-700"
                            placeholder='Serving label (e.g., "agar dishes")'
                            title="What the servings represent"
                          />
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={editData.yield}
                            onChange={(e) =>
                              setEditData({
                                ...editData,
                                yield: Math.max(
                                  1,
                                  Math.floor(Number(e.target.value || 1))
                                ),
                              })
                            }
                            className="p-1 border rounded w-full dark:bg-gray-700"
                            placeholder="Yield (servings)"
                            title="How many servings the base recipe makes"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {supplies.map((s) => {
                            const it =
                              editData.items.find((x) => x.supplyId === s.id) ||
                              {
                                supplyId: s.id,
                                amount: 0,
                                unit: s.unit,
                                amountDisplay: 0,
                              };
                            const unit = it.unit || s.unit;

                            const baseVal =
                              it.amountDisplay != null
                                ? Number(it.amountDisplay)
                                : Number(
                                    convert(Number(it.amount || 0), s.unit, unit)
                                  );
                            const disp = Number.isFinite(baseVal) ? baseVal : 0;

                            return (
                              <div
                                key={s.id}
                                className="flex items-center gap-2 text-sm"
                              >
                                <span className="w-36 truncate">
                                  {s.name} ({s.unit})
                                </span>
                                <input
                                  type="number"
                                  value={disp}
                                  onChange={(e) =>
                                    updateEditItem(
                                      s.id,
                                      e.target.value,
                                      unit
                                    )
                                  }
                                  className="p-1 border rounded w-24 dark:bg-gray-700"
                                />
                                <select
                                  value={unit}
                                  onChange={(e) =>
                                    updateEditItem(s.id, disp, e.target.value)
                                  }
                                  className="p-1 border rounded w-24 dark:bg-gray-700"
                                >
                                  {ALL_UNITS.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                              </div>
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
                    )}
                  </div>
                </div>

                {!isEditing && (
                  <div className="flex flex-col items-end gap-1">
                    <button onClick={() => startEditing(recipe)} title="Edit">
                      <Edit
                        size={18}
                        className="text-blue-500 hover:text-blue-700"
                      />
                    </button>
                    <button onClick={() => cloneRecipe(recipe)} title="Clone">
                      <Copy
                        size={18}
                        className="text-purple-500 hover:text-purple-700"
                      />
                    </button>
                    <button onClick={() => deleteRecipe(recipe.id)} title="Delete">
                      <Trash2
                        size={18}
                        className="text-red-500 hover:text-red-700"
                      />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------- CREATE MODAL ---------- */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCreate(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-3xl p-4 md:p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">New Recipe</h3>
              <button
                onClick={() => setShowCreate(false)}
                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
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
              <input
                type="text"
                value={newRecipeServingLabel}
                onChange={(e) => setNewRecipeServingLabel(e.target.value)}
                className="p-2 border rounded dark:bg-gray-800"
                placeholder='Serving label (e.g., "agar dishes")'
                title="What the servings represent"
              />
              <input
                type="number"
                min="1"
                step="1"
                value={newRecipeYield}
                onChange={(e) =>
                  setNewRecipeYield(
                    Math.max(1, Math.floor(Number(e.target.value || 1)))
                  )
                }
                className="p-2 border rounded dark:bg-gray-800"
                placeholder="Yield (servings)"
                title="How many servings the base recipe makes"
              />
            </div>

            {/* Add items row */}
            <div className="flex gap-2 mb-2">
              <select
                value={selectedSupplyId}
                onChange={(e) => {
                  setSelectedSupplyId(e.target.value);
                  const s = supplies.find((x) => x.id === e.target.value);
                  setSelectedUnit(s?.unit || "");
                }}
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
              <select
                value={selectedUnit}
                onChange={(e) => setSelectedUnit(e.target.value)}
                className="p-2 border rounded w-28 dark:bg-gray-800"
              >
                <option value="">unit</option>
                {ALL_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <button
                onClick={addItemToRecipe}
                className="flex items-center gap-1 bg-blue-600 text-white px-3 rounded hover:bg-blue-700"
                title="Add item"
              >
                <PlusCircle size={16} /> Add
              </button>
            </div>

            {!!newRecipeItems.length && (
              <div className="flex flex-wrap gap-2 text-sm mb-3">
                {newRecipeItems.map((it) => {
                  const s = supplyById(it.supplyId);
                  return (
                    <span
                      key={`${it.supplyId}-${it.unit}-${it.amountDisplay}`}
                      className="px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-700"
                    >
                      {s?.name || "Unknown"} — {formatAmount(it.amountDisplay)} {it.unit}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="mb-3">
              <h4 className="text-sm font-medium mb-1">Recipe Steps / Instructions</h4>
              <textarea
                value={newRecipeInstructions}
                onChange={(e) => setNewRecipeInstructions(e.target.value)}
                className="w-full min-h-[140px] rounded border dark:bg-gray-700 p-2 text-sm"
                placeholder="Write step-by-step instructions…"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded bg-zinc-200 dark:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={createRecipe}
                className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white"
              >
                Save Recipe
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
