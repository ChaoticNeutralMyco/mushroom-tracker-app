// src/lib/delete-all.js
// Full-account purge helpers used by Settings “Delete All Data”.
import { db, storage, auth } from "../firebase-config";
import {
  writeBatch,
  collection,
  query,
  limit as qLimit,
  getDocs,
  doc,
} from "firebase/firestore";

// ---------- Firestore purge (batched) ----------
const DEFAULT_BATCH_SIZE = 300;

async function deleteUserSubcollection(
  uid,
  collName,
  { batchSize = DEFAULT_BATCH_SIZE } = {}
) {
  const colRef = collection(db, "users", uid, collName);
  let total = 0;
  while (true) {
    const page = await getDocs(query(colRef, qLimit(batchSize)));
    if (page.size === 0) break;
    const batch = writeBatch(db);
    page.forEach((snap) =>
      batch.delete(doc(db, "users", uid, collName, snap.id))
    );
    await batch.commit();
    total += page.size;
    await new Promise((r) => setTimeout(r, 0)); // yield to UI
  }
  return total;
}

/** Deletes all known subcollections under users/{uid}. */
export async function deleteAllUserFirestore(uid, progress = () => {}) {
  // NOTE: Extra names are included intentionally — they are safe no-ops if absent.
  // This list now covers Strain Library / Storage collections too.
  const collections = [
    // core
    "grows",
    "recipes",
    "supplies",
    "labels",
    "strains",
    "clean_queue",
    "tasks",
    "timeline",
    "analytics",
    "events",
    "notes",
    "images",
    "audit",
    "logs",

    // strain library / storage (cover common variants)
    "library",
    "library_items",
    "strain_library",
    "strainLibrary",
    "strainLibraryItems",
    "storage",
    "storages",
  ];

  let deleted = 0;
  for (const name of collections) {
    progress(`Deleting ${name}…`);
    deleted += await deleteUserSubcollection(uid, name);
  }
  return { deleted };
}

// ---------- Storage purge (best-effort) ----------
async function deleteAllUserStorage(uid, progress = () => {}) {
  try {
    const { ref, listAll, deleteObject } = await import("firebase/storage");
    const root = ref(storage, `users/${uid}`);
    async function walkAndDelete(prefixRef) {
      const { items, prefixes } = await listAll(prefixRef);
      for (const item of items) {
        await deleteObject(item).catch(() => {});
      }
      for (const p of prefixes) await walkAndDelete(p);
    }
    progress("Deleting Storage files…");
    await walkAndDelete(root);
    return { deletedFiles: true };
  } catch {
    return { deletedFiles: false };
  }
}

// ---------- Local cache purge ----------
export async function clearAllLocalCaches() {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
  const dbs = [
    "firebaseLocalStorageDb",
    "firebase-heartbeat-database",
    "firebase-installations-database",
    "firebase-messaging-database",
    "firestore/[DEFAULT]/main",
    "firestore/[DEFAULT]/primary",
  ];
  await Promise.allSettled(
    dbs.map(
      (name) =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        })
    )
  );
}

/** High-level entry called from Settings. Leaves Auth account intact. */
export async function deleteAllUserData({ progress = () => {} } = {}) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in.");
  progress("Purging Firestore…");
  const fs = await deleteAllUserFirestore(uid, progress);
  progress("Purging Storage…");
  const st = await deleteAllUserStorage(uid, progress);
  return { ...fs, ...st };
}
