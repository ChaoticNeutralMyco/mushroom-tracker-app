// src/lib/grow-images.js
// Map grow types to default cover icons served from /public/images/grow-types.
// PNGs are now the default. Keeps a stable API for existing imports.

import { normalizeType } from "./growFilters";

/** Public path map (files live under /public/images/grow-types/) */
export const TYPE_ICON_PATH = {
  Agar: "/images/grow-types/agar.png",
  LC: "/images/grow-types/liquid-jar.png",
  "Grain Jar": "/images/grow-types/grain-jar.png",
  Bulk: "/images/grow-types/monotub.png",
  "Grain Bag": "/images/grow-types/grain-bag.png",
  "Spawn Bag": "/images/grow-types/spawn-bag.png",
  Other: "/images/grow-types/other-mushroom.png",
};

/**
 * Derive a display key for the type that includes bag detection.
 * - “spawn bag”, “bag spawn” => Spawn Bag
 * - “grain bag”, “rye bag”, “millet bag” => Grain Bag
 * - otherwise falls back to normalizeType(...) (Agar, LC, Grain Jar, Bulk, Other)
 */
function deriveTypeKey(type) {
  const raw = String(type || "").toLowerCase();
  if (raw.includes("bag")) {
    if (raw.includes("spawn")) return "Spawn Bag";
    if (raw.includes("grain") || raw.includes("rye") || raw.includes("millet")) return "Grain Bag";
    // generic "bag" with no hint; prefer Spawn Bag as a sensible default
    return "Spawn Bag";
  }
  return normalizeType(type);
}

export function getGrowTypeIconPath(type) {
  const key = deriveTypeKey(type);
  return TYPE_ICON_PATH[key] || TYPE_ICON_PATH.Other;
}

/** Given a grow object, return the default cover icon for its type. */
export function getDefaultCoverForGrow(grow) {
  return getGrowTypeIconPath(grow?.type || grow?.growType);
}

/**
 * Return the chosen cover URL:
 * 1) explicit coverUrl
 * 2) a selected photo by coverPhotoId (if photos provided)
 * 3) a type icon from TYPE_ICON_PATH
 */
export function getCoverSrc(grow, photos) {
  if (grow?.coverUrl) return grow.coverUrl;
  if (grow?.coverPhotoId && Array.isArray(photos)) {
    const p = photos.find((x) => x.id === grow.coverPhotoId);
    if (p?.url) return p.url;
  }
  return getDefaultCoverForGrow(grow);
}
