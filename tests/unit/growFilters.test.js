// tests/unit/growFilters.test.js
import { describe, expect, it } from "vitest";
import { isActiveGrow, isArchivedish } from "../../src/lib/growFilters";

describe("grow final-state filters", () => {
  it("routes a contaminated stage to Archive even when the status is still Active", () => {
    const grow = {
      stage: "Contaminated",
      status: "Active",
      amountTotal: 100,
      amountUsed: 0,
    };

    expect(isArchivedish(grow)).toBe(true);
    expect(isActiveGrow(grow)).toBe(false);
  });

  it("routes a contaminated status to Archive even when the stage is missing", () => {
    const grow = {
      stage: "",
      status: "Contaminated",
      amountTotal: 100,
      amountUsed: 0,
    };

    expect(isArchivedish(grow)).toBe(true);
    expect(isActiveGrow(grow)).toBe(false);
  });


  it("routes a harvested grow to Archive while leaving it out of the active dataset", () => {
    const grow = {
      id: "grow-harvested",
      stage: "Harvested",
      status: "Active",
      dryYield: 42,
    };

    expect(isArchivedish(grow)).toBe(true);
    expect(isActiveGrow(grow)).toBe(false);
  });

  it("keeps a normal active grow in the active dataset", () => {
    const grow = {
      stage: "Colonizing",
      status: "Active",
      amountTotal: 100,
      amountUsed: 0,
    };

    expect(isArchivedish(grow)).toBe(false);
    expect(isActiveGrow(grow)).toBe(true);
  });
});
