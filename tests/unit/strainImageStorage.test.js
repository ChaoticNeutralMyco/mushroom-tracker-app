// tests/unit/strainImageStorage.test.js
import { describe, expect, it, vi } from "vitest";
import {
  STRAIN_IMAGE_KIND_CARD,
  STRAIN_IMAGE_KIND_PROFILE,
  buildStrainImageStoragePath,
  cleanupStrainImageAssets,
  getStrainStorageAssets,
  isManagedStrainStoragePath,
  uploadStrainImageAsset,
} from "../../src/lib/strain-image-storage";

const FIXED_NOW = Date.parse("2026-07-25T21:00:00.000Z");

function downloadUrl(storagePath) {
  return `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(
    storagePath
  )}?alt=media`;
}

function makeDependencies(overrides = {}) {
  return {
    storageRef: vi.fn((storage, path) => ({ storage, path })),
    uploadBytes: vi.fn(async () => undefined),
    getDownloadURL: vi.fn(async (fileRef) => downloadUrl(fileRef.path)),
    deleteObject: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("strain image storage helpers", () => {
  it("builds separate owner-scoped paths for profile images and card art", () => {
    expect(
      buildStrainImageStoragePath({
        uid: "user-1",
        kind: STRAIN_IMAGE_KIND_PROFILE,
        fileName: "profile / photo.jpg",
        now: FIXED_NOW,
      })
    ).toBe(`users/user-1/strains/${FIXED_NOW}_profile - photo.jpg`);

    expect(
      buildStrainImageStoragePath({
        uid: "user-1",
        kind: STRAIN_IMAGE_KIND_CARD,
        fileName: "front art.png",
        now: FIXED_NOW,
      })
    ).toBe(`users/user-1/strain-cards/${FIXED_NOW}_front art.png`);
  });

  it("recovers legacy paths, includes pending cleanup paths, and deduplicates them", () => {
    const profilePath = "users/user-1/strains/legacy-profile.jpg";
    const cardPath = "users/user-1/strains/legacy-card.jpg";
    const pendingPath = "users/user-1/strain-cards/old-card.png";

    const assets = getStrainStorageAssets(
      {
        photoURL: downloadUrl(profilePath),
        cardBuilder: {
          frontArtUrl: downloadUrl(cardPath),
        },
        pendingStorageCleanupPaths: [
          pendingPath,
          { kind: "card", storagePath: pendingPath },
          "users/other-user/strains/not-owned.jpg",
        ],
      },
      "user-1"
    );

    expect(assets.map((asset) => asset.storagePath)).toEqual([
      profilePath,
      cardPath,
      pendingPath,
    ]);
    expect(assets[1].kind).toBe(STRAIN_IMAGE_KIND_CARD);
    expect(isManagedStrainStoragePath(profilePath, "user-1")).toBe(true);
    expect(
      isManagedStrainStoragePath("users/other-user/strains/not-owned.jpg", "user-1")
    ).toBe(false);
  });

  it("uploads card art with canonical metadata", async () => {
    const dependencies = makeDependencies();
    const result = await uploadStrainImageAsset({
      storage: { name: "storage" },
      uid: "user-1",
      kind: STRAIN_IMAGE_KIND_CARD,
      file: {
        name: "custom-front.png",
        type: "image/png",
        size: 4096,
      },
      now: FIXED_NOW,
      dependencies,
    });

    expect(result).toMatchObject({
      kind: STRAIN_IMAGE_KIND_CARD,
      storagePath: `users/user-1/strain-cards/${FIXED_NOW}_custom-front.png`,
      originalName: "custom-front.png",
      contentType: "image/png",
      sizeBytes: 4096,
    });
    expect(result.url).toBe(downloadUrl(result.storagePath));
    expect(dependencies.uploadBytes).toHaveBeenCalledTimes(1);
    expect(dependencies.deleteObject).not.toHaveBeenCalled();
  });

  it("removes a newly uploaded image when its download URL cannot be read", async () => {
    const urlError = new Error("download URL failed");
    const dependencies = makeDependencies({
      getDownloadURL: vi.fn(async () => {
        throw urlError;
      }),
    });

    await expect(
      uploadStrainImageAsset({
        storage: { name: "storage" },
        uid: "user-1",
        file: { name: "rollback.jpg", type: "image/jpeg", size: 100 },
        now: FIXED_NOW,
        dependencies,
      })
    ).rejects.toBe(urlError);

    expect(dependencies.uploadBytes).toHaveBeenCalledTimes(1);
    expect(dependencies.deleteObject).toHaveBeenCalledTimes(1);
  });

  it("cleans managed paths once and reports only real deletion failures", async () => {
    const missingPath = "users/user-1/strains/missing.jpg";
    const failedPath = "users/user-1/strain-cards/failed.png";
    const dependencies = makeDependencies({
      deleteObject: vi.fn(async (fileRef) => {
        if (fileRef.path === missingPath) {
          const error = new Error("missing");
          error.code = "storage/object-not-found";
          throw error;
        }
        if (fileRef.path === failedPath) {
          const error = new Error("network");
          error.code = "storage/retry-limit-exceeded";
          throw error;
        }
      }),
    });

    const result = await cleanupStrainImageAssets({
      storage: { name: "storage" },
      uid: "user-1",
      assets: [
        { storagePath: missingPath },
        { storagePath: missingPath },
        { storagePath: failedPath, kind: STRAIN_IMAGE_KIND_CARD },
        { storagePath: "users/user-1/photos/not-a-strain-photo.jpg" },
      ],
      dependencies,
    });

    expect(result.deletedPaths).toEqual([missingPath]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].storagePath).toBe(failedPath);
    expect(dependencies.deleteObject).toHaveBeenCalledTimes(2);
  });
});
