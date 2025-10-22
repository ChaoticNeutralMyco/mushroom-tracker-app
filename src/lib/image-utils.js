// src/lib/image-utils.js

// Lightweight in-browser image processing: EXIF-safe decode, compress, and thumbnail.
// Also includes tiny UI-formatting helpers used across GrowForm/GrowDetail.
// No extra deps. Outputs JPEG blobs (EXIF stripped). All exports are NAMED.

const hasWindow = typeof window !== "undefined";

/* =========================
 * Image decoding & resizing
 * ========================= */

/** Decode an image File/Blob into a bitmap or canvas (EXIF rotation respected when supported). */
export async function decodeBitmap(file) {
  if (hasWindow && "createImageBitmap" in window) {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = (hasWindow && URL.createObjectURL) ? URL.createObjectURL(file) : null;
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url ?? "";
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    if (url && hasWindow) URL.revokeObjectURL(url);
  }
}

function fitWithin(w, h, maxDim) {
  if (w <= maxDim && h <= maxDim) return { w, h };
  const s = Math.min(maxDim / w, maxDim / h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

function makeCanvas(width, height) {
  if (hasWindow && "OffscreenCanvas" in window) return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  return c;
}

async function drawToBlob(src, w, h, mime = "image/jpeg", q = 0.82) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: mime, quality: q });
  return new Promise((res) => canvas.toBlob((b) => res(b), mime, q));
}

/**
 * Compress + thumbnail a File
 * @returns {{ originalBlob: Blob, thumbBlob: Blob, width: number, height: number }}
 */
export async function compressAndThumb(file, { maxDim = 1600, thumbDim = 320, quality = 0.82 } = {}) {
  const bmp = await decodeBitmap(file);
  const width  = bmp.width  || bmp.drawingBufferWidth  || bmp.canvas?.width  || 0;
  const height = bmp.height || bmp.drawingBufferHeight || bmp.canvas?.height || 0;

  const main = fitWithin(width, height, maxDim);
  const th   = fitWithin(width, height, thumbDim);

  const [originalBlob, thumbBlob] = await Promise.all([
    drawToBlob(bmp, main.w, main.h, "image/jpeg", quality),
    drawToBlob(bmp, th.w, th.h, "image/jpeg", Math.min(0.76, quality)),
  ]);

  return { originalBlob, thumbBlob, width: main.w, height: main.h };
}

/** Optional: convert a Blob to a data URL for previews. */
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/* =========================
 * Number & text formatting
 * ========================= */

function toNumber(value) {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

function toFixedSmart(n, maxDigits = 2) {
  const v = toNumber(n);
  // Keep up to maxDigits, but trim trailing zeros
  const s = v.toFixed(maxDigits);
  return s.replace(/\.?0+$/, "");
}

/**
 * formatCurrency(1234.5) -> "$1,234.50"
 * Keeps a stable API for prior imports.
 */
export function formatCurrency(value, {
  currency = "USD",
  locale = (hasWindow && typeof navigator !== "undefined" && navigator.language) ? navigator.language : "en-US",
  minimumFractionDigits = 2,
  maximumFractionDigits = 2,
} = {}) {
  const amount = toNumber(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(amount);
  } catch {
    // Fallback if Intl is unavailable or currency is invalid
    const sign = amount < 0 ? "-" : "";
    return `${sign}$${Math.abs(amount).toFixed(2)}`;
  }
}

/**
 * Pluralize units based on amount: "jar" -> "jars" when amount !== 1.
 * Short units like "ml", "mL", "g", "oz" are kept as-is.
 */
export function pluralizeUnits(unit, amount) {
  if (!unit) return "";
  const u = String(unit).trim();
  const amt = toNumber(amount);
  const shortUnits = new Set(["ml", "mL", "g", "kg", "oz", "lb", "L"]);
  if (shortUnits.has(u)) return u; // do not pluralize abbreviations
  if (amt === 1) return u;
  // Basic pluralization; extend with irregulars if needed.
  if (u.endsWith("y")) return u.slice(0, -1) + "ies";
  if (u.endsWith("s")) return u; // already plural
  return u + "s";
}

/**
 * formatAmount(50, "mL") -> "50 mL"
 * formatAmount(1, "jar") -> "1 jar"
 * formatAmount(2, "jar") -> "2 jars"
 */
export function formatAmount(value, unit = "", {
  decimals = 2,
  trimZeros = true,
  space = true,
  pluralize = true,
} = {}) {
  const amt = toNumber(value);
  const num = trimZeros ? toFixedSmart(amt, decimals) : amt.toFixed(decimals);
  const u = pluralize ? pluralizeUnits(unit, amt) : (unit || "");
  return u ? `${num}${space ? " " : ""}${u}` : `${num}`;
}

/** formatPercent(0.42) -> "42%" or with decimals. */
export function formatPercent(value, { decimals = 0 } = {}) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  const pct = (v * 100).toFixed(decimals);
  return `${pct}%`;
}

/** Clamp helper often useful for remaining-bar math. */
export function clamp(n, min = 0, max = 1) {
  n = Number(n) || 0;
  return Math.max(min, Math.min(max, n));
}

/** Round to given decimals (used for amounts/yields). */
export function roundTo(n, decimals = 2) {
  const f = Math.pow(10, decimals);
  return Math.round((Number(n) || 0) * f) / f;
}

/** Convert to YYYY-MM-DD for <input type="date"> and stored stage dates. */
export function formatDateISO(d) {
  const date = (d instanceof Date) ? d : new Date(d || Date.now());
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Compute integer percent remaining from current/total (0..100). */
export function percentRemaining(current, total) {
  const t = Math.max(0, toNumber(total));
  const c = Math.max(0, Math.min(toNumber(current), t));
  return Math.round((c / (t || 1)) * 100);
}
