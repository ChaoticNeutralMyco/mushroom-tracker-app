// src/lib/storage-locations.js
import { collection, addDoc, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";

export const DEFAULT_STORAGE_LOCATIONS = ["Fridge", "Freezer", "Room"];

/** users/{uid}/storageLocations */
export function colRef(db, uid) { return collection(db, "users", uid, "storageLocations"); }

export async function seedDefaultsIfEmpty(db, uid) {
  const snap = await getDocs(query(colRef(db, uid), orderBy("order", "asc")));
  if (!snap.empty) return false;
  await Promise.all(DEFAULT_STORAGE_LOCATIONS.map((name, idx) => addDoc(colRef(db, uid), { name, order: idx, createdAt: new Date().toISOString() })));
  return true;
}

export function subscribeLocations(db, uid, set) {
  const q = query(colRef(db, uid), orderBy("order", "asc"));
  return onSnapshot(q, (snap) => set(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function addLocation(db, uid, name, orderHint = null) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  let order = orderHint;
  if (order == null) {
    const snap = await getDocs(query(colRef(db, uid), orderBy("order", "asc")));
    order = snap.size;
  }
  const docRef = await addDoc(colRef(db, uid), { name: clean, order, createdAt: new Date().toISOString() });
  return docRef.id;
}

export async function renameLocation(db, uid, id, name) {
  const clean = String(name || "").trim();
  if (!clean || !id) return;
  await updateDoc(doc(db, "users", uid, "storageLocations", id), { name: clean });
}

export async function deleteLocation(db, uid, id) {
  if (!id) return;
  await deleteDoc(doc(db, "users", uid, "storageLocations", id));
}

export async function moveLocation(db, uid, rows, fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const list = rows.slice();
  const [it] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, it);
  await Promise.all(list.map((r, i) => updateDoc(doc(db, "users", uid, "storageLocations", r.id), { order: i })));
}
