import { collection, doc, getDocs, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";

export const saveUserGrows = async (userId, grows) => {
  await setDoc(doc(db, "grows", userId), { grows });
};

export const loadUserGrows = async (userId) => {
  const docRef = doc(db, "grows", userId);
  const docSnap = await getDocs(collection(db, "grows"));
  return docSnap.exists() ? docSnap.data().grows : [];
};
