// src/components/strains/StrainCardFrontBuilder.jsx
import React, { useMemo } from "react";
import {
  STRAIN_CARD_SUMMARY_MAX_LENGTH,
  clampStrainCardSummaryText,
  getBuilderFrontTemplateURL,
  getBuilderMushroomArtLayout,
  getBuilderMushroomArtURL,
  normalizeStrainCardDesign,
} from "../../lib/strain-cards";

function splitTitle(title = "") {
  const clean = String(title || "").replace(/\s+/g, " ").trim();
  if (!clean) return ["UNTITLED STRAIN"];
  if (clean.length <= 16) return [clean.toUpperCase()];

  const words = clean.split(" ");
  if (words.length === 1) {
    return [clean.slice(0, 16).toUpperCase(), clean.slice(16).toUpperCase()].filter(Boolean);
  }

  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= 16 || !current) {
      current = next;
      continue;
    }

    lines.push(current.toUpperCase());
    current = word;

    if (lines.length === 2) break;
  }

  if (current && lines.length < 3) lines.push(current.toUpperCase());

  return lines.slice(0, 3);
}

function compactSummary(summary = "") {
  return clampStrainCardSummaryText(summary)
    .slice(0, STRAIN_CARD_SUMMARY_MAX_LENGTH)
    .trim();
}

function getArcUnitForChar(ch) {
  if (ch === " ") return 0.62;
  if ("MW".includes(ch)) return 1.08;
  if ("I1".includes(ch)) return 0.42;
  if ("JLTF".includes(ch)) return 0.62;
  return 0.86;
}

function buildSpeciesArcGlyphs(speciesLine = "") {
  const text = String(speciesLine || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  const compactLength = text.replace(/\s+/g, "").length;

  const fontSize =
    compactLength >= 22 ? 6.0 : compactLength >= 17 ? 6.35 : 6.65;

  const spreadDeg =
    compactLength >= 22 ? 102 : compactLength >= 17 ? 98 : 94;

  const rx =
    compactLength >= 22 ? 39.2 : compactLength >= 17 ? 38.2 : 37.2;

  const ry =
    compactLength >= 22 ? 12.7 : compactLength >= 17 ? 12.2 : 11.7;

  const cx = 50;
  const cy = 31.2;

  const chars = [...text];
  const units = chars.map(getArcUnitForChar);
  const totalUnits = units.reduce((sum, value) => sum + value, 0) || 1;

  let cursor = 0;

  return chars.map((ch, index) => {
    const unit = units[index];
    const centerUnits = cursor + unit / 2 - totalUnits / 2;
    const theta =
      (centerUnits / (totalUnits / 2)) * ((spreadDeg / 2) * Math.PI / 180);

    cursor += unit;

    const x = cx + rx * Math.sin(theta);
    const y = cy - ry * Math.cos(theta);
    const tangentRotation =
      (Math.atan2(ry * Math.sin(theta), rx * Math.cos(theta)) * 180) / Math.PI;

    return {
      key: `${ch}-${index}`,
      ch,
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      rotation: Number((tangentRotation * 0.72).toFixed(3)),
      fontSize,
    };
  });
}


function getPresetBaselineScale(mushroomArtKey = "") {
  const key = String(mushroomArtKey || "").trim().toLowerCase();

  if (!key) return 0.72;

  if (key.startsWith("albino-special")) return 0.68;
  if (key === "albino-chonk") return 0.64;
  if (key.startsWith("albino") || key === "leucistic") return 0.67;
  if (key.startsWith("wavy")) return 0.74;
  if (key === "enigma") return 0.7;
  if (key === "cube-special") return 0.74;
  if (key.startsWith("cube") || key === "rusty") return 0.72;

  return 0.72;
}

export default function StrainCardFrontBuilder({
  strain,
  design,
  className = "w-full h-full",
}) {
  const cfg = useMemo(() => {
    if (design) {
      return normalizeStrainCardDesign({ ...(strain || {}), cardBuilder: design });
    }
    return normalizeStrainCardDesign(strain || {});
  }, [design, strain]);

  const titleLines = useMemo(() => splitTitle(cfg.title), [cfg.title]);
  const summary = useMemo(() => compactSummary(cfg.summary), [cfg.summary]);
  const backgroundSrc = getBuilderFrontTemplateURL(cfg.frontTemplate);
  const artSrc = getBuilderMushroomArtURL(cfg.mushroomArtKey);
  const artLayout = useMemo(
    () => getBuilderMushroomArtLayout(cfg.mushroomArtKey),
    [cfg.mushroomArtKey]
  );
  const VISUAL_ZERO_ART_OFFSET_Y = -13;

  const manualArtScale = useMemo(() => {
    const rawScale = Number(cfg.artScale || 1);

    // Keep 1.00 aligned to the preset artwork's original intended size,
    // then allow the slider to scale up or down from that baseline.
    return Number(rawScale.toFixed(4));
  }, [cfg.artScale]);
  const presetBaseScale = useMemo(
    () => getPresetBaselineScale(cfg.mushroomArtKey),
    [cfg.mushroomArtKey]
  );
  const useFullFrontOverride = cfg.artMode === "full" && !!cfg.frontArtUrl;
  const speciesLine = String(cfg.speciesLine || "").toUpperCase();
  const speciesGlyphs = useMemo(
    () => buildSpeciesArcGlyphs(speciesLine),
    [speciesLine]
  );

  if (useFullFrontOverride) {
    return (
      <div className={`cn-front-builder ${className}`.trim()}>
        <img
          src={cfg.frontArtUrl}
          alt={cfg.title || "Strain card front"}
          className="cn-front-builder__image"
          decoding="async"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className={`cn-front-builder ${className}`.trim()}>
      <img
        src={backgroundSrc}
        alt=""
        className="cn-front-builder__image"
        decoding="async"
        loading="lazy"
      />

      <div className="cn-front-builder__overlay" aria-hidden="true">
        <div className="cn-front-builder__species">
          <svg
            className="cn-front-builder__species-svg"
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
          >
            {speciesGlyphs.map((glyph) =>
              glyph.ch === " " ? null : (
                <text
                  key={glyph.key}
                  x={glyph.x}
                  y={glyph.y}
                  transform={`rotate(${glyph.rotation} ${glyph.x} ${glyph.y})`}
                  className="cn-front-builder__species-glyph"
                  fontSize={glyph.fontSize}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {glyph.ch}
                </text>
              )
            )}
          </svg>
        </div>

        <div className="cn-front-builder__mushroom-wrap">
          <img
            src={artSrc}
            alt=""
            className="cn-front-builder__mushroom"
            decoding="async"
            loading="lazy"
            style={{
              "--cn-front-art-scale": Number(
                (
                  Number(artLayout.scale || 1) *
                  Number(presetBaseScale || 1) *
                  Number(manualArtScale || 1)
                ).toFixed(4)
              ),
              "--cn-front-art-x": `${Number(
                (Number(artLayout.translateXPercent || 0) + Number(cfg.artOffsetX || 0)).toFixed(3)
              )}%`,
              "--cn-front-art-y": `${Number(
                (
                  Number(artLayout.translateYPercent || 0) +
                  Number(VISUAL_ZERO_ART_OFFSET_Y || 0) +
                  Number(cfg.artOffsetY || 0)
                ).toFixed(3)
              )}%`,
            }}
          />
        </div>

        <div
          className={`cn-front-builder__title ${
            titleLines.length >= 3 ? "is-compact" : titleLines.length === 2 ? "is-two-line" : ""
          }`.trim()}
        >
          {titleLines.map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>

        <div className="cn-front-builder__code">
          {cfg.code ? `-${String(cfg.code).toUpperCase()}-` : ""}
        </div>

        <div className="cn-front-builder__summary">{summary}</div>

        <div className="cn-front-builder__footer">
          {String(cfg.footer || "").toUpperCase()}
        </div>
      </div>
    </div>
  );
}