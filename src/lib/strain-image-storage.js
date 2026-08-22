// src/lib/strain-image-storage.js
import {
  deleteObject as firebaseDeleteObject,
  getDownloadURL as firebaseGetDownloadURL,
  ref as firebaseStorageRef,
  uploadBytes as firebaseUploadBytes,
} from "firebase/storage";
import {
  extractStoragePathFromUrl,
  sanitizeStorageSegment,
} from "./photo-storage";

export const STRAIN_IMAGE_KIND_PROFILE = "profile";
export const STRAIN_IMAGE_KIND_CARD = "card";

function normalizeKind(kind) {
  return kind === STRAIN_IMAGE_KIND_CARD
    ? STRAIN_IMAGE_KIND_CARD
    : STRAIN_IMAGE_KIND_PROFILE;
}

function folderForKind(kind) {
  return normalizeKind(kind) === STRAIN_IMAGE_KIND_CARD
    ? "strain-cards"
    : "strains";
}

function inferKindFromPath(path) {
  return String(path || "").includes("/strain-cards/")
    ? STRAIN_IMAGE_KIND_CARD
    : STRAIN_IMAGE_KIND_PROFILE;
}

function resolveDependencies(dependencies = {}) {
  return {
    storageRef: dependencies.storageRef || firebaseStorageRef,
    uploadBytes: dependencies.uploadBytes || firebaseUploadBytes,
    getDownloadURL: dependencies.getDownloadURL || firebaseGetDownloadURL,
    deleteObject: dependencies.deleteObject || firebaseDeleteObject,
  };
}

export function buildStrainImageStoragePath({
  uid,
  kind = STRAIN_IMAGE_KIND_PROFILE,
  fileName,
  now = Date.now(),
}) {
  if (!uid) throw new Error("Missing user ID.");
  const folder = folderForKind(kind);
  const safeName = sanitizeStorageSegment(fileName || "strain-image", "strain-image");
  return `users/${uid}/${folder}/${Number(now)}_${safeName}`;
}

export function isManagedStrainStoragePath(path, uid = null) {
  const value = String(path || "").trim();
  if (!value) return false;

  if (uid) {
    const ownerPrefix = `users/${uid}/`;
    if (!value.startsWith(ownerPrefix)) return false;
    const remainder = value.slice(ownerPrefix.length);
    return remainder.startsWith("strains/") || remainder.startsWith("strain-cards/");
  }

  return /^users\/[^/]+\/(strains|strain-cards)\//.test(value);
}

export function getStrainImageStoragePath(asset = {}) {
  const path =
    asset?.storagePath ||
    asset?.photoStoragePath ||
    asset?.frontArtStoragePath ||
    extractStoragePathFromUrl(
      asset?.url || asset?.photoURL || asset?.frontArtUrl || ""
    );
  return path || null;
}

function normalizeAsset(asset = {}, fallbackKind = STRAIN_IMAGE_KIND_PROFILE) {
  const storagePath = getStrainImageStoragePath(asset);
  const kind = normalizeKind(asset?.kind || inferKindFromPath(storagePath) || fallbackKind);
  return {
    kind,
    url: String(
      asset?.url ||
        asset?.photoURL ||
        asset?.frontArtUrl ||
        ""
    ),
    storagePath,
  };
}

export function getStrainStorageAssets(strain = {}, uid = null) {
  const assets = [];

  const profile = normalizeAsset(
    {
      kind: STRAIN_IMAGE_KIND_PROFILE,
      url: strain?.photoURL || "",
      storagePath: strain?.photoStoragePath || null,
    },
    STRAIN_IMAGE_KIND_PROFILE
  );
  if (profile.storagePath && isManagedStrainStoragePath(profile.storagePath, uid)) {
    assets.push(profile);
  }

  const card = normalizeAsset(
    {
      kind: STRAIN_IMAGE_KIND_CARD,
      url: strain?.cardBuilder?.frontArtUrl || "",
      storagePath: strain?.cardBuilder?.frontArtStoragePath || null,
    },
    STRAIN_IMAGE_KIND_CARD
  );
  if (card.storagePath && isManagedStrainStoragePath(card.storagePath, uid)) {
    assets.push(card);
  }

  const pending = Array.isArray(strain?.pendingStorageCleanupPaths)
    ? strain.pendingStorageCleanupPaths
    : [];

  pending.forEach((entry) => {
    const asset = normalizeAsset(
      typeof entry === "string" ? { storagePath: entry } : entry,
      inferKindFromPath(typeof entry === "string" ? entry : entry?.storagePath)
    );
    if (asset.storagePath && isManagedStrainStoragePath(asset.storagePath, uid)) {
      assets.push(asset);
    }
  });

  const byPath = new Map();
  assets.forEach((asset) => {
    if (!byPath.has(asset.storagePath)) byPath.set(asset.storagePath, asset);
  });
  return Array.from(byPath.values());
}

export async function uploadStrainImageAsset({
  storage,
  uid,
  file,
  kind = STRAIN_IMAGE_KIND_PROFILE,
  now = Date.now(),
  dependencies = {},
}) {
  if (!storage) throw new Error("Firebase Storage is unavailable.");
  if (!uid) throw new Error("Not signed in.");
  if (!file) throw new Error("No image selected.");

  const normalizedKind = normalizeKind(kind);
  const storagePath = buildStrainImageStoragePath({
    uid,
    kind: normalizedKind,
    fileName: file.name,
    now,
  });
  const api = resolveDependencies(dependencies);
  const fileRef = api.storageRef(storage, storagePath);
  const metadata = file.type ? { contentType: file.type } : undefined;

  await api.uploadBytes(fileRef, file, metadata);

  try {
    const url = await api.getDownloadURL(fileRef);
    return {
      kind: normalizedKind,
      url,
      storagePath,
      originalName: file?.name ? String(file.name) : "",
      contentType: file?.type ? String(file.type) : "",
      sizeBytes: Number.isFinite(Number(file?.size)) ? Number(file.size) : null,
    };
  } catch (error) {
    try {
      await api.deleteObject(fileRef);
    } catch (cleanupError) {
      console.warn(
        "Strain image upload rollback warning:",
        cleanupError?.message || cleanupError
      );
    }
    throw error;
  }
}

export async function deleteStrainImageAsset({
  storage,
  asset,
  uid = null,
  dependencies = {},
}) {
  if (!storage) throw new Error("Firebase Storage is unavailable.");
  const storagePath = getStrainImageStoragePath(asset);
  if (!storagePath || !isManagedStrainStoragePath(storagePath, uid)) return false;

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

export async function cleanupStrainImageAssets({
  storage,
  assets,
  uid = null,
  dependencies = {},
}) {
  const uniqueAssets = [];
  const seen = new Set();

  (Array.isArray(assets) ? assets : []).forEach((entry) => {
    const asset = normalizeAsset(
      typeof entry === "string" ? { storagePath: entry } : entry,
      inferKindFromPath(typeof entry === "string" ? entry : entry?.storagePath)
    );
    if (!asset.storagePath || seen.has(asset.storagePath)) return;
    if (!isManagedStrainStoragePath(asset.storagePath, uid)) return;
    seen.add(asset.storagePath);
    uniqueAssets.push(asset);
  });

  const deletedPaths = [];
  const failed = [];

  for (const asset of uniqueAssets) {
    try {
      await deleteStrainImageAsset({
        storage,
        asset,
        uid,
        dependencies,
      });
      deletedPaths.push(asset.storagePath);
    } catch (error) {
      failed.push({
        ...asset,
        error,
      });
    }
  }

  return { deletedPaths, failed };
}
