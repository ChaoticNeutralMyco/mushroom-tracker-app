import React, { useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase-config";

export default function ClearGrowDataButton({ className = "" }) {
  const [busy, setBusy] = useState(false);

  const clearGrowData = async () => {
    if (busy) return;
    const ok = window.confirm(
      "Clear ONLY grow data? This will remove grows and their linked tasks/photos/notes, but will NOT touch recipes or supplies. Items will be sent to Trash."
    );
    if (!ok) return;

    try {
      setBusy(true);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Not signed in.");

      // 1) Pull all grows
      const growsCol = collection(db, "users", uid, "grows");
      const growsSnap = await getDocs(growsCol);
      if (growsSnap.empty) {
        alert("No grows to clear.");
        setBusy(false);
        return;
      }

      // Helper to push an item into Trash
      const addToTrash = async (payload) => {
        const trashCol = collection(db, "users", uid, "settings", "trash");
        const trashRef = doc(trashCol);
        await setDoc(trashRef, {
          ...payload,
          deletedAt: serverTimestamp(),
          source: "clearGrowData",
        });
      };

      // We’ll process grows in manageable batches
      const itemsPerBatch = 400;

      const growIds = [];
      for (const g of growsSnap.docs) {
        // Save to trash (original grow doc snapshot)
        await addToTrash({
          type: "grow",
          id: g.id,
          data: g.data(),
        });
        growIds.push(g.id);
      }

      // 2) Delete linked tasks/photos/notes for each grow (if these collections exist)
      const collectionsToSweep = [
        { name: "tasks", field: "growId" },
        { name: "photos", field: "growId" },
        { name: "notes", field: "growId" }, // if notes are embedded in the grow doc, the grow delete will handle them
      ];

      for (const { name, field } of collectionsToSweep) {
        // Sweep in chunks of 10 (Firestore "in" limits) by querying per growId to be safe
        for (const gid of growIds) {
          const col = collection(db, "users", uid, name);
          const snap = await getDocs(query(col, where(field, "==", gid)));
          if (!snap.empty) {
            let batch = writeBatch(db);
            let count = 0;
            for (const d of snap.docs) {
              await addToTrash({
                type: name.slice(0, -1), // task/photo/note
                id: d.id,
                data: d.data(),
              });
              batch.delete(doc(db, "users", uid, name, d.id));
              count++;
              if (count >= itemsPerBatch) {
                await batch.commit();
                batch = writeBatch(db);
                count = 0;
              }
            }
            if (count > 0) await batch.commit();
          }
        }
      }

      // 3) Delete the grows themselves
      {
        let batch = writeBatch(db);
        let count = 0;
        for (const g of growsSnap.docs) {
          batch.delete(doc(db, "users", uid, "grows", g.id));
          count++;
          if (count >= itemsPerBatch) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      }

      alert("Grow data cleared. Recipes & supplies were left intact.");
    } catch (err) {
      console.error(err);
      alert(`Failed to clear grow data: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={clearGrowData}
      disabled={busy}
      className={
        "px-4 py-2 rounded-lg font-medium shadow bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white " +
        className
      }
      title="Remove only grows and their linked data"
    >
      {busy ? "Clearing…" : "Clear Grow Data"}
    </button>
  );
}
