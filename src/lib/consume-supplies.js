// src/lib/consume-supplies.js
// Backward-compatible supply consumption for recipe-based grow creation.
// Adds audit fields: unitCostApplied, totalCostApplied, unit (stock unit snapshot).

import { db } from "../firebase-config";
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";

/* ---------------- helpers ---------------- */
const norm = (s) => String(s || "").trim().toLowerCase();
const n = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

function isCountUnit(u) {
  const x = norm(u);
  return x === "count" || x === "plate" || x === "jar" || x === "dish" || x === "item";
}

function roundForUnit(val, unit) {
  return isCountUnit(unit) ? Math.ceil(Math.max(0, n(val, 0))) : Math.max(0, n(val, 0));
}

function getRecipeYield(recipe = {}) {
  const qty =
    n(
      recipe?.yieldQty ??
        recipe?.yield ??
        recipe?.yieldAmount ??
        recipe?.yieldVolume ??
        recipe?.totalVolume ??
        recipe?.batchVolume ??
        recipe?.outputQty ??
        recipe?.batchQty ??
        recipe?.portions ??
        recipe?.servings,
      0
    ) || 0;

  const unit =
    String(
      recipe?.yieldUnit ||
        recipe?.unit ||
        recipe?.volumeUnit ||
        recipe?.outputUnit ||
        recipe?.batchUnit ||
        ""
    ) || "";

  return { qty, unit };
}

async function fetchRecipeById(uid, recipeId) {
  const ref = doc(db, "users", uid, "recipes", recipeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const base = { id: snap.id, ...snap.data() };
  if (!Array.isArray(base.items) || base.items.length === 0) {
    try {
      const itemsSnap = await getDocs(collection(db, "users", uid, "recipes", recipeId, "items"));
      const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return { ...base, items };
    } catch {
      /* ignore */
    }
  }
  return base;
}

async function readSupply(uid, supplyId) {
  const sRef = doc(db, "users", uid, "supplies", supplyId);
  const sSnap = await getDoc(sRef);
  return sSnap.exists() ? { id: sSnap.id, ...sSnap.data() } : null;
}

async function decrementSupply(uid, supplyId, amount) {
  if (!uid || !supplyId) return { before: 0, after: 0, unit: "", name: "", cost: 0 };

  const s = await readSupply(uid, supplyId);
  if (!s) return { before: 0, after: 0, unit: "", name: "", cost: 0 };

  const before = n(s.quantity, 0);
  const unit = String(s.unit || "");
  const name = String(s.name || "");
  const cost = Number(s.cost || 0); // locked per-unit price

  const delta = Math.max(0, n(amount, 0));
  const after = Math.max(0, before - delta);

  await updateDoc(doc(db, "users", uid, "supplies", supplyId), {
    quantity: after,
    lastUpdatedAt: serverTimestamp(),
  });

  return { before, after, unit, name, cost };
}

async function incrementSupply(uid, supplyId, amount) {
  if (!uid || !supplyId) return { before: 0, after: 0, unit: "", name: "", cost: 0 };

  const s = await readSupply(uid, supplyId);
  if (!s) return { before: 0, after: 0, unit: "", name: "", cost: 0 };

  const before = n(s.quantity, 0);
  const unit = String(s.unit || "");
  const name = String(s.name || "");
  const cost = Number(s.cost || 0);

  const delta = Math.max(0, n(amount, 0));
  const after = before + delta;

  await updateDoc(doc(db, "users", uid, "supplies", supplyId), {
    quantity: after,
    lastUpdatedAt: serverTimestamp(),
  });

  return { before, after, unit, name, cost };
}

async function audit(uid, payload) {
  if (!uid) return;
  await addDoc(collection(db, "users", uid, "supply_audits"), {
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

async function auditConsume(uid, { supplyId, amount, recipeId, recipeName, growId, unit, unitCostApplied }) {
  if (!uid || !supplyId) return;
  const totalCostApplied =
    Number.isFinite(Number(unitCostApplied)) ? Number(unitCostApplied) * Number(amount || 0) : null;

  await audit(uid, {
    action: "consume",
    supplyId: String(supplyId),
    amount: n(amount, 0),
    unit: unit || null,
    unitCostApplied: Number.isFinite(Number(unitCostApplied)) ? Number(unitCostApplied) : null,
    totalCostApplied,
    recipeId: recipeId || null,
    recipeName: recipeName || null,
    growId: growId || null,
    note: "",
  });
}

async function auditRefund(uid, { supplyId, amount, recipeId, recipeName, growId, unit, unitCostApplied }) {
  if (!uid || !supplyId) return;
  const totalCostApplied =
    Number.isFinite(Number(unitCostApplied)) ? Number(unitCostApplied) * Number(amount || 0) : null;

  await audit(uid, {
    action: "reconcile_refund",
    supplyId: String(supplyId),
    amount: n(amount, 0),
    unit: unit || null,
    unitCostApplied: Number.isFinite(Number(unitCostApplied)) ? Number(unitCostApplied) : null,
    totalCostApplied,
    recipeId: recipeId || null,
    recipeName: recipeName || null,
    growId: growId || null,
    note: "",
  });
}

/* ---------------- main API ---------------- */
export async function consumeRecipeForBatch(...args) {
  // Parse both supported signatures
  let uid = null;
  let recipe = null;
  let recipeId = null;
  let batchCount = 1;
  let perChildQty = null;
  let perChildUnit = null;
  let note = "";
  let growId = null;

  if (args.length === 1 && typeof args[0] === "object") {
    const opt = args[0] || {};
    uid = opt.uid;
    recipe = opt.recipe || null;
    recipeId = opt.recipe?.id || null;
    batchCount = n(opt.batchCount, 1) || 1;
    note = opt.note || "";
    growId = opt.growId || null;
  } else if (args.length >= 2 && typeof args[0] === "string" && typeof args[1] === "string") {
    uid = args[0];
    recipeId = args[1];
    const opt = args[2] || {};
    batchCount = n(opt.batchCount, 1) || 1;
    perChildQty = Number.isFinite(Number(opt.perChildQty)) ? Number(opt.perChildQty) : null;
    perChildUnit = opt.perChildUnit || null;
    note = opt.note || "";
    growId = opt.growId || null;
  } else {
    // unsupported call
    return;
  }

  if (!uid) return;

  if (!recipe && recipeId) {
    recipe = await fetchRecipeById(uid, recipeId);
  }
  if (!recipe || !Array.isArray(recipe.items) || recipe.items.length === 0) return;

  const { qty: yieldQty, unit: yieldUnitRaw } = getRecipeYield(recipe);
  const yieldQtySafe = n(yieldQty, 0);
  const yieldUnit = String(yieldUnitRaw || "");

  let scale = n(batchCount, 1);
  if (yieldQtySafe > 0) {
    if (perChildQty != null && perChildUnit && yieldUnit && norm(perChildUnit) === norm(yieldUnit)) {
      scale = (perChildQty * n(batchCount, 1)) / yieldQtySafe;
    } else {
      scale = n(batchCount, 1) / yieldQtySafe;
    }
  }

  for (const line of recipe.items) {
    const supplyId = line?.supplyId || line?.id || null;
    if (!supplyId) continue;

    const base = n(line.amount, 0);
    const unit = line.unit || line.amountUnit || "";
    if (base <= 0) continue;

    const neededRaw = base * scale;
    const needed = roundForUnit(neededRaw, unit);
    if (needed <= 0) continue;

    const { unit: stockUnit, cost: unitCostLocked } = await decrementSupply(uid, supplyId, needed);

    await auditConsume(uid, {
      supplyId,
      amount: needed,
      recipeId: recipe.id || recipeId || null,
      recipeName: recipe.name || null,
      growId,
      unit: stockUnit || unit || null,
      unitCostApplied: unitCostLocked,
    });
  }
}

/* ---------- Reconciliation for editing grows ---------- */
async function computeNeeds(uid, recipeOrId, { perQty, perUnit }) {
  const recipe =
    typeof recipeOrId === "string"
      ? await fetchRecipeById(uid, recipeOrId)
      : recipeOrId;

  if (!recipe || !Array.isArray(recipe.items) || recipe.items.length === 0) {
    return { recipe: null, needs: [] };
  }

  const { qty: yieldQty, unit: yieldUnit } = getRecipeYield(recipe);
  let scale = 1;
  if (yieldQty > 0) {
    if (perQty != null && perUnit && yieldUnit && norm(perUnit) === norm(yieldUnit)) {
      scale = perQty / yieldQty;
    } else {
      scale = 1 / yieldQty;
    }
  }

  const needs = (recipe.items || [])
    .map((line) => {
      const supplyId = line?.supplyId || line?.id || null;
      const base = n(line?.amount, 0);
      const unit = line?.unit || line?.amountUnit || "";
      if (!supplyId || base <= 0) return null;
      const amt = roundForUnit(base * scale, unit);
      return amt > 0 ? { supplyId, amount: amt, unit } : null;
    })
    .filter(Boolean);

  return { recipe, needs };
}

export async function reconcileRecipeChangeForGrow(uid, opts = {}) {
  if (!uid) return;

  const {
    oldRecipeId,
    oldRecipe,
    newRecipeId,
    newRecipe,
    oldPerChildQty,
    oldPerChildUnit,
    newPerChildQty,
    newPerChildUnit,
    note = "retype reconcile",
    growId = null,
  } = opts;

  // 1) Refund old if present
  if (oldRecipeId || oldRecipe) {
    const { recipe: Rold, needs: NeOld } = await computeNeeds(uid, oldRecipe || oldRecipeId, {
      perQty: Number.isFinite(Number(oldPerChildQty)) ? Number(oldPerChildQty) : null,
      perUnit: oldPerChildUnit || null,
    });

    for (const row of NeOld) {
      const { unit, cost } = await incrementSupply(uid, row.supplyId, row.amount);
      await auditRefund(uid, {
        supplyId: row.supplyId,
        amount: row.amount,
        recipeId: Rold?.id || oldRecipeId || null,
        recipeName: Rold?.name || null,
        growId,
        unit,
        unitCostApplied: cost,
      });
    }
  }

  // 2) Consume new if present
  if (newRecipeId || newRecipe) {
    const { recipe: Rnew, needs: NeNew } = await computeNeeds(uid, newRecipe || newRecipeId, {
      perQty: Number.isFinite(Number(newPerChildQty)) ? Number(newPerChildQty) : null,
      perUnit: newPerChildUnit || null,
    });

    for (const row of NeNew) {
      const { unit, cost } = await decrementSupply(uid, row.supplyId, row.amount);
      await auditConsume(uid, {
        supplyId: row.supplyId,
        amount: row.amount,
        recipeId: Rnew?.id || newRecipeId || null,
        recipeName: Rnew?.name || null,
        growId,
        unit,
        unitCostApplied: cost,
      });
    }
  }
}
