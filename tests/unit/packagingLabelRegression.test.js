// tests/unit/packagingLabelRegression.test.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPackagingLabelDataFromFinishedGood,
  collectPackagingLabelFontFaceCss,
  normalizePackagingLabelData,
} from "../../src/components/Grow/PackagingLabelPreview.jsx";

const packagingLabelSource = readFileSync(
  fileURLToPath(
    new URL("../../src/components/Grow/PackagingLabelPreview.jsx", import.meta.url)
  ),
  "utf8"
);

const expectSourceMatch = (pattern) => {
  expect(packagingLabelSource).toMatch(pattern);
};

describe("packaging label data contract", () => {
  it("normalizes display values and dates without inventing baked-in artwork fields", () => {
    const result = normalizePackagingLabelData({
      strainName: "  Lion's Mane  ",
      variantTag: " LM-F ",
      species: " Hericium erinaceus ",
      totalWeight: " 30 g ",
      capsuleCount: " 60 capsules ",
      perCapsule: " 0.5 g ",
      batchLot: " LM-0901-01 ",
      harvestedDate: "2026-08-25",
      packedDate: "9/1/26",
      bestByDate: "2027-09-01",
      containsActiveSpecies: false,
    });

    expect(result).toMatchObject({
      strainName: "Lion's Mane",
      variantTag: "LM-F",
      species: "Hericium erinaceus",
      totalWeight: "30 g",
      capsuleCount: "60 capsules",
      perCapsule: "0.5 g",
      batchLot: "LM-0901-01",
      harvestedDate: "08/25/2026",
      packedDate: "09/01/2026",
      bestByDate: "09/01/2027",
      containsActiveSpecies: false,
    });
  });

  it("builds packaging-label values from a packaged finished-good lot", () => {
    const result = buildPackagingLabelDataFromFinishedGood({
      id: "package-lot-01",
      strainName: "Lion's Mane",
      variant: "LM-F",
      species: "Hericium erinaceus",
      finishedGoodType: "capsules",
      initialQuantity: 60,
      gramsPerUnit: 0.5,
      lotCode: "LM-0901-01",
      harvestedDate: "2026-08-25",
      packDate: "2026-09-01",
      shelfLife: { bestBy: "2027-09-01" },
      containsActiveSpecies: false,
    });

    expect(result).toMatchObject({
      strainName: "Lion's Mane",
      variantTag: "LM-F",
      species: "Hericium erinaceus",
      totalWeight: "30 g",
      capsuleCount: "60 capsules",
      perCapsule: "0.5 g",
      batchLot: "LM-0901-01",
      harvestedDate: "08/25/2026",
      packedDate: "09/01/2026",
      bestByDate: "09/01/2027",
      containsActiveSpecies: false,
    });
  });

  it("honors an explicit inactive flag even when the species name matches the active-species pattern", () => {
    const result = normalizePackagingLabelData({
      species: "Psilocybe cubensis",
      containsActiveSpecies: false,
    });

    expect(result.containsActiveSpecies).toBe(false);
  });
});

describe("packaging label font parity", () => {
  it("preserves the established font stacks instead of changing calibrated typography", () => {
    expect(packagingLabelSource).toContain(
      "const DISPLAY_FONT = '\"Bebas Neue\", \"Anton\", \"Oswald\", \"Arial Narrow\", sans-serif';"
    );
    expect(packagingLabelSource).toContain(
      "const VALUE_FONT = '\"Oswald\", \"Roboto Condensed\", \"Arial Narrow\", sans-serif';"
    );
    expect(packagingLabelSource).toContain(
      "const SPECIES_FONT = '\"Georgia\", \"Times New Roman\", serif';"
    );
  });

  it("collects only @font-face rules and resolves relative font URLs for the print frame", () => {
    const result = collectPackagingLabelFontFaceCss({
      baseURI: "https://example.test/app/",
      styleSheets: [
        {
          href: "https://example.test/assets/app.css",
          cssRules: [
            {
              type: 5,
              cssText:
                '@font-face { font-family: "Oswald"; src: url("./oswald.woff2") format("woff2"); }',
            },
            {
              type: 1,
              cssText: ".not-a-font-rule { color: red; }",
            },
          ],
        },
      ],
    });

    expect(result).toContain('@font-face { font-family: "Oswald";');
    expect(result).toContain("https://example.test/assets/oswald.woff2");
    expect(result).not.toContain("not-a-font-rule");
  });

  it("deduplicates font rules and safely ignores inaccessible stylesheets", () => {
    const fontRule = {
      type: 5,
      cssText: '@font-face { font-family: "Bebas Neue"; src: local("Bebas Neue"); }',
    };
    const blockedSheet = {};
    Object.defineProperty(blockedSheet, "cssRules", {
      get() {
        throw new Error("SecurityError");
      },
    });

    const result = collectPackagingLabelFontFaceCss({
      baseURI: "https://example.test/",
      styleSheets: [
        { cssRules: [fontRule, fontRule] },
        blockedSheet,
      ],
    });

    expect(result.match(/@font-face/g)).toHaveLength(1);
  });
});

describe("Avery 5659 packaging-label regression contract", () => {
  it("keeps the approved artwork as the only source for static storage and Instagram content", () => {
    expect(packagingLabelSource).toContain(
      'const TEMPLATE_URL = "/Packaging Label.png";'
    );
    expect(packagingLabelSource).not.toContain("@chaoticneutral_co");
    expect(packagingLabelSource).not.toContain("cnm-packaging-label__storage");
    expect(packagingLabelSource).not.toContain("cnm-packaging-label__instagram");
    expect(packagingLabelSource).not.toContain("qr-placeholder");
  });

  it("locks the Avery 5659 sheet and label geometry", () => {
    expectSourceMatch(/cols:\s*2,/);
    expectSourceMatch(/rows:\s*3,/);
    expectSourceMatch(/perSheet:\s*6,/);
    expectSourceMatch(/sheetWidthIn:\s*8\.5,/);
    expectSourceMatch(/sheetHeightIn:\s*11,/);
    expectSourceMatch(/labelWidthIn:\s*3,/);
    expectSourceMatch(/labelHeightIn:\s*3,/);
    expectSourceMatch(/sideMarginIn:\s*1\.09,/);
    expectSourceMatch(/topMarginIn:\s*0\.69,/);
    expectSourceMatch(/horizontalGapIn:\s*0\.31,/);
    expectSourceMatch(/verticalGapIn:\s*0\.31,/);
  });

  it("preserves partial-sheet starts, scale limits, and calibration offsets", () => {
    expect(packagingLabelSource).toContain(
      "labels.5659.startPosition"
    );
    expect(packagingLabelSource).toContain("labels.5659.scalePct");
    expect(packagingLabelSource).toContain("labels.5659.offsetXmm");
    expect(packagingLabelSource).toContain("labels.5659.offsetYmm");
    expectSourceMatch(/Math\.max\(90,\s*Math\.min\(110,/);
    expect(packagingLabelSource).toContain(
      "Array.from({ length: prefill }, () => null)"
    );
  });

  it("keeps print output on borderless US Letter at actual label size", () => {
    expect(packagingLabelSource).toContain(
      "@page { size: letter; margin: 0; }"
    );
    expect(packagingLabelSource).toContain(
      "grid-template-columns: repeat(${AVERY_5659.cols}, ${AVERY_5659.labelWidthIn}in);"
    );
    expect(packagingLabelSource).toContain(
      "grid-template-rows: repeat(${AVERY_5659.rows}, ${AVERY_5659.labelHeightIn}in);"
    );
    expect(packagingLabelSource).toContain("await doc.fonts?.ready");
    expect(packagingLabelSource).toContain(
      "Print on US Letter at 100% or Actual Size with browser headers and footers disabled."
    );
  });

  it("copies app @font-face rules into the standalone print document before label CSS", () => {
    expect(packagingLabelSource).toContain(
      "const fontFaceCss = collectPackagingLabelFontFaceCss(document);"
    );
    expect(packagingLabelSource).toContain("fontFaceCss = \"\"");
    expect(packagingLabelSource).toContain("${fontFaceCss}");
    expect(packagingLabelSource.indexOf("${fontFaceCss}")).toBeLessThan(
      packagingLabelSource.indexOf("${cssForLabel({ print: true })}")
    );
  });

  it("keeps dynamic overlays limited to variable product and advisory data", () => {
    [
      "strainName",
      "variantTag",
      "species",
      "totalWeight",
      "capsuleCount",
      "perCapsule",
      "batchLot",
      "harvestedDate",
      "packedDate",
      "bestByDate",
      "blurbTitle",
      "companyBlurb",
      "activeNoticeTitle",
      "activeNoticeCopy",
      "safetyNoticeTitle",
      "safetyNoticeCopy",
    ].forEach((field) => expect(packagingLabelSource).toContain(field));
  });
});
