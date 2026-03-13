// tests/e2e/helpers/testData.ts
export const e2eData = {
  strainLibrary: {
    type: "Spore Syringe",
    strainName: "E2E Golden Teacher",
    scientificName: "Psilocybe cubensis",
    quantity: "10",
    unit: "ml",
    acquired: "2026-03-01",
  },
  supplies: [
    {
      name: "E2E Agar Cups",
      cost: "20",
      quantity: "20",
      unit: "count",
      type: "container",
    },
    {
      name: "E2E Grain",
      cost: "30",
      quantity: "5000",
      unit: "g",
      type: "substrate",
    },
    {
      name: "E2E Bulk Substrate",
      cost: "40",
      quantity: "10000",
      unit: "g",
      type: "substrate",
    },
  ],
  recipes: [
    {
      name: "E2E Agar Recipe",
      tags: "e2e,agar",
      servingLabel: "plates",
      yield: "1",
      ingredient: {
        supplyName: "E2E Agar Cups",
        amount: "1",
        unit: "count",
      },
      instructions: "Generic agar prep for Playwright validation.",
    },
    {
      name: "E2E Grain Recipe",
      tags: "e2e,grain",
      servingLabel: "jars",
      yield: "1",
      ingredient: {
        supplyName: "E2E Grain",
        amount: "500",
        unit: "g",
      },
      instructions: "Generic grain prep for Playwright validation.",
    },
    {
      name: "E2E Bulk Recipe",
      tags: "e2e,bulk",
      servingLabel: "tubs",
      yield: "1",
      ingredient: {
        supplyName: "E2E Bulk Substrate",
        amount: "3000",
        unit: "g",
      },
      instructions: "Generic bulk prep for Playwright validation.",
    },
  ],
  grows: {
    agar: {
      type: "Agar",
      created: "2026-03-02",
      initialVolume: "10",
      initialUnit: "ml",
      recipe: "E2E Agar Recipe",
    },
    grain: {
      type: "Grain Jar",
      created: "2026-03-04",
      parentConsume: "5",
      initialVolume: "500",
      initialUnit: "g",
      recipe: "E2E Grain Recipe",
    },
    bulk: {
      type: "Bulk",
      created: "2026-03-06",
      parentConsume: "500",
      bulkVolume: "3000",
      bulkUnit: "g",
      recipe: "E2E Bulk Recipe",
    },
  },
  flushes: [
    { date: "2026-03-10", wet: "120", dry: "12", note: "Flush 1" },
    { date: "2026-03-13", wet: "140", dry: "14", note: "Flush 2" },
    { date: "2026-03-16", wet: "160", dry: "16", note: "Flush 3" },
    { date: "2026-03-19", wet: "180", dry: "18", note: "Flush 4" },
  ],
  totals: {
    wet: "600",
    dry: "60",
  },
};