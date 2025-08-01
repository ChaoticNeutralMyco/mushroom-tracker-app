import React, { useEffect, useState } from "react";
import { db, auth } from "./firebase-config";
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  query,
  orderBy,
} from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";

const GrowList = ({ onEdit }) => {
  const [grows, setGrows] = useState([]);
  const [user] = useAuthState(auth);

  useEffect(() => {
    if (!user) return;
    const growsRef = collection(db, "users", user.uid, "grows");
    const q = query(growsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setGrows(items);
    });

    return unsubscribe;
  }, [user]);

  const handleDelete = async (id) => {
    const docRef = doc(db, "users", user.uid, "grows", id);
    await deleteDoc(docRef);
  };

  return (
    <div className="space-y-2 p-4">
      <h2 className="text-xl font-semibold">Your Grows</h2>
      {grows.map((grow) => (
        <div key={grow.id} className="p-3 border rounded shadow-sm bg-white dark:bg-gray-700">
          <p><strong>Strain:</strong> {grow.strain}</p>
          <p><strong>Stage:</strong> {grow.stage}</p>
          <p className="text-sm text-gray-500">{grow.notes}</p>
          <div className="flex space-x-2 mt-2">
            <button onClick={() => onEdit(grow)} className="px-3 py-1 bg-blue-500 text-white rounded">Edit</button>
            <button onClick={() => handleDelete(grow.id)} className="px-3 py-1 bg-red-500 text-white rounded">Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default GrowList;
