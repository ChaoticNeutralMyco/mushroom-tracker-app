// src/lib/strain-cards.js
// Resolve strain card artwork (front/back) and normalize custom card-builder data.

const UPPER = (s) => String(s || "").trim().toUpperCase();
export const DEFAULT_CARD_FOOTER = "CHAOTIC NEUTRAL MYCOLOGY";
export const DEFAULT_CARD_FRONT_TEMPLATE = "dark";
export const STRAIN_CARD_SUMMARY_MAX_LENGTH = 120;
export const STRAIN_CARD_ART_OFFSET_MIN = -20;
export const STRAIN_CARD_ART_OFFSET_MAX = 20;
export const STRAIN_CARD_ART_SCALE_MIN = 0.75;
export const STRAIN_CARD_ART_SCALE_MAX = 1.35;
const DEFAULT_CARD_FRONT_URL = "/images/cards/fronts/default-front.png";

const DEFAULT_MUSHROOM_ART_LAYOUT = {
  scale: 1,
  translateXPercent: 0,
  translateYPercent: 0,
};

const FAMILY_MUSHROOM_ART_LAYOUTS = {
  cube: {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 0.5,
  },
  albino: {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 0.8,
  },
  wavy: {
    scale: 1.06,
    translateXPercent: 0,
    translateYPercent: 4.2,
  },
  mutation: {
    scale: 1.03,
    translateXPercent: 0,
    translateYPercent: 1.6,
  },
  oyster: {
    scale: 1.02,
    translateXPercent: 0,
    translateYPercent: 2.1,
  },
  gourmet: {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 1.6,
  },
  medicinal: {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 2.1,
  },
};

const MUSHROOM_ART_LAYOUT_OVERRIDES = {
  "cube-1": {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 0.2,
  },
  "cube-2": {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 0.2,
  },
  "cube-3": {
    scale: 1.01,
    translateXPercent: 0,
    translateYPercent: 0.4,
  },
  "cube-4": {
    scale: 1.01,
    translateXPercent: 0,
    translateYPercent: 0.5,
  },
  "cube-special": {
    scale: 1.02,
    translateXPercent: 0,
    translateYPercent: 0.8,
  },
  "albino-1": {
    scale: 1.01,
    translateXPercent: 0,
    translateYPercent: 0.8,
  },
  "albino-2": {
    scale: 1.01,
    translateXPercent: 0,
    translateYPercent: 0.9,
  },
  "albino-3": {
    scale: 1.01,
    translateXPercent: 0,
    translateYPercent: 0.8,
  },
  "albino-chonk": {
    scale: 0.99,
    translateXPercent: 0,
    translateYPercent: 1.8,
  },
  "albino-special-1": {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 1.1,
  },
  "albino-special-2": {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 1.1,
  },
  leucistic: {
    scale: 1.02,
    translateXPercent: 0,
    translateYPercent: 1.2,
  },
  rusty: {
    scale: 1.01,
    translateXPercent: 0,
    translateYPercent: 0.7,
  },
  "wavy-blue-cap": {
    scale: 1.09,
    translateXPercent: 0,
    translateYPercent: 4.8,
  },
  "wavy-brown-cap": {
    scale: 1.09,
    translateXPercent: 0,
    translateYPercent: 4.8,
  },
  enigma: {
    scale: 1.04,
    translateXPercent: 0,
    translateYPercent: 1.8,
  },
  cordyceps: {
    scale: 0.98,
    translateXPercent: 0,
    translateYPercent: 2.6,
  },
  "lions-mane": {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 1.4,
  },
  reishi: {
    scale: 1.02,
    translateXPercent: 0,
    translateYPercent: 2.1,
  },
  "pink-oyster": {
    scale: 1.03,
    translateXPercent: 0,
    translateYPercent: 2.1,
  },
  "golden-oyster": {
    scale: 1.03,
    translateXPercent: 0,
    translateYPercent: 2.1,
  },
  "blue-oyster": {
    scale: 1.03,
    translateXPercent: 0,
    translateYPercent: 2.1,
  },
  "pearl-oyster": {
    scale: 1.03,
    translateXPercent: 0,
    translateYPercent: 2.1,
  },
  shiitake: {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 1.8,
  },
  enoki: {
    scale: 0.97,
    translateXPercent: 0,
    translateYPercent: 2.2,
  },
  chaga: {
    scale: 1,
    translateXPercent: 0,
    translateYPercent: 3,
  },
};

export const BUILDER_FRONT_TEMPLATES = [
  {
    key: "dark",
    label: "Dark CNM",
    url: "/images/cards/fronts/builder-base-dark.png",
  },
  {
    key: "light",
    label: "Light CNM",
    url: "/images/cards/fronts/builder-base-light.png",
  },
];

export const BUILDER_MUSHROOM_ARTS = [
  { key: "cube-1", label: "Cube 1", url: "/images/cards/art/cube-1.png", family: "cube" },
  { key: "cube-2", label: "Cube 2", url: "/images/cards/art/cube-2.png", family: "cube" },
  { key: "cube-3", label: "Cube 3", url: "/images/cards/art/cube-3.png", family: "cube" },
  { key: "cube-4", label: "Cube 4", url: "/images/cards/art/cube-4.png", family: "cube" },
  { key: "cube-special", label: "Cube Special", url: "/images/cards/art/cube-special.png", family: "cube" },
  { key: "albino-1", label: "Albino 1", url: "/images/cards/art/albino-1.png", family: "albino" },
  { key: "albino-2", label: "Albino 2", url: "/images/cards/art/albino-2.png", family: "albino" },
  { key: "albino-3", label: "Albino 3", url: "/images/cards/art/albino-3.png", family: "albino" },
  { key: "albino-chonk", label: "Albino Chonk", url: "/images/cards/art/albino-chonk.png", family: "albino" },
  { key: "albino-special-1", label: "Albino Special 1", url: "/images/cards/art/albino-special-1.png", family: "albino" },
  { key: "albino-special-2", label: "Albino Special 2", url: "/images/cards/art/albino-special-2.png", family: "albino" },
  { key: "leucistic", label: "Leucistic", url: "/images/cards/art/leucistic.png", family: "albino" },
  { key: "rusty", label: "Rusty", url: "/images/cards/art/rusty.png", family: "cube" },
  { key: "wavy-blue-cap", label: "Wavy Blue Cap", url: "/images/cards/art/wavy-blue-cap.png", family: "wavy" },
  { key: "wavy-brown-cap", label: "Wavy Brown Cap", url: "/images/cards/art/wavy-brown-cap.png", family: "wavy" },
  { key: "enigma", label: "Enigma", url: "/images/cards/art/enigma.png", family: "mutation" },
  { key: "cordyceps", label: "Cordyceps", url: "/images/cards/art/Cordyceps.png", family: "medicinal" },
  { key: "lions-mane", label: "Lion's Mane", url: "/images/cards/art/Lions%20Mane.png", family: "medicinal" },
  { key: "reishi", label: "Reishi", url: "/images/cards/art/Reishi.png", family: "medicinal" },
  { key: "pink-oyster", label: "Pink Oyster", url: "/images/cards/art/Pink%20Oyster.png", family: "oyster" },
  { key: "golden-oyster", label: "Golden Oyster", url: "/images/cards/art/Golden%20Oyster.png", family: "oyster" },
  { key: "blue-oyster", label: "Blue Oyster", url: "/images/cards/art/Blue%20Oyster.png", family: "oyster" },
  { key: "pearl-oyster", label: "Pearl Oyster", url: "/images/cards/art/Pearl%20Oyster.png", family: "oyster" },
  { key: "shiitake", label: "Shiitake", url: "/images/cards/art/Shitake.png", family: "gourmet" },
  { key: "enoki", label: "Enoki", url: "/images/cards/art/Enoki.png", family: "gourmet" },
  { key: "chaga", label: "Chaga", url: "/images/cards/art/Chaga.png", family: "medicinal" },
];

const BUILDER_FRONT_TEMPLATE_MAP = new Map(
  BUILDER_FRONT_TEMPLATES.map((item) => [item.key, item])
);

const BUILDER_MUSHROOM_ART_MAP = new Map(
  BUILDER_MUSHROOM_ARTS.map((item) => [item.key, item])
);

/** Map common strain names/synonyms -> abbreviation codes */
const NAME_TO_CODE = new Map([
  ["GOLDEN TEACHER", "GT"],
  ["B+", "B"],
  ["B PLUS", "B"],
  ["BPLUS", "B"],
  ["PENIS ENVY 6", "PE6"],
  ["PENIS ENVY #6", "PE6"],
  ["PE6", "PE6"],
  ["RUSTY WHYTE", "RW"],
  ["JEDI MIND FUCK", "JMF"],
  ["JEDI MIND-FUCK", "JMF"],
  ["JEDI MINDFUCK", "JMF"],
  ["KOH SAMUI SUPER STRAIN", "KSSS"],
  ["KOH SAMUI SUPER", "KSSS"],
  ["KOH SAMUI", "KSSS"],
  ["RIVER ELF TEACHER", "RET"],
  ["RIVER TEACHER", "RET"],
  ["ALBINO PENIS ENVY REVERT", "APER"],
  ["APER", "APER"],
  ["WAVY CAP", "WC"],
]);

function extractBracketCode(name) {
  const m = String(name || "").match(/[\(\[\{]\s*([A-Z0-9+]{1,6})\s*[\)\]\}]/i);
  return m ? UPPER(m[1]) : "";
}

function cleanName(name) {
  return UPPER(name)
    .replace(/[_\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSentenceCase(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (/^psilocybe\s/i.test(clean)) {
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) return `Psilocybe ${parts.slice(1).join(" ")}`;
  }
  if (/^panaeolus\s/i.test(clean)) {
    const parts = clean.split(/\s+/);
    if (parts.length >= 2) return `Panaeolus ${parts.slice(1).join(" ")}`;
  }
  return clean;
}

function normalizeFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function guessStrainCode(strainName) {
  const name = String(strainName || "");
  if (!name) return "";

  const bracket = extractBracketCode(name);
  if (bracket) return bracket;

  const cleaned = cleanName(name);
  if (NAME_TO_CODE.has(cleaned)) return NAME_TO_CODE.get(cleaned);

  for (const [key, code] of NAME_TO_CODE.entries()) {
    if (cleaned.includes(key)) return code;
  }

  if (/^[A-Z0-9+]{1,6}$/.test(cleaned)) return cleaned;

  return "";
}

export function guessBuilderMushroomKey(strainName = "", scientificName = "") {
  const hay = `${cleanName(strainName)} ${cleanName(scientificName)}`;

  if (/(CORDYCEPS|MILITARIS|SINENSIS)/.test(hay)) return "cordyceps";
  if (/(LIONS MANE|LION'S MANE|HERICIUM|ERINACEUS)/.test(hay)) return "lions-mane";
  if (/(REISHI|GANODERMA|LUCIDUM)/.test(hay)) return "reishi";
  if (/(CHAGA|INONOTUS|OBLIQUUS)/.test(hay)) return "chaga";
  if (/(ENOKI|ENOKITAKE|FLAMMULINA|VELUTIPES)/.test(hay)) return "enoki";
  if (/(SHIITAKE|SHITAKE|LENTINULA|EDODES)/.test(hay)) return "shiitake";
  if (/(PINK OYSTER|DJAMOR)/.test(hay)) return "pink-oyster";
  if (/(GOLDEN OYSTER|CITRINOPILEATUS)/.test(hay)) return "golden-oyster";
  if (/(BLUE OYSTER|COLUMBINUS)/.test(hay)) return "blue-oyster";
  if (/(PEARL OYSTER)/.test(hay)) return "pearl-oyster";
  if (/(OYSTER|PLEUROTUS|OSTREATUS|PULMONARIUS)/.test(hay)) return "pearl-oyster";
  if (/(ENIGMA|BLOB|MUTATION)/.test(hay)) return "enigma";
  if (/(WAVY|CYANESCENS|AZURESCENS)/.test(hay)) return "wavy-blue-cap";
  if (/(RUSTY)/.test(hay)) return "rusty";
  if (/(LEUCISTIC)/.test(hay)) return "leucistic";
  if (/(ALBINO|APER|APE)/.test(hay)) return "albino-special-1";

  return "cube-4";
}

export function getBlankCardFrontURL(templateKey = DEFAULT_CARD_FRONT_TEMPLATE) {
  return getBuilderFrontTemplateURL(templateKey);
}

export function getBuilderFrontTemplateURL(templateKey = DEFAULT_CARD_FRONT_TEMPLATE) {
  return (
    BUILDER_FRONT_TEMPLATE_MAP.get(String(templateKey || "").trim())?.url ||
    BUILDER_FRONT_TEMPLATE_MAP.get(DEFAULT_CARD_FRONT_TEMPLATE).url
  );
}

export function getBuilderMushroomArtURL(mushroomArtKey = "") {
  return (
    BUILDER_MUSHROOM_ART_MAP.get(String(mushroomArtKey || "").trim())?.url ||
    BUILDER_MUSHROOM_ART_MAP.get("cube-4").url
  );
}

export function getBuilderMushroomArtLayout(mushroomArtKey = "") {
  const key = String(mushroomArtKey || "").trim();
  const art = BUILDER_MUSHROOM_ART_MAP.get(key);
  const familyLayout = FAMILY_MUSHROOM_ART_LAYOUTS[art?.family] || {};
  const exactLayout = MUSHROOM_ART_LAYOUT_OVERRIDES[key] || {};

  return {
    ...DEFAULT_MUSHROOM_ART_LAYOUT,
    ...familyLayout,
    ...exactLayout,
  };
}

export function getCardFrontURLFromCode(code) {
  const c = UPPER(code);
  return `/images/cards/fronts/${encodeURIComponent(c)}-front.png`;
}

export function getCardFrontURL(strainName, fallback = DEFAULT_CARD_FRONT_URL) {
  const code = guessStrainCode(strainName);
  return code ? getCardFrontURLFromCode(code) : fallback;
}

export function getCardBackURL() {
  return `/images/cards/${encodeURIComponent("Strain Card Back.png")}`;
}

export function clampStrainCardSummaryText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STRAIN_CARD_SUMMARY_MAX_LENGTH)
    .trim();
}

function normalizeSummaryText(value) {
  return clampStrainCardSummaryText(value);
}

export function normalizeStrainCardDesign(strain = {}) {
  const builder = strain?.cardBuilder || {};
  const title = String(builder.title || strain?.name || "Untitled Strain").trim();
  const speciesLine = toSentenceCase(
    builder.speciesLine || strain?.scientificName || "Psilocybe cubensis"
  );
  const summary = normalizeSummaryText(
    builder.summary || strain?.description || strain?.notes || ""
  );
  const code = UPPER(builder.code || guessStrainCode(title));
  const footer = String(builder.footer || DEFAULT_CARD_FOOTER).trim() || DEFAULT_CARD_FOOTER;
  const frontTemplate =
    String(builder.frontTemplate || DEFAULT_CARD_FRONT_TEMPLATE).trim() ||
    DEFAULT_CARD_FRONT_TEMPLATE;
  const frontArtUrl = String(builder.frontArtUrl || "").trim();
  const artMode = String(builder.artMode || (frontArtUrl ? "full" : "preset")).trim() || "preset";
  const mushroomArtKey =
    String(builder.mushroomArtKey || guessBuilderMushroomKey(title, speciesLine)).trim() ||
    "cube-4";
  const artOffsetX = clampNumber(
    normalizeFiniteNumber(builder.artOffsetX, 0),
    STRAIN_CARD_ART_OFFSET_MIN,
    STRAIN_CARD_ART_OFFSET_MAX
  );
  const artOffsetY = clampNumber(
    normalizeFiniteNumber(builder.artOffsetY, -16),
    STRAIN_CARD_ART_OFFSET_MIN,
    STRAIN_CARD_ART_OFFSET_MAX
  );
  const artScale = clampNumber(
    normalizeFiniteNumber(builder.artScale, 1),
    STRAIN_CARD_ART_SCALE_MIN,
    STRAIN_CARD_ART_SCALE_MAX
  );

  return {
    enabled: builder.enabled !== false,
    title,
    code,
    speciesLine,
    summary,
    footer,
    frontTemplate,
    frontArtUrl,
    artMode,
    mushroomArtKey,
    artOffsetX,
    artOffsetY,
    artScale,
  };
}

export function buildDefaultStrainCardDesign(strain = {}) {
  return {
    enabled: true,
    ...normalizeStrainCardDesign(strain),
  };
}