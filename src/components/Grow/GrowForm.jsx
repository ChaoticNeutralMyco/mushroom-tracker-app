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

   NEW:
   - Allow consuming from MULTIPLE parent grows when creating a new grow.
   - Primary parent behaves exactly as before (stored as parentId for lineage).
   - Additional parents are tracked only for inventory (amountUsed / amountAvailable)
     using the same deduction logic as the primary parent.

   SAFEGUARDS:
   - Clamp extra-parent amounts to each parent's remaining volume.
   - Block submit if:
     * Any selected parent has 0 / negative / NaN consumption.
     * Batch consumption from any parent would exceed that parent's remaining volume.
     * In "Active Grow" mode, total parent consumption across all parents is 0.
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
import { onAuthStateChanged } from "firebase/auth";
import { db, auth } from "../../firebase-config";
import { allowedStagesForType, normalizeType } from "../../lib/growFilters";
import {
  consumeRecipeForBatch,
  reconcileRecipeChangeForGrow,
} from "../../lib/consume-supplies";
import RecipeConsumptionPreview from "./RecipeConsumptionPreview";
import { useConfirm } from "../ui/ConfirmDialog";

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
function pad2(n) {
  return String(n).padStart(2, "0");
}
function toLocalDateInputValue(d) {
  const Y = d.getFullYear();
  const M = pad2(d.getMonth() + 1);
  const D = pad2(d.getDate());
  return `${Y}-${M}-${D}`;
}
function dateFromDateInput(value) {
  return value ? new Date(`${value}T00:00:00`) : new Date();
}
function deriveAbbrFromName(name = "") {
  const words = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function maxSuffixForPrefix(existingGrows = [], prefix) {
  if (!prefix) return 0;

  const reBare = new RegExp(`^${escapeRegExp(prefix)}$`);
  const reNum = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  let max = 0;

  for (const g of existingGrows) {
    const ab = String(
      g.abbr ||
        g.abbreviation ||
        g.subName ||
        g.subname ||
        g.name ||
        ""
    );

    if (!ab) continue;

    if (reBare.test(ab)) {
      max = Math.max(max, 1);
      continue;
    }

    const m = ab.match(reNum);
    if (m) {
      const suffix = parseInt(m[1], 10);
      if (Number.isFinite(suffix)) {
        max = Math.max(max, suffix);
      }
    }
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
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/* ---------- Recipe helpers (unchanged) ---------- */
function norm(s = "") {
  return String(s || "").trim().toLowerCase();
}
function recipeType(r = {}) {
  return normalizeType(r.type || r.growType || r.category || "");
}

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
  const qty =
    Number(
      recipe?.yieldQty ??
        recipe?.yield ??
        recipe?.yieldAmount ??
        recipe?.yieldVolume ??
        recipe?.totalVolume ??
        recipe?.batchVolume ??
        recipe?.outputQty ??
        recipe?.batchQty ??
        recipe?.portions ??
        recipe?.servings ??
        0
    ) || 0;
  const unit = String(
    recipe?.yieldUnit ||
      recipe?.unit ||
      recipe?.volumeUnit ||
      recipe?.outputUnit ||
      recipe?.batchUnit ||
      ""
  );
  return { qty, unit };
}


function normalizeRecipeScope(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (
    [
      "post-production",
      "post production",
      "postproduction",
      "post-process",
      "post process",
      "postprocessing",
      "post processing",
      "post-processing",
    ].includes(raw)
  ) {
    return "post-production";
  }
  return "production";
}

function recipeUsableInGrowForm(recipe = {}) {
  return (
    normalizeRecipeScope(
      recipe?.recipeScope ||
        recipe?.scope ||
        recipe?.recipeKind ||
        recipe?.recipeType ||
        recipe?.usage ||
        ""
    ) !== "post-production"
  );
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

  const isSyringe =
    /syringe|mss|lc|liquid/.test(typeName) || unitHint === "ml";
  if (isSyringe) {
    const avail = firstFinite(
      docData.volumeMl,
      docData.ml,
      unitHint === "ml" ? docData.qty : undefined
    );
    const ok = Number.isFinite(avail);
    return {
      ok,
      mode: "volume",
      available: ok ? Math.max(0, avail) : 0,
      unit: "ml",
      typeLabel: docData.type || "Syringe",
      fieldPref: ["volumeMl", "ml", "qty"],
    };
  }

  const isCount =
    /swab|print|plate|slant|agar/.test(typeName) ||
    !unitHint ||
    unitHint === "count" ||
    unitHint === "plate";
  if (isCount) {
    const raw = firstFinite(
      docData.count,
      docData.qty,
      docData.quantity,
      docData.plates,
      docData.items
    );
    const ok = Number.isFinite(raw);
    const whole = ok ? Math.max(0, Math.floor(raw)) : 0;
    return {
      ok,
      mode: "count",
      available: whole,
      unit: unitHint || "count",
      typeLabel: docData.type || "Stored Item",
      fieldPref: ["count", "qty", "quantity"],
    };
  }
  return {
    ok: false,
    mode: "unknown",
    available: 0,
    unit: "",
    typeLabel: docData.type || "Item",
    fieldPref: [],
  };
}


function normalizeSupplyType(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";

  const compact = raw.replace(/[\s_-]+/g, "");

  if (
    new Set([
      "labconsumable",
      "labconsumables",
      "consumable",
      "consumables",
      "prepconsumable",
      "prepconsumables",
    ]).has(compact)
  ) {
    return "lab-consumable";
  }

  if (
    new Set([
      "growcontainer",
      "growcontainers",
      "spawnbag",
      "spawnbags",
    ]).has(compact)
  ) {
    return "grow-container";
  }

  if (
    new Set([
      "sanitation",
      "sanitize",
      "sanitizer",
      "sanitizers",
      "cleaning",
      "cleaner",
      "cleaners",
      "disinfectant",
      "disinfectants",
    ]).has(compact)
  ) {
    return "sanitation";
  }

  if (new Set(["container", "containers"]).has(compact)) return "container";
  if (new Set(["tool", "tools"]).has(compact)) return "tool";
  if (new Set(["labor", "labour"]).has(compact)) return "labor";
  if (new Set(["packaging", "package", "packages"]).has(compact)) return "packaging";
  if (new Set(["ingredient", "ingredients"]).has(compact)) return "ingredient";
  if (new Set(["substrate", "substrates"]).has(compact)) return "substrate";
  if (new Set(["supplement", "supplements"]).has(compact)) return "supplement";
  if (new Set(["carrier", "carriers"]).has(compact)) return "carrier";

  return raw.replace(/[\s_]+/g, "-");
}

function isCountLikeSupplyUnit(unit = "") {
  const raw = String(unit || "").trim().toLowerCase();
  if (!raw) return true;

  return new Set([
    "count",
    "counts",
    "piece",
    "pieces",
    "pc",
    "pcs",
    "item",
    "items",
    "unit",
    "units",
    "bag",
    "bags",
    "jar",
    "jars",
    "plate",
    "plates",
    "dish",
    "dishes",
    "tub",
    "tubs",
    "tray",
    "trays",
    "bottle",
    "bottles",
    "syringe",
    "syringes",
    "needle",
    "needles",
    "swab",
    "swabs",
    "pad",
    "pads",
    "wipe",
    "wipes",
    "filter",
    "filters",
    "patch",
    "patches",
    "pair",
    "pairs",
    "glove",
    "gloves",
    "cap",
    "caps",
    "lid",
    "lids",
  ]).has(raw);
}

function roundedSupplyAmount(value, unit = "") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (isCountLikeSupplyUnit(unit)) return Math.ceil(parsed);
  return Math.max(0, Number(parsed.toFixed(4)));
}

async function consumeTrackedSupply(uid, supplyId, amount, note = "") {
  if (!uid || !supplyId) return;

  const supplyRef = doc(db, "users", uid, "supplies", supplyId);
  const snap = await getDoc(supplyRef);
  if (!snap.exists()) {
    throw new Error("Tracked lab consumable no longer exists.");
  }

  const supply = snap.data() || {};
  const unit = supply.unit || "count";
  const safeAmount = roundedSupplyAmount(amount, unit);
  if (safeAmount <= 0) return;

  const before = Number(supply.quantity || 0);
  if (safeAmount > before + 1e-9) {
    const name = supply.name || "Supply";
    throw new Error(
      `${name} exceeds stock on hand. Need ${safeAmount} ${unit}, but only ${before} ${unit} remain.`
    );
  }

  const after = Math.max(0, Number((before - safeAmount).toFixed(4)));
  const unitCostApplied = Number(supply.cost || 0);
  const totalCostApplied = Number((safeAmount * unitCostApplied).toFixed(2));

  await updateDoc(supplyRef, {
    quantity: after,
    lastUpdatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, "users", uid, "supply_audits"), {
    supplyId,
    action: "consume",
    amount: safeAmount,
    note: note || "",
    unit,
    unitCostApplied: Number.isFinite(unitCostApplied) ? unitCostApplied : null,
    totalCostApplied: Number.isFinite(totalCostApplied) ? totalCostApplied : null,
    timestamp: new Date().toISOString(),
  });
}


function normalizeSavedConsumables(source = []) {
  if (!Array.isArray(source)) return [];
  return source
    .map((row) => {
      if (!row?.supplyId) return null;
      const amountRaw =
        row?.amountPerGrow ?? row?.amount ?? row?.deductedAmount ?? row?.qty ?? 0;
      const totalRaw =
        row?.totalCostPerGrow ?? row?.totalCost ?? row?.costTotal ?? row?.cost ?? null;
      const unitCostRaw = row?.unitCost ?? row?.unitPrice ?? row?.costPerUnit ?? null;
      const amount = Number(amountRaw);
      const totalCost = Number(totalRaw);
      const unitCost = Number(unitCostRaw);
      return {
        supplyId: row.supplyId,
        name: row.name || row.supplyName || "Unnamed Supply",
        type: row.type || row.supplyType || "",
        unit: row.unit || row.supplyUnit || "count",
        amount: Number.isFinite(amount) ? amount : 0,
        totalCost: Number.isFinite(totalCost) ? totalCost : null,
        unitCost: Number.isFinite(unitCost) ? unitCost : null,
        batchAmount: Number.isFinite(Number(row?.batchAmount))
          ? Number(row.batchAmount)
          : null,
        batchTotalCost: Number.isFinite(Number(row?.batchTotalCost))
          ? Number(row.batchTotalCost)
          : null,
        allocationCount: Number.isFinite(Number(row?.allocationCount))
          ? Number(row.allocationCount)
          : null,
      };
    })
    .filter(Boolean);
}

function fallbackLegacyConsumables(grow = {}, suppliesMap = new Map()) {
  const out = [];
  const legacyAmount = Number(grow?.syringesUsedTotal || 0);
  if (grow?.syringeSupplyId && Number.isFinite(legacyAmount) && legacyAmount > 0) {
    const supply = suppliesMap.get(grow.syringeSupplyId);
    out.push({
      supplyId: grow.syringeSupplyId,
      name: supply?.name || "Syringe",
      type: supply?.type || "lab-consumable",
      unit: supply?.unit || "syringe",
      amount: legacyAmount,
      totalCost: Number.isFinite(Number(grow?.labConsumablesCost))
        ? Number(grow.labConsumablesCost)
        : null,
      unitCost: Number.isFinite(Number(supply?.cost)) ? Number(supply.cost) : null,
      batchAmount: null,
      batchTotalCost: null,
      allocationCount: null,
    });
  }
  return out;
}

function getSavedConsumablesForGrow(grow = {}, suppliesMap = new Map()) {
  const saved = normalizeSavedConsumables(grow?.labConsumablesUsed);
  if (saved.length) return saved;
  return fallbackLegacyConsumables(grow, suppliesMap);
}

function sumConsumablesCost(rows = [], suppliesMap = new Map()) {
  return Number(
    rows
      .reduce((sum, row) => {
        const amount = Number(row?.amount || 0);
        const directTotal = Number(row?.totalCost);
        if (Number.isFinite(directTotal)) return sum + directTotal;
        const directUnitCost = Number(row?.unitCost);
        if (Number.isFinite(directUnitCost)) return sum + directUnitCost * amount;
        const liveUnitCost = Number(
          row?.supplyId && suppliesMap.has(row.supplyId)
            ? suppliesMap.get(row.supplyId)?.cost
            : 0
        );
        return sum + (Number.isFinite(liveUnitCost) ? liveUnitCost : 0) * amount;
      }, 0)
      .toFixed(2)
  );
}

function buildInitialConsumableSelections(grow = {}, suppliesMap = new Map()) {
  const selections = {};
  const rows = getSavedConsumablesForGrow(grow, suppliesMap);
  rows.forEach((row) => {
    if (!row?.supplyId) return;
    const amount = Number.isFinite(Number(row?.batchAmount))
      ? Number(row.batchAmount)
      : Number(row?.amount || 0);
    selections[row.supplyId] = {
      enabled: true,
      amount: Number.isFinite(amount) && amount > 0 ? String(amount) : "",
    };
  });
  return selections;
}

/* ==================== COMPONENT ==================== */
export default function GrowForm(props) {
  const {
    editingGrow = null,
    onSaveComplete = () => {},
    onClose = () => {},
    strains = [],
    grows = [],
    recipes,
    supplies,
    onCreateGrow,
    onUpdateGrow,
  } = props;

  const confirm = useConfirm();
  const hasRecipesProp = Object.prototype.hasOwnProperty.call(props || {}, "recipes");
  const hasSuppliesProp = Object.prototype.hasOwnProperty.call(props || {}, "supplies");

  const [uid, setUid] = useState(() => auth.currentUser?.uid || null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid || null));
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, []);

  const mode = editingGrow && editingGrow.id ? "edit" : "create";

  /* ---- Parent Source ---- */
  const cameFromLibrary =
    editingGrow?.parentSource === "Library" && editingGrow?.parentId;
  const [parentSource, setParentSource] = useState(
    cameFromLibrary ? "library" : "grow"
  );
  const isSubmittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formNotice, setFormNotice] = useState(null);
  const effectiveParentSource = parentSource;

  /* ---- Basics ---- */
  const [growType, setGrowType] = useState(
    editingGrow?.type || editingGrow?.growType || "Agar"
  );
  const [strainId, setStrainId] = useState(editingGrow?.strainId || "");
  const [strain, setStrain] = useState(
    editingGrow?.strain || editingGrow?.strainName || ""
  );

  const strainNameById = useMemo(() => {
    const map = new Map();
    (Array.isArray(strains) ? strains : []).forEach((s) =>
      map.set(s.id, s.name || s.strain || "Unnamed Strain")
    );
    return map;
  }, [strains]);

  const [batchCount, setBatchCount] = useState(1);
  const [stage, setStage] = useState(editingGrow?.stage || DEFAULT_STAGE);
  const [status, setStatus] = useState(editingGrow?.status || DEFAULT_STATUS);

  const [created, setCreated] = useState(() => {
    const d = toDateAny(editingGrow?.createdAt) || new Date();
    return toLocalDateInputValue(d);
  });

  /* ---- Recipes & Supplies ---- */
  const [localRecipes, setLocalRecipes] = useState(() =>
    hasRecipesProp && Array.isArray(recipes) ? recipes : []
  );
  const [localSupplies, setLocalSupplies] = useState(() =>
    hasSuppliesProp && Array.isArray(supplies) ? supplies : []
  );

  useEffect(() => {
    if (hasRecipesProp) {
      setLocalRecipes(Array.isArray(recipes) ? recipes : []);
    }
  }, [hasRecipesProp, recipes]);

  useEffect(() => {
    if (hasSuppliesProp) {
      setLocalSupplies(Array.isArray(supplies) ? supplies : []);
    }
  }, [hasSuppliesProp, supplies]);

  useEffect(() => {
    if (!uid) return undefined;
    if (hasRecipesProp && hasSuppliesProp) return undefined;

    let cancelled = false;

    (async () => {
      try {
        if (!hasRecipesProp && !localRecipes.length) {
          const snap = await getDocs(collection(db, "users", uid, "recipes"));
          if (!cancelled) {
            setLocalRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          }
        }

        if (!hasSuppliesProp && !localSupplies.length) {
          const snap = await getDocs(collection(db, "users", uid, "supplies"));
          if (!cancelled) {
            setLocalSupplies(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load GrowForm recipes/supplies:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    uid,
    hasRecipesProp,
    hasSuppliesProp,
    localRecipes.length,
    localSupplies.length,
  ]);

  const suppliesMap = useMemo(() => {
    const m = new Map();
    for (const s of localSupplies) m.set(s.id, s);
    return m;
  }, [localSupplies]);

  const [recipeId, setRecipeId] = useState(editingGrow?.recipeId || "");
  const [recipeName, setRecipeName] = useState(
    editingGrow?.recipe || editingGrow?.recipeName || ""
  );
  const [cost, setCost] = useState(
    Number.isFinite(Number(editingGrow?.recipeCost))
      ? Number(editingGrow.recipeCost)
      : Number.isFinite(Number(editingGrow?.cost))
      ? Number(editingGrow.cost)
      : 0
  );
  const [consumableSelections, setConsumableSelections] = useState({});

  useEffect(() => {
    if (mode === "edit") {
      setConsumableSelections(
        buildInitialConsumableSelections(editingGrow, suppliesMap)
      );
      return;
    }
    setConsumableSelections({});
  }, [mode, editingGrow?.id]);


  /* ---- Volumes ---- */
  const [ivalue, setIValue] = useState(
    editingGrow?.amountTotal ?? editingGrow?.initialVolume ?? ""
  );
  const [ivUnit, setIvUnit] = useState(
    editingGrow?.amountUnit ||
      editingGrow?.volumeUnit ||
      (normalizeType(growType) === "Bulk" ? "g" : "ml")
  );
  const [amountAvailableEdit, setAmountAvailableEdit] = useState(
    editingGrow?.amountAvailable ?? ""
  );
  const [bulkGrainParts, setBulkGrainParts] = useState(
    editingGrow?.bulkGrainParts ?? 1
  );
  const [bulkSubstrateParts, setBulkSubstrateParts] = useState(
    editingGrow?.bulkSubstrateParts ?? 5
  );
  const [bulkVolume, setBulkVolume] = useState(
    editingGrow?.bulkVolume ?? ""
  );
  const [bulkUnit, setBulkUnit] = useState(
    editingGrow?.bulkVolumeUnit || "g"
  );

  /* ---- Parent grow (Active Grow) ---- */
  const [parentGrowId, setParentGrowId] = useState("");
  const [consumeFromParent, setConsumeFromParent] = useState("");
  const [consumeUnit, setConsumeUnit] = useState("ml");
  const [parentList, setParentList] = useState([]);
  const [extraParents, setExtraParents] = useState([]);
  const [extraParentErrors, setExtraParentErrors] = useState([]);

  const [parentRemaining, setParentRemaining] = useState(0);
  const [parentTotal, setParentTotal] = useState(null);
  const [consumeWarn, setConsumeWarn] = useState("");

  /* ---- Library/Storage picker ---- */
  const [libraryItems, setLibraryItems] = useState([]);
  const [libId, setLibId] = useState(
    cameFromLibrary ? String(editingGrow.parentId) : ""
  );
  const [storageDoc, setStorageDoc] = useState(null);
  const [storageMode, setStorageMode] = useState({
    ok: false,
    mode: "unknown",
    available: 0,
    unit: "",
    typeLabel: "",
    fieldPref: [],
  });
  const [useFromStorageAmount, setUseFromStorageAmount] = useState("");

  const strainLockedByRecord =
    Boolean(editingGrow?.fromStorage) ||
    Boolean(editingGrow?.lockStrain) ||
    cameFromLibrary;

  const sourceLocksStrain =
    effectiveParentSource === "grow"
      ? Boolean(parentGrowId) || extraParents.some((p) => p?.parentId)
      : effectiveParentSource === "library"
      ? Boolean(libId)
      : false;

  useEffect(() => {
    if (strainLockedByRecord || sourceLocksStrain) return;
    setStrain(strainId ? strainNameById.get(strainId) || "" : "");
  }, [strainId, strainNameById, strainLockedByRecord, sourceLocksStrain]);

  useEffect(() => {
    if (mode !== "create") return;

    if (effectiveParentSource === "grow") {
      setLibId("");
      setStorageDoc(null);
      setStorageMode({
        ok: false,
        mode: "unknown",
        available: 0,
        unit: "",
        typeLabel: "",
        fieldPref: [],
      });
      setUseFromStorageAmount("");
    } else if (effectiveParentSource === "library") {
      setParentGrowId("");
      setConsumeFromParent("");
      setConsumeWarn("");
      setExtraParents([]);
      setExtraParentErrors([]);
      setParentRemaining(0);
      setParentTotal(null);
    }
  }, [mode, effectiveParentSource]);

  useEffect(() => {
    if (effectiveParentSource !== "library" || !uid) {
      if (effectiveParentSource !== "library") {
        setLibraryItems([]);
        setStorageDoc(null);
        setStorageMode({
          ok: false,
          mode: "unknown",
          available: 0,
          unit: "",
          typeLabel: "",
          fieldPref: [],
        });
      }
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(collection(db, "users", uid, "library"));
        if (cancelled) return;
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const active = rows.filter((it) => {
          const qty = Number(it?.qty || 0);
          const archivedish =
            !!it?.archived ||
            String(it?.status || "").toLowerCase() === "archived";
          return qty > 0 && !archivedish;
        });
        setLibraryItems(active);
        if (cameFromLibrary && editingGrow?.parentId) {
          setLibId(String(editingGrow.parentId));
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load library items:", err);
          setLibraryItems([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveParentSource, uid, cameFromLibrary, editingGrow]);

  useEffect(() => {
    if (effectiveParentSource !== "library" || !libId) {
      setStorageDoc(null);
      setStorageMode({ ok: false, mode: "unknown", available: 0, unit: "" });
      return;
    }
    const it = (libraryItems || []).find(
      (i) => String(i.id) === String(libId)
    );
    if (!it) {
      setStorageDoc(null);
      setStorageMode({ ok: false, mode: "unknown", available: 0, unit: "" });
      return;
    }
    setStorageDoc(it);
    const modeInfo = storageAvailabilityOf({
      ...it,
      qty: it.qty,
      unit: it.unit,
      type: it.type,
    });
    setStorageMode(modeInfo);
    setUseFromStorageAmount("1");
    if (it.strainName) setStrain(it.strainName);
  }, [libId, libraryItems, effectiveParentSource]);

  const lockStrain = strainLockedByRecord || sourceLocksStrain;

  const stageOptions = allowedStagesForType(growType);

  useEffect(() => {
    const isBulk = normalizeType(growType) === "Bulk";
    if (isBulk) setIValue("");
    if (!stageOptions.includes(stage)) setStage(DEFAULT_STAGE);
  }, [growType]); // eslint-disable-line

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

  const growUsableRecipes = useMemo(
    () => recipesRanked.filter((recipe) => recipeUsableInGrowForm(recipe)),
    [recipesRanked]
  );

  const selectedRecipe = useMemo(
    () => (recipeId ? recipesRanked.find((r) => r.id === recipeId) : null),
    [recipesRanked, recipeId]
  );
  const selectedRecipeScore = useMemo(
    () => (selectedRecipe ? recipeMatchScore(selectedRecipe, growType) : 0),
    [selectedRecipe, growType]
  );
  const selectedRecipeScope = useMemo(
    () =>
      normalizeRecipeScope(
        selectedRecipe?.recipeScope ||
          selectedRecipe?.scope ||
          selectedRecipe?.recipeKind ||
          selectedRecipe?.recipeType ||
          selectedRecipe?.usage ||
          ""
      ),
    [selectedRecipe]
  );

  const trackedConsumableOptions = useMemo(() => {
    return [...(Array.isArray(localSupplies) ? localSupplies : [])]
      .filter((supply) => normalizeSupplyType(supply?.type) === "lab-consumable")
      .sort((a, b) =>
        String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
          sensitivity: "base",
        })
      );
  }, [localSupplies]);

  const enabledConsumableRows = useMemo(() => {
    return trackedConsumableOptions
      .filter((supply) => consumableSelections?.[supply.id]?.enabled)
      .map((supply) => {
        const rawAmount = consumableSelections?.[supply.id]?.amount;
        const enteredAmount = Number(rawAmount);
        const deductAmount = roundedSupplyAmount(
          enteredAmount,
          supply.unit || "count"
        );
        const unitCost = Number(supply?.cost || 0);
        const totalCost = Number((deductAmount * unitCost).toFixed(2));
        const available = Number(supply?.quantity || 0);
        return {
          supplyId: supply.id,
          name: supply.name || "Unnamed Supply",
          type: supply.type || "",
          unit: supply.unit || "count",
          enteredAmount,
          deductAmount,
          unitCost,
          totalCost,
          available,
        };
      });
  }, [trackedConsumableOptions, consumableSelections]);

  const invalidConsumableRows = useMemo(
    () =>
      enabledConsumableRows.filter(
        (row) => !Number.isFinite(row.enteredAmount) || row.deductAmount <= 0
      ),
    [enabledConsumableRows]
  );

  const overConsumableRows = useMemo(
    () =>
      enabledConsumableRows.filter(
        (row) => row.deductAmount > row.available + 1e-9
      ),
    [enabledConsumableRows]
  );

  const batchConsumablesCost = useMemo(
    () =>
      Number(
        enabledConsumableRows
          .reduce((sum, row) => sum + row.totalCost, 0)
          .toFixed(2)
      ),
    [enabledConsumableRows]
  );

  const savedConsumableRows = useMemo(
    () => getSavedConsumablesForGrow(editingGrow, suppliesMap),
    [editingGrow, suppliesMap]
  );

  const savedConsumablesCost = useMemo(() => {
    const inline = Number(editingGrow?.labConsumablesCost);
    if (Number.isFinite(inline)) return inline;
    return sumConsumablesCost(savedConsumableRows, suppliesMap);
  }, [editingGrow, savedConsumableRows, suppliesMap]);

  const labConsumablesCost = useMemo(() => {
    if (mode === "create") {
      const count = Math.max(1, Number(batchCount || 1));
      return Number((batchConsumablesCost / count).toFixed(2));
    }
    return Number(savedConsumablesCost.toFixed(2));
  }, [mode, batchCount, batchConsumablesCost, savedConsumablesCost]);

  const totalCost = useMemo(
    () =>
      Number(
        (Number(cost || 0) + Number(labConsumablesCost || 0)).toFixed(2)
      ),
    [cost, labConsumablesCost]
  );

  const perGrowAllocatedConsumables = useMemo(() => {
    const count = Math.max(1, Number(batchCount || 1));
    return enabledConsumableRows.map((row) => ({
      supplyId: row.supplyId,
      name: row.name,
      type: row.type,
      unit: row.unit,
      amount: Number((row.deductAmount / count).toFixed(4)),
      totalCost: Number((row.totalCost / count).toFixed(2)),
      unitCost: Number(row.unitCost || 0),
      batchAmount: row.deductAmount,
      batchTotalCost: row.totalCost,
      allocationCount: count,
    }));
  }, [enabledConsumableRows, batchCount]);


  useEffect(() => {
    if (!selectedRecipe) {
      setRecipeName("");
      setCost(0);
      return;
    }
    setRecipeName(selectedRecipe.name || "");
    const totalBatchCost = computeRecipeTotalCost(selectedRecipe, suppliesMap);
    const { qty: yieldQty, unit: yieldUnitRaw } =
      getRecipeYield(selectedRecipe);
    const yieldUnit = (yieldUnitRaw || "").toLowerCase();
    let perGrowCost = totalBatchCost;
    if (yieldQty > 0) {
      if (normalizeType(growType) !== "Bulk") {
        const vol = Number(ivalue || 0);
        const unit = (ivUnit || "").toLowerCase();
        perGrowCost =
          vol > 0 && unit && yieldUnit && unit === yieldUnit
            ? totalBatchCost * (vol / yieldQty)
            : totalBatchCost / yieldQty;
      } else {
        const vol = Number(bulkVolume || 0);
        const unit = (bulkUnit || "").toLowerCase();
        perGrowCost =
          vol > 0 && unit && yieldUnit && unit === yieldUnit
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
    const user = auth.currentUser;
    if (!user) throw new Error("Missing user");
    const ref = await addDoc(
      collection(db, "users", user.uid, "grows"),
      payload
    );
    return ref.id;
  };
  const patchGrow = async (id, patch) => {
    if (!id) return;
    if (typeof onUpdateGrow === "function")
      return await onUpdateGrow(id, patch);
    const user = auth.currentUser;
    if (!user) throw new Error("Missing user");
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

  /* ---- Submit ---- */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      setFormNotice(null);
      if (!growType) throw new Error("Please choose a grow type.");
      if (!strain) throw new Error("Please choose a strain.");
      if (!stage) throw new Error("Please choose a stage.");

      if (recipeId && selectedRecipeScope === "post-production") {
        throw new Error(
          "The selected recipe is marked Post Production and cannot be used in GrowForm."
        );
      }

      if (!recipeId || selectedRecipeScore === 0) {
        const t = normalizeType(growType);
        const msg = !recipeId
          ? `No recipe is selected for ${t}. Continue anyway?`
          : `The selected recipe doesn’t look like a ${t} recipe. Continue anyway?`;
        if (
          !(await confirm({
            message: msg,
            confirmLabel: "Continue",
            cancelLabel: "Go back",
          }))
        )
          return;
      }

      let storageUsageTotal = 0;
      if (mode === "create" && effectiveParentSource === "library") {
        if (!libId) throw new Error("Select a storage item.");
        if (!storageMode?.ok)
          throw new Error("Selected storage item is invalid.");
        const available = Number(storageMode.available || 0);
        if (storageMode.mode === "count") {
          const maxCount = Math.floor(available);
          let v = parseInt(String(useFromStorageAmount), 10);
          if (!Number.isFinite(v)) v = 0;
          if (v < 1)
            throw new Error("Items to consume must be a whole number ≥ 1.");
          if (v > maxCount)
            throw new Error(`You only have ${maxCount} in storage.`);
          storageUsageTotal = v;
        } else {
          const v = Number(useFromStorageAmount);
          if (!Number.isFinite(v) || v <= 0)
            throw new Error(
              `Enter how much to use from storage (${storageMode.unit}).`
            );
          if (available > 0 && v > available + 1e-9)
            throw new Error(
              `Requested ${v} ${storageMode.unit} exceeds available ${available} ${storageMode.unit}.`
            );
          storageUsageTotal = v;
        }
      }

      const batch = Math.max(1, Number(batchCount || 1));

      if (mode === "create" && effectiveParentSource === "grow") {
        let totalParentUse = 0;

        const primaryPerChild = parentGrowId
          ? Number(consumeFromParent || 0)
          : 0;

        if (parentGrowId) {
          if (!Number.isFinite(primaryPerChild) || primaryPerChild <= 0) {
            throw new Error(
              "You selected a primary parent but entered 0 to consume. Enter a positive amount or clear the parent."
            );
          }

          const parent =
            (parentList || []).find((p) => p.id === parentGrowId) || null;
          if (!parent) {
            throw new Error(
              "Selected primary parent grow is no longer available."
            );
          }

          const total = Number(parent.amountTotal);
          const used = Number(parent.amountUsed);
          const remNew =
            Number.isFinite(total) && total > 0
              ? Math.max(0, total - (Number.isFinite(used) ? used : 0))
              : null;
          const remLegacy = Number(parent.amountAvailable);
          const remaining = Number.isFinite(remNew)
            ? remNew
            : Number.isFinite(remLegacy)
            ? remLegacy
            : 0;
          const unit = parent.amountUnit || parent.volumeUnit || consumeUnit || "ml";

          if (remaining <= 0) {
            throw new Error(
              "Selected primary parent has no remaining volume to consume."
            );
          }

          const totalUse = primaryPerChild * batch;
          if (totalUse > remaining + 1e-9) {
            throw new Error(
              `Batch would consume ${totalUse.toFixed(
                2
              )} ${unit}, but only ${remaining.toFixed(
                2
              )} ${unit} remain in the primary parent. Lower the per-child amount or batch count.`
            );
          }

          totalParentUse += totalUse;
        }

        const effectiveExtras = (extraParents || []).filter(
          (row) => row.parentId
        );

        for (const row of effectiveExtras) {
          const perChild = Number(row.amount || 0);
          if (!Number.isFinite(perChild) || perChild <= 0) {
            throw new Error(
              "Each additional parent that is selected must consume a positive amount."
            );
          }

          const parent =
            (parentList || []).find((p) => p.id === row.parentId) || null;
          if (!parent) {
            throw new Error(
              "One of the additional parents is no longer available. Refresh and try again."
            );
          }

          const total = Number(parent.amountTotal);
          const used = Number(parent.amountUsed);
          const remNew =
            Number.isFinite(total) && total > 0
              ? Math.max(0, total - (Number.isFinite(used) ? used : 0))
              : null;
          const remLegacy = Number(parent.amountAvailable);
          const remaining = Number.isFinite(remNew)
            ? remNew
            : Number.isFinite(remLegacy)
            ? remLegacy
            : 0;
          const unit = parent.amountUnit || parent.volumeUnit || "ml";

          if (remaining <= 0) {
            throw new Error(
              `Additional parent “${
                parent.abbr || parent.strain || parent.id
              }” has no remaining volume to consume.`
            );
          }

          const totalUse = perChild * batch;
          if (totalUse > remaining + 1e-9) {
            throw new Error(
              `Additional parent “${
                parent.abbr || parent.strain || parent.id
              }” would be over-consumed: batch would use ${totalUse.toFixed(
                2
              )} ${unit}, but only ${remaining.toFixed(
                2
              )} ${unit} remain.`
            );
          }

          totalParentUse += totalUse;
        }

        if (totalParentUse <= 0) {
          throw new Error(
            "No volume is being consumed from any parent. Enter a positive amount from at least one parent, or switch to the Storage source."
          );
        }
      }

      if (mode === "create") {
        if (invalidConsumableRows.length > 0) {
          const names = invalidConsumableRows.map((row) => row.name).join(", ");
          throw new Error(
            `Enter a quantity greater than 0 for each checked lab consumable: ${names}.`
          );
        }
        if (overConsumableRows.length > 0) {
          const first = overConsumableRows[0];
          throw new Error(
            `${first.name} exceeds stock on hand. Need ${first.deductAmount} ${first.unit}, but only ${first.available} ${first.unit} remain.`
          );
        }
      }

      const createdAt = created ? dateFromDateInput(created) : new Date();
      const recipeCostNum = Number.isFinite(Number(cost)) ? Number(cost) : 0;
      const labConsumablesCostNum =
        mode === "create"
          ? Number(labConsumablesCost || 0)
          : Number(savedConsumablesCost || 0);
      const totalCostNum = Number(
        (recipeCostNum + labConsumablesCostNum).toFixed(2)
      );
      const isBulkNow = normalizeType(growType) === "Bulk";

      let parentContributions = [];

      if (mode === "create") {
        if (effectiveParentSource === "grow") {
          const primaryPerChild = parentGrowId
            ? Number(consumeFromParent || 0)
            : 0;

          if (
            parentGrowId &&
            Number.isFinite(primaryPerChild) &&
            primaryPerChild > 0
          ) {
            const parent =
              (parentList || []).find((p) => p.id === parentGrowId) || {};
            const unit =
              parent.amountUnit ||
              parent.volumeUnit ||
              consumeUnit ||
              "ml";
            parentContributions.push({
              parentId: parentGrowId,
              amount: primaryPerChild,
              unit,
              source: "Grow",
            });
          }

          const effectiveExtras = (extraParents || []).filter(
            (row) => row && row.parentId
          );
          for (const row of effectiveExtras) {
            const perChild = Number(row.amount || 0);
            if (!Number.isFinite(perChild) || perChild <= 0) continue;
            const parent =
              (parentList || []).find((p) => p.id === row.parentId) || {};
            const unit =
              parent.amountUnit ||
              parent.volumeUnit ||
              consumeUnit ||
              "ml";
            parentContributions.push({
              parentId: row.parentId,
              amount: perChild,
              unit,
              source: "Grow",
            });
          }
        }

        const baseCommon = {
          type: growType,
          strain,
          strainId: strainId || "",
          stage,
          status,
          recipe: recipeName || "",
          recipeId: recipeId || "",
          recipeCost: recipeCostNum,
          labConsumablesCost: labConsumablesCostNum,
          cost: totalCostNum,
          createdAt,
          parentSource:
            effectiveParentSource === "library" ? "Library" : "Grow",
          parentId:
            effectiveParentSource === "library"
              ? libId
              : parentGrowId || null,
          parentType:
            effectiveParentSource === "library"
              ? storageDoc?.type || null
              : null,
          ...(parentContributions.length ? { parentContributions } : {}),
          ...(perGrowAllocatedConsumables.length
            ? { labConsumablesUsed: perGrowAllocatedConsumables }
            : {}),
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

        const count = batch;
        const prefix = abbrPrefix(strain, growType, created);
        const existingMax = maxSuffixForPrefix(grows, prefix);

        const createPayloads = [];
        for (let i = 0; i < count; i++) {
          const payload = { ...baseCommon };
          payload.abbr =
            existingMax === 0
              ? i === 0
                ? prefix
                : `${prefix}-${i + 1}`
              : `${prefix}-${existingMax + i + 1}`;
          createPayloads.push(payload);
        }
        await Promise.all(createPayloads.map((p) => createGrow(p)));

        if (effectiveParentSource === "grow" && parentGrowId) {
          const consume = Number(consumeFromParent || 0);
          if (consume > 0) {
            const parent =
              (parentList || []).find((p) => p.id === parentGrowId) || {};
            const pTotal = Number(parent.amountTotal);
            const pUsed = Number(parent.amountUsed);
            const hasNewModel =
              Number.isFinite(pTotal) && pTotal > 0;
            const totalParentUse = consume * count;
            if (hasNewModel) {
              const nextUsed = Math.min(
                pTotal,
                (Number.isFinite(pUsed) ? pUsed : 0) + totalParentUse
              );
              await patchGrow(parentGrowId, { amountUsed: nextUsed });
            } else {
              const avail = Number(parent.amountAvailable);
              const nextAvail = Math.max(0, avail - totalParentUse);
              await patchGrow(parentGrowId, { amountAvailable: nextAvail });
            }
          }
        }

        if (effectiveParentSource === "grow" && extraParents.length) {
          for (const row of extraParents) {
            const pId = row.parentId;
            const perChild = Number(row.amount || 0);
            if (!pId || !perChild || perChild <= 0) continue;

            const parent =
              (parentList || []).find((p) => p.id === pId) || {};
            const pTotal = Number(parent.amountTotal);
            const pUsed = Number(parent.amountUsed);
            const hasNewModel =
              Number.isFinite(pTotal) && pTotal > 0;
            const totalParentUse = perChild * count;

            if (hasNewModel) {
              const nextUsed = Math.min(
                pTotal,
                (Number.isFinite(pUsed) ? pUsed : 0) + totalParentUse
              );
              await patchGrow(pId, { amountUsed: nextUsed });
            } else {
              const avail = Number(parent.amountAvailable);
              const nextAvail = Math.max(0, avail - totalParentUse);
              await patchGrow(pId, { amountAvailable: nextAvail });
            }
          }
        }

        try {
          const user = auth.currentUser;
          if (user && recipeId) {
            const perChildQty = !isBulkNow
              ? Number(ivalue || 0)
              : Number(bulkVolume || 0);
            const perChildUnit = !isBulkNow
              ? String(ivUnit || "")
              : String(bulkUnit || "");
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

        if (enabledConsumableRows.length > 0) {
          try {
            const user = auth.currentUser;
            if (user) {
              for (const row of enabledConsumableRows) {
                await consumeTrackedSupply(
                  user.uid,
                  row.supplyId,
                  row.deductAmount,
                  `Grow-form lab consumable usage for ${count > 1 ? `${prefix} × ${count}` : prefix}`
                );
              }
            }
          } catch (supplyErr) {
            console.error("Lab consumable deduction (non-fatal):", supplyErr);
            await confirm.alert({
              title: "Consumable deduction needs review",
              message:
                `Grows were created, but one or more lab consumables were not deducted.

${
                  supplyErr?.message || "Please adjust the COG inventory manually."
                }`,
              confirmLabel: "OK",
            });
          }
        }

        if (effectiveParentSource === "library" && libId && storageMode?.ok) {
          const user = auth.currentUser;
          if (!user) throw new Error("Missing user");
          const libRef = doc(db, "users", user.uid, "library", libId);
          const snap = await getDoc(libRef);
          if (snap.exists()) {
            const data = snap.data() || {};
            const prevQty = Number(data.qty || 0);
            let deduct = Number(storageUsageTotal || 0);
            const typeName = String(data.type || "").toLowerCase();
            if (
              /print/.test(typeName) &&
              deduct > 1 &&
              deduct <= 100 &&
              storageMode?.mode === "count"
            ) {
              deduct = deduct / 100;
            }
            const nextQty = Math.max(
              0,
              prevQty - (Number.isFinite(deduct) ? deduct : 0)
            );
            await updateDoc(libRef, {
              qty: nextQty,
              updatedAt: serverTimestamp(),
            });
          }
        }

        onSaveComplete?.();
        onClose?.();
        return;
      }

      const user = auth.currentUser;
      if (!user) throw new Error("Missing user");
      const currentRef = doc(db, "users", user.uid, "grows", editingGrow.id);
      const currentSnap = await getDoc(currentRef);
      const currentGrow = currentSnap.exists()
        ? { id: currentSnap.id, ...currentSnap.data() }
        : editingGrow;

      const prevType = normalizeType(
        currentGrow?.type || currentGrow?.growType || ""
      );
      const nextType = normalizeType(growType);

      const prevRecipeId = currentGrow?.recipeId || "";
      const nextRecipeId = recipeId || "";

      const prevQty = Number.isFinite(Number(currentGrow?.amountTotal))
        ? Number(currentGrow.amountTotal)
        : Number(currentGrow?.initialVolume || 0);
      const prevUnit =
        currentGrow?.amountUnit ||
        currentGrow?.volumeUnit ||
        (prevType === "Bulk" ? "g" : "ml");

      const nextQty =
        normalizeType(growType) !== "Bulk"
          ? Number(ivalue || 0)
          : Number(bulkVolume || 0);
      const nextUnit =
        normalizeType(growType) !== "Bulk"
          ? String(ivUnit || "")
          : String(bulkUnit || "");

      const shouldReconcile =
        prevRecipeId !== nextRecipeId ||
        prevType !== nextType ||
        (Number.isFinite(prevQty) &&
          Number.isFinite(nextQty) &&
          (prevQty !== nextQty ||
            (prevUnit || "") !== (nextUnit || "")));

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
          setFormNotice({ tone: "warning", message: "Inventory reconcile failed. The grow saved, but recipe inventory was not fully reconciled." });
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
        recipeCost: Number.isFinite(recipeCostNum) ? recipeCostNum : 0,
        labConsumablesCost: Number.isFinite(labConsumablesCostNum)
          ? labConsumablesCostNum
          : 0,
        cost: Number.isFinite(totalCostNum) ? totalCostNum : 0,
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

      const tsFieldEdit = stageTimestampField[stage];
      if (tsFieldEdit) patch[tsFieldEdit] = createdAt;

      await patchGrow(currentGrow.id, patch);
      onSaveComplete?.();
      onClose?.();
    } catch (err) {
      console.error(err);
      setFormNotice({ tone: "error", message: err?.message || "Failed to save grow." });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  /* ---- Lists + helpers ---- */
  useEffect(() => {
    const src = Array.isArray(grows) ? grows : [];

    const activeWithRemaining = src.filter((g) => {
      const s = (g.status || "Active").toLowerCase();
      if (s !== "active") return false;

      const total = Number(g.amountTotal);
      const used = Number(g.amountUsed);

      const remNew =
        Number.isFinite(total) && total > 0
          ? Math.max(0, total - (Number.isFinite(used) ? used : 0))
          : null;

      const remLegacy = Number(g.amountAvailable);
      const remaining = Number.isFinite(remNew)
        ? remNew
        : Number.isFinite(remLegacy)
        ? remLegacy
        : 0;

      return remaining > 0;
    });

    const limited = activeWithRemaining.filter((g) => {
      const t = normalizeType(g.type || g.growType || "");
      if (t === "Bulk") return false;
      return String(g.stage) === "Colonized";
    });

    const sorted = [...limited].sort((a, b) => {
      const aStr = String(a.strain || "").toLowerCase();
      const bStr = String(b.strain || "").toLowerCase();
      if (aStr !== bStr) return aStr.localeCompare(bStr);

      const aAbbr = String(a.abbr || a.subName || "").toLowerCase();
      const bAbbr = String(b.abbr || b.subName || "").toLowerCase();
      if (aAbbr !== bAbbr) return aAbbr.localeCompare(bAbbr);

      const aDate = toDateAny(a.createdAt)?.getTime() ?? 0;
      const bDate = toDateAny(b.createdAt)?.getTime() ?? 0;
      return aDate - bDate;
    });

    setParentList(sorted);
  }, [grows]);

  useEffect(() => {
    if (mode !== "edit") return;
    if (!editingGrow) return;
    if (!Array.isArray(editingGrow.parentContributions)) return;
    if (!editingGrow.parentContributions.length) return;
    if (!parentList || !parentList.length) return;
    if (parentGrowId || (extraParents && extraParents.length)) return;

    const contribs = editingGrow.parentContributions.filter(
      (c) => c && c.parentId
    );
    if (!contribs.length) return;

    const hasParentInList = (pid) =>
      !!(parentList || []).find((p) => p.id === pid);

    const primaryIdFromDoc =
      editingGrow.parentGrowId || editingGrow.parentId || null;

    let primaryEntry =
      (primaryIdFromDoc &&
        contribs.find((c) => c.parentId === primaryIdFromDoc)) ||
      null;

    if (!primaryEntry || !hasParentInList(primaryEntry.parentId)) {
      primaryEntry =
        contribs.find((c) => hasParentInList(c.parentId)) || null;
    }

    const usable = contribs.filter((c) => hasParentInList(c.parentId));
    if (!usable.length) return;

    if (primaryEntry) {
      setParentGrowId(primaryEntry.parentId);
      const amt = Number(primaryEntry.amount);
      if (Number.isFinite(amt) && amt > 0) {
        setConsumeFromParent(String(amt));
      }
    }

    const extras = usable
      .filter((c) => !primaryEntry || c.parentId !== primaryEntry.parentId)
      .map((c) => {
        const amtNum = Number(c.amount);
        return {
          parentId: c.parentId,
          amount:
            Number.isFinite(amtNum) && amtNum > 0 ? String(amtNum) : "",
        };
      });

    setExtraParents(extras);
  }, [mode, editingGrow, parentList, parentGrowId, extraParents]);

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
      ? storageMode.mode === "count"
        ? Math.floor(total)
        : total
      : 0;
  }, [useFromStorageAmount, storageMode.mode]);

  const handleConsumeChange = (e) => {
    let v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (parentGrowId) {
      const max = Number(parentRemaining || 0);
      if (v > max) {
        setConsumeWarn(
          `Requested ${v} ${consumeUnit} exceeds available ${max} ${consumeUnit}. Using maximum.`
        );
        v = max;
        window.clearTimeout(handleConsumeChange._t);
        handleConsumeChange._t = window.setTimeout(
          () => setConsumeWarn(""),
          1800
        );
      } else {
        setConsumeWarn("");
      }
    }
    setConsumeFromParent(String(v));
  };

  const handleAddExtraParent = () => {
    setExtraParents((rows) => [...rows, { parentId: "", amount: "" }]);
    setExtraParentErrors((errs) => [...errs, ""]);
  };

  const handleExtraParentChange = (index, field, value) => {
    if (field === "amount") {
      setExtraParents((rows) => {
        const next = rows.map((row) => ({ ...row }));
        const row = next[index] || { parentId: "", amount: "" };

        let v = Number(value);
        if (!Number.isFinite(v) || v < 0) v = 0;

        let msg = "";
        const parent =
          (parentList || []).find((g) => g.id === row.parentId) || null;

        if (parent) {
          const total = Number(parent.amountTotal);
          const used = Number(parent.amountUsed);
          const remNew =
            Number.isFinite(total) && total > 0
              ? Math.max(0, total - (Number.isFinite(used) ? used : 0))
              : null;
          const remLegacy = Number(parent.amountAvailable);
          const remaining = Number.isFinite(remNew)
            ? remNew
            : Number.isFinite(remLegacy)
            ? remLegacy
            : 0;
          const unit =
            parent.amountUnit ||
            parent.volumeUnit ||
            "ml";

          if (remaining > 0 && v > remaining) {
            v = remaining;
            msg = `Requested amount exceeds available ${remaining} ${unit}. Using maximum.`;
          }
        }

        row.amount = v === 0 ? "" : String(v);
        next[index] = row;

        setExtraParentErrors((errs) => {
          const out = [...errs];
          out[index] = msg;
          return out;
        });

        return next;
      });
    } else if (field === "parentId") {
      setExtraParents((rows) =>
        rows.map((row, i) =>
          i === index ? { ...row, parentId: value } : row
        )
      );
      setExtraParentErrors((errs) => {
        const out = [...errs];
        out[index] = "";
        return out;
      });
    } else {
      setExtraParents((rows) =>
        rows.map((row, i) =>
          i === index ? { ...row, [field]: value } : row
        )
      );
    }
  };

  const handleRemoveExtraParent = (index) => {
    setExtraParents((rows) => rows.filter((_, i) => i !== index));
    setExtraParentErrors((errs) => errs.filter((_, i) => i !== index));
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
        .chipset .active { background: var(--_accent-600); color: var(--_accent-on); }
      `}</style>

      <form className="grow-form" onSubmit={handleSubmit}>
        {formNotice ? (
          <div
            className={`mb-3 rounded-xl px-4 py-3 text-sm ${formNotice.tone === "error" ? "border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200" : formNotice.tone === "warning" ? "border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200" : "border border-[rgba(var(--_accent-rgb),0.35)] bg-[rgba(var(--_accent-rgb),0.10)]"}` }
          >
            {formNotice.message}
          </div>
        ) : null}
        {mode === "create" && (
          <section className="mb-2">
            <label className="label mb-1 block">Parent Source</label>
            <div className="chipset">
              {PARENT_SOURCES.map((opt) => (
                <button
                  type="button"
                  key={opt.key}
                  className={
                    effectiveParentSource === opt.key ? "active" : ""
                  }
                  onClick={() => setParentSource(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        )}

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
                  const label = `${leftPart}${
                    p.strain || "(no strain)"
                  } · ${p.type || p.growType} · ${p.stage}`;
                  return (
                    <option key={p.id} value={p.id}>
                      {label}
                    </option>
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
                  <select
                    className="input"
                    value={consumeUnit}
                    onChange={(e) => setConsumeUnit(e.target.value)}
                    disabled
                  >
                    {VOLUME_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="text-xs mt-1 opacity-80">
                {parentGrowId
                  ? `${parentRemaining} ${consumeUnit} left${
                      Number.isFinite(parentTotal)
                        ? ` of ${parentTotal} ${consumeUnit}`
                        : ""
                    }`
                  : "Select a parent to see availability"}
              </div>
              {consumeWarn && (
                <div
                  className="text-xs mt-1"
                  style={{ color: "#f87171" }}
                >
                  {consumeWarn}
                </div>
              )}
            </div>

            <div className="sm:col-span-2 mt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="label">Additional Parents (optional)</label>
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded-full border border-slate-500/70 bg-slate-800/60 hover:bg-slate-700"
                  onClick={handleAddExtraParent}
                >
                  + Add parent
                </button>
              </div>

              {extraParents.length === 0 && (
                <div className="text-xs opacity-70">
                  Use this when a bulk tub consumes from multiple colonized
                  jars of the same strain.
                </div>
              )}

              <div className="space-y-2 mt-1">
                {extraParents.map((row, idx) => {
                  const parent = parentList.find(
                    (g) => g.id === row.parentId
                  );

                  let unit = consumeUnit || "ml";
                  let remaining = 0;
                  let total = null;

                  if (parent) {
                    const totalNum = Number(parent.amountTotal);
                    const usedNum = Number(parent.amountUsed);

                    if (Number.isFinite(totalNum) && totalNum > 0) {
                      total = totalNum;
                      remaining = Math.max(
                        0,
                        totalNum -
                          (Number.isFinite(usedNum) ? usedNum : 0)
                      );
                    } else {
                      const avail = Number(parent.amountAvailable);
                      remaining = Number.isFinite(avail)
                        ? Math.max(0, avail)
                        : 0;
                    }

                    unit =
                      parent.amountUnit ||
                      parent.volumeUnit ||
                      unit;
                  }

                  const availabilityText = parent
                    ? `${remaining} ${unit} left${
                        total !== null ? ` of ${total} ${unit}` : ""
                      }`
                    : "Select a parent to see availability";

                  return (
                    <div
                      key={idx}
                      className="flex flex-col gap-1 sm:flex-row sm:items-center"
                    >
                      <div className="flex-1">
                        <select
                          className="input"
                          value={row.parentId}
                          onChange={(e) =>
                            handleExtraParentChange(
                              idx,
                              "parentId",
                              e.target.value
                            )
                          }
                        >
                          <option value="">— Select Parent —</option>
                          {parentList
                            .filter(
                              (p) =>
                                p.id !== parentGrowId &&
                                !extraParents.some(
                                  (r, j) =>
                                    j !== idx && r.parentId === p.id
                                )
                            )
                            .map((p) => {
                              const leftPart = p.abbr
                                ? `${p.abbr} — `
                                : "";
                              const label = `${leftPart}${
                                p.strain || "(no strain)"
                              } · ${p.type || p.growType} · ${
                                p.stage
                              }`;
                              return (
                                <option key={p.id} value={p.id}>
                                  {label}
                                </option>
                              );
                            })}
                        </select>
                      </div>

                      <div className="flex flex-col sm:items-end gap-1 sm:gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            className="input w-28"
                            placeholder="0"
                            value={row.amount}
                            onChange={(e) =>
                              handleExtraParentChange(
                                idx,
                                "amount",
                                e.target.value
                              )
                            }
                          />
                          <span className="text-xs opacity-70">
                            {unit}
                          </span>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded-full border border-slate-600 hover:bg-slate-700"
                            onClick={() => handleRemoveExtraParent(idx)}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="text-[11px] opacity-70">
                          {availabilityText}
                        </div>
                        {extraParentErrors[idx] && (
                          <div
                            className="text-[11px] mt-0.5"
                            style={{ color: "#f87171" }}
                          >
                            {extraParentErrors[idx]}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {mode === "create" && effectiveParentSource === "library" && (
          <section className="grid sm:grid-cols-3 gap-2">
            <div className="sm:col-span-3">
              <label className="label">Storage Item</label>
              <select
                className="input"
                value={libId}
                onChange={(e) => setLibId(e.target.value)}
              >
                <option value="">— Select from Storage —</option>
                {libraryItems
                  .slice()
                  .sort((a, b) =>
                    String(a.strainName || "").localeCompare(
                      String(b.strainName || "")
                    )
                  )
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.type || "Item"} — {it.strainName || "Unknown"} ·{" "}
                      {it.qty ?? 0} {it.unit || "count"} left
                    </option>
                  ))}
              </select>
            </div>

            {libId && storageMode?.ok && (
              <>
                <div>
                  <label className="label">
                    {storageMode.mode === "count"
                      ? "Items to consume (count)"
                      : "Total to use (ml)"}
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={storageMode.mode === "count" ? 1 : 0}
                    step={storageMode.mode === "count" ? 1 : 0.1}
                    max={
                      storageMode.mode === "count"
                        ? Math.floor(
                            Number(storageMode.available || 0)
                          )
                        : Number(storageMode.available || 0)
                    }
                    className="input"
                    value={useFromStorageAmount}
                    onChange={handleStorageChange}
                  />
                </div>
                <div className="flex items-end text-sm opacity-80">
                  Available:{" "}
                  <span className="ml-1 font-semibold">
                    {storageMode.available}
                  </span>{" "}
                  {storageMode.unit}
                </div>
                <div className="flex items-end text-sm opacity-80">
                  Deducting:{" "}
                  <span className="ml-1 font-semibold">
                    {totalStorageDeduct}
                  </span>{" "}
                  {storageMode.unit}
                </div>
              </>
            )}
          </section>

        )}

        {mode === "create" && (
          <section className="grid sm:grid-cols-4 gap-2 mt-3">
            <div className="sm:col-span-4 text-xs opacity-70">
              Check any grow-form lab consumables used for this save. Quantities
              entered below are total for the whole save
              {Math.max(1, Number(batchCount || 1)) > 1
                ? ` and the cost will be split across ${Math.max(
                    1,
                    Number(batchCount || 1)
                  )} created grows.`
                : "."}
            </div>

            {trackedConsumableOptions.length === 0 ? (
              <div className="sm:col-span-4 text-xs text-amber-300">
                No <code>lab-consumable</code> items were found in COG yet. Add
                things like syringes, needles, prep pads, or gloves there first.
              </div>
            ) : (
              trackedConsumableOptions.map((supply) => {
                const selection = consumableSelections?.[supply.id] || {
                  enabled: false,
                  amount: "",
                };
                const enabled = !!selection.enabled;
                const enteredAmount = Number(selection.amount || 0);
                const deductAmount = enabled
                  ? roundedSupplyAmount(enteredAmount, supply.unit || "count")
                  : 0;
                const available = Number(supply.quantity || 0);
                const over = enabled && deductAmount > available + 1e-9;
                const invalid =
                  enabled &&
                  (!Number.isFinite(enteredAmount) || deductAmount <= 0);

                return (
                  <div
                    key={supply.id}
                    className={`rounded-xl border p-3 ${
                      enabled
                        ? "border-[rgba(var(--_accent-rgb),0.45)] bg-[rgba(var(--_accent-rgb),0.08)]"
                        : "border-slate-700/70 bg-slate-900/30"
                    }`}
                  >
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) =>
                          setConsumableSelections((prev) => ({
                            ...prev,
                            [supply.id]: {
                              enabled: e.target.checked,
                              amount: e.target.checked
                                ? prev?.[supply.id]?.amount || "1"
                                : "",
                            },
                          }))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm">
                          {supply.name || "Unnamed Supply"}
                        </div>
                        <div className="text-xs opacity-70 mt-1">
                          {supply.type || "supply"} ·{" "}
                          {Number(supply.quantity || 0)} {supply.unit || "count"} on hand · $
                          {Number(supply.cost || 0).toFixed(2)} /{" "}
                          {supply.unit || "count"}
                        </div>
                      </div>
                    </label>

                    <div className="mt-3">
                      <label className="label text-xs">Used for this save</label>
                      <input
                        type="number"
                        min="0"
                        step={
                          isCountLikeSupplyUnit(supply.unit || "") ? "1" : "0.1"
                        }
                        className="input"
                        value={selection.amount || ""}
                        onChange={(e) =>
                          setConsumableSelections((prev) => ({
                            ...prev,
                            [supply.id]: {
                              enabled: true,
                              amount: e.target.value,
                            },
                          }))
                        }
                        placeholder="0"
                        disabled={!enabled}
                      />
                    </div>

                    {enabled && (
                      <div className="mt-2 text-xs opacity-80">
                        Deducting{" "}
                        <span className="font-semibold">{deductAmount}</span>{" "}
                        {supply.unit || "count"} · Cost added{" "}
                        <span className="font-semibold">
                          ${Number(deductAmount * Number(supply.cost || 0)).toFixed(2)}
                        </span>
                      </div>
                    )}

                    {invalid && (
                      <div className="mt-2 text-xs" style={{ color: "#f87171" }}>
                        Enter a quantity greater than 0.
                      </div>
                    )}

                    {over && (
                      <div className="mt-2 text-xs" style={{ color: "#f87171" }}>
                        That exceeds the current stock on hand.
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {enabledConsumableRows.length > 0 && (
              <div className="sm:col-span-4 text-xs opacity-80">
                Grow-form lab consumables:{" "}
                <span className="font-semibold">
                  ${batchConsumablesCost.toFixed(2)}
                </span>{" "}
                total for this save ·{" "}
                <span className="font-semibold">
                  ${labConsumablesCost.toFixed(2)}
                </span>{" "}
                per grow
              </div>
            )}
          </section>
        )}

        {mode === "edit" && savedConsumableRows.length > 0 && (
          <section className="grid sm:grid-cols-3 gap-2 mt-3">
            <div className="sm:col-span-3 rounded-xl border border-slate-700/70 bg-slate-900/30 p-3">
              <div className="text-sm font-medium mb-2">Saved Lab Consumables</div>
              <div className="space-y-1 text-xs opacity-80">
                {savedConsumableRows.map((row) => (
                  <div key={`${row.supplyId}-${row.name}`}>
                    {row.name} ·{" "}
                    {Number(row.amount || 0).toFixed(
                      isCountLikeSupplyUnit(row.unit || "") ? 0 : 2
                    )}{" "}
                    {row.unit || "count"} · $
                    {Number(
                      (Number.isFinite(Number(row.totalCost))
                        ? Number(row.totalCost)
                        : Number(
                            (
                              Number(row.unitCost || 0) *
                              Number(row.amount || 0)
                            ).toFixed(2)
                          )) || 0
                    ).toFixed(2)}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="grid sm:grid-cols-3 gap-2 mt-3">
          <div>
            <label className="label">Grow Type</label>
            <select
              className="input"
              value={growType}
              onChange={(e) => setGrowType(e.target.value)}
            >
              {GROW_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
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
                  .map((s) => ({
                    id: s.id,
                    label:
                      s.name || s.strain || "Unnamed Strain",
                  }))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
              </select>
            )}
          </div>

          <div>
            <label className="label">Abbreviation</label>
            <input
              className="input"
              value={abbrPreview}
              readOnly
              disabled
            />
          </div>
        </section>

        {normalizeType(growType) !== "Bulk" && (
          <section className="grid sm:grid-cols-3 gap-2 mt-3">
            <div className="sm:col-span-2">
              <label className="label">Initial Volume (each child)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                className="input"
                placeholder="0"
                value={ivalue}
                onChange={(e) => setIValue(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Unit</label>
              <select
                className="input"
                value={ivUnit}
                onChange={(e) => setIvUnit(e.target.value)}
              >
                {VOLUME_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </section>
        )}

        {normalizeType(growType) === "Bulk" && (
          <section className="grid sm:grid-cols-3 gap-2 mt-3">
            <div className="sm:col-span-2">
              <label className="label">Grain : Substrate Ratio</label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="input"
                  value={bulkGrainParts}
                  onChange={(e) =>
                    setBulkGrainParts(e.target.value)
                  }
                  placeholder="Grain (e.g., 1)"
                />
                <div className="flex items-center justify-center text-sm opacity-70">
                  :
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="input"
                  value={bulkSubstrateParts}
                  onChange={(e) =>
                    setBulkSubstrateParts(e.target.value)
                  }
                  placeholder="Substrate (e.g., 5)"
                />
              </div>
            </div>
            <div>
              <label className="label">Bulk Volume (each child)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                className="input"
                value={bulkVolume}
                onChange={(e) => setBulkVolume(e.target.value)}
                placeholder="e.g., 3000"
              />
            </div>
            <div>
              <label className="label">Unit</label>
              <select
                className="input"
                value={bulkUnit}
                onChange={(e) => setBulkUnit(e.target.value)}
              >
                {VOLUME_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </section>
        )}

        <section className="grid sm:grid-cols-3 gap-2 mt-3">
          {mode === "create" && (
            <div>
              <label className="label">Batch Count</label>
              <input
                type="number"
                min="1"
                step="1"
                className="input"
                value={batchCount}
                onChange={(e) =>
                  setBatchCount(e.target.value)
                }
              />
            </div>
          )}
          <div>
            <label className="label">Stage</label>
            <select
              className="input"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              {allowedStagesForType(growType).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option>Active</option>
              <option>Archived</option>
              <option>Stored</option>
            </select>
          </div>
        </section>

        <section className="grid sm:grid-cols-3 gap-2 mt-3">
          <div>
            <label className="label">Created Date</label>
            <input
              type="date"
              className="input"
              value={created}
              onChange={(e) => setCreated(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Recipe</label>
            <select
              className="input"
              value={recipeId}
              onChange={(e) => setRecipeId(e.target.value)}
            >
              <option value="">Optional</option>
              {growUsableRecipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || "Untitled Recipe"}
                </option>
              ))}
            </select>

            {recipeId ? (
              selectedRecipeScope === "post-production" ? (
                <div className="text-xs mt-1 text-amber-300">
                  ⚠ This recipe is marked Post Production and cannot be used in GrowForm.
                </div>
              ) : selectedRecipeScore >= 2 ? (
                <div className="text-xs mt-1 accent-text">
                  ✓ Likely match for {normalizeType(growType)}
                </div>
              ) : selectedRecipeScore === 0 ? (
                <div className="text-xs mt-1 text-amber-300">
                  ⚠ Doesn’t look like a {normalizeType(growType)} recipe
                </div>
              ) : null
            ) : (
              <div className="text-xs mt-1 text-amber-300">
                No recipe selected
              </div>
            )}

            {recipeId && (
              <div className="mt-2">
                <RecipeConsumptionPreview
                  recipeId={recipeId}
                  batchCount={Number(batchCount) || 1}
                  perChildQty={
                    normalizeType(growType) !== "Bulk"
                      ? Number(ivalue || 0)
                      : Number(bulkVolume || 0)
                  }
                  perChildUnit={
                    normalizeType(growType) !== "Bulk"
                      ? String(ivUnit || "")
                      : String(bulkUnit || "")
                  }
                />
              </div>
            )}
          </div>

          <div>
            <label className="label">Cost</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={Number(totalCost).toFixed(2)}
              readOnly
              disabled
            />
            <div className="text-xs mt-1 opacity-70">
              Recipe ${Number(cost || 0).toFixed(2)} + lab consumables $
              {Number(labConsumablesCost || 0).toFixed(2)} = total $
              {Number(totalCost || 0).toFixed(2)}
            </div>
          </div>
        </section>

        {mode === "edit" &&
          normalizeType(growType) !== "Bulk" && (
            <section className="grid sm:grid-cols-3 gap-2 mt-3">
              <div>
                <label className="label">
                  Amount Available (legacy) — {ivUnit}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="input"
                  value={amountAvailableEdit}
                  onChange={(e) =>
                    setAmountAvailableEdit(e.target.value)
                  }
                />
              </div>
              <div className="sm:col-span-2 flex items-end text-sm opacity-70">
                For older grows that still use{" "}
                <code>amountAvailable</code>.
              </div>
            </section>
          )}

        <div className="mt-4 flex gap-2">
          <button
            className="btn btn-accent"
            type="submit"
            disabled={isSubmitting}
          >
            {mode === "edit"
              ? "Save"
              : isSubmitting
              ? "Creating…"
              : "Create"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onClose?.()}
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}