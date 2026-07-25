// src/components/Grow/PackagingLabelPreview.jsx
// labels-v47-avery-5659-and-streamlined-advisories
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";

const TEMPLATE_URL = "/Packaging Label.png";

const DISPLAY_FONT = '"Bebas Neue", "Anton", "Oswald", "Arial Narrow", sans-serif';
const VALUE_FONT = '"Oswald", "Roboto Condensed", "Arial Narrow", sans-serif';
const SPECIES_FONT = '"Georgia", "Times New Roman", serif';
const INK = "#06142b";
const ALIGNMENT_MARKER = "grow-folder-overlay-tuning-v21-label-glyph-clearance";
const DEFAULT_COMPANY_BLURB =
  "Small-batch mushroom products with full-lifecycle tracking, intentional formulation, and Chaotic Neutral care.";
const ACTIVE_NOTICE_TITLE = "RESPECT THE DOSE • RESPECT THE SETTING";
const ACTIVE_NOTICE_COPY =
  "No standardized serving or dose. Potency and effects may vary. Do not combine with alcohol or other intoxicants.";
const SAFETY_NOTICE_TITLE = "21+ • SAFETY & RESPONSIBILITY";
const SAFETY_NOTICE_COPY =
  "Keep away from children and pets. Do not drive or operate machinery. Verify applicable law. Use lawfully and responsibly.";
const ACTIVE_SPECIES_PATTERN = /\b(psilocybe|panaeolus|gymnopilus|pluteus)\b|(?:^|[\s+])P\.\s*(cubensis|cyanescens|azurescens|semilanceata|natalensis)\b/i;

const AVERY_5659 = {
  id: "5659",
  name: 'Avery 5659 (3" × 3")',
  cols: 2,
  rows: 3,
  perSheet: 6,
  sheetWidthIn: 8.5,
  sheetHeightIn: 11,
  labelWidthIn: 3,
  labelHeightIn: 3,
  sideMarginIn: 1.09,
  topMarginIn: 0.69,
  horizontalGapIn: 0.31,
  verticalGapIn: 0.31,
};

const LOCAL_KEY_5659_START = "labels.5659.startPosition";
const LOCAL_KEY_5659_GRID = "labels.5659.gridOverlay";
const LOCAL_KEY_5659_SCALE = "labels.5659.scalePct";
const LOCAL_KEY_5659_OFFSET_X = "labels.5659.offsetXmm";
const LOCAL_KEY_5659_OFFSET_Y = "labels.5659.offsetYmm";

export const DEMO_PACKAGING_LABEL_DATA = {
  strainName: "Albino Penis Envy",
  variantTag: "APE-R",
  species: "Psilocybe cubensis",
  totalWeight: "8 g",
  capsuleCount: "16 capsules",
  perCapsule: "≈ 0.5 g",
  batchLot: "APE-R-0605-01",
  harvestedDate: "06/01/2026",
  packedDate: "06/05/2026",
  bestByDate: "06/05/2027",
  blurbTitle: "CHAOTIC NEUTRAL",
  companyBlurb: DEFAULT_COMPANY_BLURB,
  containsActiveSpecies: true,
  advisoryType: "active",
  activeNoticeTitle: ACTIVE_NOTICE_TITLE,
  activeNoticeCopy: ACTIVE_NOTICE_COPY,
  safetyNoticeTitle: SAFETY_NOTICE_TITLE,
  safetyNoticeCopy: SAFETY_NOTICE_COPY,
};

const toText = (value) => (value == null ? "" : String(value).trim());

const coalesceText = (...values) => {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return "";
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const toOptionalBoolean = (value) => {
  if (value === true || value === false) return value;
  const normalized = toText(value).toLowerCase();
  if (["true", "yes", "1", "active"].includes(normalized)) return true;
  if (["false", "no", "0", "inactive", "none"].includes(normalized)) return false;
  return null;
};

const resolveActiveSpeciesFlag = (lot = {}, labelMeta = {}) => {
  const explicitValues = [
    labelMeta?.containsActiveSpecies,
    lot?.containsActiveSpecies,
    labelMeta?.activeSpecies,
    lot?.activeSpecies,
  ];

  for (const value of explicitValues) {
    const parsed = toOptionalBoolean(value);
    if (parsed !== null) return parsed;
  }

  const advisoryType = coalesceText(labelMeta?.advisoryType, lot?.advisoryType).toLowerCase();
  if (["active", "psychoactive", "active_species"].includes(advisoryType)) return true;
  if (["functional", "medicinal", "culinary", "non_active"].includes(advisoryType)) return false;

  const speciesText = [
    labelMeta?.speciesDisplay,
    labelMeta?.species,
    lot?.species,
    lot?.scientificName,
    lot?.latinName,
    lot?.genusSpecies,
  ]
    .map(toText)
    .filter(Boolean)
    .join(" + ");

  return ACTIVE_SPECIES_PATTERN.test(speciesText);
};

const resolveLabelBlurb = (lot = {}, labelMeta = {}) => {
  const productSpecific = coalesceText(
    labelMeta?.blendBlurb,
    labelMeta?.productBlurb,
    lot?.blendBlurb,
    lot?.productBlurb
  );

  return {
    title: productSpecific ? "ABOUT THIS BLEND" : "CHAOTIC NEUTRAL",
    copy: productSpecific || DEFAULT_COMPANY_BLURB,
  };
};

const formatDate = (value) => {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getMonth() + 1).padStart(2, "0")}/${String(value.getDate()).padStart(2, "0")}/${value.getFullYear()}`;
  }

  if (typeof value === "object" && typeof value?.seconds === "number") {
    return formatDate(new Date(value.seconds * 1000));
  }

  const raw = toText(value);
  if (!raw) return "";

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${slash[1].padStart(2, "0")}/${slash[2].padStart(2, "0")}/${year}`;
  }

  return raw;
};

const formatWeightGrams = (grams) => {
  const n = Number(grams);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return `${rounded} g`;
};

const formatPerCapsule = (lot = {}) => {
  const direct = coalesceText(lot?.perCapsule, lot?.perUnit, lot?.dosePerUnit, lot?.servingSize);
  if (direct) return direct;

  const mg = toNumber(
    lot?.mgPerUnit ??
      lot?.potency?.activeMgPerUnit ??
      lot?.potency?.mgPerUnit ??
      lot?.activeMgPerUnit
  );
  if (mg > 0) return `${mg} mg`;

  const grams = toNumber(lot?.gramsPerUnit ?? lot?.gPerUnit);
  if (grams > 0) return `${grams} g`;

  return "";
};

const getFinishedQuantity = (lot = {}) => {
  return toNumber(
    lot?.initialQuantity ??
      lot?.remainingQuantity ??
      lot?.quantity ??
      lot?.count ??
      lot?.outputCount ??
      lot?.qty
  );
};

const getLotTypeLabel = (lot = {}) => {
  const raw = toText(lot?.finishedGoodType || lot?.productType || lot?.lotType).toLowerCase();
  if (raw === "capsule" || raw === "capsules") return "capsules";
  if (raw === "gummy" || raw === "gummies") return "gummies";
  if (raw === "chocolate" || raw === "chocolates") return "chocolates";
  if (raw === "tincture" || raw === "tinctures") return "bottles";
  return toText(lot?.unitLabel || lot?.unit || lot?.pieceLabelPlural || lot?.pieceLabel) || "units";
};

const deriveTotalWeight = (lot = {}) => {
  const explicit = coalesceText(lot?.totalWeight, lot?.labelTotalWeight, lot?.netWeight);
  if (explicit) return explicit;

  const quantity = getFinishedQuantity(lot);
  const gramsPerUnit = toNumber(lot?.gramsPerUnit ?? lot?.gPerUnit);
  if (quantity > 0 && gramsPerUnit > 0) return formatWeightGrams(quantity * gramsPerUnit);

  const mgPerUnit = toNumber(
    lot?.mgPerUnit ??
      lot?.potency?.activeMgPerUnit ??
      lot?.potency?.mgPerUnit ??
      lot?.activeMgPerUnit
  );
  if (quantity > 0 && mgPerUnit > 0) return formatWeightGrams((quantity * mgPerUnit) / 1000);

  const amount = toNumber(lot?.totalGrams ?? lot?.weightGrams ?? lot?.weightG);
  if (amount > 0) return formatWeightGrams(amount);

  return "";
};

const buildFallbackLotCode = (lot = {}) => {
  const date = formatDate(lot?.packDate || lot?.createdDate || lot?.date || lot?.createdAt)
    .replace(/[^0-9]/g, "")
    .slice(-4);
  const variant = toText(lot?.variant || lot?.strain || lot?.name || "LOT")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 6);
  const suffix = toText(lot?.id || lot?.lotId || lot?.batchId)
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(-2);

  return [variant || "LOT", date || "0000", suffix || "01"].filter(Boolean).join("-");
};

export function buildPackagingLabelDataFromFinishedGood(lot = {}) {
  if (!lot || !Object.keys(lot).length) return { ...DEMO_PACKAGING_LABEL_DATA };

  const labelMeta = lot?.labelMetadata && typeof lot.labelMetadata === "object" ? lot.labelMetadata : {};
  const shelfLife = lot?.shelfLife && typeof lot.shelfLife === "object" ? lot.shelfLife : {};
  const quantity = getFinishedQuantity(lot);
  const unitLabel = getLotTypeLabel(lot);
  const productType = toText(lot?.finishedGoodType || lot?.productType || lot?.lotType).toLowerCase();
  const strainName = coalesceText(
    lot?.strainName,
    lot?.strain,
    lot?.sourceStrain,
    lot?.name,
    lot?.batchName,
    "Finished Product"
  );
  const variantTag = coalesceText(lot?.variant, lot?.sku, lot?.batchName);
  const blurb = resolveLabelBlurb(lot, labelMeta);
  const containsActiveSpecies = resolveActiveSpeciesFlag(lot, labelMeta);
  const advisoryType = coalesceText(
    labelMeta?.advisoryType,
    lot?.advisoryType,
    containsActiveSpecies ? "active" : "general"
  );

  return {
    strainName,
    variantTag: variantTag && variantTag !== strainName ? variantTag : "",
    species: coalesceText(labelMeta?.speciesDisplay, labelMeta?.species, lot?.species, lot?.scientificName, lot?.latinName, lot?.genusSpecies),
    totalWeight: coalesceText(labelMeta?.totalWeight, lot?.totalWeight, deriveTotalWeight(lot)),
    capsuleCount: coalesceText(
      labelMeta?.capsuleCount,
      lot?.capsuleCount,
      lot?.countLabel,
      quantity > 0
        ? `${quantity} ${productType === "capsule" || productType === "capsules" ? "capsules" : unitLabel}`
        : ""
    ),
    perCapsule: coalesceText(labelMeta?.perCapsule, lot?.perCapsule, formatPerCapsule(lot)),
    batchLot: coalesceText(labelMeta?.lotCode, lot?.lotCode, lot?.batchLot, buildFallbackLotCode(lot)),
    harvestedDate: formatDate(
      coalesceText(
        lot?.harvestedDate,
        lot?.harvestDate,
        lot?.sourceHarvestDate,
        lot?.source?.harvestedDate,
        lot?.inputSnapshot?.harvestedDate
      )
    ),
    packedDate: formatDate(coalesceText(labelMeta?.packDate, lot?.packDate, lot?.createdDate, lot?.date, lot?.createdAt)),
    bestByDate: formatDate(coalesceText(labelMeta?.bestBy, labelMeta?.expirationDate, shelfLife?.bestBy, shelfLife?.bestByDate, shelfLife?.expirationDate, shelfLife?.expiresOn)),
    blurbTitle: blurb.title,
    companyBlurb: blurb.copy,
    containsActiveSpecies,
    advisoryType,
    activeNoticeTitle: coalesceText(labelMeta?.activeNoticeTitle, lot?.activeNoticeTitle, ACTIVE_NOTICE_TITLE),
    activeNoticeCopy: coalesceText(labelMeta?.activeNoticeCopy, lot?.activeNoticeCopy, ACTIVE_NOTICE_COPY),
    safetyNoticeTitle: coalesceText(labelMeta?.safetyNoticeTitle, lot?.safetyNoticeTitle, SAFETY_NOTICE_TITLE),
    safetyNoticeCopy: coalesceText(labelMeta?.safetyNoticeCopy, lot?.safetyNoticeCopy, SAFETY_NOTICE_COPY),
  };
}

export function normalizePackagingLabelData(data = {}) {
  const source = data && Object.keys(data).length ? data : DEMO_PACKAGING_LABEL_DATA;
  const explicitActive = toOptionalBoolean(source.containsActiveSpecies);
  const advisoryType = coalesceText(
    source.advisoryType,
    explicitActive === true ? "active" : "general"
  );
  const containsActiveSpecies =
    explicitActive !== null
      ? explicitActive
      : advisoryType.toLowerCase() === "active" ||
        ACTIVE_SPECIES_PATTERN.test(toText(source.species));

  return {
    strainName: toText(source.strainName),
    variantTag: toText(source.variantTag || source.subname || source.subName),
    species: toText(source.species),
    totalWeight: toText(source.totalWeight),
    capsuleCount: toText(source.capsuleCount),
    perCapsule: toText(source.perCapsule),
    batchLot: toText(source.batchLot),
    harvestedDate: formatDate(source.harvestedDate),
    packedDate: formatDate(source.packedDate),
    bestByDate: formatDate(source.bestByDate),
    blurbTitle: coalesceText(source.blurbTitle, "CHAOTIC NEUTRAL"),
    companyBlurb: coalesceText(source.companyBlurb, DEFAULT_COMPANY_BLURB),
    containsActiveSpecies,
    advisoryType,
    activeNoticeTitle: coalesceText(source.activeNoticeTitle, ACTIVE_NOTICE_TITLE),
    activeNoticeCopy: coalesceText(source.activeNoticeCopy, ACTIVE_NOTICE_COPY),
    safetyNoticeTitle: coalesceText(source.safetyNoticeTitle, SAFETY_NOTICE_TITLE),
    safetyNoticeCopy: coalesceText(source.safetyNoticeCopy, SAFETY_NOTICE_COPY),
  };
}

const escapeHtml = (value) =>
  toText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const fitSize = (value, sizes) => {
  const length = toText(value).length;
  for (const [max, size] of sizes) {
    if (length <= max) return size;
  }
  return sizes[sizes.length - 1][1];
};

const splitIntoLines = (value, maxLines = 3, preferredChars = 22) => {
  const clean = toText(value).replace(/\s+/g, " ");
  if (!clean) return [];

  const words = clean.split(" ").filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > preferredChars && lines.length < maxLines - 1) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, maxLines);
};

const splitTitleLines = (value) => {
  const clean = toText(value).replace(/\s+/g, " ");
  if (!clean) return [];

  if (clean.length <= 24) return [clean];
  if (clean.length <= 44) return splitIntoLines(clean, 2, 22);
  return splitIntoLines(clean, 3, 24);
};

const abbreviateSpeciesPart = (value) => {
  const clean = toText(value).replace(/\s+/g, " ").trim();
  if (!clean) return "";

  if (/^[A-Z]\.\s+/.test(clean)) return clean;

  const words = clean.split(" ").filter(Boolean);
  if (words.length < 2) return clean;

  const genus = words[0].replace(/[^a-z-]/gi, "");
  if (!genus || genus.length < 3) return clean;

  return `${genus.slice(0, 1).toUpperCase()}. ${words.slice(1).join(" ")}`;
};

const packSpeciesPartsIntoLines = (parts = []) => {
  const normalized = parts.map(abbreviateSpeciesPart).filter(Boolean);
  if (normalized.length === 0) return [];
  if (normalized.length === 1) return normalized;

  const lines = [];
  let current = "";

  for (const part of normalized) {
    const next = current ? `${current} + ${part}` : part;
    if (current && next.length > 30 && lines.length < 1) {
      lines.push(current);
      current = part;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);

  if (lines.length <= 2) return lines;

  return [lines[0], lines.slice(1).join(" + ")];
};

const splitSpeciesLines = (value) => {
  const clean = toText(value).replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const plusParts = clean.split(/\s*\+\s*/).map((part) => part.trim()).filter(Boolean);
  if (plusParts.length > 1) return packSpeciesPartsIntoLines(plusParts);

  const abbreviated = abbreviateSpeciesPart(clean);
  if (abbreviated.length > 29) return splitIntoLines(abbreviated, 2, 24);
  return [abbreviated];
};

const getSpeciesLineCount = (value) => splitSpeciesLines(value).length;

const renderStrainText = (value) => {
  const lines = splitTitleLines(value);
  if (!lines.length) return null;
  return lines.map((line, index) => (
    <span key={`${line}-${index}`} className="cnm-packaging-label__strain-line">
      {line}
    </span>
  ));
};

const renderStrainHtml = (value) =>
  splitTitleLines(value)
    .map((line) => `<span class="cnm-packaging-label__strain-line">${escapeHtml(line)}</span>`)
    .join("");

const renderSpeciesText = (value) => {
  const lines = splitSpeciesLines(value);
  if (!lines.length) return null;
  return lines.map((line, index) => (
    <span key={`${line}-${index}`} className="cnm-packaging-label__species-line">
      {line}
    </span>
  ));
};

const renderSpeciesHtml = (value) =>
  splitSpeciesLines(value)
    .map((line) => `<span class="cnm-packaging-label__species-line">${escapeHtml(line)}</span>`)
    .join("");

const noticeIconSvg = (type) => {
  if (type === "mushroom") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11c.7-4.2 3.8-7 8-7s7.3 2.8 8 7c.1.7-.4 1.3-1.1 1.3H5.1C4.4 12.3 3.9 11.7 4 11Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.4 12.3v4.8c0 1.7 1.1 2.9 2.6 2.9s2.6-1.2 2.6-2.9v-4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }

  if (type === "warning") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.7 19.2c-.4.8.1 1.8 1.1 1.8h16.4c1 0 1.5-1 1.1-1.8L12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1" fill="currentColor"/></svg>`;
  }

  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.7 7.3L21 11l-7.3 1.7L12 20l-1.7-7.3L3 11l7.3-1.7L12 2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="18.5" cy="5.5" r="1.2" fill="currentColor"/><circle cx="5.5" cy="17.5" r=".9" fill="currentColor"/></svg>`;
};

function NoticeIcon({ type }) {
  return (
    <span
      className="cnm-packaging-label__notice-icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: noticeIconSvg(type) }}
    />
  );
}

const cssForLabel = ({ print = false } = {}) => `
  .cnm-packaging-label {
    width: ${print ? "3in" : "420px"};
    max-width: ${print ? "3in" : "100%"};
    height: ${print ? "3in" : "auto"};
    aspect-ratio: 1 / 1;
    position: relative;
    overflow: hidden;
    color: ${INK};
    background: #fff url("${TEMPLATE_URL}") center / contain no-repeat;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    isolation: isolate;
  }
  .cnm-packaging-label__field {
    position: absolute;
    z-index: 2;
    box-sizing: border-box;
    color: ${INK};
    overflow: hidden;
    text-overflow: clip;
    letter-spacing: 0.018em;
    text-shadow: 0 0 ${print ? "0.012in" : "2px"} rgba(255, 255, 255, 0.46);
  }
  .cnm-packaging-label__strain {
    left: 12.2%;
    top: 24.0%;
    width: 75.6%;
    height: 12.1%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: ${DISPLAY_FONT};
    font-weight: 900;
    line-height: 0.86;
    text-align: center;
    text-transform: uppercase;
    white-space: normal;
    -webkit-text-stroke: ${print ? "0.0045in" : "0.75px"} rgba(255, 255, 255, 0.88);
    paint-order: stroke fill;
    text-shadow:
      0 0 ${print ? "0.012in" : "3px"} rgba(255, 255, 255, 0.95),
      0 ${print ? "0.004in" : "1px"} ${print ? "0.006in" : "1px"} rgba(255, 255, 255, 0.72);
    overflow: visible;
  }
  .cnm-packaging-label__strain-line {
    display: block;
    max-width: 100%;
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
    padding-bottom: ${print ? "0.012in" : "2px"};
  }
  .cnm-packaging-label__variant {
    left: 16.5%;
    top: 34.9%;
    width: 67%;
    height: 4.8%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: ${DISPLAY_FONT};
    font-weight: 800;
    line-height: 1;
    text-align: center;
    text-transform: uppercase;
    white-space: nowrap;
    -webkit-text-stroke: ${print ? "0.0035in" : "0.55px"} rgba(255, 255, 255, 0.9);
    paint-order: stroke fill;
    text-shadow: 0 0 ${print ? "0.009in" : "2px"} rgba(255, 255, 255, 0.94);
    overflow: visible;
  }
  .cnm-packaging-label__left-value {
    left: 20.1%;
    width: 27.8%;
    height: 3.35%;
    display: flex;
    align-items: flex-end;
    font-family: ${VALUE_FONT};
    font-weight: 800;
    line-height: 1;
    white-space: nowrap;
    overflow: visible;
  }
  .cnm-packaging-label__species {
    left: 19.7%;
    width: 34.2%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-end;
    font-family: ${SPECIES_FONT};
    font-weight: 700;
    font-style: italic;
    letter-spacing: 0;
    text-transform: none;
    white-space: normal;
    overflow: visible;
  }
  .cnm-packaging-label__species--single {
    top: 43.42%;
    height: 3.1%;
    line-height: 0.98;
  }
  .cnm-packaging-label__species--multi {
    top: 42.68%;
    height: 4.35%;
    justify-content: center;
    line-height: 0.86;
  }
  .cnm-packaging-label__species-line {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: clip;
    white-space: nowrap;
  }
  .cnm-packaging-label__total-weight { top: 51.55%; }
  .cnm-packaging-label__capsule-count { top: 58.85%; }
  .cnm-packaging-label__per-capsule { top: 65.56%; }
  .cnm-packaging-label__batch-value {
    left: 42.25%;
    width: 21.25%;
    height: 2.75%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    font-family: ${DISPLAY_FONT};
    font-weight: 800;
    line-height: 1.08;
    text-align: center;
    text-transform: uppercase;
    white-space: nowrap;
    letter-spacing: -0.018em;
    overflow: visible;
  }
  .cnm-packaging-label__batch-text {
    display: inline-block;
    max-width: 100%;
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
    line-height: 1.08;
    -webkit-text-stroke: ${print ? "0.0025in" : "0.38px"} rgba(255, 255, 255, 0.88);
    paint-order: stroke fill;
    text-shadow: 0 0 ${print ? "0.006in" : "1.5px"} rgba(255, 255, 255, 0.92);
  }
  .cnm-packaging-label__batch-lot { top: 50.85%; }
  .cnm-packaging-label__harvested { top: 57.15%; }
  .cnm-packaging-label__packed { top: 63.35%; }
  .cnm-packaging-label__best-by { top: 69.55%; }
  .cnm-packaging-label__notice-stack {
    position: absolute;
    left: 8.8%;
    width: 82.4%;
    z-index: 3;
    display: grid;
    box-sizing: border-box;
    color: ${INK};
  }
  .cnm-packaging-label__notice-stack--active {
    top: 80.7%;
    height: 18.5%;
    grid-template-rows: 23% 35% 38%;
    gap: 2%;
  }
  .cnm-packaging-label__notice-stack--standard {
    top: 82.2%;
    height: 8.2%;
    grid-template-rows: 1fr;
  }
  .cnm-packaging-label__notice-panel {
    min-height: 0;
    display: grid;
    grid-template-columns: 8.2% minmax(0, 1fr);
    align-items: start;
    gap: 2.1%;
    box-sizing: border-box;
    padding: 0;
    background: transparent;
    border: 0;
    box-shadow: none;
    overflow: hidden;
  }
  .cnm-packaging-label__notice-panel--company {
    grid-template-columns: 6.5% minmax(0, 1fr);
  }
  .cnm-packaging-label__notice-icon {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    color: ${INK};
    padding-top: ${print ? "0.005in" : "1px"};
    box-sizing: border-box;
  }
  .cnm-packaging-label__notice-icon svg {
    width: 82%;
    height: auto;
    max-height: 88%;
    display: block;
  }
  .cnm-packaging-label__notice-content {
    min-width: 0;
    font-family: ${VALUE_FONT};
    color: ${INK};
    line-height: 1.03;
    overflow: hidden;
    text-shadow: 0 0 ${print ? "0.008in" : "1px"} rgba(255,255,255,0.85);
  }
  .cnm-packaging-label__notice-title {
    display: block;
    margin-bottom: ${print ? "0.004in" : "1px"};
    font-family: ${DISPLAY_FONT};
    font-weight: 900;
    font-size: ${print ? "0.049in" : "0.43rem"};
    line-height: 0.96;
    letter-spacing: 0.012em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .cnm-packaging-label__notice-copy {
    display: block;
    font-size: ${print ? "0.040in" : "0.35rem"};
    font-weight: 650;
    line-height: 1.04;
    letter-spacing: -0.004em;
  }
  .cnm-packaging-label__notice-panel--company .cnm-packaging-label__notice-title {
    display: inline;
    margin-right: ${print ? "0.018in" : "3px"};
    font-size: ${print ? "0.047in" : "0.41rem"};
  }
  .cnm-packaging-label__notice-panel--company .cnm-packaging-label__notice-copy {
    display: inline;
    font-size: ${print ? "0.039in" : "0.34rem"};
    line-height: 1.06;
  }
  .cnm-packaging-label__notice-stack--standard .cnm-packaging-label__notice-panel--company {
    grid-template-columns: 7.2% minmax(0, 1fr);
  }
  .cnm-packaging-label__notice-stack--standard .cnm-packaging-label__notice-title {
    font-size: ${print ? "0.054in" : "0.48rem"};
  }
  .cnm-packaging-label__notice-stack--standard .cnm-packaging-label__notice-copy {
    font-size: ${print ? "0.044in" : "0.39rem"};
    line-height: 1.08;
  }
  .cnm-packaging-label__preload {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
`;

function LabelArtwork({ labelData, print = false }) {
  const data = normalizePackagingLabelData(labelData);
  const speciesLines = splitSpeciesLines(data.species);
  const speciesIsMulti = speciesLines.length > 1;
  const speciesDisplayText = speciesLines.join(" ");

  const strainFontSize = fitSize(data.strainName, [
    [0, print ? "0.01in" : "0.01rem"],
    [18, print ? "0.208in" : "1.68rem"],
    [24, print ? "0.186in" : "1.5rem"],
    [35, print ? "0.136in" : "1.08rem"],
    [50, print ? "0.108in" : "0.88rem"],
    [68, print ? "0.092in" : "0.74rem"],
    [999, print ? "0.078in" : "0.64rem"],
  ]);

  const variantFontSize = fitSize(data.variantTag, [
    [0, print ? "0.01in" : "0.01rem"],
    [12, print ? "0.118in" : "0.98rem"],
    [18, print ? "0.104in" : "0.86rem"],
    [28, print ? "0.086in" : "0.7rem"],
    [999, print ? "0.068in" : "0.56rem"],
  ]);

  const speciesFontSize = speciesIsMulti
    ? fitSize(speciesDisplayText, [
        [0, print ? "0.01in" : "0.01rem"],
        [34, print ? "0.054in" : "0.5rem"],
        [54, print ? "0.048in" : "0.44rem"],
        [999, print ? "0.042in" : "0.38rem"],
      ])
    : fitSize(speciesDisplayText, [
        [0, print ? "0.01in" : "0.01rem"],
        [16, print ? "0.066in" : "0.6rem"],
        [24, print ? "0.06in" : "0.55rem"],
        [999, print ? "0.052in" : "0.48rem"],
      ]);

  const valueFontSize = print ? "0.086in" : "0.78rem";

  const batchFontSize = fitSize(data.batchLot, [
    [0, print ? "0.01in" : "0.01rem"],
    [10, print ? "0.066in" : "0.58rem"],
    [14, print ? "0.056in" : "0.5rem"],
    [18, print ? "0.05in" : "0.45rem"],
    [24, print ? "0.046in" : "0.4rem"],
    [999, print ? "0.038in" : "0.34rem"],
  ]);
  const dateFontSize = print ? "0.064in" : "0.58rem";

  return (
    <div className="cnm-packaging-label" aria-label="3 by 3 packaging label preview" data-alignment={ALIGNMENT_MARKER}>
      <style>{cssForLabel({ print })}</style>

      <div className="cnm-packaging-label__field cnm-packaging-label__strain" style={{ fontSize: strainFontSize }}>
        {renderStrainText(data.strainName)}
      </div>

      <div className="cnm-packaging-label__field cnm-packaging-label__variant" style={{ fontSize: variantFontSize }}>
        {data.variantTag}
      </div>

      <div
        className={`cnm-packaging-label__field cnm-packaging-label__left-value cnm-packaging-label__species ${speciesIsMulti ? "cnm-packaging-label__species--multi" : "cnm-packaging-label__species--single"}`}
        style={{ fontSize: speciesFontSize }}
      >
        {renderSpeciesText(data.species)}
      </div>
      <div className="cnm-packaging-label__field cnm-packaging-label__left-value cnm-packaging-label__total-weight" style={{ fontSize: valueFontSize }}>
        {data.totalWeight}
      </div>
      <div className="cnm-packaging-label__field cnm-packaging-label__left-value cnm-packaging-label__capsule-count" style={{ fontSize: valueFontSize }}>
        {data.capsuleCount}
      </div>
      <div className="cnm-packaging-label__field cnm-packaging-label__left-value cnm-packaging-label__per-capsule" style={{ fontSize: valueFontSize }}>
        {data.perCapsule}
      </div>

      <div className="cnm-packaging-label__field cnm-packaging-label__batch-value cnm-packaging-label__batch-lot" style={{ fontSize: batchFontSize }}>
        <span className="cnm-packaging-label__batch-text">{data.batchLot}</span>
      </div>
      <div className="cnm-packaging-label__field cnm-packaging-label__batch-value cnm-packaging-label__harvested" style={{ fontSize: dateFontSize }}>
        <span className="cnm-packaging-label__batch-text">{data.harvestedDate}</span>
      </div>
      <div className="cnm-packaging-label__field cnm-packaging-label__batch-value cnm-packaging-label__packed" style={{ fontSize: dateFontSize }}>
        <span className="cnm-packaging-label__batch-text">{data.packedDate}</span>
      </div>
      <div className="cnm-packaging-label__field cnm-packaging-label__batch-value cnm-packaging-label__best-by" style={{ fontSize: dateFontSize }}>
        <span className="cnm-packaging-label__batch-text">{data.bestByDate}</span>
      </div>

      <div
        className={`cnm-packaging-label__notice-stack ${
          data.containsActiveSpecies
            ? "cnm-packaging-label__notice-stack--active"
            : "cnm-packaging-label__notice-stack--standard"
        }`}
      >
        <div className="cnm-packaging-label__notice-panel cnm-packaging-label__notice-panel--company">
          <NoticeIcon type="spark" />
          <div className="cnm-packaging-label__notice-content">
            <span className="cnm-packaging-label__notice-title">{data.blurbTitle}</span>
            <span className="cnm-packaging-label__notice-copy">{data.companyBlurb}</span>
          </div>
        </div>

        {data.containsActiveSpecies ? (
          <>
            <div className="cnm-packaging-label__notice-panel cnm-packaging-label__notice-panel--active">
              <NoticeIcon type="mushroom" />
              <div className="cnm-packaging-label__notice-content">
                <span className="cnm-packaging-label__notice-title">{data.activeNoticeTitle}</span>
                <span className="cnm-packaging-label__notice-copy">{data.activeNoticeCopy}</span>
              </div>
            </div>

            <div className="cnm-packaging-label__notice-panel cnm-packaging-label__notice-panel--safety">
              <NoticeIcon type="warning" />
              <div className="cnm-packaging-label__notice-content">
                <span className="cnm-packaging-label__notice-title">{data.safetyNoticeTitle}</span>
                <span className="cnm-packaging-label__notice-copy">{data.safetyNoticeCopy}</span>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}


const getPrintSizing = (data) => {
  const speciesLines = splitSpeciesLines(data.species);
  const speciesIsMulti = speciesLines.length > 1;
  const speciesDisplayText = speciesLines.join(" ");

  return {
    speciesIsMulti,
    strainFontSize: fitSize(data.strainName, [
      [0, "0.01in"],
      [18, "0.208in"],
      [24, "0.186in"],
      [35, "0.136in"],
      [50, "0.108in"],
      [68, "0.092in"],
      [999, "0.078in"],
    ]),
    variantFontSize: fitSize(data.variantTag, [
      [0, "0.01in"],
      [12, "0.118in"],
      [18, "0.104in"],
      [28, "0.086in"],
      [999, "0.068in"],
    ]),
    speciesFontSize: speciesIsMulti
      ? fitSize(speciesDisplayText, [
          [0, "0.01in"],
          [34, "0.054in"],
          [54, "0.048in"],
          [999, "0.042in"],
        ])
      : fitSize(speciesDisplayText, [
          [0, "0.01in"],
          [16, "0.066in"],
          [24, "0.06in"],
          [999, "0.052in"],
        ]),
    batchFontSize: fitSize(data.batchLot, [
      [0, "0.01in"],
      [10, "0.066in"],
      [14, "0.056in"],
      [18, "0.05in"],
      [24, "0.046in"],
      [999, "0.038in"],
    ]),
  };
};

const buildSingleLabelHtml = (labelData) => {
  const data = normalizePackagingLabelData(labelData);
  const sizing = getPrintSizing(data);
  const value = (key) => escapeHtml(data[key]);

  return `
    <div class="cnm-packaging-label" aria-label="3 by 3 packaging label" data-alignment="${ALIGNMENT_MARKER}">
      <img class="cnm-packaging-label__preload" src="${TEMPLATE_URL}" alt="" />
      <div class="cnm-packaging-label__field cnm-packaging-label__strain" style="font-size:${sizing.strainFontSize}">${renderStrainHtml(data.strainName)}</div>
      <div class="cnm-packaging-label__field cnm-packaging-label__variant" style="font-size:${sizing.variantFontSize}">${value("variantTag")}</div>
      <div class="cnm-packaging-label__field cnm-packaging-label__left-value cnm-packaging-label__species ${sizing.speciesIsMulti ? "cnm-packaging-label__species--multi" : "cnm-packaging-label__species--single"}" style="font-size:${sizing.speciesFontSize}">${renderSpeciesHtml(data.species)}</div>
      <div class="cnm-packaging-label__field cnm-packaging-label__left-value cnm-packaging-label__total-weight" style="font-size:0.086in">${value("totalWeight")}</div>
      <div class="cnm-packaging-label__field cnm-packaging-label__left-value cnm-packaging-label__capsule-count" style="font-size:0.086in">${value("capsuleCount")}</div>
      <div class="cnm-packaging-label__field cnm-packaging-label__left-value cnm-packaging-label__per-capsule" style="font-size:0.086in">${value("perCapsule")}</div>
      <div class="cnm-packaging-label__field cnm-packaging-label__batch-value cnm-packaging-label__batch-lot" style="font-size:${sizing.batchFontSize}"><span class="cnm-packaging-label__batch-text">${value("batchLot")}</span></div>
      <div class="cnm-packaging-label__field cnm-packaging-label__batch-value cnm-packaging-label__harvested" style="font-size:0.064in"><span class="cnm-packaging-label__batch-text">${value("harvestedDate")}</span></div>
      <div class="cnm-packaging-label__field cnm-packaging-label__batch-value cnm-packaging-label__packed" style="font-size:0.064in"><span class="cnm-packaging-label__batch-text">${value("packedDate")}</span></div>
      <div class="cnm-packaging-label__field cnm-packaging-label__batch-value cnm-packaging-label__best-by" style="font-size:0.064in"><span class="cnm-packaging-label__batch-text">${value("bestByDate")}</span></div>
      <div class="cnm-packaging-label__notice-stack ${data.containsActiveSpecies ? "cnm-packaging-label__notice-stack--active" : "cnm-packaging-label__notice-stack--standard"}">
        <div class="cnm-packaging-label__notice-panel cnm-packaging-label__notice-panel--company">
          <span class="cnm-packaging-label__notice-icon" aria-hidden="true">${noticeIconSvg("spark")}</span>
          <div class="cnm-packaging-label__notice-content">
            <span class="cnm-packaging-label__notice-title">${value("blurbTitle")}</span>
            <span class="cnm-packaging-label__notice-copy">${value("companyBlurb")}</span>
          </div>
        </div>
        ${
          data.containsActiveSpecies
            ? `<div class="cnm-packaging-label__notice-panel cnm-packaging-label__notice-panel--active">
                <span class="cnm-packaging-label__notice-icon" aria-hidden="true">${noticeIconSvg("mushroom")}</span>
                <div class="cnm-packaging-label__notice-content">
                  <span class="cnm-packaging-label__notice-title">${value("activeNoticeTitle")}</span>
                  <span class="cnm-packaging-label__notice-copy">${value("activeNoticeCopy")}</span>
                </div>
              </div>
              <div class="cnm-packaging-label__notice-panel cnm-packaging-label__notice-panel--safety">
                <span class="cnm-packaging-label__notice-icon" aria-hidden="true">${noticeIconSvg("warning")}</span>
                <div class="cnm-packaging-label__notice-content">
                  <span class="cnm-packaging-label__notice-title">${value("safetyNoticeTitle")}</span>
                  <span class="cnm-packaging-label__notice-copy">${value("safetyNoticeCopy")}</span>
                </div>
              </div>`
            : ""
        }
      </div>
    </div>`;
};

const buildAveryPages = (entries, startPosition = 1) => {
  const prefill = Math.max(0, Math.min(AVERY_5659.perSheet - 1, Number(startPosition || 1) - 1));
  const cells = [
    ...Array.from({ length: prefill }, () => null),
    ...entries,
  ];

  if (!cells.length) return [Array.from({ length: AVERY_5659.perSheet }, () => null)];

  const pages = [];
  for (let index = 0; index < cells.length; index += AVERY_5659.perSheet) {
    const page = cells.slice(index, index + AVERY_5659.perSheet);
    while (page.length < AVERY_5659.perSheet) page.push(null);
    pages.push(page);
  }
  return pages;
};

const buildAveryPrintHtml = ({
  entries,
  startPosition,
  scalePct,
  offsetXmm,
  offsetYmm,
}) => {
  const pages = buildAveryPages(entries, startPosition);
  const sheetsHtml = pages
    .map(
      (page, pageIndex) => `
        <section class="avery-sheet" data-page="${pageIndex + 1}">
          <div class="avery-grid">
            ${page
              .map(
                (entry) => `
                  <div class="avery-cell">
                    ${
                      entry
                        ? `<div class="avery-label-inner">${buildSingleLabelHtml(entry.data)}</div>`
                        : ""
                    }
                  </div>`
              )
              .join("")}
          </div>
        </section>`
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Avery 5659 Packaging Labels</title>
    <style>
      @page { size: letter; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .avery-sheet {
        width: ${AVERY_5659.sheetWidthIn}in;
        height: ${AVERY_5659.sheetHeightIn}in;
        position: relative;
        overflow: hidden;
        page-break-after: always;
        break-after: page;
        background: #fff;
      }
      .avery-sheet:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .avery-grid {
        position: absolute;
        left: calc(${AVERY_5659.sideMarginIn}in + ${Number(offsetXmm) || 0}mm);
        top: calc(${AVERY_5659.topMarginIn}in + ${Number(offsetYmm) || 0}mm);
        display: grid;
        grid-template-columns: repeat(${AVERY_5659.cols}, ${AVERY_5659.labelWidthIn}in);
        grid-template-rows: repeat(${AVERY_5659.rows}, ${AVERY_5659.labelHeightIn}in);
        column-gap: ${AVERY_5659.horizontalGapIn}in;
        row-gap: ${AVERY_5659.verticalGapIn}in;
      }
      .avery-cell {
        width: ${AVERY_5659.labelWidthIn}in;
        height: ${AVERY_5659.labelHeightIn}in;
        position: relative;
        overflow: hidden;
        background: #fff;
      }
      .avery-label-inner {
        width: ${AVERY_5659.labelWidthIn}in;
        height: ${AVERY_5659.labelHeightIn}in;
        transform: scale(${Math.max(90, Math.min(110, Number(scalePct) || 100)) / 100});
        transform-origin: center;
      }
      ${cssForLabel({ print: true })}
    </style>
  </head>
  <body>${sheetsHtml}</body>
</html>`;
};

const clampInteger = (value, min, max, fallback = min) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const clampNumber = (value, min, max, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const readStoredNumber = (key, fallback) => {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

export default function PackagingLabelPreview({
  data,
  title = "Packaging label preview",
  subtitle = "Avery 5659 · six 3×3 labels per US Letter sheet.",
  sourceLabel = "Demo data",
  items = [],
  selectedId = "",
  onSelectedIdChange,
}) {
  const printFrameRef = useRef(null);
  const selectAllRef = useRef(null);

  const labelData = useMemo(
    () => normalizePackagingLabelData(data || DEMO_PACKAGING_LABEL_DATA),
    [data]
  );

  const normalizedItems = useMemo(() => {
    if (Array.isArray(items) && items.length) {
      return items.map((item, index) => ({
        id: toText(item?.id) || `packaging-label-${index + 1}`,
        name: toText(item?.name) || `Packaging label ${index + 1}`,
        data: normalizePackagingLabelData(item?.data || DEMO_PACKAGING_LABEL_DATA),
        maxQuantity: Math.max(1, Math.floor(toNumber(item?.maxQuantity) || 1)),
      }));
    }

    return [
      {
        id: selectedId || "current-packaging-label",
        name: sourceLabel || "Current packaging label",
        data: labelData,
        maxQuantity: 1,
      },
    ];
  }, [items, labelData, selectedId, sourceLabel]);

  const activePreviewId =
    selectedId && normalizedItems.some((item) => item.id === selectedId)
      ? selectedId
      : normalizedItems[0]?.id || "";

  const [selectedIds, setSelectedIds] = useState(
    () => new Set(activePreviewId ? [activePreviewId] : [])
  );
  const [quantities, setQuantities] = useState({});
  const [startPosition, setStartPosition] = useState(() =>
    clampInteger(readStoredNumber(LOCAL_KEY_5659_START, 1), 1, AVERY_5659.perSheet, 1)
  );
  const [gridOverlay, setGridOverlay] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_KEY_5659_GRID) === "1";
    } catch {
      return false;
    }
  });
  const [scalePct, setScalePct] = useState(() =>
    clampNumber(readStoredNumber(LOCAL_KEY_5659_SCALE, 100), 90, 110, 100)
  );
  const [offsetXmm, setOffsetXmm] = useState(() =>
    clampNumber(readStoredNumber(LOCAL_KEY_5659_OFFSET_X, 0), -5, 5, 0)
  );
  const [offsetYmm, setOffsetYmm] = useState(() =>
    clampNumber(readStoredNumber(LOCAL_KEY_5659_OFFSET_Y, 0), -5, 5, 0)
  );

  useEffect(() => {
    setSelectedIds((previous) => {
      const validIds = new Set(normalizedItems.map((item) => item.id));
      const next = new Set([...previous].filter((id) => validIds.has(id)));

      if (!next.size && activePreviewId) next.add(activePreviewId);
      return next;
    });

    setQuantities((previous) => {
      const next = {};
      for (const item of normalizedItems) {
        next[item.id] = clampInteger(
          previous[item.id] ?? 1,
          1,
          item.maxQuantity,
          1
        );
      }
      return next;
    });
  }, [activePreviewId, normalizedItems]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    const selectedCount = normalizedItems.filter((item) => selectedIds.has(item.id)).length;
    selectAllRef.current.indeterminate =
      selectedCount > 0 && selectedCount < normalizedItems.length;
  }, [normalizedItems, selectedIds]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY_5659_START, String(startPosition));
      localStorage.setItem(LOCAL_KEY_5659_GRID, gridOverlay ? "1" : "0");
      localStorage.setItem(LOCAL_KEY_5659_SCALE, String(scalePct));
      localStorage.setItem(LOCAL_KEY_5659_OFFSET_X, String(offsetXmm));
      localStorage.setItem(LOCAL_KEY_5659_OFFSET_Y, String(offsetYmm));
    } catch {}
  }, [gridOverlay, offsetXmm, offsetYmm, scalePct, startPosition]);

  useEffect(() => {
    return () => {
      if (printFrameRef.current?.parentNode) {
        try {
          printFrameRef.current.parentNode.removeChild(printFrameRef.current);
        } catch {}
      }
      printFrameRef.current = null;
    };
  }, []);

  const selectedEntries = useMemo(() => {
    const entries = [];

    for (const item of normalizedItems) {
      if (!selectedIds.has(item.id)) continue;
      const quantity = clampInteger(
        quantities[item.id] ?? 1,
        1,
        item.maxQuantity,
        1
      );

      for (let copyIndex = 0; copyIndex < quantity; copyIndex += 1) {
        entries.push({
          key: `${item.id}-${copyIndex + 1}`,
          id: item.id,
          name: item.name,
          data: item.data,
        });
      }
    }

    return entries;
  }, [normalizedItems, quantities, selectedIds]);

  const previewPages = useMemo(
    () => buildAveryPages(selectedEntries, startPosition),
    [selectedEntries, startPosition]
  );

  const selectedLotCount = normalizedItems.filter((item) => selectedIds.has(item.id)).length;
  const selectedLabelCount = selectedEntries.length;

  const toggleSelected = (id) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (checked) => {
    setSelectedIds(
      checked ? new Set(normalizedItems.map((item) => item.id)) : new Set()
    );
  };

  const updateQuantity = (item, value) => {
    setQuantities((previous) => ({
      ...previous,
      [item.id]: clampInteger(value, 1, item.maxQuantity, 1),
    }));
  };

  const printAverySheets = async () => {
    if (!selectedEntries.length) {
      alert("Select at least one packaging label to print.");
      return;
    }

    if (printFrameRef.current?.parentNode) {
      try {
        printFrameRef.current.parentNode.removeChild(printFrameRef.current);
      } catch {}
      printFrameRef.current = null;
    }

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);
    printFrameRef.current = iframe;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      alert("Unable to open the Avery 5659 print frame.");
      return;
    }

    doc.open();
    doc.write(
      buildAveryPrintHtml({
        entries: selectedEntries,
        startPosition,
        scalePct,
        offsetXmm,
        offsetYmm,
      })
    );
    doc.close();

    await new Promise((resolve) => {
      if (doc.readyState === "complete") {
        resolve(true);
        return;
      }
      iframe.onload = () => resolve(true);
      setTimeout(() => resolve(true), 300);
    });

    await Promise.all(
      Array.from(doc.images || []).map((img) => {
        if (img.complete) return Promise.resolve(true);
        return new Promise((resolve) => {
          img.addEventListener("load", () => resolve(true), { once: true });
          img.addEventListener("error", () => resolve(true), { once: true });
        });
      })
    );

    try {
      await doc.fonts?.ready;
    } catch {}

    const cleanup = () => {
      if (iframe.parentNode) {
        try {
          iframe.parentNode.removeChild(iframe);
        } catch {}
      }
      if (printFrameRef.current === iframe) printFrameRef.current = null;
    };

    try {
      iframe.contentWindow?.focus();
      if (iframe.contentWindow) iframe.contentWindow.onafterprint = cleanup;
      iframe.contentWindow?.print();
      setTimeout(cleanup, 2500);
    } catch {
      cleanup();
      alert("The Avery 5659 print dialog could not be opened.");
    }
  };

  const sheetScale = 0.5;
  const sheetPreviewWidthPx = AVERY_5659.sheetWidthIn * 96 * sheetScale;
  const sheetPreviewHeightPx = AVERY_5659.sheetHeightIn * 96 * sheetScale;

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-4 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{title}</div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Preview source: {sourceLabel}
          </div>
        </div>
        <button type="button" onClick={printAverySheets} className="btn btn-accent">
          <Printer className="h-4 w-4" />
          Print Avery 5659 sheets
        </button>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="inline-flex items-center gap-2 select-none">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={normalizedItems.length > 0 && selectedLotCount === normalizedItems.length}
              onChange={(event) => selectAll(event.target.checked)}
            />
            <span className="text-sm font-medium">Select all</span>
          </label>

          <label className="space-y-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-zinc-500">
              Start at position
            </span>
            <select
              value={startPosition}
              onChange={(event) =>
                setStartPosition(
                  clampInteger(event.target.value, 1, AVERY_5659.perSheet, 1)
                )
              }
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2"
            >
              {Array.from({ length: AVERY_5659.perSheet }, (_, index) => index + 1).map(
                (position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                )
              )}
            </select>
          </label>

          <label className="inline-flex items-center gap-2 pb-2 select-none">
            <input
              type="checkbox"
              checked={gridOverlay}
              onChange={(event) => setGridOverlay(event.target.checked)}
            />
            <span className="text-sm">Grid preview</span>
          </label>

          <label className="space-y-1 text-sm min-w-[190px]">
            <span className="block text-xs uppercase tracking-wide text-zinc-500">
              Label scale: {Number(scalePct).toFixed(1)}%
            </span>
            <input
              type="range"
              min="90"
              max="110"
              step="0.25"
              value={scalePct}
              onChange={(event) =>
                setScalePct(clampNumber(event.target.value, 90, 110, 100))
              }
              className="w-full"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-zinc-500">
              Horizontal offset
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="-5"
                max="5"
                step="0.25"
                value={offsetXmm}
                onChange={(event) =>
                  setOffsetXmm(clampNumber(event.target.value, -5, 5, 0))
                }
                className="w-20 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-2"
              />
              <span className="text-xs text-zinc-500">mm</span>
            </div>
          </label>

          <label className="space-y-1 text-sm">
            <span className="block text-xs uppercase tracking-wide text-zinc-500">
              Vertical offset
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="-5"
                max="5"
                step="0.25"
                value={offsetYmm}
                onChange={(event) =>
                  setOffsetYmm(clampNumber(event.target.value, -5, 5, 0))
                }
                className="w-20 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-2"
              />
              <span className="text-xs text-zinc-500">mm</span>
            </div>
          </label>

          <div className="pb-2 text-sm text-zinc-600 dark:text-zinc-400">
            {selectedLotCount} lot{selectedLotCount === 1 ? "" : "s"} ·{" "}
            {selectedLabelCount} label{selectedLabelCount === 1 ? "" : "s"} ·{" "}
            {previewPages.length} sheet{previewPages.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Print on US Letter at 100% or Actual Size with browser headers and footers disabled.
          Use the offsets only after a plain-paper alignment test.
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 space-y-2">
          <div className="font-medium">Packaging lots and quantities</div>
          <div className="max-h-[360px] overflow-auto space-y-2 pr-1">
            {normalizedItems.map((item) => {
              const checked = selectedIds.has(item.id);
              const previewing = item.id === activePreviewId;

              return (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 ${
                    previewing
                      ? "border-violet-400/70 bg-violet-500/10"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(item.id)}
                      className="mt-1"
                      aria-label={`Select ${item.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => onSelectedIdChange?.(item.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="font-medium truncate" title={item.name}>
                        {item.name}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {item.data.batchLot || "No lot code"} · up to {item.maxQuantity}
                      </div>
                    </button>
                    <label className="text-xs text-zinc-500">
                      Qty
                      <input
                        type="number"
                        min="1"
                        max={item.maxQuantity}
                        value={quantities[item.id] ?? 1}
                        disabled={!checked}
                        onChange={(event) => updateQuantity(item, event.target.value)}
                        className="ml-2 w-16 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-40"
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 overflow-auto">
          <div className="font-medium mb-3">Avery 5659 sheet preview</div>
          <div className="flex flex-wrap gap-4 items-start">
            {previewPages.map((page, pageIndex) => (
              <div
                key={`preview-sheet-${pageIndex}`}
                style={{
                  width: sheetPreviewWidthPx,
                  height: sheetPreviewHeightPx,
                  position: "relative",
                  flex: "0 0 auto",
                }}
              >
                <div
                  style={{
                    width: `${AVERY_5659.sheetWidthIn}in`,
                    height: `${AVERY_5659.sheetHeightIn}in`,
                    position: "relative",
                    background: "white",
                    boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
                    transform: `scale(${sheetScale})`,
                    transformOrigin: "top left",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: `calc(${AVERY_5659.sideMarginIn}in + ${offsetXmm}mm)`,
                      top: `calc(${AVERY_5659.topMarginIn}in + ${offsetYmm}mm)`,
                      display: "grid",
                      gridTemplateColumns: `repeat(${AVERY_5659.cols}, ${AVERY_5659.labelWidthIn}in)`,
                      gridTemplateRows: `repeat(${AVERY_5659.rows}, ${AVERY_5659.labelHeightIn}in)`,
                      columnGap: `${AVERY_5659.horizontalGapIn}in`,
                      rowGap: `${AVERY_5659.verticalGapIn}in`,
                    }}
                  >
                    {page.map((entry, cellIndex) => (
                      <div
                        key={`preview-${pageIndex}-${cellIndex}`}
                        style={{
                          width: `${AVERY_5659.labelWidthIn}in`,
                          height: `${AVERY_5659.labelHeightIn}in`,
                          overflow: "hidden",
                          position: "relative",
                          border: gridOverlay
                            ? "1px dashed rgba(139,92,246,0.8)"
                            : "1px solid transparent",
                          boxSizing: "border-box",
                          background: "white",
                        }}
                      >
                        {entry ? (
                          <div
                            style={{
                              width: `${AVERY_5659.labelWidthIn}in`,
                              height: `${AVERY_5659.labelHeightIn}in`,
                              transform: `scale(${scalePct / 100})`,
                              transformOrigin: "center",
                            }}
                          >
                            <LabelArtwork labelData={entry.data} print />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-1 text-center text-xs text-zinc-500">
                  Sheet {pageIndex + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,440px)_minmax(280px,1fr)] gap-4 items-start">
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white p-3 overflow-auto">
          <LabelArtwork labelData={labelData} />
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="font-medium mb-3">Generated fields</div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {[
              ["Strain", labelData.strainName],
              ["Variant", labelData.variantTag],
              ["Species", labelData.species],
              ["Total weight", labelData.totalWeight],
              ["Capsule count", labelData.capsuleCount],
              ["Per capsule", labelData.perCapsule],
              ["Batch / lot", labelData.batchLot],
              ["Harvested", labelData.harvestedDate],
              ["Packed", labelData.packedDate],
              ["Best by", labelData.bestByDate],
              ["Blurb heading", labelData.blurbTitle],
              ["Company / blend blurb", labelData.companyBlurb],
              ["Active species notice", labelData.containsActiveSpecies ? "Shown" : "Not shown"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {label}
                </dt>
                <dd
                  className="font-medium text-zinc-900 dark:text-zinc-100 truncate"
                  title={value || "—"}
                >
                  {value || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
