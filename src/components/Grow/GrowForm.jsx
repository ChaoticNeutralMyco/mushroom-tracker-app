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
  const [initialVolume, setInitialVolume] = useState("");       // child’s size
  const [volumeUnit, setVolumeUnit] = useState("mL");
  const [status, setStatus] = useState("Active");
  const [parentGrowId, setParentGrowId] = useState("");         // parent link
  const [parentConsumption, setParentConsumption] = useState(""); // amount to subtract from parent ONLY
  const [createdAt, setCreatedAt] = useState("");
  const [recipeId, setRecipeId] = useState("");

  // Options
  const [strainOptions, setStrainOptions] = useState([]);
  const [parentOptions, setParentOptions] = useState([]);
  const [recipeOptions, setRecipeOptions] = useState([]);
  const [supplyOptions, setSupplyOptions] = useState([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ----- Seed from editingGrow -----
  useEffect(() => {
    if (isEditing) {
      setStrain(editingGrow.strain || "");
      setAbbreviation(editingGrow.abbreviation || "");
      setStage(editingGrow.stage || "Inoculated");
      setGrowType(editingGrow.growType || "Agar");
      setInitialVolume(editingGrow.initialVolume ?? "");
      setVolumeUnit(editingGrow.volumeUnit || "mL");
      setStatus(editingGrow.status || "Active");
      setParentGrowId(editingGrow.parentGrowId || "");
      setRecipeId(editingGrow.recipeId || "");
      setCreatedAt((editingGrow.createdAt || "").substring?.(0, 10) || "");
      setParentConsumption(""); // separate; only used when creating
    } else {
      setStrain("");
      setAbbreviation("");
      setStage("Inoculated");
      setGrowType("Agar");
      setInitialVolume("");
      setVolumeUnit("mL");
      setStatus("Active");
      setParentGrowId("");
      setRecipeId("");
      setCreatedAt(new Date().toISOString().substring(0, 10));
      setParentConsumption("");
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
  const selectedParent = useMemo(() => {
    if (!parentGrowId) return null;
    const src = Array.isArray(grows) ? grows : parentOptions;
    return src.find((g) => g.id === parentGrowId) || null;
  }, [parentGrowId, grows, parentOptions]);

  // When a parent is chosen, lock strain to parent and copy unit (no auto consumption)
  useEffect(() => {
    if (!selectedParent || isEditing) return;
    setStrain(selectedParent.strain || "");
    if (selectedParent.volumeUnit) setVolumeUnit(selectedParent.volumeUnit);
  }, [selectedParent, isEditing]);

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

  const calculateRecipeCost = (rid) => {
    const r =
      (Array.isArray(recipeOptions) && recipeOptions.find((x) => x.id === rid)) ||
      (Array.isArray(recipes) && recipes.find((x) => x.id === rid));
    if (!r || !Array.isArray(r.items)) return 0;
    return r.items.reduce((total, item) => {
      const sup =
        (Array.isArray(supplyOptions) && supplyOptions.find((s) => s.id === item.supplyId)) ||
        (Array.isArray(supplies) && supplies.find((s) => s.id === item.supplyId));
      const cost = Number(sup?.cost || 0) * Number(item.amount || 0);
      return total + (Number.isFinite(cost) ? cost : 0);
    }, 0);
  };

  const parentAvailable = Number(selectedParent?.amountAvailable || 0);
  const consumeValue = parentGrowId ? Number(parentConsumption || 0) : 0; // ← decoupled from child volume
  const overConsume = parentGrowId && consumeValue > parentAvailable;
  const invalidVolume = growType !== "Bulk" ? Number(initialVolume || 0) <= 0 : false;

  // ----- Submit -----
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const user = auth.currentUser;
    if (!user) return;

    if (overConsume) {
      setError("Cannot consume more than parent has available.");
      return;
    }

    try {
      setSaving(true);
      const baseCost = calculateRecipeCost(recipeId);
      let parentCost = 0;

      if (parentGrowId) {
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

      const growData = {
        strain,
        abbreviation,
        stage,
        growType,
        status,
        parentGrowId: parentGrowId || null,
        createdAt,
        recipeId: recipeId || null,
        cost: Number(baseCost) + Number(parentCost),
        volumeUnit,
      };

      if (growType !== "Bulk") {
        growData.initialVolume = Number(initialVolume || 0);
        growData.amountAvailable = Number(initialVolume || 0);
      }

      let newId = editingGrow?.id || null;
      if (isEditing) {
        if (typeof onUpdateGrow === "function") {
          await onUpdateGrow(editingGrow.id, growData);
        } else {
          await updateDoc(doc(db, "users", user.uid, "grows", editingGrow.id), growData);
        }
      } else {
        if (typeof onCreateGrow === "function") {
          newId = await onCreateGrow(growData);
        } else {
          const ref = await addDoc(collection(db, "users", user.uid, "grows"), growData);
          newId = ref.id;
        }

        // Reduce parent by the chosen consumption amount ONLY (does not affect child volume)
        if (parentGrowId && consumeValue > 0) {
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
      }

      onSaveComplete && onSaveComplete(newId);
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

        <label className="block text-xs font-medium">Parent Grow (optional)</label>
        <select
          value={parentGrowId}
          onChange={(e) => setParentGrowId(e.target.value)}
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
          aria-label="Select parent grow"
        >
          <option value="">None</option>
          {parentOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.strain} ({g.growType}) — {g.amountAvailable ?? 0} {g.volumeUnit || ""} left
            </option>
          ))}
        </select>

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
          Strain{parentGrowId ? " (locked to parent)" : ""}
        </label>
        <select
          value={strain}
          onChange={(e) => setStrain(e.target.value)}
          required
          disabled={!!parentGrowId}
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
            <label className="block text-xs font-medium">Initial Volume (child)</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={initialVolume}
                onChange={(e) => setInitialVolume(e.target.value)}
                min={1}
                required
                className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
                aria-label="Initial volume"
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

        {parentGrowId && (
          <>
            <label className="block text-xs font-medium">
              Consume from Parent ({selectedParent?.amountAvailable ?? 0}{" "}
              {selectedParent?.volumeUnit || volumeUnit} available)
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
                aria-label="Amount to consume from parent"
              />
              <span className="text-xs text-zinc-500">
                {selectedParent?.volumeUnit || volumeUnit}
              </span>
            </div>
            {overConsume && (
              <div className="text-xs text-red-500">Cannot exceed parent’s available amount.</div>
            )}
          </>
        )}

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
          className="w-full p-1.5 rounded border dark:bg-zinc-700 dark:text-white"
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
              (growType !== "Bulk" && invalidVolume) ||
              (parentGrowId && overConsume)
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
