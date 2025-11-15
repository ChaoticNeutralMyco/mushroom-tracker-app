// src/components/strains/StrainCard.jsx
import React, { useMemo, useState } from "react";
import "./strain-card.css";
import { Pencil, Trash2, ExternalLink } from "lucide-react";
import StrainCardImage from "./StrainCardImage";
import { getCardBackURL } from "../../lib/strain-cards";

function computeBannerFit(title = "") {
  const len = String(title).trim().length;
  if (len <= 3) return { textLength: 42, fontSize: 9.2 };   // e.g., "B+"
  if (len <= 6) return { textLength: 52, fontSize: 8.8 };
  if (len <= 10) return { textLength: 62, fontSize: 8.6 };
  if (len <= 16) return { textLength: 72, fontSize: 8.2 };
  if (len <= 22) return { textLength: 78, fontSize: 8.0 };
  return { textLength: 86, fontSize: 7.5 };
}

const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export default function StrainCard({
  strain,
  // legacy props (already used in your app)
  stats,
  counts,
  // NEW: per-strain aggregate from Analytics (optional)
  // { avgColonize, avgFruit, avgHarvest, avgWet, avgDry, contamRate,
  //   activeCount, archivedCount, storedCount }
  aggregate,
  checked = false,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
}) {
  const [flipped, setFlipped] = useState(false);
  const [isDefaultFront, setIsDefaultFront] = useState(false);
  const backURL = useMemo(() => getCardBackURL(), []);

  const title = strain?.name || "Untitled Strain";
  const sci = strain?.scientificName || "";
  const bannerFit = useMemo(() => computeBannerFit(title), [title]);

  const hasToggle = typeof onToggleSelect === "function";
  const safeOpen = typeof onOpen === "function" ? onOpen : () => {};
  const safeEdit = typeof onEdit === "function" ? onEdit : () => {};
  const safeDelete = typeof onDelete === "function" ? onDelete : () => {};

  // Prefer aggregate (from Analytics) first, then legacy stats/counts
  const agg = aggregate || {};
  const s = stats || {};
  const c = counts || {};

  const avgColonize = toNum(agg.avgColonize ?? s.avgColonize);
  const avgFruit = toNum(agg.avgFruit ?? s.avgFruit);
  const avgHarvest = toNum(agg.avgHarvest ?? s.avgHarvest);
  const avgWet = toNum(agg.avgWet ?? s.avgWet);
  const avgDry = toNum(agg.avgDry ?? s.avgDry);
  const contamRate = toNum(agg.contamRate ?? s.contamRate);

  const activeCount = toNum(agg.activeCount ?? c.activeCount) ?? 0;
  const archivedCount = toNum(agg.archivedCount ?? c.archivedCount) ?? 0;
  const storedCount = toNum(agg.storedCount ?? c.storedCount) ?? 0;

  // Show name/species on the FRONT only if using default placeholder
  const showFrontText = isDefaultFront && !strain?.photoURL;

  const handleFrontClick = (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "button" || e.target.closest?.(".cn-front-actions")) return;
    setFlipped(true);
  };
  const handleBackClick = (e) => {
    if (e.target.closest?.(".cn-back-actions")) return;
    setFlipped(false);
  };

  return (
    <div className="cn-strain-card">
      <div className={`cn-card-inner ${flipped ? "is-flipped" : ""}`}>
        {/* ---------- FRONT ---------- */}
        <div className="cn-card-face cn-card-front clickable" onClick={handleFrontClick}>
          <label
            className="cn-card-checkbox"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={!!checked}
              onChange={hasToggle ? onToggleSelect : undefined}
              readOnly={!hasToggle}
              aria-label={`Select ${title}`}
            />
          </label>

          {checked && (
            <div
              className="cn-front-actions"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  safeEdit();
                }}
                className="cn-chip"
                aria-label={`Edit ${title}`}
                title="Edit"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  safeDelete();
                }}
                className="cn-chip cn-chip-danger"
                aria-label={`Delete ${title}`}
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          )}

          {strain?.photoURL ? (
            <img
              src={strain.photoURL}
              alt={title}
              className="w-full h-full object-cover"
              decoding="async"
              loading="lazy"
            />
          ) : (
            <StrainCardImage
              name={title}
              className="w-full h-full object-cover"
              alt={title}
              onResolvedSrc={(src) => setIsDefaultFront(String(src).includes("/default-front.png"))}
            />
          )}

          {showFrontText && (
            <div className="cn-front-overlay no-pointer">
              <div className="cn-front-text">
                <div className="cn-front-name">{title}</div>
                {!!sci && <div className="cn-front-sci italic">{sci}</div>}
              </div>
            </div>
          )}
        </div>

        {/* ---------- BACK ---------- */}
        <div className="cn-card-face cn-card-back clickable" onClick={handleBackClick}>
          <img src={backURL} alt="" className="absolute inset-0 w-full h-full object-cover" />

          {/* Curved banner text (raised) */}
          <div className="cn-banner-wrap">
            <svg
              className="cn-banner-svg"
              viewBox="0 0 100 40"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* ↑ Move arc even higher so text sits inside the ribbon */}
              <path id="cnBannerArc" d="M 8 14 Q 50 3.8 92 14" fill="none" />
              <text
                className="cn-banner-text"
                lengthAdjust="spacingAndGlyphs"
                textLength={bannerFit.textLength}
                style={{ fontSize: `${bannerFit.fontSize}px` }}
              >
                <textPath href="#cnBannerArc" startOffset="50%" textAnchor="middle">
                  {title}
                </textPath>
              </text>
            </svg>
            {!!sci && <div className="cn-back-sub">{sci}</div>}
          </div>

          {/* Four mid boxes — now prefer aggregate values if present */}
          <div className="cn-back-boxes">
            <div className="cn-box">
              <div className="cn-box-label">Colonize avg</div>
              <div className="cn-box-val">{avgColonize ?? "—"}d</div>
            </div>
            <div className="cn-box">
              <div className="cn-box-label">Fruiting avg</div>
              <div className="cn-box-val">{avgFruit ?? "—"}d</div>
            </div>
            <div className="cn-box">
              <div className="cn-box-label">Harvest avg</div>
              <div className="cn-box-val">{avgHarvest ?? "—"}d</div>
            </div>
            <div className="cn-box">
              <div className="cn-box-label">Avg yield (wet/dry)</div>
              <div className="cn-box-val">
                {(avgWet ?? "—")}g / {(avgDry ?? "—")}g
              </div>
            </div>
          </div>

          {/* Bottom wide box — counts + contam */}
          <div className="cn-back-wide">
            <div className="cn-wide-grid">
              <div>
                <span className="cn-wide-label">Active grows:</span>{" "}
                <strong>{activeCount}</strong>
              </div>
              <div>
                <span className="cn-wide-label">Archived grows:</span>{" "}
                <strong>{archivedCount}</strong>
              </div>
              <div>
                <span className="cn-wide-label">Stored items:</span>{" "}
                <strong>{storedCount}</strong>
              </div>
              <div>
                <span className="cn-wide-label">Contam rate:</span>{" "}
                <strong>{contamRate != null ? `${contamRate}%` : "—"}</strong>
              </div>
            </div>
            {strain?.description ? <div className="cn-wide-note">{strain.description}</div> : null}
          </div>

          <div
            className="cn-back-actions"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="cn-chip cn-chip-primary" onClick={safeOpen} title="Open strain details">
              <ExternalLink className="w-4 h-4" />
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
