import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase-config";
import {
  doc,
  getDoc,
  deleteDoc,
  collection,
  getDocs,
} from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";
import { Trash2, Pencil } from "lucide-react";

export default function GrowList({ grows, setGrows, setEditingGrow }) {
  const [user] = useAuthState(auth);
  const [parentMap, setParentMap] = useState({});
  const [supplyMap, setSupplyMap] = useState({});
  const [recipeMap, setRecipeMap] = useState({});

  useEffect(() => {
    if (!user) return;

    const fetchParents = async () => {
      const map = {};
      for (const grow of grows) {
        if (grow.parentGrowId && !map[grow.parentGrowId]) {
          const ref = doc(db, "users", user.uid, "grows", grow.parentGrowId);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            map[grow.parentGrowId] = snap.data().strain || "Unknown";
          }
        }
      }
      setParentMap(map);
    };

    const fetchSuppliesAndRecipes = async () => {
      const suppliesSnap = await getDocs(collection(db, "users", user.uid, "supplies"));
      const recipesSnap = await getDocs(collection(db, "users", user.uid, "recipes"));
      const supplyData = {};
      const recipeData = {};
      suppliesSnap.forEach((doc) => (supplyData[doc.id] = doc.data()));
      recipesSnap.forEach((doc) => (recipeData[doc.id] = doc.data()));
      setSupplyMap(supplyData);
      setRecipeMap(recipeData);
    };

    fetchParents();
    fetchSuppliesAndRecipes();
  }, [grows, user]);

  const calculateRecipeCost = (recipeId) => {
    const recipe = recipeMap[recipeId];
    if (!recipe || !recipe.items) return 0;
    return recipe.items.reduce((sum, item) => {
      const supply = supplyMap[item.supplyId];
      return supply ? sum + (supply.cost || 0) * item.amount : sum;
    }, 0);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this grow?")) return;
    const ref = doc(db, "users", user.uid, "grows", id);
    await deleteDoc(ref);
    setGrows((prev) => prev.filter((g) => g.id !== id));
  };

  const generateQRUrl = (growId) => {
    const raw = `${user?.uid || ""}:${growId}`;
    const encoded = "grow:" + btoa(raw);
    return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(encoded)}&size=100x100`;
  };

  return (
    <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl shadow space-y-4">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Your Grows</h2>

      {grows.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-300 text-sm">No grows yet.</p>
      ) : (
        <div className="grid gap-4">
          {grows.map((grow) => (
            <div
              key={grow.id}
              className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 shadow-sm transition hover:shadow-md"
            >
              <div className="flex justify-between items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                    {grow.strain || "Unnamed Strain"}
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Stage: <span className="capitalize">{grow.stage}</span>
                    {grow.parentGrowId && (
                      <> — Spawned from: {parentMap[grow.parentGrowId] || "..."}</>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-3 mt-2 sm:mt-0">
                  <button
                    onClick={() => setEditingGrow(grow)}
                    className="text-blue-500 hover:text-blue-600 transition"
                    title="Edit"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => handleDelete(grow.id)}
                    className="text-red-500 hover:text-red-600 transition"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="text-sm text-zinc-700 dark:text-zinc-300 mt-3 space-y-1">
                <p>
                  <strong>Cost:</strong>{" "}
                  ${grow.recipeId
                    ? calculateRecipeCost(grow.recipeId).toFixed(2)
                    : (grow.cost || 0).toFixed(2)}
                </p>

                {(grow.yieldWet || grow.yieldDry) && (
                  <p>
                    <strong>Yield:</strong>{" "}
                    {grow.yieldWet ? `${grow.yieldWet}g wet` : ""}
                    {grow.yieldWet && grow.yieldDry ? " / " : ""}
                    {grow.yieldDry ? `${grow.yieldDry}g dry` : ""}
                  </p>
                )}

                {grow.notes && (
                  <p>
                    <strong>Notes:</strong>{" "}
                    {Array.isArray(grow.notes)
                      ? `${grow.notes.length} note(s)`
                      : grow.notes}
                  </p>
                )}

                {grow.stageDates && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {Object.entries(grow.stageDates)
                      .map(([s, d]) => `${s}: ${d.substring(0, 10)}`)
                      .join(", ")}
                  </p>
                )}

                {/* QR CODE (CDN based) */}
                <div className="pt-2">
                  <p className="font-medium text-sm mb-1">QR Code:</p>
                  <img
                    src={generateQRUrl(grow.id)}
                    alt={`QR for ${grow.strain}`}
                    className="border rounded bg-white p-1 shadow-sm"
                    width={96}
                    height={96}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
