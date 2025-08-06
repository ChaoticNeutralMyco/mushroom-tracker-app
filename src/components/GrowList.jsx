import React, { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  deleteDoc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { db, auth } from "../firebase-config";
import GrowForm from "./GrowForm";
import GrowNotesModal from "./GrowNotesModal";
import { Trash2, Pencil, StickyNote } from "lucide-react";

export default function GrowList() {
  const [grows, setGrows] = useState([]);
  const [editingGrow, setEditingGrow] = useState(null);
  const [showNotesFor, setShowNotesFor] = useState(null);
  const [supplies, setSupplies] = useState({});
  const [recipes, setRecipes] = useState({});

  const uid = auth.currentUser?.uid;

  // Load grows
  useEffect(() => {
    if (!uid) return;
    const growsRef = collection(db, "users", uid, "grows");
    const unsubscribe = onSnapshot(growsRef, async (snapshot) => {
      const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setGrows(data);
    });
    return () => unsubscribe();
  }, [uid]);

  // Load supplies
  useEffect(() => {
    if (!uid) return;
    const fetchSupplies = async () => {
      const snap = await getDocs(collection(db, "users", uid, "supplies"));
      const result = {};
      snap.forEach((doc) => {
        result[doc.id] = doc.data();
      });
      setSupplies(result);
    };
    fetchSupplies();
  }, [uid]);

  // Load recipes
  useEffect(() => {
    if (!uid) return;
    const fetchRecipes = async () => {
      const snap = await getDocs(collection(db, "users", uid, "recipes"));
      const result = {};
      snap.forEach((doc) => {
        result[doc.id] = doc.data();
      });
      setRecipes(result);
    };
    fetchRecipes();
  }, [uid]);

  // Calculate cost
  const calculateCost = (grow) => {
    const recipe = recipes[grow.recipeId];
    if (!recipe || !recipe.items) return null;

    let total = 0;
    for (const item of recipe.items) {
      const supply = supplies[item.supplyId];
      if (supply && typeof supply.cost === "number") {
        total += item.amount * supply.cost;
      }
    }
    return total;
  };

  const handleDelete = async (growId) => {
    if (!uid) return;
    if (!window.confirm("Delete this grow?")) return;
    await deleteDoc(doc(db, "users", uid, "grows", growId));
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Your Grows</h2>
      <div className="grid gap-4">
        {grows.map((grow) => {
          const cost = calculateCost(grow);

          return (
            <div
              key={grow.id}
              className="bg-white dark:bg-gray-800 shadow rounded-lg p-4 relative"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold">
                    {grow.strain || "Unnamed Strain"}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Stage: {grow.stage || "Unknown"}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Cost: {cost != null ? `$${cost.toFixed(2)}` : "N/A"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowNotesFor(grow)}
                    className="text-blue-500 hover:text-blue-700"
                    title="Notes"
                  >
                    <StickyNote size={18} />
                  </button>
                  <button
                    onClick={() => setEditingGrow(grow)}
                    className="text-green-500 hover:text-green-700"
                    title="Edit"
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(grow.id)}
                    className="text-red-500 hover:text-red-700"
                    title="Delete"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editingGrow && (
        <div className="mt-6">
          <GrowForm editingGrow={editingGrow} onClose={() => setEditingGrow(null)} />
        </div>
      )}

      {showNotesFor && (
        <GrowNotesModal grow={showNotesFor} onClose={() => setShowNotesFor(null)} />
      )}
    </div>
  );
}
