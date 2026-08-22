// src/lib/photo-storage.js
import {
  addDoc as firebaseAddDoc,
  collection as firebaseCollection,
  doc as firebaseDoc,
  getDoc as firebaseGetDoc,
  serverTimestamp as firebaseServerTimestamp,
  updateDoc as firebaseUpdateDoc,
  writeBatch as firebaseWriteBatch,
} from "firebase/firestore";
import {
  deleteObject as firebaseDeleteObject,
  getDownloadURL as firebaseGetDownloadURL,
  ref as firebaseStorageRef,
  uploadBytes as firebaseUploadBytes,
} from "firebase/storage";

const DEFAULT_STAGE_FOLDER = "General";
const MAX_SEGMENT_LENGTH = 120;

function asDate(value) {
  if (!value) return null;
  try {
    if (typeof value?.toDate === "function") {
      const date = value.toDate();
      return Number.isNaN(date?.getTime?.()) ? null : date;
    }
    if (typeof value?.toMillis === "function") {
      const date = new Date(value.toMillis());
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (
      typeof value === "object" &&
      Number.isFinite(Number(value.seconds))
    ) {
      const millis =
        Number(value.seconds) * 1000 +
        Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

export function sanitizeStorageSegment(value, fallback = "item") {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, MAX_SEGMENT_LENGTH);

  return normalized || fallback;
}

export function extractStoragePathFromUrl(url) {
  try {
    const match = String(url || "").match(/\/o\/([^?]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function getPhotoStoragePath(photo) {
  return photo?.storagePath || extractStoragePathFromUrl(photo?.url) || null;
}

export function getPhotoTimeMs(photo) {
  const date = asDate(photo?.createdAt || photo?.timestamp || null);
  return date ? date.getTime() : 0;
}

export function sortPhotoRecordsNewestFirst(photos = []) {
  return (Array.isArray(photos) ? photos : [])
    .slice()
    .sort((a, b) => getPhotoTimeMs(b) - getPhotoTimeMs(a));
}

export function normalizePhotoRecord(photo = {}) {
  const createdAtDate = asDate(photo.createdAt);
  const legacyDate = asDate(photo.timestamp);
  const timestamp =
    photo.timestamp ||
    (createdAtDate ? createdAtDate.toISOString() : legacyDate?.toISOString?.() || null);

  return {
    ...photo,
    growId: photo.growId || "",
    stage: photo.stage || null,
    caption: typeof photo.caption === "string" ? photo.caption : "",
    storagePath: getPhotoStoragePath(photo),
    timestamp,
  };
}

export function buildGrowPhotoStoragePath({
  uid,
  growId,
  stage,
  fileName,
  now = Date.now(),
}) {
  if (!uid) throw new Error("Missing user ID.");
  if (!growId) throw new Error("Missing grow ID.");

  const safeGrowId = sanitizeStorageSegment(growId, "grow");
  const safeStage = sanitizeStorageSegment(stage || DEFAULT_STAGE_FOLDER, DEFAULT_STAGE_FOLDER);
  const safeName = sanitizeStorageSegment(fileName || "photo", "photo");
  return `users/${uid}/photos/${safeGrowId}/${safeStage}/${Number(now)}_${safeName}`;
}

export function buildGrowPhotoRecord({
  growId,
  url,
  storagePath,
  stage = null,
  caption = "",
  file = null,
  createdAt = null,
  now = Date.now(),
}) {
  if (!growId) throw new Error("Missing grow ID.");
  if (!url) throw new Error("Missing photo URL.");
  if (!storagePath) throw new Error("Missing Storage path.");

  const normalizedStage = String(stage || "").trim() || null;
  const record = {
    growId,
    url,
    storagePath,
    caption: String(caption || "").trim(),
    stage: normalizedStage,
    createdAt,
    timestamp: new Date(Number(now)).toISOString(),
  };

  if (file?.name) record.originalName = String(file.name);
  if (file?.type) record.contentType = String(file.type);
  if (Number.isFinite(Number(file?.size))) record.sizeBytes = Number(file.size);

  return record;
}

function resolveDependencies(dependencies = {}) {
  return {
    addDoc: dependencies.addDoc || firebaseAddDoc,
    collection: dependencies.collection || firebaseCollection,
    doc: dependencies.doc || firebaseDoc,
    getDoc: dependencies.getDoc || firebaseGetDoc,
    serverTimestamp: dependencies.serverTimestamp || firebaseServerTimestamp,
    updateDoc: dependencies.updateDoc || firebaseUpdateDoc,
    writeBatch: dependencies.writeBatch || firebaseWriteBatch,
    storageRef: dependencies.storageRef || firebaseStorageRef,
    uploadBytes: dependencies.uploadBytes || firebaseUploadBytes,
    getDownloadURL: dependencies.getDownloadURL || firebaseGetDownloadURL,
    deleteObject: dependencies.deleteObject || firebaseDeleteObject,
  };
}

export async function uploadGrowPhoto({
  db,
  storage,
  uid,
  growId,
  file,
  stage = null,
  caption = "",
  now = Date.now(),
  dependencies = {},
}) {
  if (!db) throw new Error("Firestore is unavailable.");
  if (!storage) throw new Error("Firebase Storage is unavailable.");
  if (!uid) throw new Error("Not signed in.");
  if (!growId) throw new Error("Missing grow ID.");
  if (!file) throw new Error("No file selected.");

  const api = resolveDependencies(dependencies);
  const storagePath = buildGrowPhotoStoragePath({
    uid,
    growId,
    stage,
    fileName: file.name,
    now,
  });
  const fileRef = api.storageRef(storage, storagePath);
  const metadata = file.type ? { contentType: file.type } : undefined;

  await api.uploadBytes(fileRef, file, metadata);

  try {
    const url = await api.getDownloadURL(fileRef);
    const record = buildGrowPhotoRecord({
      growId,
      url,
      storagePath,
      stage,
      caption,
      file,
      createdAt: api.serverTimestamp(),
      now,
    });
    const documentRef = await api.addDoc(
      api.collection(db, "users", uid, "photos"),
      record
    );
    return { id: documentRef?.id || null, ...record };
  } catch (error) {
    try {
      await api.deleteObject(fileRef);
    } catch (cleanupError) {
      console.warn(
        "Photo upload rollback warning:",
        cleanupError?.message || cleanupError
      );
    }
    throw error;
  }
}

export async function deletePhotoStorageFile({
  storage,
  photo,
  dependencies = {},
}) {
  if (!storage) throw new Error("Firebase Storage is unavailable.");
  const storagePath = getPhotoStoragePath(photo);
  if (!storagePath) return false;

  const api = resolveDependencies(dependencies);
  const fileRef = api.storageRef(storage, storagePath);

  try {
    await api.deleteObject(fileRef);
    return true;
  } catch (error) {
    const code = String(error?.code || "").toLowerCase();
    if (code.includes("object-not-found")) return false;
    throw error;
  }
}

export async function deleteGrowPhoto({
  db,
  storage,
  uid,
  photo,
  growId = photo?.growId || "",
  dependencies = {},
}) {
  if (!db) throw new Error("Firestore is unavailable.");
  if (!storage) throw new Error("Firebase Storage is unavailable.");
  if (!uid) throw new Error("Not signed in.");
  if (!photo?.id) throw new Error("Missing photo ID.");

  const api = resolveDependencies(dependencies);

  // Remove the binary first. If Firestore cleanup later fails, the visible record
  // remains retryable and a second delete tolerates the already-missing object.
  const storageDeleted = await deletePhotoStorageFile({
    storage,
    photo,
    dependencies,
  });

  const photoRef = api.doc(db, "users", uid, "photos", photo.id);
  const batch = api.writeBatch(db);
  let coverCleared = false;

  if (growId) {
    const growRef = api.doc(db, "users", uid, "grows", growId);
    const growSnapshot = await api.getDoc(growRef);
    if (growSnapshot.exists() && growSnapshot.data()?.coverPhotoId === photo.id) {
      batch.update(growRef, {
        coverPhotoId: null,
        coverUrl: null,
        coverStoragePath: null,
        coverUpdatedAt: api.serverTimestamp(),
      });
      coverCleared = true;
    }
  }

  batch.delete(photoRef);
  await batch.commit();

  return { storageDeleted, coverCleared };
}

export async function setGrowCoverPhoto({
  db,
  uid,
  growId,
  photo,
  dependencies = {},
}) {
  if (!db) throw new Error("Firestore is unavailable.");
  if (!uid) throw new Error("Not signed in.");
  if (!growId) throw new Error("Missing grow ID.");
  if (!photo?.id || !photo?.url) throw new Error("Missing photo data.");

  const api = resolveDependencies(dependencies);
  const patch = {
    coverPhotoId: photo.id,
    coverUrl: photo.url,
    coverStoragePath: getPhotoStoragePath(photo),
    coverUpdatedAt: api.serverTimestamp(),
  };

  await api.updateDoc(api.doc(db, "users", uid, "grows", growId), patch);
  return patch;
}
