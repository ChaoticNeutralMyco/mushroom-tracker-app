// src/utils/firestore.js
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase-config";

export const saveUserGrows = async (userId, grows) => {
  if (!userId) {
    throw new Error("saveUserGrows: userId is required");
  }

  const safeGrows = Array.isArray(grows) ? grows : [];
  await setDoc(doc(db, "grows", userId), { grows: safeGrows });
};

export const loadUserGrows = async (userId) => {
  if (!userId) return [];

  const docSnap = await getDoc(doc(db, "grows", userId));
  if (!docSnap.exists()) return [];

  const data = docSnap.data() || {};
  return Array.isArray(data.grows) ? data.grows : [];
};

export const deleteUserGrows = async (userId) => {
  if (!userId) {
    throw new Error("deleteUserGrows: userId is required");
  }

  await deleteDoc(doc(db, "grows", userId));
};