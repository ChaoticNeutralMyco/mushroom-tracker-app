// src/components/Grow/RecipeConsumptionPreview.jsx
import React, { useEffect, useState } from "react";
import { db, auth } from "../../firebase-config";
import { doc, getDoc } from "firebase/firestore";
import { canonicalUnit, COUNT_UNITS, convert, formatAmount } from "../../lib/units";

function norm(v) { return String(v || "").trim().toLowerCase(); }
function isCountUnit(u) { return canonicalUnit(u) === "count" || COUNT_UNITS.includes(canonicalUnit(u)); }

function roundForUnit(val, unit) {
  return isCountUnit(unit) ? Math.ceil(Math.max(0, Number(val) || 0)) : Math.max(0, Number(val) || 0);
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
        const base = Number(it?.amount) || 0;
        const unit = it?.unit || it?.amountUnit || "";
        if (!supplyId || base <= 0) continue;

        const need = roundForUnit(base * scale, unit);

        // enrich with supply info
        const sSnap = await getDoc(doc(db, "users", user.uid, "supplies", supplyId));
        const sData = sSnap.exists() ? sSnap.data() : null;
        const inStock = sData ? Number(sData?.qty) || 0 : 0;
        const stockUnit = sData?.unit || unit;
        const name = sData?.name || it?.name || supplyId;
        const type = sData?.type || "";

        out.push({
          supplyId,
          name,
          type,
          perBatch: base,
          unit,
          need,
          inStock,
          stockUnit,
          short: Math.max(0, need - (canonicalUnit(stockUnit) === canonicalUnit(unit) ? inStock : Number(convert(inStock, stockUnit, unit)) || 0)),
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
    <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/40 p-3">
      <div className="text-sm font-medium mb-2">Recipe Consumption Preview — <span className="opacity-80">{recipeName}</span></div>
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
                <th className="py-1 pr-2">In stock</th>
                <th className="py-1 pr-2">Short</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const stockSameUnit = canonicalUnit(r.stockUnit) === canonicalUnit(r.unit);
                const stockForNeedUnit = stockSameUnit ? r.inStock : (Number(convert(r.inStock, r.stockUnit, r.unit)) || 0);
                const shortage = Math.max(0, r.need - stockForNeedUnit);
                return (
                  <tr key={r.supplyId} className="border-t border-zinc-800/60">
                    <td className="py-1 pr-2">{r.name}</td>
                    <td className="py-1 pr-2">{formatAmount(r.perBatch)} {r.unit}</td>
                    <td className="py-1 pr-2">{formatAmount(r.need)} {r.unit}</td>
                    <td className="py-1 pr-2">{formatAmount(stockForNeedUnit)} {r.unit}</td>
                    <td className={"py-1 pr-2 " + (shortage > 0 ? "text-amber-300" : "opacity-70")}>
                      {shortage > 0 ? `${formatAmount(shortage)} ${r.unit}` : "OK"}
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
