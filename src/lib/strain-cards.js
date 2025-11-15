// src/lib/strain-cards.js
// Resolve strain card artwork (front/back) by abbreviation with robust guessing.

const UPPER = (s) => String(s || "").trim().toUpperCase();

/** Map common strain names/synonyms -> abbreviation codes */
const NAME_TO_CODE = new Map([
  // classics
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
  ["ALBINO PENIS ENVY REVERT", "APER"],
  ["APER", "APER"],
  ["WAVY CAP", "WC"],
]);

/** Try to extract things like "(GT)" or "[GT]" from the name. */
function extractBracketCode(name) {
  const m = String(name || "").match(/[\(\[\{]\s*([A-Z0-9+]{1,6})\s*[\)\]\}]/i);
  return m ? UPPER(m[1]) : "";
}

/** Normalize common punctuation and spaces for matching. */
function cleanName(name) {
  return UPPER(name)
    .replace(/[_\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Guess an abbreviation code for a strain name.
 * Order: explicit bracket code -> exact table -> heuristic contains match -> bare alnum token if already looks like a code.
 */
export function guessStrainCode(strainName) {
  const name = String(strainName || "");
  if (!name) return "";

  // 1) Explicit (GT) style
  const bracket = extractBracketCode(name);
  if (bracket) return bracket;

  const cleaned = cleanName(name);

  // 2) Exact lookup
  if (NAME_TO_CODE.has(cleaned)) return NAME_TO_CODE.get(cleaned);

  // 3) Contains heuristic (e.g., "Golden Teacher (Clone)") -> GT
  for (const [key, code] of NAME_TO_CODE.entries()) {
    if (cleaned.includes(key)) return code;
  }

  // 4) If the whole name already looks like a short code (e.g., "GT", "RW")
  if (/^[A-Z0-9+]{1,6}$/.test(cleaned)) return cleaned;

  return "";
}

/** Build the public path to a front image for an abbreviation code. */
export function getCardFrontURLFromCode(code) {
  const c = UPPER(code);
  return `/images/cards/fronts/${encodeURIComponent(c)}-front.png`;
}

/** Convenience: resolve a front image from a strain name (with code guess + fallback). */
export function getCardFrontURL(strainName, fallback = "/images/cards/fronts/default-front.png") {
  const code = guessStrainCode(strainName);
  return code ? getCardFrontURLFromCode(code) : fallback;
}

/** Back-of-card template (your PNG with spaces is URL-encoded). */
export function getCardBackURL() {
  return `/images/cards/${encodeURIComponent("Strain Card Back.png")}`;
}
