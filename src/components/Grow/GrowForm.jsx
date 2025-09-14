// src/components/Grow/GrowForm.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  getDoc,
} from "firebase/firestore";
import { db, auth } from "../../firebase-config";

/* lightweight toast (no deps) */
function showToast(message, { duration = 2400 } = {}) {
  try {
    const el = document.createElement("div");
    el.textContent = message;
    Object.assign(el.style, {
      position: "fixed",
      left: "50%",
      bottom: "22px",
      transform: "translateX(-50%) translateY(8px)",
      background: "rgba(16,185,129,0.95)", // emerald-ish
      color: "white",
      padding: "10px 14px",
      borderRadius: "12px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      fontSize: "14px",
      zIndex: 999999,
      opacity: 0,
      transition: "opacity 160ms ease, transform 160ms ease",
      pointerEvents: "none",
      maxWidth: "80vw",
      textAlign: "center",
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = 1;
      el.style.transform = "translateX(-50%) translateY(0)";
    });
    setTimeout(() => {
      el.style.opacity = 0;
      el.style.transform = "translateX(-50%) translateY(6px)";
      setTimeout(() => el.remove(), 200);
    }, duration);
  } catch {
    // no-op
  }
}

/**
 * Prop-driven first; falls back to Firestore if lists/handlers aren’t passed.
 */
export default function GrowForm({
  editingGrow,
  onSaveComplete,
  onClose = () => {},
  strains,
  grows,
  recipes,
  supplies,
  onCreateGrow,
  onUpdateGrow,
}) {
  const isEditing = !!editingGrow?.id;

  // ----- Local state -----
  const [strain, setStrain] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [stage, setStage] = useState("Inoculated");
  const [growType, setGrowType] = useState("Agar");
  const [initialVolume, setInitialVolume] = useState(""); // per-child size
  const [volumeUnit, setVolumeUnit] = useState("mL");
  const [status, setStatus] = useState("Active");

  // Parent (now required): either existing grow OR library item
  const [parentMode, setParentMode] = useState("grow"); // "grow" | "library"
  const [parentGrowId, setParentGrowId] = useState("");
  const [parentLibraryId, setParentLibraryId] = useState("");
  const [parentConsumption, setParentConsumption] = useState(""); // total to subtract from parent grow (if grow-mode)

  const [batchCount, setBatchCount] = useState(1);

  const [createdAt, setCreatedAt] = useState("");
  const [recipeId, setRecipeId] = useState("");

  // Options
  const [strainOptions, setStrainOptions] = useState([]);
  const [parentOptions, setParentOptions] = useState([]); // grows
  const [libraryItems, setLibraryItems] = useState([]); // library
  const [recipeOptions, setRecipeOptions] = useState([]);
  const [supplyOptions, setSupplyOptions] = useState([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ----- Seed from editingGrow / prefill -----
  useEffect(() => {
    if (isEditing) {
      setStrain(editingGrow.strain || "");
      setAbbreviation(editingGrow.abbreviation || "");
      setStage(editingGrow.stage || "Inoculated");
      setGrowType(editingGrow.growType || "Agar");
      setInitialVolume(editingGrow.initialVolume ?? "");
      setVolumeUnit(editingGrow.volumeUnit || "mL");
      setStatus(editingGrow.status || "Active");
      setCreatedAt((editingGrow.createdAt || "").substring?.(0, 10) || "");
      setRecipeId(editingGrow.recipeId || "");

      // Parent reflect existing data
      if (editingGrow.parentGrowId) {
        setParentMode("grow");
        setParentGrowId(editingGrow.parentGrowId);
      } else if (editingGrow.parentLibraryId || editingGrow.parentSource === "Library") {
        setParentMode("library");
        if (editingGrow.parentLibraryId) setParentLibraryId(editingGrow.parentLibraryId);
      }
      setParentConsumption(""); // only used when creating
      setBatchCount(1);
    } else {
      setStrain(editingGrow?.strain || "");
      setAbbreviation("");
      setStage("Inoculated");
      setGrowType(editingGrow?.growType || "Agar");
      setInitialVolume("");
      setVolumeUnit("mL");
      setStatus("Active");
      setCreatedAt(new Date().toISOString().substring(0, 10));
      setRecipeId("");

      // Prefill parent from Strains→Library "New Grow"
      if (editingGrow?.parentSource === "Library" && editingGrow?.parentId) {
        setParentMode("library");
        setParentLibraryId(editingGrow.parentId);
        if (editingGrow?.strainName) setStrain(editingGrow.strainName);
      } else if (editingGrow?.parentGrowId) {
        setParentMode("grow");
        setParentGrowId(editingGrow.parentGrowId);
      } else {
        setParentMode("grow");
        setParentGrowId("");
        setParentLibraryId("");
      }
      setParentConsumption("");
      setBatchCount(1);
    }
  }, [editingGrow, isEditing]);

  // ----- Load options from props, else fallback fetch -----
  useEffect(() => {
    (async () => {
      try {
        const user = auth.currentUser;

        if (Array.isArray(strains)) {
          setStrainOptions(
            strains.map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean)
          );
        } else if (user) {
          const snap = await getDocs(collection(db, "users", user.uid, "strains"));
          setStrainOptions(snap.docs.map((d) => d.data().name).filter(Boolean));
        }

        // Parents allowed sources
        const allowAsParent = (g) =>
          g.status !== "Archived" &&
          g.status !== "Contaminated" &&
          (g.growType === "Agar" || g.growType === "LC" || g.growType === "Grain Jar");

        if (Array.isArray(grows)) {
          setParentOptions(grows.filter(allowAsParent));
        } else if (user) {
          const snap = await getDocs(collection(db, "users", user.uid, "grows"));
          setParentOptions(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(allowAsParent));
        }

        // Library items (swab/syringe/print/LC etc.)
        if (user) {
          const libSnap = await getDocs(collection(db, "users", user.uid, "library"));
          setLibraryItems(libSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }

        if (Array.isArray(recipes)) {
          setRecipeOptions(recipes);
        } else if (user) {
          const snap = await getDocs(collection(db, "users", user.uid, "recipes"));
          setRecipeOptions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }

        if (Array.isArray(supplies)) {
          setSupplyOptions(supplies);
        } else if (user) {
          const snap = await getDocs(collection(db, "users", user.uid, "supplies"));
          setSupplyOptions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
      } catch (e) {
        console.error(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strains, grows, recipes, supplies]);

  // ----- Parent helpers -----
  const selectedParentGrow = useMemo(() => {
    if (!parentGrowId) return null;
    const src = Array.isArray(grows) ? grows : parentOptions;
    return src.find((g) => g.id === parentGrowId) || null;
  }, [parentGrowId, grows, parentOptions]);

  const selectedLibraryItem = useMemo(
    () => (parentLibraryId ? libraryItems.find((l) => l.id === parentLibraryId) || null : null),
    [parentLibraryId, libraryItems]
  );

  // When a parent is chosen, lock strain to parent and copy unit (grow-mode)
  useEffect(() => {
    if (!selectedParentGrow || isEditing) return;
    setStrain(selectedParentGrow.strain || "");
    if (selectedParentGrow.volumeUnit) setVolumeUnit(selectedParentGrow.volumeUnit);
  }, [selectedParentGrow, isEditing]);

  // When a library parent is chosen, prefill strain if missing
  useEffect(() => {
    if (!selectedLibraryItem || isEditing) return;
    if (!strain) setStrain(selectedLibraryItem.strainName || "");
  }, [selectedLibraryItem, isEditing, strain]);

  // ----- Abbreviation generator -----
  useEffect(() => {
    const makeAbbr = async () => {
      if (!strain || !createdAt || isEditing) return;
      const initials = String(strain)
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase();
      const typeAbbr = { Agar: "AG", LC: "LC", "Grain Jar": "GJ", Bulk: "BK" }[growType] || "XX";
      const datePart = createdAt.replaceAll("-", "").slice(2); // YYMMDD
      const base = `${initials}-${typeAbbr}-${datePart}`;

      let existing = [];
      if (Array.isArray(grows)) {
        existing = grows.map((g) => g.abbreviation).filter((a) => a?.startsWith(base));
      } else {
        const user = auth.currentUser;
        if (user) {
          const snap = await getDocs(collection(db, "users", user.uid, "grows"));
          existing = snap.docs
            .map((d) => d.data().abbreviation)
            .filter((a) => a?.startsWith(base));
        }
      }

      let final = base;
      if (existing.includes(base)) {
        let n = 1;
        while (existing.includes(`${base}-${n}`)) n++;
        final = `${base}-${n}`;
      }
      setAbbreviation(final);
    };
    makeAbbr();
  }, [strain, growType, createdAt, grows, isEditing]);

  // ----- Derived / validation -----
  const stageOptions = useMemo(
    () =>
      growType === "Bulk"
        ? ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"]
        : ["Inoculated", "Colonizing", "Colonized"],
    [growType]
  );

  const calculateRecipeCost = (rid, servings = 1) => {
    const r =
      (Array.isArray(recipeOptions) && recipeOptions.find((x) => x.id === rid)) ||
      (Array.isArray(recipes) && recipes.find((x) => x.id === rid));
    if (!r || !Array.isArray(r.items)) return 0;
    return r.items.reduce((total, item) => {
      const sup =
        (Array.isArray(supplyOptions) && supplyOptions.find((s) => s.id === item.supplyId)) ||
        (Array.isArray(supplies) && supplies.find((s) => s.id === item.supplyId));
      // item.amount is already in stock units
      const need = Number(item.amount || 0) * (Number(servings) || 1);
      const cost = Number(sup?.cost || 0) * need;
      return total + (Number.isFinite(cost) ? cost : 0);
    }, 0);
  };

  const parentAvailable = Number(selectedParentGrow?.amountAvailable || 0);
  const consumeValue = parentMode === "grow" && parentGrowId ? Number(parentConsumption || 0) : 0; // total for batch
  const overConsume = parentMode === "grow" && parentGrowId && consumeValue > parentAvailable;
  const invalidVolume = growType !== "Bulk" ? Number(initialVolume || 0) <= 0 : false;
  const parentChosen =
    (parentMode === "grow" && !!parentGrowId) || (parentMode === "library" && !!parentLibraryId);

  // ----- Recipe helpers for stock deduction on create -----
  const getRecipeById = async (rid) => {
    if (!rid) return null;
    const fromState =
      (Array.isArray(recipeOptions) && recipeOptions.find((r) => r.id === rid)) ||
      (Array.isArray(recipes) && recipes.find((r) => r.id === rid));
    if (fromState) return fromState;

    const user = auth.currentUser;
    if (!user) return null;
    const ref = doc(db, "users", user.uid, "recipes", rid);
    const snap = await getDoc(ref);
    return snap.exists() ? { id: rid, ...snap.data() } : null;
  };

  const supplyById = (sid) =>
    (Array.isArray(supplyOptions) && supplyOptions.find((s) => s.id === sid)) ||
    (Array.isArray(supplies) && supplies.find((s) => s.id === sid)) ||
    null;

  // Compute consumption rows from normalized recipe items for N servings
  const computeConsumptionRows = (recipe, servings = 1) => {
    const baseYield = Number(recipe?.yield) > 0 ? Number(recipe.yield) : 1;
    const factor = (Number(servings) > 0 ? Number(servings) : 1) / baseYield;

    const rows = (recipe?.items || [])
      .map((it) => {
        const s = supplyById(it.supplyId);
        if (!s) return null;
        const unit = String(s.unit || "").toLowerCase();
        let need = Number(it.amount || 0) * factor; // already in stock unit
        if (unit === "count") need = Math.ceil(need);
        const onHand = Number(s.quantity || 0);
        return {
          supplyId: s.id,
          name: s.name,
          unit: s.unit || "",
          need,
          onHand,
          newQty: Math.max(0, onHand - need),
          shortage: onHand - need < 0,
        };
      })
      .filter(Boolean);

    return rows;
  };

  const confirmShortages = (rows, recipeName, servings = 1, servingLabel = "") => {
    const shortages = rows.filter((r) => r.shortage);
    if (shortages.length === 0) return true;
    const list = shortages
      .map((r) => `• ${r.name}: have ${r.onHand} ${r.unit}, need ${r.need} ${r.unit}`)
      .join("\n");
    return window.confirm(
      `Not enough stock to make ${servings} ${servingLabel || "servings"} of "${recipeName}".\n\n${list}\n\nProceed anyway? (Will deduct what is available, never below zero.)`
    );
  };

  const deductSupplies = async (rows, firstGrowId, recipeName, servings = 1, servingLabel = "") => {
    const user = auth.currentUser;
    if (!user) return;
    await Promise.all(
      rows.map(async (r) => {
        const ref = doc(db, "users", user.uid, "supplies", r.supplyId);
        await updateDoc(ref, { quantity: r.newQty });
        await addDoc(collection(db, "users", user.uid, "supply_audits"), {
          supplyId: r.supplyId,
          action: "consume",
          amount: Number(r.need),
          note: `Batch for "${recipeName}" (${servings} ${servingLabel || "servings"}) — first grow ${firstGrowId}`,
          timestamp: new Date().toISOString(),
        });
      })
    );
  };

  // ----- Submit -----
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const user = auth.currentUser;
    if (!user) return;

    if (!parentChosen) {
      setError("Select a parent (Existing Grow or Library Item).");
      return;
    }
    if (overConsume) {
      setError("Cannot consume more than parent has available.");
      return;
    }
    if (Number(batchCount || 0) < 1) {
      setError("Batch count must be at least 1.");
      return;
    }

    try {
      setSaving(true);

      // Preload recipe + compute totals for the WHOLE batch
      let recipeForUse = null;
      let consumptionRows = [];
      if (!isEditing && recipeId) {
        recipeForUse = await getRecipeById(recipeId);
        if (recipeForUse) {
          consumptionRows = computeConsumptionRows(recipeForUse, Number(batchCount || 1));
          const ok = confirmShortages(
            consumptionRows,
            recipeForUse.name || "Recipe",
            Number(batchCount || 1),
            recipeForUse.servingLabel || ""
          );
          if (!ok) {
            setSaving(false);
            return;
          }
        }
      }

      // Total cost includes recipe for total servings (batch) + parent cost (if any)
      const baseCostTotal = calculateRecipeCost(recipeId, Number(batchCount || 1));
      let parentCost = 0;

      if (parentMode === "grow" && parentGrowId) {
        const fromProps =
          (Array.isArray(grows) && grows.find((g) => g.id === parentGrowId)) || null;

        if (fromProps) {
          parentCost = Number(fromProps.cost || 0);
        } else {
          const parentRef = doc(db, "users", user.uid, "grows", parentGrowId);
          const parentSnap = await getDoc(parentRef);
          if (parentSnap.exists()) parentCost = Number(parentSnap.data().cost || 0);
        }
      }

      // Base grow payload (per child)
      const common = {
        strain,
        stage,
        growType,
        status,
        createdAt,
        recipeId: recipeId || null,
        volumeUnit,
      };

      // Parent fields
      if (parentMode === "grow") {
        common.parentGrowId = parentGrowId;
      } else if (parentMode === "library") {
        common.parentGrowId = null;
        common.parentSource = "Library";
        common.parentLibraryId = parentLibraryId;
        if (selectedLibraryItem) {
          common.parentLibraryType = selectedLibraryItem.type || "";
          common.parentLabel =
            selectedLibraryItem.strainName || selectedLibraryItem.type || "Library";
        }
      }

      // Per-child fields
      if (growType !== "Bulk") {
        common.initialVolume = Number(initialVolume || 0);
        common.amountAvailable = Number(initialVolume || 0);
      }

      const firstIdOut = { id: null };
      const totalCostPerChild = (Number(baseCostTotal) + Number(parentCost)) / Number(batchCount || 1);

      // Create N children
      for (let i = 1; i <= Number(batchCount || 1); i++) {
        const abbr = i === 1 ? abbreviation : `${abbreviation}-${i}`;
        const payload = { ...common, abbreviation: abbr, cost: totalCostPerChild };

        let newId = editingGrow?.id || null;
        if (isEditing) {
          if (typeof onUpdateGrow === "function") {
            await onUpdateGrow(editingGrow.id, payload);
            newId = editingGrow.id;
          } else {
            await updateDoc(doc(db, "users", user.uid, "grows", editingGrow.id), payload);
            newId = editingGrow.id;
          }
        } else {
          if (typeof onCreateGrow === "function") {
            newId = await onCreateGrow(payload);
          } else {
            const ref = await addDoc(collection(db, "users", user.uid, "grows"), payload);
            newId = ref.id;
          }
        }

        if (!firstIdOut.id) firstIdOut.id = newId;
      }

      // Parent grow consumption happens ONCE for the batch (total entered)
      if (!isEditing && parentMode === "grow" && parentGrowId && consumeValue > 0) {
        const fromProps =
          (Array.isArray(grows) && grows.find((g) => g.id === parentGrowId)) || null;

        const remaining =
          Number((fromProps?.amountAvailable ?? parentAvailable) - consumeValue);

        const nextStatus = remaining <= 0 ? "Archived" : (fromProps?.status || "Active");

        if (typeof onUpdateGrow === "function" && fromProps) {
          await onUpdateGrow(parentGrowId, {
            amountAvailable: remaining > 0 ? remaining : 0,
            status: nextStatus,
          });
        } else {
          const parentRef = doc(db, "users", user.uid, "grows", parentGrowId);
          const parentSnap = fromProps
            ? { exists: () => true, data: () => fromProps }
            : await getDoc(parentRef);
          if (parentSnap.exists()) {
            const pdata = parentSnap.data();
            const rem = Number((pdata.amountAvailable || 0) - consumeValue);
            await updateDoc(parentRef, {
              amountAvailable: rem > 0 ? rem : 0,
              status: rem <= 0 ? "Archived" : (pdata.status || "Active"),
            });
          }
        }
      }

      // Deduct supplies for the WHOLE batch (after first grow exists for logging)
      if (!isEditing && recipeForUse && consumptionRows.length) {
        await deductSupplies(
          consumptionRows,
          firstIdOut.id,
          recipeForUse.name || "Recipe",
          Number(batchCount || 1),
          recipeForUse.servingLabel || ""
        );
        showToast("Supplies deducted for this batch.");
      }

      onSaveComplete && onSaveComplete(firstIdOut.id);
      onClose && onClose();
    } catch (err) {
      console.error("Error saving grow:", err);
      setError(err?.message || "Failed to save grow.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-auto px-2 py-4">
      <form
        onSubmit={handleSubmit}
        className="relative z-10 bg-white dark:bg-zinc-800 p-4 rounded-2xl shadow w-full max-w-sm space-y-2 text-sm"
      >
        <div className="flex justify-between items-center border-b border-zinc-200 dark:border-zinc-700 pb-2 mb-2">
          <h2 className="text-base font-semibold">{isEditing ? "Edit Grow" : "Add Grow"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-red-500 text-lg rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
            aria-label="Close add/edit grow form"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="p-2 rounded bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Parent required */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Parent</span>
          <div className="ml-auto inline-flex rounded-full overflow-hidden border border-zinc-300 dark:border-zinc-600">
            <button
              type="button"
              className={`px-3 py-1 text-xs ${parentMode === "grow" ? "accent-bg text-white" : "bg-zinc-100 dark:bg-zinc-700"}`}
              onClick={() => setParentMode("grow")}
            >
              Existing Grow
            </button>
            <button
              type="button"
              className={`px-3 py-1 text-xs ${parentMode === "library" ? "accent-bg text-white" : "bg-zinc-100 dark:bg-zinc-700"}`}
              onClick={() => setParentMode("library")}
            >
              Library Item
            </button>
          </div>
        </div>

        {parentMode === "grow" ? (
          <>
            <select
              value={parentGrowId}
              onChange={(e) => setParentGrowId(e.target.value)}
              className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
              aria-label="Select parent grow"
              required
            >
              <option value="">Select a parent grow…</option>
              {parentOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.strain} ({g.growType}) — {g.amountAvailable ?? 0} {g.volumeUnit || ""} left
                </option>
              ))}
            </select>

            <label className="block text-xs font-medium">
              Consume from Parent ({selectedParentGrow?.amountAvailable ?? 0}{" "}
              {selectedParentGrow?.volumeUnit || volumeUnit} available)
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={parentConsumption}
                onChange={(e) => setParentConsumption(e.target.value)}
                min={0}
                max={parentAvailable}
                className={`w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white ${
                  overConsume ? "border-red-500" : ""
                }`}
                aria-label="Total amount to consume from parent for this batch"
              />
              <span className="text-xs text-zinc-500">
                {selectedParentGrow?.volumeUnit || volumeUnit}
              </span>
            </div>
            {overConsume && (
              <div className="text-xs text-red-500">Cannot exceed parent’s available amount.</div>
            )}
          </>
        ) : (
          <>
            <select
              value={parentLibraryId}
              onChange={(e) => setParentLibraryId(e.target.value)}
              className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
              aria-label="Select library item as parent"
              required
            >
              <option value="">Select a library item…</option>
              {libraryItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.type || "Item"} — {it.strainName || "Unknown"} · Qty {it.qty ?? 0} {it.unit || "count"} ({it.location || "—"})
                </option>
              ))}
            </select>
          </>
        )}

        <label className="block text-xs font-medium">Grow Type</label>
        <select
          value={growType}
          onChange={(e) => setGrowType(e.target.value)}
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
          aria-label="Select grow type"
        >
          <option>Agar</option>
          <option>LC</option>
          <option>Grain Jar</option>
          <option>Bulk</option>
        </select>

        <label className="block text-xs font-medium">
          Strain{parentMode === "grow" && parentGrowId ? " (locked to parent)" : ""}
        </label>
        <select
          value={strain}
          onChange={(e) => setStrain(e.target.value)}
          required
          disabled={parentMode === "grow" && !!parentGrowId}
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white disabled:opacity-70"
          aria-label="Select strain"
        >
          <option value="">Select Strain</option>
          {strainOptions.map((s, i) => (
            <option key={i}>{s}</option>
          ))}
        </select>

        <label className="block text-xs font-medium">Abbreviation</label>
        <input
          value={abbreviation}
          readOnly
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white opacity-80"
          aria-readonly="true"
        />

        {growType !== "Bulk" && (
          <>
            <label className="block text-xs font-medium">Initial Volume (each child)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={initialVolume}
                onChange={(e) => setInitialVolume(e.target.value)}
                min={1}
                required
                className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
                aria-label="Initial volume per child"
              />
              <select
                value={volumeUnit}
                onChange={(e) => setVolumeUnit(e.target.value)}
                className="p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
                aria-label="Volume unit"
              >
                <option value="mL">mL</option>
                <option value="g">g</option>
              </select>
            </div>
          </>
        )}

        {/* Batch */}
        <label className="block text-xs font-medium">Batch count</label>
        <input
          type="number"
          min={1}
          value={batchCount}
          onChange={(e) => setBatchCount(e.target.value)}
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
          aria-label="Number of children to create"
        />

        <label className="block text-xs font-medium">Stage</label>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
          aria-label="Select stage"
        >
          {stageOptions.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>

        <label className="block text-xs font-medium">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
          aria-label="Select status"
        >
          <option>Active</option>
          <option>Contaminated</option>
          <option>Archived</option>
        </select>

        <label className="block text-xs font-medium">Created Date</label>
        <input
          type="date"
          value={createdAt}
          onChange={(e) => setCreatedAt(e.target.value)}
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
          aria-label="Created date"
        />

        <label className="block text-xs font-medium">Recipe</label>
        <select
          value={recipeId}
          onChange={(e) => setRecipeId(e.target.value)}
          disabled={saving}
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white disabled:opacity-60"
          aria-label="Select recipe"
        >
          <option value="">None</option>
          {(Array.isArray(recipeOptions) ? recipeOptions : recipes || []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="bg-zinc-200 dark:bg-zinc-600 text-black dark:text-white px-3 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="accent-bg text-white px-3 py-1 rounded disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
            disabled={
              saving ||
              !strain ||
              !parentChosen ||
              (growType !== "Bulk" && invalidVolume) ||
              (parentMode === "grow" && parentGrowId && overConsume)
            }
            aria-busy={saving ? "true" : "false"}
          >
            {saving ? "Saving…" : isEditing ? "Update Grow" : "Add Grow"}
          </button>
        </div>
      </form>
    </div>
  );
}
