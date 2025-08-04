<<<<<<< HEAD
import React, { useRef } from "react";

export default function PhotoUpload({ growId, photos, onUpload }) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    const photoURLs = files.map((file) => URL.createObjectURL(file));

    // You could store the actual file in state if you want to persist uploads
    onUpload(growId, photoURLs);
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow-md mt-4">
      <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-white">
        Upload Photos
      </h3>

      <div className="flex items-center space-x-4">
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileChange}
          ref={fileInputRef}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current.click()}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          Select Images
        </button>
      </div>

      {photos && photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-4">
          {photos.map((src, index) => (
            <img
              key={index}
              src={src}
              alt={`Grow ${growId} Photo ${index + 1}`}
              className="w-full h-24 object-cover rounded border border-gray-300"
            />
          ))}
        </div>
=======
import React, { useState, useEffect } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, auth, db } from "../firebase-config";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";

export default function PhotoUpload({ grows }) {
  const [selectedGrow, setSelectedGrow] = useState("");
  const [image, setImage] = useState(null);
  const [caption, setCaption] = useState("");
  const [photos, setPhotos] = useState([]);

  useEffect(() => {
    if (selectedGrow) {
      fetchPhotos();
    } else {
      setPhotos([]);
    }
  }, [selectedGrow]);

  const fetchPhotos = async () => {
    const user = auth.currentUser;
    if (!user || !selectedGrow) return;
    const photosRef = collection(
      db,
      `users/${user.uid}/grows/${selectedGrow}/photos`
    );
    const q = query(photosRef, orderBy("timestamp", "desc"));
    const snapshot = await getDocs(q);
    const photoData = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    setPhotos(photoData);
  };

  const handleUpload = async () => {
    if (!selectedGrow || !image) {
      alert("⚠️ Please select a grow and a photo.");
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) return;

      const fileName = `${Date.now()}_${image.name}`;
      const storageRef = ref(
        storage,
        `grows/${user.uid}/${selectedGrow}/${fileName}`
      );

      await uploadBytes(storageRef, image);
      const downloadURL = await getDownloadURL(storageRef);

      const photoData = {
        url: downloadURL,
        caption,
        timestamp: Timestamp.now(),
      };

      await addDoc(
        collection(db, `users/${user.uid}/grows/${selectedGrow}/photos`),
        photoData
      );

      setImage(null);
      setCaption("");
      fetchPhotos();
      alert("✅ Photo uploaded!");
    } catch (err) {
      console.error("❌ Upload failed:", err);
      alert("Upload failed.");
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white p-6 rounded-2xl mt-6 shadow max-w-3xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">📸 Grow Photo Timeline</h2>

      <div>
        <label className="block text-sm font-medium mb-1">Select Grow</label>
        <select
          value={selectedGrow}
          onChange={(e) => setSelectedGrow(e.target.value)}
          className="w-full p-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="">Select a grow</option>
          {grows.map((g) => (
            <option key={g.id} value={g.id}>
              {g.strain || "Unnamed Grow"} — {g.inoculation}
            </option>
          ))}
        </select>
      </div>

      {selectedGrow && (
        <>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Choose Photo
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImage(e.target.files[0])}
                className="block w-full text-sm file:mr-4 file:py-2 file:px-4
                   file:rounded-md file:border-0
                   file:text-sm file:font-semibold
                   file:bg-blue-600 file:text-white
                   hover:file:bg-blue-700
                   dark:file:bg-blue-500 dark:hover:file:bg-blue-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Caption</label>
              <input
                type="text"
                placeholder="e.g. Fruiting begins"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
              />
            </div>

            <button
              onClick={handleUpload}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded w-full transition"
            >
              🚀 Upload Photo
            </button>
          </div>

          {photos.length > 0 && (
            <div className="mt-6 space-y-4">
              <h3 className="text-lg font-semibold">🖼️ Timeline</h3>
              <div className="space-y-4">
                {photos.map((p) => (
                  <div
                    key={p.id}
                    className="bg-zinc-100 dark:bg-zinc-800 rounded shadow overflow-hidden"
                  >
                    <img
                      src={p.url}
                      alt={p.caption}
                      className="w-full max-h-72 object-cover"
                    />
                    <div className="p-3 text-sm">
                      <p className="font-medium">{p.caption}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {p.timestamp?.toDate().toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
>>>>>>> be7d1a18 (Initial commit with final polished version)
      )}
    </div>
  );
}
