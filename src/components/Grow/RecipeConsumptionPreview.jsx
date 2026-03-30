// src/components/Grow/RecipeConsumptionPreview.jsx
import React, { useEffect, useState } from "react";
import { db, auth } from "../../firebase-config";
import { doc, getDoc } from "firebase/firestore";
import { areCompatible, canonicalUnit, COUNT_UNITS, convert, formatAmount } from "../../lib/units";

function norm(v) { return String(v || "").trim().toLowerCase(); }
function isCountUnit(u) { return canonicalUnit(u) === "count" || COUNT_UNITS.includes(canonicalUnit(u)); }

function roundForUnit(val, unit) {
  return isCountUnit(unit) ? Math.ceil(Math.max(0, Number(val) || 0)) : Math.max(0, Number(val) || 0);
}

function getRecipeItemUnits(item = {}, supply = {}) {
  const stockUnit = canonicalUnit(supply?.unit || item?.stockUnit || item?.unit || "");
  const displayUnit = canonicalUnit(
    item?.unit || item?.amountUnit || supply?.unit || item?.stockUnit || ""
  );

  return {
    stockUnit,
    displayUnit: displayUnit || stockUnit,
  };
}

function getRecipeItemDisplayAmount(item = {}, supply = {}) {
  const { stockUnit, displayUnit } = getRecipeItemUnits(item, supply);
  const storedStockAmount = Number(item?.amount || 0);
  const storedDisplayAmount = Number(item?.amountDisplay);

  if (Number.isFinite(storedDisplayAmount) && storedDisplayAmount > 0) {
    return storedDisplayAmount;
  }

  if (displayUnit && stockUnit && areCompatible(displayUnit, stockUnit)) {
    return convert(storedStockAmount, stockUnit, displayUnit);
  }

  return storedStockAmount;
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
      recipe?.output
    ) || 0;
  const unit = String(
    recipe?.yieldUnit ??
    recipe?.yield_amount_unit ??
    recipe?.yieldVolumeUnit ??
    recipe?.volumeUnit ??
    recipe?.outputUnit ??
    recipe?.unit
  ) || "";
  return { qty, unit };
}

export default function RecipeConsumptionPreview({
  recipeId,
  batchCount = 1,
  perChildQty = null,
  perChildUnit = "",
}) {
  const [rows, setRows] = useState([]);
  const [recipeName, setRecipeName] = useState("");
  const [scaleExplain, setScaleExplain] = useState("");

  useEffect(() => {
    let ignore = false;
    async function run() {
      const user = auth.currentUser;
      if (!user || !recipeId) { setRows([]); return; }

      // fetch recipe
      const rSnap = await getDoc(doc(db, "users", user.uid, "recipes", recipeId));
      if (!rSnap.exists()) { setRows([]); return; }
      const recipe = { id: rSnap.id, ...rSnap.data() };
      setRecipeName(recipe?.name || "Untitled Recipe");

      // compute scale exactly like consumeRecipeForBatch
      const { qty: yieldQty, unit: yieldUnit } = getRecipeYield(recipe);
      let scale = Number(batchCount) || 1;
      let scaleNote = `× batches (${batchCount})`;
      if ((Number(yieldQty) || 0) > 0) {
        if (perChildQty != null && perChildUnit && yieldUnit && norm(perChildUnit) === norm(yieldUnit)) {
          scale = (Number(perChildQty) * (Number(batchCount) || 1)) / Number(yieldQty);
          scaleNote = `(${formatAmount(perChildQty)} ${yieldUnit} × ${batchCount}) ÷ yield ${formatAmount(yieldQty)} ${yieldUnit}`;
        } else {
          scale = (Number(batchCount) || 1) / Number(yieldQty);
          scaleNote = `${batchCount} ÷ yield ${formatAmount(yieldQty)} ${yieldUnit}`;
        }
      }

      // build needs
      const items = Array.isArray(recipe?.items) ? recipe.items : [];
      const out = [];
      for (const it of items) {
        const supplyId = it?.supplyId || it?.id;
        if (!supplyId) continue;

        // enrich with supply info
        const sSnap = await getDoc(doc(db, "users", user.uid, "supplies", supplyId));
        const sData = sSnap.exists() ? sSnap.data() : null;
        const name = sData?.name || it?.name || supplyId;
        const type = sData?.type || "";

        const { stockUnit, displayUnit } = getRecipeItemUnits(it, sData || {});
        const baseStock = Number(it?.amount) || 0;
        if (baseStock <= 0) continue;

        const perBatchDisplay = getRecipeItemDisplayAmount(it, sData || {});
        const needStock = roundForUnit(baseStock * scale, stockUnit);
        const needDisplay =
          displayUnit && stockUnit && areCompatible(displayUnit, stockUnit)
            ? roundForUnit(convert(needStock, stockUnit, displayUnit), displayUnit)
            : roundForUnit(perBatchDisplay * scale, displayUnit);

        const inStock = sData
          ? Number(sData?.quantity ?? sData?.qty ?? sData?.q ?? 0) || 0
          : 0;

        const stockForDisplayUnit =
          displayUnit && stockUnit && areCompatible(displayUnit, stockUnit)
            ? Number(convert(inStock, stockUnit, displayUnit)) || 0
            : inStock;

        const shortStock = Math.max(0, needStock - inStock);
        const shortDisplay =
          displayUnit && stockUnit && areCompatible(displayUnit, stockUnit)
            ? Number(convert(shortStock, stockUnit, displayUnit)) || 0
            : shortStock;

        out.push({
          supplyId,
          name,
          type,
          stockUnit,
          perBatchDisplay,
          displayUnit,
          needDisplay,
          onHandStock: inStock,
          inStockDisplay: stockForDisplayUnit,
          shortDisplay,
        });
      }

      if (!ignore) {
        setRows(out);
        setScaleExplain(scaleNote);
      }
    }
    run();
    return () => { ignore = true; };
  }, [recipeId, batchCount, perChildQty, perChildUnit]);

  if (!recipeId) return null;
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="text-sm font-medium mb-2">Recipe Consumption Preview — <span className="accent-text">{recipeName}</span></div>
      <div className="text-xs opacity-75 mb-2">Scale: {scaleExplain}</div>
      {rows.length === 0 ? (
        <div className="text-xs opacity-70">No consumable items in this recipe.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left opacity-80">
                <th className="py-1 pr-2">Supply</th>
                <th className="py-1 pr-2">Per batch</th>
                <th className="py-1 pr-2">Total need</th>
                <th className="py-1 pr-2">Stock unit</th>
                <th className="py-1 pr-2">On hand</th>
                <th className="py-1 pr-2">Short</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const displayUnitCanonical = canonicalUnit(r.displayUnit);
                const stockUnitCanonical = canonicalUnit(r.stockUnit);
                const shortage = Math.max(0, Number(r.shortDisplay || 0));
                return (
                  <tr key={r.supplyId} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1 pr-2">{r.name}</td>
                    <td className="py-1 pr-2">
                      {displayUnitCanonical === "count"
                        ? Math.floor(Number(r.perBatchDisplay || 0))
                        : formatAmount(r.perBatchDisplay)} {r.displayUnit}
                    </td>
                    <td className="py-1 pr-2">
                      {displayUnitCanonical === "count"
                        ? Math.floor(Number(r.needDisplay || 0))
                        : formatAmount(r.needDisplay)} {r.displayUnit}
                    </td>
                    <td className="py-1 pr-2">{r.stockUnit}</td>
                    <td className="py-1 pr-2">
                      {stockUnitCanonical === "count"
                        ? Math.floor(Number(r.onHandStock || 0))
                        : formatAmount(r.onHandStock)} {r.stockUnit}
                    </td>
                    <td className={"py-1 pr-2 " + (shortage > 0 ? "text-amber-600 dark:text-amber-300" : "opacity-70")}>
                      {shortage > 0
                        ? `${displayUnitCanonical === "count" ? Math.floor(shortage) : formatAmount(shortage)} ${r.displayUnit}`
                        : "OK"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[11px] mt-2 opacity-60">
        Preview only — final consumption uses the same math at create time.
      </div>
    </div>
  );
}
