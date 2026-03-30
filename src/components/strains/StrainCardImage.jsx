// src/components/strains/StrainCardImage.jsx
import React, { useMemo, useState } from "react";
import { getCardFrontURL, getCardFrontURLFromCode } from "../../lib/strain-cards";

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