// tests/unit/photoStorage.test.js
import { describe, expect, it, vi } from "vitest";
import {
  buildGrowPhotoStoragePath,
  deletePhotoStorageFile,
  extractStoragePathFromUrl,
  getPhotoStoragePath,
  getPhotoTimeMs,
  normalizePhotoRecord,
  uploadGrowPhoto,
} from "../../src/lib/photo-storage";

const FIXED_NOW = Date.parse("2026-07-25T18:30:00.000Z");

function makeDependencies(overrides = {}) {
  return {
    storageRef: vi.fn((storage, path) => ({ storage, path })),
    uploadBytes: vi.fn(async () => undefined),
    getDownloadURL: vi.fn(async (fileRef) =>
      `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(
        fileRef.path
      )}?alt=media`
    ),
    collection: vi.fn((...parts) => parts.join("/")),
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
    addDoc: vi.fn(async () => ({ id: "photo-1" })),
    deleteObject: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("photo storage helpers", () => {
  it("builds owner-scoped, sanitized grow photo paths", () => {
    expect(
      buildGrowPhotoStoragePath({
        uid: "user-1",
        growId: "grow/one",
        stage: "Fruiting / Flush 1",
        fileName: "cap photo.jpg",
        now: FIXED_NOW,
      })
    ).toBe(
      `users/user-1/photos/grow-one/Fruiting - Flush 1/${FIXED_NOW}_cap photo.jpg`
    );
  });

  it("normalizes legacy photo records and recovers their Storage path", () => {
    const storagePath = "users/user-1/photos/grow-1/General/legacy.jpg";
    const url = `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(
      storagePath
    )}?alt=media`;
    const normalized = normalizePhotoRecord({
      id: "legacy-photo",
      growId: "grow-1",
      url,
      timestamp: "2026-07-20T12:00:00.000Z",
    });

    expect(extractStoragePathFromUrl(url)).toBe(storagePath);
    expect(getPhotoStoragePath(normalized)).toBe(storagePath);
    expect(normalized.caption).toBe("");
    expect(normalized.stage).toBeNull();
    expect(getPhotoTimeMs(normalized)).toBe(
      Date.parse("2026-07-20T12:00:00.000Z")
    );
  });

  it("writes the canonical metadata shape for a successful upload", async () => {
    const dependencies = makeDependencies();
    const file = {
      name: "flush-1.jpg",
      type: "image/jpeg",
      size: 2048,
    };

    const result = await uploadGrowPhoto({
      db: { name: "db" },
      storage: { name: "storage" },
      uid: "user-1",
      growId: "grow-1",
      file,
      stage: "Fruiting",
      caption: "  First flush  ",
      now: FIXED_NOW,
      dependencies,
    });

    expect(result.id).toBe("photo-1");
    expect(result).toMatchObject({
      growId: "grow-1",
      storagePath: `users/user-1/photos/grow-1/Fruiting/${FIXED_NOW}_flush-1.jpg`,
      caption: "First flush",
      stage: "Fruiting",
      timestamp: "2026-07-25T18:30:00.000Z",
      originalName: "flush-1.jpg",
      contentType: "image/jpeg",
      sizeBytes: 2048,
      createdAt: { __serverTimestamp: true },
    });
    expect(dependencies.addDoc).toHaveBeenCalledTimes(1);
    expect(dependencies.deleteObject).not.toHaveBeenCalled();
  });

  it("deletes the uploaded Storage file when Firestore metadata creation fails", async () => {
    const metadataError = new Error("metadata write failed");
    const dependencies = makeDependencies({
      addDoc: vi.fn(async () => {
        throw metadataError;
      }),
    });

    await expect(
      uploadGrowPhoto({
        db: { name: "db" },
        storage: { name: "storage" },
        uid: "user-1",
        growId: "grow-1",
        file: { name: "rollback.jpg", type: "image/jpeg", size: 100 },
        now: FIXED_NOW,
        dependencies,
      })
    ).rejects.toBe(metadataError);

    expect(dependencies.uploadBytes).toHaveBeenCalledTimes(1);
    expect(dependencies.deleteObject).toHaveBeenCalledTimes(1);
  });

  it("deletes the uploaded Storage file when the download URL cannot be read", async () => {
    const urlError = new Error("download URL failed");
    const dependencies = makeDependencies({
      getDownloadURL: vi.fn(async () => {
        throw urlError;
      }),
    });

    await expect(
      uploadGrowPhoto({
        db: { name: "db" },
        storage: { name: "storage" },
        uid: "user-1",
        growId: "grow-1",
        file: { name: "url-failure.jpg", type: "image/jpeg", size: 100 },
        now: FIXED_NOW,
        dependencies,
      })
    ).rejects.toBe(urlError);

    expect(dependencies.uploadBytes).toHaveBeenCalledTimes(1);
    expect(dependencies.addDoc).not.toHaveBeenCalled();
    expect(dependencies.deleteObject).toHaveBeenCalledTimes(1);
  });

  it("treats an already-missing Storage object as a completed cleanup", async () => {
    const dependencies = makeDependencies({
      deleteObject: vi.fn(async () => {
        const error = new Error("missing");
        error.code = "storage/object-not-found";
        throw error;
      }),
    });

    await expect(
      deletePhotoStorageFile({
        storage: { name: "storage" },
        photo: { storagePath: "users/user-1/photos/grow-1/missing.jpg" },
        dependencies,
      })
    ).resolves.toBe(false);
  });
});
