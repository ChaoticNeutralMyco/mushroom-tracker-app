// src/hooks/usePhotos.js
import { useEffect, useMemo, useState, useCallback } from "react";
import { auth, db, storage } from "../firebase-config";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
  deleteObject,
} from "firebase/storage";

/**
 * Photo management for a grow.
 * Collection: users/{uid}/photos (photo docs)
 * Storage:    users/{uid}/photos/{growId}/...
 * Grow cover: users/{uid}/grows/{growId} fields: coverPhotoId, coverUrl, coverStoragePath
 */
export function usePhotos(growId) {
  const [items, setItems] = useState([]);
  const [isLoading, setLoading] = useState(true);
  const [coverPhotoId, setCoverPhotoId] = useState(null);

  const uid = auth.currentUser?.uid || null;

  const colRef = useMemo(() => (uid ? collection(db, "users", uid, "photos") : null), [uid]);
  const growDocRef = useMemo(
    () => (uid && growId ? doc(db, "users", uid, "grows", growId) : null),
    [uid, growId]
  );

  // Photos for this grow
  useEffect(() => {
    if (!colRef || !growId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(colRef, where("growId", "==", growId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => {
          const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : +new Date(a.createdAt || 0);
          const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : +new Date(b.createdAt || 0);
          return tb - ta;
        });
        setItems(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [colRef, growId]);

  // Cover listener
  useEffect(() => {
    if (!growDocRef) {
      setCoverPhotoId(null);
      return;
    }
    const unsub = onSnapshot(growDocRef, (snap) => {
      setCoverPhotoId(snap.data()?.coverPhotoId || null);
    });
    return () => unsub();
  }, [growDocRef]);

  // Upload
  const uploadPhoto = useCallback(
    async (file, { stage = "", caption = "" } = {}) => {
      if (!uid || !growId) throw new Error("Not signed in or missing growId");
      if (!file) throw new Error("No file selected");

      const safeStage = stage || "Unsorted";
      const storagePath = `users/${uid}/photos/${growId}/${safeStage}/${Date.now()}_${file.name}`;
      const r = storageRef(storage, storagePath);

      await uploadBytes(r, file);
      const url = await getDownloadURL(r);

      await addDoc(collection(db, "users", uid, "photos"), {
        url,
        storagePath,
        stage: stage || null,
        caption: caption || "",
        growId,
        createdAt: serverTimestamp(),
      });

      return { storagePath, url };
    },
    [uid, growId]
  );

  const pathFromDownloadURL = (url) => {
    try {
      const m = String(url).match(/\/o\/([^?]+)/);
      if (m && m[1]) return decodeURIComponent(m[1]);
    } catch {}
    return null;
  };

  // Delete one (optimistic)
  const deletePhoto = useCallback(
    async (photo) => {
      if (!uid || !growId || !photo?.id) return;

      const prev = items;
      setItems((curr) => curr.filter((x) => x.id !== photo.id));
      try {
        const storagePath = photo.storagePath || pathFromDownloadURL(photo.url);
        if (storagePath) {
          try {
            await deleteObject(storageRef(storage, storagePath));
          } catch (e) {
            console.warn("Storage delete warning:", e?.message || e);
          }
        }
        await deleteDoc(doc(db, "users", uid, "photos", photo.id));

        // If it was the cover, clear the grow
        if (photo.id === coverPhotoId && growDocRef) {
          try {
            const g = await getDoc(growDocRef);
            if (g.exists() && g.data()?.coverPhotoId === photo.id) {
              await updateDoc(growDocRef, {
                coverPhotoId: null,
                coverUrl: null,
                coverStoragePath: null,
                coverUpdatedAt: serverTimestamp(),
              });
            }
          } catch (e) {
            console.warn("Cover clear warning:", e?.message || e);
          }
        }
      } catch (err) {
        setItems(prev);
        throw err;
      }
    },
    [uid, growId, items, coverPhotoId, growDocRef]
  );

  // Batch delete
  const deletePhotos = useCallback(
    async (photos = []) => {
      for (const p of photos) {
        // eslint-disable-next-line no-await-in-loop
        await deletePhoto(p);
      }
    },
    [deletePhoto]
  );

  // Update fields (caption, stage)
  const updatePhoto = useCallback(
    async (photoId, patch = {}) => {
      if (!uid || !photoId) return;
      const allowed = {};
      if (typeof patch.caption === "string") allowed.caption = patch.caption;
      if (typeof patch.stage === "string" || patch.stage === null) allowed.stage = patch.stage || null;
      if (!Object.keys(allowed).length) return;

      await updateDoc(doc(db, "users", uid, "photos", photoId), allowed);
      setItems((curr) => curr.map((x) => (x.id === photoId ? { ...x, ...allowed } : x)));
    },
    [uid]
  );

  // Set cover
  const setCover = useCallback(
    async (photo) => {
      if (!uid || !growDocRef || !photo?.id) return;
      await updateDoc(growDocRef, {
        coverPhotoId: photo.id,
        coverUrl: photo.url || null,
        coverStoragePath: photo.storagePath || pathFromDownloadURL(photo.url) || null,
        coverUpdatedAt: serverTimestamp(),
      });
      setCoverPhotoId(photo.id);
    },
    [uid, growDocRef]
  );

  return {
    data: items,
    isLoading,
    coverPhotoId,
    uploadPhoto,
    deletePhoto,
    deletePhotos,
    updatePhoto,
    setCover,
  };
}
