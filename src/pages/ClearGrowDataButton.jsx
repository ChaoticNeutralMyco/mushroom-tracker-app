// src/pages/ClearGrowDataButton.jsx
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

      const growsCol = collection(db, "users", uid, "grows");
      const growsSnap = await getDocs(growsCol);
      if (growsSnap.empty) {
        alert("No grows to clear.");
        setBusy(false);
        return;
      }

      const addToTrash = async (payload) => {
        const trashCol = collection(db, "users", uid, "settings", "trash");
        const trashRef = doc(trashCol);
        await setDoc(trashRef, {
          ...payload,
          deletedAt: serverTimestamp(),
          source: "clearGrowData",
        });
      };

      const growIds = [];
      for (const g of growsSnap.docs) {
        await addToTrash({ type: "grow", id: g.id, data: g.data() });
        growIds.push(g.id);
      }

      const collectionsToSweep = [
        { name: "tasks", field: "growId" },
        { name: "photos", field: "growId" },
        { name: "notes", field: "growId" },
      ];

      for (const { name, field } of collectionsToSweep) {
        for (const gid of growIds) {
          const col = collection(db, "users", uid, name);
          const snap = await getDocs(query(col, where(field, "==", gid)));
          if (!snap.empty) {
            let batch = writeBatch(db);
            let count = 0;
            for (const d of snap.docs) {
              await addToTrash({ type: name.slice(0, -1), id: d.id, data: d.data() });
              batch.delete(doc(db, "users", uid, name, d.id));
              count++;
              if (count >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                count = 0;
              }
            }
            if (count > 0) await batch.commit();
          }
        }
      }

      {
        let batch = writeBatch(db);
        let count = 0;
        for (const g of growsSnap.docs) {
          batch.delete(doc(db, "users", uid, "grows", g.id));
          count++;
          if (count >= 400) {
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
      data-testid="clear-grow-data"
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
