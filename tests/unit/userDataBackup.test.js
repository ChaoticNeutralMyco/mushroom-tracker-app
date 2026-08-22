// tests/unit/userDataBackup.test.js
import { describe, expect, it } from "vitest";
import { GeoPoint, Timestamp } from "firebase/firestore";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  GROW_DATA_COLLECTIONS,
  USER_DATA_COLLECTIONS,
  deserializeBackupValue,
  normalizeBackupPayload,
  serializeBackupValue,
} from "../../src/lib/user-data-backup";

describe("user data backup helpers", () => {
  it("includes the current photo, post-processing, storage, and cleanup collections", () => {
    expect(USER_DATA_COLLECTIONS).toEqual(
      expect.arrayContaining([
        "photos",
        "materialLots",
        "processBatches",
        "inventoryMovements",
        "storageLocations",
        "clean_queue",
        "supply_audits",
      ])
    );
    expect(GROW_DATA_COLLECTIONS).toEqual(
      expect.arrayContaining([
        "photos",
        "materialLots",
        "processBatches",
        "inventoryMovements",
        "clean_queue",
      ])
    );
    expect(USER_DATA_COLLECTIONS).not.toContain("billing");
  });

  it("round-trips Firestore timestamps, dates, and geographic points", () => {
    const source = {
      dueAt: new Timestamp(1_800_000_000, 123_000_000),
      packedAt: new Date("2026-07-25T12:30:00.000Z"),
      location: new GeoPoint(38.8339, -104.8214),
      nested: [{ completedAt: new Timestamp(1_800_000_100, 0) }],
    };

    const restored = deserializeBackupValue(serializeBackupValue(source));

    expect(restored.dueAt).toBeInstanceOf(Timestamp);
    expect(restored.dueAt.seconds).toBe(1_800_000_000);
    expect(restored.dueAt.nanoseconds).toBe(123_000_000);
    expect(restored.packedAt).toBeInstanceOf(Date);
    expect(restored.packedAt.toISOString()).toBe("2026-07-25T12:30:00.000Z");
    expect(restored.location).toBeInstanceOf(GeoPoint);
    expect(restored.location.latitude).toBeCloseTo(38.8339);
    expect(restored.location.longitude).toBeCloseTo(-104.8214);
    expect(restored.nested[0].completedAt).toBeInstanceOf(Timestamp);
  });

  it("normalizes current backups, nested records, and skips unsupported collections", () => {
    const normalized = normalizeBackupPayload({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      storageFilesIncluded: false,
      collections: {
        grows: [
          {
            id: "grow-1",
            data: { name: "Test grow" },
            subcollections: {
              environmentLogs: [
                { id: "log-1", data: { humidity: 92 } },
              ],
              unexpectedNestedCollection: [
                { id: "bad-1", data: { ignored: true } },
              ],
            },
          },
        ],
        billing: [{ id: "entitlement", data: { planId: "lab" } }],
      },
    });

    expect(normalized.summary.documentCount).toBe(1);
    expect(normalized.summary.nestedDocumentCount).toBe(1);
    expect(normalized.summary.totalDocumentCount).toBe(2);
    expect(normalized.collections.grows[0].subcollections.environmentLogs).toHaveLength(1);
    expect(normalized.collections.grows[0].subcollections.unexpectedNestedCollection).toBeUndefined();
    expect(normalized.collections.billing).toBeUndefined();
    expect(normalized.skippedCollections).toEqual(["billing"]);
  });

  it("supports the legacy backup shape used by the old Settings exporter", () => {
    const normalized = normalizeBackupPayload({
      grows: [{ id: "grow-legacy", name: "Legacy grow", stage: "Fruiting" }],
      tasks: [{ id: "task-legacy", title: "Legacy task" }],
    });

    expect(normalized.format).toBe("legacy");
    expect(normalized.summary.totalDocumentCount).toBe(2);
    expect(normalized.collections.grows[0]).toEqual({
      id: "grow-legacy",
      data: { name: "Legacy grow", stage: "Fruiting" },
      subcollections: {},
    });
  });
});
