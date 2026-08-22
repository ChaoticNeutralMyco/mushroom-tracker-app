// tests/unit/photoUiConsolidation.test.js
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  deleteGrowPhoto,
  setGrowCoverPhoto,
  sortPhotoRecordsNewestFirst,
} from "../../src/lib/photo-storage";

function makeDeleteDependencies({ coverPhotoId = "photo-1" } = {}) {
  const operations = [];
  const batch = {
    update: vi.fn((reference, patch) => {
      operations.push({ type: "update", reference, patch });
      return batch;
    }),
    delete: vi.fn((reference) => {
      operations.push({ type: "delete", reference });
      return batch;
    }),
    commit: vi.fn(async () => undefined),
  };

  return {
    operations,
    dependencies: {
      doc: vi.fn((...parts) => parts.join("/")),
      getDoc: vi.fn(async () => ({
        exists: () => true,
        data: () => ({ coverPhotoId }),
      })),
      writeBatch: vi.fn(() => batch),
      serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
      storageRef: vi.fn((storage, path) => ({ storage, path })),
      deleteObject: vi.fn(async () => undefined),
      updateDoc: vi.fn(async () => undefined),
    },
  };
}

describe("canonical grow photo actions", () => {
  it("deletes the Storage object and atomically clears a matching cover with metadata", async () => {
    const { operations, dependencies } = makeDeleteDependencies();

    const result = await deleteGrowPhoto({
      db: { name: "db" },
      storage: { name: "storage" },
      uid: "user-1",
      growId: "grow-1",
      photo: {
        id: "photo-1",
        growId: "grow-1",
        storagePath: "users/user-1/photos/grow-1/Fruiting/photo.jpg",
      },
      dependencies,
    });

    expect(result).toEqual({ storageDeleted: true, coverCleared: true });
    expect(dependencies.deleteObject).toHaveBeenCalledTimes(1);
    expect(operations.map((item) => item.type)).toEqual(["update", "delete"]);
    expect(operations[0].patch).toMatchObject({
      coverPhotoId: null,
      coverUrl: null,
      coverStoragePath: null,
    });
  });

  it("deletes a non-cover photo without changing the grow cover", async () => {
    const { operations, dependencies } = makeDeleteDependencies({
      coverPhotoId: "different-photo",
    });

    const result = await deleteGrowPhoto({
      db: { name: "db" },
      storage: { name: "storage" },
      uid: "user-1",
      growId: "grow-1",
      photo: {
        id: "photo-1",
        growId: "grow-1",
        storagePath: "users/user-1/photos/grow-1/General/photo.jpg",
      },
      dependencies,
    });

    expect(result.coverCleared).toBe(false);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ type: "delete" });
  });

  it("sets the canonical cover fields from the same photo metadata", async () => {
    const { dependencies } = makeDeleteDependencies();
    const patch = await setGrowCoverPhoto({
      db: { name: "db" },
      uid: "user-1",
      growId: "grow-1",
      photo: {
        id: "photo-1",
        url: "https://example.test/photo.jpg",
        storagePath: "users/user-1/photos/grow-1/General/photo.jpg",
      },
      dependencies,
    });

    expect(patch).toMatchObject({
      coverPhotoId: "photo-1",
      coverUrl: "https://example.test/photo.jpg",
      coverStoragePath: "users/user-1/photos/grow-1/General/photo.jpg",
    });
    expect(dependencies.updateDoc).toHaveBeenCalledTimes(1);
  });

  it("sorts current and legacy photo timestamps newest first", () => {
    const sorted = sortPhotoRecordsNewestFirst([
      { id: "old", timestamp: "2026-07-01T12:00:00.000Z" },
      { id: "new", createdAt: { seconds: 1785000000, nanoseconds: 0 } },
      { id: "middle", timestamp: "2026-07-20T12:00:00.000Z" },
    ]);

    expect(sorted.map((photo) => photo.id)).toEqual(["new", "middle", "old"]);
  });
});

describe("photo UI consolidation", () => {
  const removedPaths = [
    new URL("../../src/hooks/usePhotos.js", import.meta.url),
    new URL("../../src/components/ui/PhotoUpload.jsx", import.meta.url),
    new URL("../../src/components/ui/PhotoGallery.jsx", import.meta.url),
    new URL("../../src/components/Grow/StageNotesPhotosModal.jsx", import.meta.url),
  ];

  it("removes the disconnected duplicate photo subsystem", () => {
    removedPaths.forEach((url) => {
      expect(existsSync(fileURLToPath(url))).toBe(false);
    });
  });

  it("routes live grow, stage, and strain galleries through canonical actions", () => {
    const appSource = readFileSync(
      fileURLToPath(new URL("../../src/App.jsx", import.meta.url)),
      "utf8"
    );
    const quickEditSource = readFileSync(
      fileURLToPath(new URL("../../src/pages/QuickEdit.jsx", import.meta.url)),
      "utf8"
    );
    const growDetailSource = readFileSync(
      fileURLToPath(new URL("../../src/components/Grow/GrowDetail.jsx", import.meta.url)),
      "utf8"
    );
    const strainManagerSource = readFileSync(
      fileURLToPath(new URL("../../src/pages/StrainManager.jsx", import.meta.url)),
      "utf8"
    );

    expect(appSource).toContain("deleteGrowPhoto");
    expect(appSource).toContain("onDeletePhoto={onDeletePhoto}");
    expect(appSource).toContain("onSetCoverPhoto={onSetCoverPhoto}");
    expect(quickEditSource).toContain("await onDeletePhoto(grow.id, photo)");
    expect(growDetailSource).toContain("await onDeletePhoto(growId, p)");
    expect(strainManagerSource).toContain("return deleteGrowPhoto({");
    expect(strainManagerSource).toContain("normalizePhotoRecord");
  });
});
