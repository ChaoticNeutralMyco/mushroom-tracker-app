// tests/unit/subscriptionGrowLimits.test.js

import { describe, expect, it } from "vitest";
import {
  ACTIVE_GROW_LIMIT_ERROR_CODE,
  ActiveGrowLimitError,
  applyGrowPatchForAccessCheck,
  assertActiveGrowCapacity,
  buildActiveGrowLimitMessage,
  countRequestedActiveGrows,
  encodeGrowPatchForCallable,
  encodeGrowPayloadForCallable,
  getActiveGrowLimitState,
  getActiveGrowUsage,
  getGrowActivityTransition,
  normalizeActiveGrowLimit,
  wouldReactivateGrow,
} from "../../src/lib/subscriptionGrowLimits.js";

const activeGrow = (id = "active") => ({
  id,
  stage: "Colonizing",
  status: "Active",
});

const archivedGrow = (id = "archived") => ({
  id,
  stage: "Harvested",
  status: "Archived",
  archived: true,
  archivedAt: "2026-07-20T00:00:00.000Z",
});

describe("active-grow subscription limit helpers", () => {
  it("normalizes finite limits and preserves null as unlimited", () => {
    expect(normalizeActiveGrowLimit(null)).toBeNull();
    expect(normalizeActiveGrowLimit(6.9)).toBe(6);
    expect(normalizeActiveGrowLimit("30")).toBe(30);
    expect(normalizeActiveGrowLimit(-5)).toBe(0);
  });

  it("counts only active grows toward plan usage", () => {
    expect(
      getActiveGrowUsage([
        activeGrow("one"),
        { id: "stored", stage: "Colonized", status: "Stored" },
        { id: "harvested", stage: "Harvested", status: "Active" },
        { id: "contaminated", stage: "Contaminated", status: "Contaminated" },
      ])
    ).toBe(1);
  });

  it("allows the final available Free slot and blocks the next active grow", () => {
    expect(
      getActiveGrowLimitState({
        activeGrowCount: 5,
        activeGrowLimit: 6,
        requestedCount: 1,
      }).allowed
    ).toBe(true);

    const blocked = getActiveGrowLimitState({
      activeGrowCount: 6,
      activeGrowLimit: 6,
      requestedCount: 1,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.reached).toBe(true);
    expect(blocked.remaining).toBe(0);
  });

  it("checks an entire batch before any grow is created", () => {
    const state = getActiveGrowLimitState({
      activeGrowCount: 5,
      activeGrowLimit: 6,
      requestedCount: 2,
    });

    expect(state.allowed).toBe(false);
    expect(state.projected).toBe(7);
  });

  it("treats Cultivator, Lab, Trial, Admin, and custom unlimited access as unlimited", () => {
    const state = getActiveGrowLimitState({
      activeGrowCount: 500,
      activeGrowLimit: null,
      requestedCount: 100,
    });

    expect(state.unlimited).toBe(true);
    expect(state.allowed).toBe(true);
    expect(state.remaining).toBeNull();
  });

  it("honors a custom finite limit override", () => {
    expect(
      getActiveGrowLimitState({
        activeGrowCount: 49,
        activeGrowLimit: 50,
        requestedCount: 1,
      }).allowed
    ).toBe(true);
    expect(
      getActiveGrowLimitState({
        activeGrowCount: 50,
        activeGrowLimit: 50,
        requestedCount: 1,
      }).allowed
    ).toBe(false);
  });

  it("counts only active payloads in mixed create batches", () => {
    expect(
      countRequestedActiveGrows([
        activeGrow("one"),
        { id: "stored", stage: "Colonized", status: "Stored" },
        activeGrow("two"),
      ])
    ).toBe(2);
  });

  it("builds clear single-create, batch, and reactivation messages", () => {
    expect(
      buildActiveGrowLimitMessage({
        activeGrowCount: 6,
        activeGrowLimit: 6,
        requestedCount: 1,
      })
    ).toContain("6 of 6 active grows");

    expect(
      buildActiveGrowLimitMessage({
        activeGrowCount: 5,
        activeGrowLimit: 6,
        requestedCount: 2,
      })
    ).toContain("batch would create 2 active grows");

    expect(
      buildActiveGrowLimitMessage({
        activeGrowCount: 6,
        activeGrowLimit: 6,
        action: "reactivate",
      })
    ).toContain("Reactivating this grow");
  });

  it("throws a typed error with usage and limit details", () => {
    expect(() =>
      assertActiveGrowCapacity({
        activeGrowCount: 6,
        activeGrowLimit: 6,
        requestedCount: 1,
      })
    ).toThrow(ActiveGrowLimitError);

    try {
      assertActiveGrowCapacity({
        activeGrowCount: 6,
        activeGrowLimit: 6,
        requestedCount: 1,
      });
    } catch (error) {
      expect(error.code).toBe(ACTIVE_GROW_LIMIT_ERROR_CODE);
      expect(error.details.usage).toBe(6);
      expect(error.details.limit).toBe(6);
    }
  });

  it("recognizes Archive delete-field patches as field removal", () => {
    const next = applyGrowPatchForAccessCheck(archivedGrow(), {
      stage: "Inoculated",
      status: "Active",
      archived: { _methodName: "deleteField" },
      archivedAt: { _methodName: "deleteField" },
      isArchived: { _methodName: "deleteField" },
    });

    expect(next.archived).toBeUndefined();
    expect(next.archivedAt).toBeUndefined();
    expect(next.stage).toBe("Inoculated");
  });

  it("detects an archived grow becoming active", () => {
    expect(
      wouldReactivateGrow(archivedGrow(), {
        stage: "Inoculated",
        status: "Active",
        archived: { _methodName: "deleteField" },
        archivedAt: { _methodName: "deleteField" },
      })
    ).toBe(true);
  });

  it("does not treat ordinary edits to an existing active grow as reactivation", () => {
    const transition = getGrowActivityTransition(activeGrow(), {
      strain: "Updated strain",
    });

    expect(transition.wasActive).toBe(true);
    expect(transition.willBeActive).toBe(true);
    expect(transition.reactivating).toBe(false);
    expect(transition.deactivating).toBe(false);
  });

  it("detects completion or archiving as a capacity-releasing transition", () => {
    const transition = getGrowActivityTransition(activeGrow(), {
      stage: "Harvested",
      status: "Archived",
      archived: true,
    });

    expect(transition.deactivating).toBe(true);
    expect(transition.willBeActive).toBe(false);
  });

  it("encodes grow dates without changing ordinary nested data", () => {
    const encoded = encodeGrowPayloadForCallable({
      createdAt: new Date("2026-08-01T12:30:00.000Z"),
      stageDates: { Inoculated: "2026-08-01" },
      parentContributions: [
        { parentId: "parent-one", amount: 2.5, unit: "ml" },
      ],
    });

    expect(encoded.createdAt).toEqual({
      __cnmTimestamp: "2026-08-01T12:30:00.000Z",
    });
    expect(encoded.stageDates).toEqual({ Inoculated: "2026-08-01" });
    expect(encoded.parentContributions[0].amount).toBe(2.5);
  });

  it("encodes Firestore delete-field and server-timestamp sentinels for callables", () => {
    const encoded = encodeGrowPatchForCallable({
      archived: { _methodName: "deleteField" },
      archivedAt: { _methodName: "deleteField" },
      updatedAt: { _methodName: "serverTimestamp" },
    });

    expect(encoded.archived).toEqual({ __cnmDeleteField: true });
    expect(encoded.archivedAt).toEqual({ __cnmDeleteField: true });
    expect(encoded.updatedAt).toEqual({ __cnmServerTimestamp: true });
  });

  it("drops undefined object fields and preserves array positions", () => {
    const encoded = encodeGrowPayloadForCallable({
      keep: "value",
      remove: undefined,
      list: ["one", undefined, "three"],
    });

    expect(encoded).toEqual({
      keep: "value",
      list: ["one", null, "three"],
    });
  });

});
