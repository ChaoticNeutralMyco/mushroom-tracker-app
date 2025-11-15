// src/components/strains/StrainCardImage.jsx
import React, { useMemo, useState } from "react";
import { getCardFrontURL, getCardFrontURLFromCode } from "../../lib/strain-cards";

/**
 * Displays the front artwork for a strain card.
 * - If `code` is provided, use it directly (e.g., "GT", "PE6").
 * - Otherwise, guess from the `name`.
 * - Falls back to default-front.png, then to GT-front.png if default is missing.
 * - Calls `onResolvedSrc(src)` with the final loaded image URL so the parent
 *   can know if we’re using the default.
 */
export default function StrainCardImage({
  name,
  code,
  className = "w-full h-full object-cover",
  alt = "",
  onResolvedSrc,
}) {
  const [src, setSrc] = useState(null);

  const initial = useMemo(() => {
    if (code) return getCardFrontURLFromCode(code);
    return getCardFrontURL(name);
  }, [name, code]);

  const defaultFallback = "/images/cards/fronts/default-front.png";
  const finalFallback = "/images/cards/fronts/GT-front.png";

  return (
    <img
      src={src || initial}
      alt={alt || name || "Strain card"}
      className={className}
      decoding="async"
      loading="lazy"
      onLoad={(e) => {
        const resolved = e.currentTarget?.src || "";
        if (typeof onResolvedSrc === "function") onResolvedSrc(resolved);
      }}
      onError={(e) => {
        const current = e.currentTarget.getAttribute("src") || "";
        if (!current.includes("default-front.png")) {
          setSrc(defaultFallback);
        } else if (!current.includes("GT-front.png")) {
          setSrc(finalFallback);
        }
      }}
    />
  );
}
