// src/components/StrainManager.jsx
import React, { useState, useEffect } from "react";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase-config";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { UploadCloud, Trash2, Pencil } from "lucide-react";

export default function StrainManager() {
  const [strains, setStrains] = useState([]);
  const [form, setForm] = useState({
    name: "",
    description: "",
    genetics: "",
    notes: "",
    photoURL: "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const fetchStrains = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const snap = await getDocs(collection(db, "users", user.uid, "strains"));
    setStrains(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  useEffect(() => {
    fetchStrains();
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleImageChange = (e) => {
    setImageFile(e.target.files[0]);
  };

  const uploadImage = async () => {
    if (!imageFile) return "";
    const storage = getStorage();
    const storageRef = ref(storage, `strains/${auth.currentUser.uid}/${Date.now()}_${imageFile.name}`);
    await uploadBytes(storageRef, imageFile);
    return await getDownloadURL(storageRef);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    let photoURL = form.photoURL;
    if (imageFile) {
      photoURL = await uploadImage();
    }

    const data = {
      ...form,
      photoURL,
      updatedAt: serverTimestamp(),
    };

    if (editingId) {
      await updateDoc(doc(db, "users", user.uid, "strains", editingId), data);
    } else {
      await addDoc(collection(db, "users", user.uid, "strains"), {
        ...data,
        createdAt: serverTimestamp(),
      });
    }

    setForm({ name: "", description: "", genetics: "", notes: "", photoURL: "" });
    setImageFile(null);
    setEditingId(null);
    fetchStrains();
  };

  const handleEdit = (strain) => {
    setForm(strain);
    setEditingId(strain.id);
  };

  const handleDelete = async (id) => {
    const user = auth.currentUser;
    if (!user) return;
    await deleteDoc(doc(db, "users", user.uid, "strains", id));
    fetchStrains();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 p-4 rounded shadow space-y-4"
      >
        <h2 className="text-xl font-bold">{editingId ? "Edit Strain" : "Add Strain"}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            name="name"
            placeholder="Strain Name"
            value={form.name}
            onChange={handleChange}
            required
            className="p-2 rounded border dark:bg-gray-900 dark:border-gray-700"
          />
          <input
            name="genetics"
            placeholder="Genetics (e.g. P. cubensis GT)"
            value={form.genetics}
            onChange={handleChange}
            className="p-2 rounded border dark:bg-gray-900 dark:border-gray-700"
          />
          <input
            name="description"
            placeholder="Short Description"
            value={form.description}
            onChange={handleChange}
            className="p-2 rounded border dark:bg-gray-900 dark:border-gray-700 col-span-2"
          />
          <textarea
            name="notes"
            placeholder="Notes"
            value={form.notes}
            onChange={handleChange}
            className="p-2 rounded border dark:bg-gray-900 dark:border-gray-700 col-span-2"
          />
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="col-span-2"
          />
        </div>
        <button
          type="submit"
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          <UploadCloud className="w-4 h-4" />
          {editingId ? "Update Strain" : "Add Strain"}
        </button>
      </form>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {strains.map((strain) => (
          <div
            key={strain.id}
            className="bg-white dark:bg-gray-800 rounded shadow p-4 space-y-2 relative"
          >
            {strain.photoURL && (
              <img
                src={strain.photoURL}
                alt={strain.name}
                className="w-full h-40 object-cover rounded"
              />
            )}
            <h3 className="text-lg font-bold">{strain.name}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">{strain.genetics}</p>
            <p className="text-sm">{strain.description}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{strain.notes}</p>
            <div className="absolute top-2 right-2 flex gap-2">
              <button
                onClick={() => handleEdit(strain)}
                className="text-blue-500 hover:text-blue-700"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleDelete(strain.id)}
                className="text-red-500 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
