// src/components/Grow/GrowForm.jsx
/* Storage & Parent Source upgrade (pure form)
   - Parent Source options trimmed to: Active Grow / Storage Item (no "None")
   - Default selection: Active Grow
   - Keep all previous behavior (Active Grow consumption, Storage deduction,
     recipe warnings, cost math, stage options, etc.)
   - Parent (Active Grow) UI:
     * Dropdown shows ABBR — Strain · Type · Stage (date removed)
     * Availability shown below input as helper text (less cramped)
     * Auto-fill strain from selected parent so abbreviation preview populates
   - Parent choices: Only Colonized parents are allowed (Bulk is excluded).
   - Over-consumption guard: if input > available, show red warning and clamp to max.
   - Auto-unit switching by grow type:
     * Agar/LC → ml
     * Grain Jar/Bulk → g (Bulk uses bulkUnit)
*/

import { useEffect, useMemo, useState, useRef } from "react";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../../firebase-config";
import { allowedStagesForType, normalizeType } from "../../lib/growFilters";
import {
  consumeRecipeForBatch,
  reconcileRecipeChangeForGrow,
} from "../../lib/consume-supplies";
import RecipeConsumptionPreview from "./RecipeConsumptionPreview";

/* ---------- Constants ---------- */
const GROW_TYPES = ["Agar", "LC", "Grain Jar", "Bulk", "Other"];
const DEFAULT_STATUS = "Active";
const DEFAULT_STAGE = "Inoculated";
const VOLUME_UNITS = ["ml", "g", "pcs"];

const PARENT_SOURCES = [
  { key: "grow", label: "Active Grow" },
  { key: "library", label: "Storage Item" },
];

/* ---------- Small utils ---------- */
function pad2(n) { return String(n).padStart(2, "0"); }
function toLocalDateInputValue(d) {
  const Y = d.getFullYear(); const M = pad2(d.getMonth() + 1); const D = pad2(d.getDate());
  return `${Y}-${M}-${D}`;
}
function dateFromDateInput(value) { return value ? new Date(`${value}T00:00:00`) : new Date(); }
function deriveAbbrFromName(name = "") {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function typeCodeFor(t = "") {
  const n = normalizeType(t);
  if (n === "Agar") return "AG";
  if (n === "LC") return "LC";
  if (n === "Grain Jar") return "GJ";
  if (n === "Bulk") return "BK";
  return "OT";
}
function yymmddFromLocalDateInput(localDate) {
  if (!localDate) return "";
  const [Y, M, D] = localDate.split("-").map((x) => parseInt(x, 10));
  if (!Y || !M || !D) return "";
  return `${String(Y).slice(-2)}${pad2(M)}${pad2(D)}`;
}
function abbrPrefix(strainName, growType, localDate) {
  const s = deriveAbbrFromName(strainName);
  const code = typeCodeFor(growType);
  const date = yymmddFromLocalDateInput(localDate);
  if (!s) return "";
  return date ? `${s}-${code}-${date}` : `${s}-${code}`;
}
function escapeRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function maxSuffixForPrefix(existingGrows = [], prefix) {
  if (!prefix) return 0;
  const reBare = new RegExp(`^${escapeRegExp(prefix)}$`);
  const reNum = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  let max = 0;
  for (const g of existingGrows) {
    const ab = String(g.abbr || g.abbreviation || "");
    if (reBare.test(ab)) { max = Math.max(max, 1); continue; }
    const m = ab.match(reNum);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}
function toDateAny(raw) {
  if (!raw) return null;
  try {
    if (raw?.toDate) return raw.toDate();
    if (raw instanceof Date) return raw;
    if (typeof raw === "number") return new Date(raw);
    const d = new Date(String(raw));
    return isNaN(d) ? null : d;
  } catch { return null; }
}

/* ---------- Recipe helpers (unchanged) ---------- */
function norm(s = "") { return String(s || "").trim().toLowerCase(); }
function recipeType(r = {}) { return normalizeType(r.type || r.growType || r.category || ""); }

const TYPE_KEYWORDS = {
  agar: ["agar", "plate", "slant", "lme", "mea", "pda"],
  lc: ["lc", "liquid culture", "liquid-culture", "liquid"],
  "grain jar": ["grain", "spawn", "jar", "grain jar", "wbs", "rye"],
  bulk: ["bulk", "substrate", "tub", "shoebox", "mono", "monotub"],
  other: ["misc", "other"],
};

function recipeMatchScore(recipe = {}, currentType = "") {
  const tNorm = norm(normalizeType(currentType));
  if (!tNorm) return 0;
  let score = 0;
  const rType = norm(recipeType(recipe));
  if (tNorm && rType && tNorm === rType) score += 3;
  const name = norm(recipe.name || "");
  const tags = (recipe.tags || recipe.keywords || recipe.labels || []).map(norm);
  const keys = TYPE_KEYWORDS[tNorm] || [];
  if (keys.some((k) => name.includes(k))) score += 2;
  if (tags.length && keys.some((k) => tags.includes(k))) score += 1;
  return score;
}
function computeRecipeTotalCost(recipe, suppliesMap) {
  if (!recipe || !Array.isArray(recipe.items)) return 0;
  let total = 0;
  for (const it of recipe.items) {
    const sup = suppliesMap.get(it.supplyId);
    const price = Number(sup?.cost || 0);
    const amt = Number(it.amount || 0);
    total += price * amt;
  }
  return Math.round(total * 100) / 100;
}
function getRecipeYield(recipe = {}) {
  const qty = Number(
    recipe?.yieldQty ?? recipe?.yield ?? recipe?.yieldAmount ?? recipe?.yieldVolume ??
    recipe?.totalVolume ?? recipe?.batchVolume ?? recipe?.outputQty ?? recipe?.batchQty ??
    recipe?.portions ?? recipe?.servings ?? 0
  ) || 0;
  const unit = String(
    recipe?.yieldUnit || recipe?.unit || recipe?.volumeUnit || recipe?.outputUnit || recipe?.batchUnit || ""
  );
  return { qty, unit };
}

/* ---------- Stage timestamps ---------- */
const stageTimestampField = {
  Inoculated: "inoculatedAt",
  Colonizing: "colonizingAt",
  Colonized: "colonizedAt",
  Fruiting: "fruitingAt",
  Harvested: "harvestedAt",
  Consumed: "consumedAt",
  Contaminated: "contaminatedAt",
};

/* ---------- Storage availability ---------- */
const firstFinite = (...vals) => {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
};
function storageAvailabilityOf(docData = {}) {
  const typeName = String(
    docData.type || docData.form || docData.itemType || docData.kind || ""
  ).toLowerCase();
  const unitHint = String(docData.unit || docData.qtyUnit || "").toLowerCase();

  const isSyringe = /syringe|mss|lc|liquid/.test(typeName) || unitHint === "ml";
  if (isSyringe) {
    const avail = firstFinite(docData.volumeMl, docData.ml, unitHint === "ml" ? docData.qty : undefined);
    const ok = Number.isFinite(avail);
    return { ok, mode: "volume", available: ok ? Math.max(0, avail) : 0, unit: "ml", typeLabel: docData.type || "Syringe", fieldPref: ["volumeMl", "ml", "qty"] };
  }

  const isCount =
    /swab|print|plate|slant|agar/.test(typeName) ||
    !unitHint || unitHint === "count" || unitHint === "plate";
  if (isCount) {
    const raw = firstFinite(docData.count, docData.qty, docData.quantity, docData.plates, docData.items);
    const ok = Number.isFinite(raw);
    const whole = ok ? Math.max(0, Math.floor(raw)) : 0;
    return { ok, mode: "count", available: whole, unit: unitHint || "count", typeLabel: docData.type || "Stored Item", fieldPref: ["count", "qty", "quantity"] };
  }
  return { ok: false, mode: "unknown", available: 0, unit: "", typeLabel: docData.type || "Item", fieldPref: [] };
}

/* ==================== COMPONENT ==================== */
export default function GrowForm({
  editingGrow = null,
  onSaveComplete = () => {},
  onClose = () => {},
  strains = [],
  grows = [],
  recipes = [],
  supplies = [],
  onCreateGrow,
  onUpdateGrow,
}) {
  const mode = editingGrow && editingGrow.id ? "edit" : "create";

  /* ---- Parent Source ---- */
  const cameFromLibrary = editingGrow?.parentSource === "Library" && editingGrow?.parentId;
const [parentSource, setParentSource] = useState(cameFromLibrary ? "library" : "grow");
const isSubmittingRef = useRef(false);
const [isSubmitting, setIsSubmitting] = useState(false);
const effectiveParentSource = parentSource;

  /* ---- Basics ---- */
  const [growType, setGrowType] = useState(editingGrow?.type || editingGrow?.growType || "Agar");
  const [strainId, setStrainId] = useState(editingGrow?.strainId || "");
  const [strain, setStrain] = useState(editingGrow?.strain || editingGrow?.strainName || "");

  // keep `strain` (name) in sync when dropdown id changes (only when not locked by parent/storage)
  const strainNameById = useMemo(() => {
    const map = new Map();
    (Array.isArray(strains) ? strains : []).forEach((s) =>
      map.set(s.id, s.name || s.strain || "Unnamed Strain")
    );
    return map;
  }, [strains]);

  useEffect(() => {
    const lockBecauseOfParent =
      Boolean(editingGrow?.fromStorage) ||
      Boolean(editingGrow?.lockStrain) ||
      cameFromLibrary ||
      effectiveParentSource === "grow" ||
      (effectiveParentSource === "library" && !!editingGrow?.parentId);

    if (lockBecauseOfParent) return;
    setStrain(strainId ? (strainNameById.get(strainId) || "") : "");
  }, [strainId, strainNameById, effectiveParentSource, cameFromLibrary, editingGrow]);

  const [batchCount, setBatchCount] = useState(1);
  const [stage, setStage] = useState(editingGrow?.stage || DEFAULT_STAGE);
  const [status, setStatus] = useState(editingGrow?.status || DEFAULT_STATUS);

  const [created, setCreated] = useState(() => {
    if (editingGrow?.createdAt) {
      try {
        const d = editingGrow.createdAt.toDate?.() || new Date(editingGrow.createdAt);
        return toLocalDateInputValue(d);
      } catch { return toLocalDateInputValue(new Date()); }
    }
    return toLocalDateInputValue(new Date());
  });

  /* ---- Recipes & Supplies ---- */
  const [localRecipes, setLocalRecipes] = useState(Array.isArray(recipes) ? recipes : []);
  const [localSupplies, setLocalSupplies] = useState(Array.isArray(supplies) ? supplies : []);
  useEffect(() => { if (recipes?.length) setLocalRecipes(recipes); }, [recipes]);
  useEffect(() => { if (supplies?.length) setLocalSupplies(supplies); }, [supplies]);
  useEffect(() => {
    if (localRecipes.length && localSupplies.length) return;
    const user = auth.currentUser; if (!user) return;
    (async () => {
      if (!localRecipes.length) {
        const snap = await getDocs(collection(db, "users", user.uid, "recipes"));
        setLocalRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      if (!localSupplies.length) {
        const snap = await getDocs(collection(db, "users", user.uid, "supplies"));
        setLocalSupplies(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    })();
  }, []); // mount
  const suppliesMap = useMemo(() => {
    const m = new Map();
    for (const s of localSupplies) m.set(s.id, s);
    return m;
  }, [localSupplies]);

  const [recipeId, setRecipeId] = useState(editingGrow?.recipeId || "");
  const [recipeName, setRecipeName] = useState(editingGrow?.recipe || editingGrow?.recipeName || "");
  const [cost, setCost] = useState(Number.isFinite(Number(editingGrow?.cost)) ? Number(editingGrow.cost) : 0);

  /* ---- Volumes ---- */
  const [ivalue, setIValue] = useState(editingGrow?.amountTotal ?? editingGrow?.initialVolume ?? "");
  const [ivUnit, setIvUnit] = useState(
    editingGrow?.amountUnit || editingGrow?.volumeUnit || (normalizeType(growType) === "Bulk" ? "g" : "ml")
  );
  const [amountAvailableEdit, setAmountAvailableEdit] = useState(editingGrow?.amountAvailable ?? "");
  const [bulkGrainParts, setBulkGrainParts] = useState(editingGrow?.bulkGrainParts ?? 1);
  const [bulkSubstrateParts, setBulkSubstrateParts] = useState(editingGrow?.bulkSubstrateParts ?? 5);
  const [bulkVolume, setBulkVolume] = useState(editingGrow?.bulkVolume ?? "");
  const [bulkUnit, setBulkUnit] = useState(editingGrow?.bulkVolumeUnit || "g");

  /* ---- Parent grow (Active Grow) ---- */
  const [parentGrowId, setParentGrowId] = useState("");
  const [consumeFromParent, setConsumeFromParent] = useState("");
  const [consumeUnit, setConsumeUnit] = useState("ml");
  const [parentList, setParentList] = useState([]);

  // computed figures for the chosen parent
  const [parentRemaining, setParentRemaining] = useState(0);
  const [parentTotal, setParentTotal] = useState(null);
  const [consumeWarn, setConsumeWarn] = useState(""); // red warning text

  /* ---- Library/Storage picker ---- */
  const [libraryItems, setLibraryItems] = useState([]);
  const [libId, setLibId] = useState(cameFromLibrary ? String(editingGrow.parentId) : "");
  const [storageDoc, setStorageDoc] = useState(null);
  const [storageMode, setStorageMode] = useState({ ok: false, mode: "unknown", available: 0, unit: "", typeLabel: "", fieldPref: [] });
  const [useFromStorageAmount, setUseFromStorageAmount] = useState("");

  useEffect(() => {
    if (effectiveParentSource !== "library") return;
    const user = auth.currentUser; if (!user) return;
    (async () => {
      const snap = await getDocs(collection(db, "users", user.uid, "library"));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const active = rows.filter((it) => {
        const qty = Number(it?.qty || 0);
        const archivedish = !!it?.archived || String(it?.status || "").toLowerCase() === "archived";
        return qty > 0 && !archivedish;
      });
      setLibraryItems(active);
      if (cameFromLibrary && editingGrow?.parentId) setLibId(String(editingGrow.parentId));
    })();
  }, [effectiveParentSource]); // eslint-disable-line

  useEffect(() => {
    if (effectiveParentSource !== "library" || !libId) {
      setStorageDoc(null);
      setStorageMode({ ok: false, mode: "unknown", available: 0, unit: "" });
      return;
    }
    const it = (libraryItems || []).find((i) => String(i.id) === String(libId));
    if (!it) { setStorageDoc(null); setStorageMode({ ok: false, mode: "unknown", available: 0, unit: "" }); return; }
    setStorageDoc(it);
    const mode = storageAvailabilityOf({ ...it, qty: it.qty, unit: it.unit, type: it.type });
    setStorageMode(mode);
    setUseFromStorageAmount(mode.mode === "count" ? "1" : "1");
    if (it.strainName) setStrain(it.strainName);
  }, [libId, libraryItems, effectiveParentSource]);

  const lockStrainPref =
    Boolean(editingGrow?.fromStorage) ||
    Boolean(editingGrow?.lockStrain) ||
    cameFromLibrary;

  const lockStrain =
    lockStrainPref ||
    Boolean(parentGrowId) ||
    (effectiveParentSource === "library" && Boolean(libId));

  const stageOptions = allowedStagesForType(growType);

  useEffect(() => {
    const isBulk = normalizeType(growType) === "Bulk";
    if (isBulk) setIValue("");
    if (!stageOptions.includes(stage)) setStage(DEFAULT_STAGE);
  }, [growType]); // eslint-disable-line

  // Auto-switch units by grow type
  useEffect(() => {
    const t = normalizeType(growType);
    if (t === "Bulk") {
      setBulkUnit("g");
    } else if (t === "Grain Jar") {
      setIvUnit("g");
    } else if (t === "Agar" || t === "LC") {
      setIvUnit("ml");
    }
  }, [growType]);

  const recipesRanked = useMemo(() => {
    const src = Array.isArray(localRecipes) ? [...localRecipes] : [];
    src.sort((a, b) => {
      const sa = recipeMatchScore(a, growType);
      const sb = recipeMatchScore(b, growType);
      if (sb !== sa) return sb - sa;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    return src;
  }, [localRecipes, growType]);

  const selectedRecipe = useMemo(
    () => (recipeId ? recipesRanked.find((r) => r.id === recipeId) : null),
    [recipesRanked, recipeId]
  );
  const selectedRecipeScore = useMemo(
    () => (selectedRecipe ? recipeMatchScore(selectedRecipe, growType) : 0),
    [selectedRecipe, growType]
  );

  useEffect(() => {
    if (!selectedRecipe) { setRecipeName(""); setCost(0); return; }
    setRecipeName(selectedRecipe.name || "");
    const totalBatchCost = computeRecipeTotalCost(selectedRecipe, suppliesMap);
    const { qty: yieldQty, unit: yieldUnitRaw } = getRecipeYield(selectedRecipe);
    const yieldUnit = (yieldUnitRaw || "").toLowerCase();
    let perGrowCost = totalBatchCost;
    if (yieldQty > 0) {
      if (normalizeType(growType) !== "Bulk") {
        const vol = Number(ivalue || 0);
        const unit = (ivUnit || "").toLowerCase();
        perGrowCost = vol > 0 && unit && yieldUnit && unit === yieldUnit
          ? totalBatchCost * (vol / yieldQty)
          : totalBatchCost / yieldQty;
      } else {
        const vol = Number(bulkVolume || 0);
        const unit = (bulkUnit || "").toLowerCase();
        perGrowCost = vol > 0 && unit && yieldUnit && unit === yieldUnit
          ? totalBatchCost * (vol / yieldQty)
          : totalBatchCost / yieldQty;
      }
    }
    setCost(Math.max(0, Math.round(perGrowCost * 100) / 100));
  }, [selectedRecipe, suppliesMap, ivalue, ivUnit, bulkVolume, bulkUnit, growType]);

  const abbrPreview = useMemo(() => {
    const prefix = abbrPrefix(strain, growType, created);
    if (!prefix) return "";
    const maxExisting = maxSuffixForPrefix(grows, prefix);
    return maxExisting === 0 ? prefix : `${prefix}-${maxExisting + 1}`;
  }, [strain, growType, created, grows]);

  /* ---- Persist helpers ---- */
  const createGrow = async (payload) => {
    if (typeof onCreateGrow === "function") return await onCreateGrow(payload);
    const user = auth.currentUser; if (!user) throw new Error("Missing user");
    const ref = await addDoc(collection(db, "users", user.uid, "grows"), payload);
    return ref.id;
  };
  const patchGrow = async (id, patch) => {
    if (!id) return;
    if (typeof onUpdateGrow === "function") return await onUpdateGrow(id, patch);
    const user = auth.currentUser; if (!user) throw new Error("Missing user");
    await updateDoc(doc(db, "users", user.uid, "grows", id), patch);
  };

  /* ---- Compute parent stats + set strain from parent ---- */
  useEffect(() => {
    const p = (parentList || []).find((g) => g.id === parentGrowId);
    if (!p) {
      setParentRemaining(0);
      setParentTotal(null);
      setConsumeUnit("ml");
      return;
    }
    if (p.strain) setStrain(p.strain);

    const total = Number(p.amountTotal);
    const used = Number(p.amountUsed);
    let remaining;
    const unit = p.amountUnit || p.volumeUnit || "ml";

    if (Number.isFinite(total) && total > 0) {
      remaining = Math.max(0, total - (Number.isFinite(used) ? used : 0));
      setParentTotal(total);
    } else {
      const avail = Number(p.amountAvailable);
      remaining = Number.isFinite(avail) ? Math.max(0, avail) : 0;
      setParentTotal(null);
    }
    setParentRemaining(remaining);
    setConsumeUnit(unit);
  }, [parentGrowId, parentList]);

  /* ---- Submit (unchanged) ---- */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      if (!growType) throw new Error("Please choose a grow type.");
      if (!strain) throw new Error("Please choose a strain.");
      if (!stage) throw new Error("Please choose a stage.");

      if (!recipeId || selectedRecipeScore === 0) {
        const t = normalizeType(growType);
        const msg = !recipeId
          ? `No recipe is selected for ${t}. Continue anyway?`
          : `The selected recipe doesn’t look like a ${t} recipe. Continue anyway?`;
        if (!window.confirm(msg)) return;
      }

      let storageUsageTotal = 0;
      if (mode === "create" && effectiveParentSource === "library") {
        if (!libId) throw new Error("Select a storage item.");
        if (!storageMode?.ok) throw new Error("Selected storage item is invalid.");
        const available = Number(storageMode.available || 0);
        if (storageMode.mode === "count") {
          const maxCount = Math.floor(available);
          let v = parseInt(String(useFromStorageAmount), 10);
          if (!Number.isFinite(v)) v = 0;
          if (v < 1) throw new Error("Items to consume must be a whole number ≥ 1.");
          if (v > maxCount) throw new Error(`You only have ${maxCount} in storage.`);
          storageUsageTotal = v;
        } else {
          const v = Number(useFromStorageAmount);
          if (!Number.isFinite(v) || v <= 0)
            throw new Error(`Enter how much to use from storage (${storageMode.unit}).`);
          if (available > 0 && v > available + 1e-9)
            throw new Error(`Requested ${v} ${storageMode.unit} exceeds available ${available} ${storageMode.unit}.`);
          storageUsageTotal = v;
        }
      }

      const createdAt = created ? dateFromDateInput(created) : new Date();
      const costNum = Number.isFinite(Number(cost)) ? Number(cost) : 0;
      const isBulkNow = normalizeType(growType) === "Bulk";

      if (mode === "create") {
        const baseCommon = {
          type: growType,
          strain,
          strainId: strainId || "",
          stage,
          status,
          recipe: recipeName || "",
          recipeId: recipeId || "",
          cost: costNum,
          createdAt,
          parentSource: effectiveParentSource === "library" ? "Library" : "Grow",
          parentId: effectiveParentSource === "library" ? libId : (parentGrowId || null),
          parentType: effectiveParentSource === "library" ? storageDoc?.type || null : null,
        };

        if (!isBulkNow) {
          const initial = Number(ivalue || 0);
          baseCommon.initialVolume = initial;
          baseCommon.volumeUnit = ivUnit;
          baseCommon.amountTotal = initial;
          baseCommon.amountUnit = ivUnit;
          baseCommon.amountUsed = 0;
        } else {
          const totalBulk = Number(bulkVolume || 0);
          baseCommon.bulkGrainParts = Number(bulkGrainParts || 0);
          baseCommon.bulkSubstrateParts = Number(bulkSubstrateParts || 0);
          baseCommon.bulkVolume = totalBulk;
          baseCommon.bulkVolumeUnit = bulkUnit;
          baseCommon.amountTotal = totalBulk;
          baseCommon.amountUnit = bulkUnit;
          baseCommon.amountUsed = 0;
        }

        const tsField = stageTimestampField[stage];
        if (tsField) baseCommon[tsField] = createdAt;

        const count = Math.max(1, Number(batchCount || 1));
        const prefix = abbrPrefix(strain, growType, created);
        const existingMax = maxSuffixForPrefix(grows, prefix);

        const createPayloads = [];
        for (let i = 0; i < count; i++) {
          const payload = { ...baseCommon };
          payload.abbr =
            existingMax === 0
              ? i === 0 ? prefix : `${prefix}-${i + 1}`
              : `${prefix}-${existingMax + i + 1}`;
          createPayloads.push(payload);
        }
        await Promise.all(createPayloads.map((p) => createGrow(p)));

        if (effectiveParentSource === "grow" && parentGrowId) {
          const consume = Number(consumeFromParent || 0);
          if (consume > 0) {
            const parent = (parentList || []).find((p) => p.id === parentGrowId) || {};
            const pTotal = Number(parent.amountTotal);
            const pUsed = Number(parent.amountUsed);
            const hasNewModel = Number.isFinite(pTotal) && pTotal > 0;
            const totalParentUse = consume * count;
            if (hasNewModel) {
              const nextUsed = Math.min(pTotal, (Number.isFinite(pUsed) ? pUsed : 0) + totalParentUse);
              await patchGrow(parentGrowId, { amountUsed: nextUsed });
            } else {
              const avail = Number(parent.amountAvailable);
              const nextAvail = Math.max(0, avail - totalParentUse);
              await patchGrow(parentGrowId, { amountAvailable: nextAvail });
            }
          }
        }

        try {
          const user = auth.currentUser;
          if (user && recipeId) {
            const perChildQty = !isBulkNow ? Number(ivalue || 0) : Number(bulkVolume || 0);
            const perChildUnit = !isBulkNow ? String(ivUnit || "") : String(bulkUnit || "");
            await consumeRecipeForBatch(user.uid, recipeId, {
              batchCount: count,
              perChildQty,
              perChildUnit,
              note: prefix,
            });
          }
        } catch (e2) {
          console.error("Recipe consumption (non-fatal):", e2);
        }

        if (effectiveParentSource === "library" && libId && storageMode?.ok) {
          
          // Deduct from Library item directly (no external helper)
          {
            const user = auth.currentUser; if (!user) throw new Error("Missing user");
            const libRef = doc(db, "users", user.uid, "library", libId);
            const snap = await getDoc(libRef);
            if (snap.exists()) {
              const data = snap.data() || {};
              const prevQty = Number(data.qty || 0);
              let deduct = Number(storageUsageTotal || 0);
              // If this is a Spore Print and a 1–100 value is entered while in count mode,
              // treat it as a percentage of one print (e.g., 25 => 0.25)
              const typeName = String(data.type || "").toLowerCase();
              if (/print/.test(typeName) && deduct > 1 && deduct <= 100 && storageMode?.mode === "count") {
                deduct = deduct / 100;
              }
              const nextQty = Math.max(0, prevQty - (Number.isFinite(deduct) ? deduct : 0));
              await updateDoc(libRef, { qty: nextQty, updatedAt: serverTimestamp() });
            }
          }
        }

        onSaveComplete?.(); onClose?.(); return;
      }

      // EDIT path (unchanged behavior)
      const user = auth.currentUser; if (!user) throw new Error("Missing user");
      const currentRef = doc(db, "users", user.uid, "grows", editingGrow.id);
      const currentSnap = await getDoc(currentRef);
      const currentGrow = currentSnap.exists() ? { id: currentSnap.id, ...currentSnap.data() } : editingGrow;

      const prevType = normalizeType(currentGrow?.type || currentGrow?.growType || "");
      const nextType = normalizeType(growType);

      const prevRecipeId = currentGrow?.recipeId || "";
      const nextRecipeId = recipeId || "";

      const prevQty = Number.isFinite(Number(currentGrow?.amountTotal))
        ? Number(currentGrow.amountTotal)
        : Number(currentGrow?.initialVolume || 0);
      const prevUnit = currentGrow?.amountUnit || currentGrow?.volumeUnit || (prevType === "Bulk" ? "g" : "ml");

      const nextQty = normalizeType(growType) !== "Bulk" ? Number(ivalue || 0) : Number(bulkVolume || 0);
      const nextUnit = normalizeType(growType) !== "Bulk" ? String(ivUnit || "") : String(bulkUnit || "");

      const shouldReconcile =
        prevRecipeId !== nextRecipeId ||
        prevType !== nextType ||
        (Number.isFinite(prevQty) && Number.isFinite(nextQty) && (prevQty !== nextQty || (prevUnit || "") !== (nextUnit || "")));

      if (shouldReconcile) {
        try {
          await reconcileRecipeChangeForGrow(user.uid, {
            oldRecipeId: prevRecipeId || null,
            newRecipeId: nextRecipeId || null,
            oldPerChildQty: Number.isFinite(prevQty) ? prevQty : null,
            oldPerChildUnit: prevUnit || null,
            newPerChildQty: Number.isFinite(nextQty) ? nextQty : null,
            newPerChildUnit: nextUnit || null,
            note: `retype ${currentGrow?.abbr || ""}`,
            growId: currentGrow?.id || null,
          });
        } catch (reconErr) {
          console.error("Reconcile failed:", reconErr);
          alert("Inventory reconcile failed; saved grow fields only.");
        }
      }

      const patch = {
        type: growType,
        strain,
        strainId: strainId || "",
        stage,
        status,
        recipe: recipeName || "",
        recipeId: nextRecipeId || "",
        cost: Number.isFinite(costNum) ? costNum : 0,
        createdAt,
        updatedAt: serverTimestamp(),
      };

      if (normalizeType(growType) !== "Bulk") {
        const initial = Number(ivalue || 0);
        patch.initialVolume = initial;
        patch.volumeUnit = ivUnit;
        patch.amountTotal = initial;
        patch.amountUnit = ivUnit;
      } else {
        const totalBulk = Number(bulkVolume || 0);
        patch.bulkGrainParts = Number(bulkGrainParts || 0);
        patch.bulkSubstrateParts = Number(bulkSubstrateParts || 0);
        patch.bulkVolume = totalBulk;
        patch.bulkVolumeUnit = bulkUnit;
        patch.amountTotal = totalBulk;
        patch.amountUnit = bulkUnit;
      }

      if (amountAvailableEdit !== "" && amountAvailableEdit !== null) {
        patch.amountAvailable = Number(amountAvailableEdit);
      }

      const tsField = stageTimestampField[stage];
      if (tsField) patch[tsField] = createdAt;

      await patchGrow(currentGrow.id, patch);
      onSaveComplete?.(); onClose?.();
    } catch (err) {
      console.error(err);
      alert(err?.message || "Failed to save grow.");
    }
  finally { isSubmittingRef.current = false; setIsSubmitting(false); }

  };

  /* ---- Lists + helpers ---- */
  useEffect(() => {
    const src = Array.isArray(grows) ? grows : [];
    // Active with remaining > 0
    const activeWithRemaining = src.filter((g) => {
      const s = (g.status || "Active").toLowerCase();
      if (s !== "active") return false;
      const total = Number(g.amountTotal);
      const used = Number(g.amountUsed);
      const remNew = Number.isFinite(total) && total > 0 ? Math.max(0, total - (Number.isFinite(used) ? used : 0)) : null;
      const remLegacy = Number(g.amountAvailable);
      const remaining = Number.isFinite(remNew) ? remNew : Number.isFinite(remLegacy) ? remLegacy : 0;
      return remaining > 0;
    });

    // ✅ Only Colonized parents; exclude Bulk entirely
    const limited = activeWithRemaining.filter((g) => {
      const t = normalizeType(g.type || g.growType || "");
      if (t === "Bulk") return false;        // <-- Bulk cannot be a parent
      return String(g.stage) === "Colonized"; // <-- Only Colonized show
    });

    setParentList(limited);
  }, [grows]);

  const availableCount = Math.floor(Number(storageMode.available || 0));
  const handleStorageChange = (e) => {
    const raw = e.target.value;
    if (storageMode.mode === "count") {
      let v = parseInt(raw, 10);
      if (!Number.isFinite(v)) v = 0;
      if (v < 1) v = 1;
      if (v > availableCount) v = availableCount;
      setUseFromStorageAmount(String(v));
    } else {
      let v = Number(raw);
      if (!Number.isFinite(v) || v < 0) v = 0;
      const max = Number(storageMode.available || 0);
      if (v > max) v = max;
      setUseFromStorageAmount(String(v));
    }
  };
  const totalStorageDeduct = useMemo(() => {
    const total = Number(useFromStorageAmount);
    return Number.isFinite(total) && total > 0
      ? storageMode.mode === "count" ? Math.floor(total) : total
      : 0;
  }, [useFromStorageAmount, storageMode.mode]);

  // Clamp over-consumption and show red warning
  const handleConsumeChange = (e) => {
    let v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (parentGrowId) {
      const max = Number(parentRemaining || 0);
      if (v > max) {
        setConsumeWarn(`Requested ${v} ${consumeUnit} exceeds available ${max} ${consumeUnit}. Using maximum.`);
        v = max;
        window.clearTimeout((handleConsumeChange)._t);
        (handleConsumeChange)._t = window.setTimeout(() => setConsumeWarn(""), 1800);
      } else {
        setConsumeWarn("");
      }
    }
    setConsumeFromParent(String(v));
  };

  /* ==================== RENDER ==================== */
  return (
    <>
      <style>{`
        .grow-form .label { color: #e5e7eb !important; }
        .grow-form input.input, .grow-form select.input, .grow-form textarea.input {
          background-color: #0b1220 !important; color: #f8fafc !important; border: 1px solid #475569 !important; outline: none !important;
        }
        .grow-form input::placeholder, .grow-form textarea::placeholder { color: #94a3b8 !important; opacity: 1; }
        .dark .grow-form select { color-scheme: dark; }
        .dark .grow-form option { background-color: #0b1220; color: #f8fafc; }
        .grow-form option { background-color: #ffffff; color: #111827; }
        .chipset { display: inline-flex; gap: .5rem; background: rgba(148,163,184,.1); padding: .25rem; border-radius: 9999px; }
        .chipset button { padding: .35rem .75rem; border-radius: 9999px; font-size: .875rem; }
        .chipset .active { background: #10b981; color: white; }
      `}</style>

      <form className="grow-form" onSubmit={handleSubmit}>
        {/* Parent Source Selector */}
        {mode === "create" && (
          <section className="mb-2">
            <label className="label mb-1 block">Parent Source</label>
            <div className="chipset">
              {PARENT_SOURCES.map((opt) => (
                <button
                  type="button"
                  key={opt.key}
                  className={effectiveParentSource === opt.key ? "active" : ""}
                  onClick={() => setParentSource(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Active Grow path */}
        {mode === "create" && effectiveParentSource === "grow" && (
          <section className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Parent grow</label>
              <select
                value={parentGrowId}
                onChange={(e) => setParentGrowId(e.target.value)}
                className="input"
              >
                <option value="">— Select Parent —</option>
                {parentList.map((p) => {
                  const leftPart = p.abbr ? `${p.abbr} — ` : "";
                  const label = `${leftPart}${p.strain || "(no strain)"} · ${p.type || p.growType} · ${p.stage}`;
                  return (
                    <option key={p.id} value={p.id}>{label}</option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="label">Consume from Parent</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="input flex-1"
                  placeholder="0"
                  value={consumeFromParent}
                  onChange={handleConsumeChange}
                  disabled={!parentGrowId}
                />
                <div className="w-28">
                  <label className="label">Unit</label>
                  <select className="input" value={consumeUnit} onChange={(e) => setConsumeUnit(e.target.value)} disabled>
                    {VOLUME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="text-xs mt-1 opacity-80">
                {parentGrowId
                  ? `${parentRemaining} ${consumeUnit} left${Number.isFinite(parentTotal) ? ` of ${parentTotal} ${consumeUnit}` : ""}`
                  : "Select a parent to see availability"}
              </div>
              {consumeWarn && (
                <div className="text-xs mt-1" style={{ color: "#f87171" }}>{consumeWarn}</div>
              )}
            </div>
          </section>
        )}

        {/* Storage / Library path */}
        {mode === "create" && effectiveParentSource === "library" && (
          <section className="grid sm:grid-cols-3 gap-2">
            <div className="sm:col-span-3">
              <label className="label">Storage Item</label>
              <select className="input" value={libId} onChange={(e) => setLibId(e.target.value)}>
                <option value="">— Select from Storage —</option>
                {libraryItems
                  .slice()
                  .sort((a, b) => String(a.strainName || "").localeCompare(String(b.strainName || "")))
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.type || "Item"} — {it.strainName || "Unknown"} · {it.qty ?? 0} {it.unit || "count"} left
                    </option>
                  ))}
              </select>
            </div>

            {libId && storageMode?.ok && (
              <>
                <div>
                  <label className="label">
                    {storageMode.mode === "count" ? "Items to consume (count)" : "Total to use (ml)"}
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={storageMode.mode === "count" ? 1 : 0}
                    step={storageMode.mode === "count" ? 1 : 0.1}
                    max={storageMode.mode === "count"
                        ? Math.floor(Number(storageMode.available || 0))
                        : Number(storageMode.available || 0)}
                    className="input"
                    value={useFromStorageAmount}
                    onChange={handleStorageChange}
                  />
                </div>
                <div className="flex items-end text-sm opacity-80">
                  Available: <span className="ml-1 font-semibold">{storageMode.available}</span> {storageMode.unit}
                </div>
                <div className="flex items-end text-sm opacity-80">
                  Deducting: <span className="ml-1 font-semibold">{totalStorageDeduct}</span> {storageMode.unit}
                </div>
              </>
            )}
          </section>
        )}

        {/* Type / Strain / Abbr */}
        <section className="grid sm:grid-cols-3 gap-2 mt-3">
          <div>
            <label className="label">Grow Type</label>
            <select className="input" value={growType} onChange={(e) => setGrowType(e.target.value)}>
              {GROW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Strain</label>
            {lockStrain ? (
              <input className="input" value={strain} disabled readOnly />
            ) : (
              <select
                className="input"
                value={strainId}
                onChange={(e) => setStrainId(e.target.value)}
              >
                <option value="">— Select Strain —</option>
                {(Array.isArray(strains) ? strains : [])
                  .map((s) => ({ id: s.id, label: s.name || s.strain || "Unnamed Strain" }))
                  .map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="label">Abbreviation</label>
            <input className="input" value={abbrPreview} readOnly disabled />
          </div>
        </section>

        {/* Non-bulk init */}
        {normalizeType(growType) !== "Bulk" && (
          <section className="grid sm:grid-cols-3 gap-2 mt-3">
            <div className="sm:col-span-2">
              <label className="label">Initial Volume (each child)</label>
              <input type="number" min="0" step="0.1" className="input" placeholder="0" value={ivalue} onChange={(e) => setIValue(e.target.value)} />
            </div>
            <div>
              <label className="label">Unit</label>
              <select className="input" value={ivUnit} onChange={(e) => setIvUnit(e.target.value)}>
                {VOLUME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </section>
        )}

        {/* Bulk init */}
        {normalizeType(growType) === "Bulk" && (
          <section className="grid sm:grid-cols-3 gap-2 mt-3">
            <div className="sm:col-span-2">
              <label className="label">Grain : Substrate Ratio</label>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" min="0" step="0.1" className="input" value={bulkGrainParts} onChange={(e) => setBulkGrainParts(e.target.value)} placeholder="Grain (e.g., 1)" />
                <div className="flex items-center justify-center text-sm opacity-70">:</div>
                <input type="number" min="0" step="0.1" className="input" value={bulkSubstrateParts} onChange={(e) => setBulkSubstrateParts(e.target.value)} placeholder="Substrate (e.g., 5)" />
              </div>
            </div>
            <div>
              <label className="label">Bulk Volume (each child)</label>
              <input type="number" min="0" step="0.1" className="input" value={bulkVolume} onChange={(e) => setBulkVolume(e.target.value)} placeholder="e.g., 3000" />
            </div>
            <div>
              <label className="label">Unit</label>
              <select className="input" value={bulkUnit} onChange={(e) => setBulkUnit(e.target.value)}>
                {VOLUME_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </section>
        )}

        {/* Batch / Stage / Status */}
        <section className="grid sm:grid-cols-3 gap-2 mt-3">
          {mode === "create" && (
            <div>
              <label className="label">Batch Count</label>
              <input type="number" min="1" step="1" className="input" value={batchCount} onChange={(e) => setBatchCount(e.target.value)} />
            </div>
          )}
          <div>
            <label className="label">Stage</label>
            <select className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
              {allowedStagesForType(growType).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>Active</option>
              <option>Archived</option>
              <option>Stored</option>
            </select>
          </div>
        </section>

        {/* Dates / Recipe / Cost */}
        <section className="grid sm:grid-cols-3 gap-2 mt-3">
          <div>
            <label className="label">Created Date</label>
            <input type="date" className="input" value={created} onChange={(e) => setCreated(e.target.value)} />
          </div>

          <div>
            <label className="label">Recipe</label>
            <select className="input" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
              <option value="">Optional</option>
              {recipesRanked.map((r) => <option key={r.id} value={r.id}>{r.name || "Untitled Recipe"}</option>)}
            </select>

            {recipeId ? (
              selectedRecipeScore >= 2 ? (
                <div className="text-xs mt-1 text-emerald-300">✓ Likely match for {normalizeType(growType)}</div>
              ) : selectedRecipeScore === 0 ? (
                <div className="text-xs mt-1 text-amber-300">⚠ Doesn’t look like a {normalizeType(growType)} recipe</div>
              ) : null
            ) : (
              <div className="text-xs mt-1 text-amber-300">No recipe selected</div>
            )}

            {recipeId && (
              <div className="mt-2">
                <RecipeConsumptionPreview
                  recipeId={recipeId}
                  batchCount={Number(batchCount) || 1}
                  perChildQty={normalizeType(growType) !== "Bulk" ? Number(ivalue || 0) : Number(bulkVolume || 0)}
                  perChildUnit={normalizeType(growType) !== "Bulk" ? String(ivUnit || "") : String(bulkUnit || "")}
                />
              </div>
            )}
          </div>

          <div>
            <label className="label">Cost</label>
            <input type="number" min="0" step="0.01" className="input" value={Number(cost).toFixed(2)} readOnly disabled />
          </div>
        </section>

        {/* Legacy amountAvailable editor (edit only, non-bulk) */}
        {mode === "edit" && normalizeType(growType) !== "Bulk" && (
          <section className="grid sm:grid-cols-3 gap-2 mt-3">
            <div>
              <label className="label">Amount Available (legacy) — {ivUnit}</label>
              <input type="number" min="0" step="0.1" className="input" value={amountAvailableEdit} onChange={(e) => setAmountAvailableEdit(e.target.value)} />
            </div>
            <div className="sm:col-span-2 flex items-end text-sm opacity-70">
              For older grows that still use <code>amountAvailable</code>.
            </div>
          </section>
        )}

        <div className="mt-4 flex gap-2">
          <button className="btn btn-primary" type="submit" disabled={isSubmitting}>{mode === "edit" ? "Save" : (isSubmitting ? "Creating…" : "Create")}</button>
          <button type="button" className="btn" onClick={() => onClose?.()}>Cancel</button>
        </div>
      </form>
    </>
  );
}
