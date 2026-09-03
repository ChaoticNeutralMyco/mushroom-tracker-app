// tests/unit/packagingLabelRegression.test.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPackagingLabelDataFromFinishedGood,
  collectPackagingLabelFontFaceCss,
  normalizePackagingLabelData,
} from "../../src/components/Grow/PackagingLabelPreview.jsx";
import {
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLANS,
} from "../../src/lib/subscriptionPlans.js";

const packagingLabelSource = readFileSync(
  fileURLToPath(
    new URL("../../src/components/Grow/PackagingLabelPreview.jsx", import.meta.url)
  ),
  "utf8"
);

const labelPrintWrapperSource = readFileSync(
  fileURLToPath(
    new URL("../../src/components/Grow/LabelPrintWrapper.jsx", import.meta.url)
  ),
  "utf8"
);

const labelPrintSource = readFileSync(
  fileURLToPath(
    new URL("../../src/components/Grow/LabelPrint.jsx", import.meta.url)
  ),
  "utf8"
);

const expectSourceMatch = (pattern) => {
  expect(packagingLabelSource).toMatch(pattern);
};

const getLegacyLabelTemplateBlock = (templateId) => {
  const start = labelPrintSource.indexOf(`"${templateId}": {`);
  if (start < 0) return "";

  const end =
    templateId === "5160"
      ? labelPrintSource.indexOf('"5167": {', start)
      : labelPrintSource.indexOf("\n};", start);

  return end > start ? labelPrintSource.slice(start, end) : "";
};

const readTemplateInches = (block, key) => {
  const match = block.match(new RegExp(`${key}:\\s*"([0-9.]+)in"`));
  return match ? Number(match[1]) : Number.NaN;
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

describe("Avery cultivation label sheet geometry regression", () => {
  it("locks Avery 5160 / 8160 to the physical 3x10 sheet geometry", () => {
    const block = getLegacyLabelTemplateBlock("5160");

    expect(block).toContain("cols: 3");
    expect(block).toContain("rows: 10");
    expect(block).toContain('labelW: "2.625in"');
    expect(block).toContain('labelH: "1in"');
    expect(block).toContain('gapX: "0.125in"');
    expect(block).toContain('gapY: "0in"');
    expect(block).toContain('padX: "0.1875in"');
    expect(block).toContain('padY: "0.5in"');

    const width =
      2 * readTemplateInches(block, "padX") +
      3 * readTemplateInches(block, "labelW") +
      2 * readTemplateInches(block, "gapX");
    const height =
      2 * readTemplateInches(block, "padY") +
      10 * readTemplateInches(block, "labelH") +
      9 * readTemplateInches(block, "gapY");

    expect(width).toBeCloseTo(8.5, 6);
    expect(height).toBeCloseTo(11, 6);
  });

  it("locks Avery 5167 to the physical 4x20 sheet geometry", () => {
    const block = getLegacyLabelTemplateBlock("5167");

    expect(block).toContain("cols: 4");
    expect(block).toContain("rows: 20");
    expect(block).toContain('labelW: "1.75in"');
    expect(block).toContain('labelH: "0.5in"');
    expect(block).toContain('gapX: "0.3125in"');
    expect(block).toContain('gapY: "0in"');
    expect(block).toContain('padX: "0.28125in"');
    expect(block).toContain('padY: "0.5in"');

    const width =
      2 * readTemplateInches(block, "padX") +
      4 * readTemplateInches(block, "labelW") +
      3 * readTemplateInches(block, "gapX");
    const height =
      2 * readTemplateInches(block, "padY") +
      20 * readTemplateInches(block, "labelH") +
      19 * readTemplateInches(block, "gapY");

    expect(width).toBeCloseTo(8.5, 6);
    expect(height).toBeCloseTo(11, 6);
  });

  it("uses the same template margins and gaps for preview and standalone print output", () => {
    expect(labelPrintSource).toContain("paddingLeft: template.padX");
    expect(labelPrintSource).toContain("paddingRight: template.padX");
    expect(labelPrintSource).toContain("columnGap: template.gapX");
    expect(labelPrintSource).toContain("rowGap: template.gapY");
    expect(labelPrintSource).toContain(
      ".sheet { width: ${template.sheetW}; height: ${template.sheetH}; padding: ${template.padY} ${template.padX};"
    );
    expect(labelPrintSource).toContain(
      "column-gap: ${template.gapX}; row-gap: ${template.gapY};"
    );
  });
});

describe("legacy Avery print-scale safety", () => {
  it("labels the scale control as preview-only so it is not mistaken for print calibration", () => {
    expect(labelPrintSource).toContain(
      '<span className="text-sm">Preview scale</span>'
    );
    expect(labelPrintSource).toContain(
      "Preview scale is screen-only."
    );
  });

  it("tells users to preserve physical Avery dimensions in the browser print dialog", () => {
    expect(labelPrintSource).toContain(
      "print on US Letter at 100% or Actual Size"
    );
    expect(labelPrintSource).toContain(
      "with browser headers and footers disabled."
    );
  });

  it("keeps preview scaling out of the standalone print HTML", () => {
    const start = labelPrintSource.indexOf("const buildPrintHTML =");
    const end = labelPrintSource.indexOf("const printNow =", start);
    const printBuilder = labelPrintSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(labelPrintSource).toContain(
      "transform: `scale(${scalePct / 100})`"
    );
    expect(printBuilder).not.toContain("scalePct");
  });
});

describe("packaged SKU label eligibility regression", () => {
  it("keeps the approved package SKU types limited to retail, sample, promo, and internal", () => {
    expect(labelPrintWrapperSource).toContain(
      'const PACKAGED_SKU_TYPES = new Set(["retail", "sample", "promo", "internal"]);'
    );
  });

  it("requires packaged-child identity, package-run identity, valid SKU type, package size, and available packages", () => {
    [
      "hasChildRelationship",
      "hasPackageRunIdentity",
      "hasValidSkuType",
      "hasPackageSize",
      "hasAvailablePackages",
    ].forEach((guard) => expect(labelPrintWrapperSource).toContain(guard));

    expect(labelPrintWrapperSource).toMatch(
      /hasChildRelationship\s*&&\s*hasPackageRunIdentity\s*&&\s*hasValidSkuType\s*&&\s*hasPackageSize\s*&&\s*hasAvailablePackages/
    );
  });

  it("feeds Avery 5659 only from printable finished lots that pass the packaged-child SKU guard", () => {
    expect(labelPrintWrapperSource).toMatch(
      /finishedGoodsBuckets\.printable\.filter\(isPackagedSkuChildLot\)/
    );
    expect(labelPrintWrapperSource).toContain(
      "Parent finished batches never appear here."
    );
  });

  it("keeps blocked finished inventory out of the standard finished-label source as a second safety layer", () => {
    expect(labelPrintSource).toContain(
      'if (source === "finished_goods") return finishedGoodsBuckets.printable;'
    );
    expect(labelPrintSource).toContain(
      "const eligibility = getFinishedLabelEligibility(lot);"
    );
  });
});

describe("label subscription boundary regression", () => {
  it("keeps grow labels and Post Processing labels as separate feature keys", () => {
    expect(SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS).toBe("growLabels");
    expect(SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS).toBe("postProcessLabels");
    expect(SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS).not.toBe(
      SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS
    );
  });

  it("keeps cultivation labels available on Free, Hobby, and Cultivator while Post Processing labels remain locked", () => {
    [
      SUBSCRIPTION_PLAN_IDS.FREE,
      SUBSCRIPTION_PLAN_IDS.HOBBY,
      SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
    ].forEach((planId) => {
      expect(
        SUBSCRIPTION_PLANS[planId].features[SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS]
      ).toBe(true);
      expect(
        SUBSCRIPTION_PLANS[planId].features[
          SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS
        ]
      ).toBe(false);
    });
  });

  it("allows both label families for Lab, trial Lab access, and admin", () => {
    [
      SUBSCRIPTION_PLAN_IDS.LAB,
      SUBSCRIPTION_PLAN_IDS.TRIAL,
      SUBSCRIPTION_PLAN_IDS.ADMIN,
    ].forEach((planId) => {
      expect(
        SUBSCRIPTION_PLANS[planId].features[SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS]
      ).toBe(true);
      expect(
        SUBSCRIPTION_PLANS[planId].features[
          SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS
        ]
      ).toBe(true);
    });
  });

  it("keeps finished-goods fetching and packaged-SKU data behind canUsePostProcessLabels", () => {
    expect(labelPrintWrapperSource).toContain(
      "const canUsePostProcessLabels = props?.canUsePostProcessLabels !== false;"
    );
    expect(labelPrintWrapperSource).toContain(
      "if (!uid || !canUsePostProcessLabels)"
    );
    expect(labelPrintWrapperSource).toMatch(
      /const finishedGoodsSource = canUsePostProcessLabels\s*\?/
    );
    expect(labelPrintWrapperSource).toContain(
      "finishedGoods={canUsePostProcessLabels ? finishedGoodsBuckets.active : []}"
    );
  });

  it("routes blocked packaged-label access through the Post Processing label feature key", () => {
    expect(labelPrintWrapperSource).toContain(
      "featureKey: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS"
    );
    expect(labelPrintWrapperSource).toContain(
      "Grow and cultivation labels remain available on every plan."
    );
    expect(labelPrintWrapperSource).toContain(
      "Post Processing labels require Lab access"
    );
  });

  it("keeps the standard label component from bypassing the same Post Processing label gate", () => {
    expect(labelPrintSource).toContain(
      "const canUsePostProcessLabels = props?.canUsePostProcessLabels !== false;"
    );
    expect(labelPrintSource).toContain(
      "featureKey: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS"
    );
    expect(labelPrintSource).toContain(
      'if (source === "finished_goods" && !canUsePostProcessLabels)'
    );
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
