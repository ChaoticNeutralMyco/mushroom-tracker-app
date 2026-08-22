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
import {
  GROW_DATA_COLLECTIONS,
  NESTED_USER_DATA_COLLECTIONS,
  USER_DATA_COLLECTIONS,
} from "./user-data-backup";

// ---------- Firestore purge (batched) ----------
const DEFAULT_BATCH_SIZE = 300;

async function deleteCollectionRef(
  colRef,
  { batchSize = DEFAULT_BATCH_SIZE } = {}
) {
  let total = 0;
  while (true) {
    const page = await getDocs(query(colRef, qLimit(batchSize)));
    if (page.size === 0) break;
    const batch = writeBatch(db);
    page.forEach((snap) => batch.delete(snap.ref));
    await batch.commit();
    total += page.size;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return total;
}

async function deleteUserSubcollection(
  uid,
  collName,
  { batchSize = DEFAULT_BATCH_SIZE } = {}
) {
  const colRef = collection(db, "users", uid, collName);
  const nestedNames = NESTED_USER_DATA_COLLECTIONS[collName] || [];
  let total = 0;

  while (true) {
    const page = await getDocs(query(colRef, qLimit(batchSize)));
    if (page.size === 0) break;

    for (const snap of page.docs) {
      for (const nestedName of nestedNames) {
        total += await deleteCollectionRef(
          collection(db, "users", uid, collName, snap.id, nestedName),
          { batchSize }
        );
      }
    }

    const batch = writeBatch(db);
    page.forEach((snap) => batch.delete(doc(db, "users", uid, collName, snap.id)));
    await batch.commit();
    total += page.size;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return total;
}

/** Deletes all known app-owned subcollections under users/{uid}. */
export async function deleteAllUserFirestore(uid, progress = () => {}) {
  let deleted = 0;
  for (const name of USER_DATA_COLLECTIONS) {
    progress(`Deleting ${name}…`);
    deleted += await deleteUserSubcollection(uid, name);
  }
  return { deleted };
}

async function deleteStoragePrefix(path) {
  const { ref, listAll, deleteObject } = await import("firebase/storage");
  const root = ref(storage, path);
  let deletedFiles = 0;

  async function walkAndDelete(prefixRef) {
    const { items, prefixes } = await listAll(prefixRef);
    for (const item of items) {
      try {
        await deleteObject(item);
        deletedFiles += 1;
      } catch {
        // Continue best-effort cleanup for the remaining files.
      }
    }
    for (const child of prefixes) await walkAndDelete(child);
  }

  await walkAndDelete(root);
  return deletedFiles;
}

/** Deletes grow, task, photo, and post-processing data while preserving recipes/settings. */
export async function deleteGrowDataOnly(progress = () => {}) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in.");

  let deleted = 0;
  for (const name of GROW_DATA_COLLECTIONS) {
    progress(`Deleting ${name}…`);
    deleted += await deleteUserSubcollection(uid, name);
  }

  // Live grow photos use users/{uid}/photos. Keep the old grows prefix cleanup
  // as a compatibility pass for earlier builds that stored files there.
  let deletedFiles = 0;
  let storageCleanupAttempted = false;
  try {
    storageCleanupAttempted = true;
    progress("Deleting grow photo files…");
    deletedFiles += await deleteStoragePrefix(`users/${uid}/photos`);
    deletedFiles += await deleteStoragePrefix(`users/${uid}/grows`);
  } catch {
    // Storage cleanup remains best-effort; Firestore deletion has already completed.
  }

  return { deleted, deletedFiles, storageCleanupAttempted };
}

// ---------- Storage purge (best-effort) ----------
async function deleteAllUserStorage(uid, progress = () => {}) {
  try {
    progress("Deleting Storage files…");
    const deletedFileCount = await deleteStoragePrefix(`users/${uid}`);
    return { deletedFiles: true, deletedFileCount };
  } catch {
    return { deletedFiles: false, deletedFileCount: 0 };
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

/** High-level entry called from Settings. Leaves the Firebase Auth account intact. */
export async function deleteAllUserData({ progress = () => {} } = {}) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not signed in.");
  progress("Purging Firestore…");
  const firestoreResult = await deleteAllUserFirestore(uid, progress);
  progress("Purging Storage…");
  const storageResult = await deleteAllUserStorage(uid, progress);
  return { ...firestoreResult, ...storageResult };
}
