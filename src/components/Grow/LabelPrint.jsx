// src/components/Grow/LabelPrint.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "../../firebase-config";
import { collection, getDocs } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import { isActiveGrow } from "../../lib/growFilters";

/** Avery 5160/8160 (US Letter) — 3 columns, 10 rows */
const COLS = 3;
const ROWS = 10;
const PER_SHEET = COLS * ROWS;

const LABEL_W = "2.625in";
const LABEL_H = "1in";
const SHEET_W = "8.5in";
const SHEET_H = "11in";
const SHEET_PAD = "0.5in 0.1875in"; // Avery 5160/8160 top/side margins
const GAP_X = "0.125in";

const QR_SIZE = "0.80in";         // fixed QR
const PAD_X = "0.16in";           // inner side padding
const PAD_Y = "0.06in";           // inner top/bottom padding

const T1_PT = 8.7;   // Strain (bold)
const T2_PT = 7.2;   // Abbrev/code (semibold)
const F_PT  = 6.7;   // Type / Inoc lines

// Transparent logo at /public/logo.png
const LOGO_URL = "/logo.png";
const LOGO_OPACITY = 0.12;
// Compensate for transparent padding in the PNG so the visible emblem ≈ QR size
const LOGO_SCALE = 1.15;

const LOCAL_KEY_WATERMARK = "labels.watermark.enabled";
const LOCAL_KEY_STARTPOS = "labels.start.position"; // stored as "row,col"

/* -------------------- helpers -------------------- */
const toText = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && typeof v.toDate === "function") {
    try { return v.toDate().toISOString(); } catch {}
  }
  if (typeof v === "object" && "seconds" in v) {
    try { return new Date(v.seconds * 1000).toISOString(); } catch {}
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
};
const isoYYYYMMDD = (txt) => (txt || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
const looksLikeDateValue = (val) => {
  if (!val && val !== 0) return false;
  if (val instanceof Date) return true;
  if (typeof val === "object" && (typeof val.toDate === "function" || "seconds" in val)) return true;
  const s = String(val);
  if (isoYYYYMMDD(s)) return true;
  return !Number.isNaN(Date.parse(s));
};
const normalizeDate10 = (v) => {
  const s = toText(v);
  if (!s) return "";
  const iso = isoYYYYMMDD(s);
  if (iso) return iso;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};
const getStrain = (g) => {
  if (typeof g?.strain === "string") return g.strain;
  if (g?.strain && typeof g.strain === "object") {
    if (typeof g.strain.name === "string") return g.strain.name;
    if (typeof g.strain.title === "string") return g.strain.title;
  }
  return toText(g?.strain || g?.strainName || g?.name || g?.title || g?.label) || "Unknown";
};
const getAbbrev = (g) => {
  const keys = ["abbreviation","abbr","code","labelCode","growCode","batchCode","lotCode","shortCode","sub"];
  for (const k of keys) {
    const v = g?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (g?.strain && typeof g.strain === "object") {
    const v = g.strain.abbreviation || g.strain.code;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
};
const getInoc = (g) => {
  const explicit = g?.inoc || g?.inocDate || g?.inoculationDate || g?.inoculatedAt;
  if (looksLikeDateValue(explicit)) return normalizeDate10(explicit);
  const fb = g?.createdAt || g?.created_on || g?.startDate || g?.startedAt;
  if (looksLikeDateValue(fb)) return normalizeDate10(fb);
  const isoInside =
    (typeof g?.inoc === "string" && isoYYYYMMDD(g.inoc)) ? g.inoc :
    (typeof g?.inocDate === "string" && isoYYYYMMDD(g.inocDate)) ? g.inocDate : "";
  return normalizeDate10(isoInside);
};
const getType = (g) => toText(g?.type ?? g?.growType ?? g?.container ?? g?.kind ?? g?.category);

/** ---------- inline preview styles (true-size 5160/8160) ---------- */
const sheetStyle = {
  width: SHEET_W,
  minHeight: SHEET_H,
  padding: SHEET_PAD,
  boxSizing: "border-box",
  display: "grid",
  gridTemplateColumns: `${LABEL_W} ${LABEL_W} ${LABEL_W}`,
  columnGap: GAP_X,
  rowGap: "0",
  alignContent: "start",
  justifyContent: "start",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial',
  color: "#000",
  background: "#fff",
};
const labelStyle = (selected) => ({
  position: "relative",
  width: LABEL_W,
  height: LABEL_H,
  padding: `${PAD_Y} ${PAD_X}`,
  boxSizing: "border-box",
  overflow: "hidden",
  breakInside: "avoid",
  cursor: "pointer",
  outline: selected ? "1px solid transparent" : "1px dashed #bfbfbf",
  opacity: selected ? 1 : 0.55,
});
const blankLabelStyle = {
  position: "relative",
  width: LABEL_W,
  height: LABEL_H,
  padding: `${PAD_Y} ${PAD_X}`,
  boxSizing: "border-box",
  overflow: "hidden",
  breakInside: "avoid",
  outline: "1px dashed #e5e7eb",
  background: "transparent",
  opacity: 0.35,
};
const selectBadgeStyle = (selected) => ({
  position: "absolute",
  top: "0.04in",
  left: "0.04in",
  zIndex: 5,
  width: "0.16in",
  height: "0.16in",
  borderRadius: "0.03in",
  border: "1px solid #bdbdbd",
  background: selected ? "#2563eb" : "#fff",
  boxShadow: "0 0 0 1px rgba(0,0,0,0.03)",
});
const rowStyle = {
  position: "relative",
  zIndex: 2,
  display: "grid",
  gridTemplateColumns: `calc(100% - ${QR_SIZE} - 0.12in) ${QR_SIZE}`,
  gap: "0.10in",
  alignItems: "stretch",
};
const t1Style = { position: "relative", zIndex: 2, fontWeight: 700, fontSize: `${T1_PT}pt`, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const t2Style = { position: "relative", zIndex: 2, fontWeight: 600, fontSize: `${T2_PT}pt`, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const fieldsWrapStyle = { marginTop: "0.02in", position: "relative", zIndex: 2 };
const fStyle = { position: "relative", zIndex: 2, fontSize: `${F_PT}pt`, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
// Text column fills row height so watermark can center
const contentContainerStyle = { position: "relative", minWidth: 0, height: "100%", minHeight: QR_SIZE };
// Watermark centered in text column, visually ~ QR size
const wmTextStyle = {
  position: "absolute",
  left: "50%", top: "50%",
  transform: "translate(-50%, -50%)",
  width: `calc(${QR_SIZE} * ${LOGO_SCALE})`,
  height: `calc(${QR_SIZE} * ${LOGO_SCALE})`,
  opacity: LOGO_OPACITY,
  pointerEvents: "none",
  filter: "grayscale(100%)",
  objectFit: "contain",
  zIndex: 1,
};

/* -------------------- pagination helpers -------------------- */
function pagesWithOffset(items, skipCount) {
  const pages = [];
  let i = 0;
  const firstCap = Math.max(0, PER_SHEET - skipCount);
  const firstSlice = items.slice(i, i + firstCap);
  pages.push({ prefill: skipCount, grows: firstSlice });
  i += firstSlice.length;
  while (i < items.length) {
    const slice = items.slice(i, i + PER_SHEET);
    pages.push({ prefill: 0, grows: slice });
    i += slice.length;
  }
  return pages;
}

/* -------------------- component -------------------- */
export default function LabelPrint(props) {
  // Detect whether the parent actually provided the 'grows' prop.
  const hasGrowsProp = Object.prototype.hasOwnProperty.call(props || {}, "grows");
  const propGrows = hasGrowsProp ? (props.grows || []) : undefined;

  const uid = useMemo(() => auth.currentUser?.uid || null, [auth?.currentUser]);
  const [fetched, setFetched] = useState([]);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Start position (Row 1..10, Col 1..3)
  const [startRow, setStartRow] = useState(1);
  const [startCol, setStartCol] = useState(1);

  // Use parent-provided grows if present (even if it's an empty array).
  // Only use the Firestore fallback when the prop is NOT provided at all.
  const allGrows = hasGrowsProp ? propGrows : fetched;

  // Ref to MULTI-SHEET hidden container (for printing)
  const printSheetsRef = useRef(null);
  const selectAllRef = useRef(null);

  // Default select all on first load / when grows change
  useEffect(() => {
    if (!allGrows.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds((prev) => {
      if (prev.size) {
        const next = new Set([...prev].filter((id) => allGrows.some((g) => g.id === id)));
        return next.size ? next : new Set(allGrows.map((g) => g.id));
      }
      return new Set(allGrows.map((g) => g.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGrows.map((g) => g.id).join("|")]);

  const selectedGrows = useMemo(
    () => allGrows.filter((g) => selectedIds.has(g.id)),
    [allGrows, selectedIds]
  );

  const allSelected = selectedIds.size && selectedIds.size === allGrows.length;
  const noneSelected = selectedIds.size === 0;
  const someSelected = !noneSelected && !allSelected;

  // Indeterminate visual state for "Select all"
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  // Watermark preference
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY_WATERMARK);
      if (raw !== null) setWatermarkEnabled(raw === "true");
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LOCAL_KEY_WATERMARK, String(watermarkEnabled)); } catch {}
  }, [watermarkEnabled]);

  // Start position persistence
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY_STARTPOS);
      if (raw) {
        const [r, c] = raw.split(",").map((n) => parseInt(n, 10));
        if (r >= 1 && r <= ROWS && c >= 1 && c <= COLS) { setStartRow(r); setStartCol(c); }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LOCAL_KEY_STARTPOS, `${startRow},${startCol}`); } catch {}
  }, [startRow, startCol]);

  // Firestore fallback — ONLY when the prop isn't present at all
  useEffect(() => {
    if (hasGrowsProp || !uid) return;
    (async () => {
      const snap = await getDocs(collection(db, "users", uid, "grows"));
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setFetched(items.filter(isActiveGrow)); // ensure active-only when falling back
    })();
  }, [hasGrowsProp, uid]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const skipCount = Math.max(0, Math.min(PER_SHEET - 1, (startRow - 1) * COLS + (startCol - 1)));

  // Build print HTML. IMPORTANT: we pass **innerHTML** (not the hidden wrapper)
  const buildPrintHTML = (sheetsInnerHTML) => `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Labels</title>
<style>
  @page { size: letter; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .sheet {
    width: ${SHEET_W}; height: ${SHEET_H}; padding: ${SHEET_PAD}; box-sizing: border-box;
    display: grid; grid-template-columns: ${LABEL_W} ${LABEL_W} ${LABEL_W}; column-gap: ${GAP_X}; row-gap: 0;
    align-content: start; justify-content: start;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    color: #000;
  }
  .sheet + .sheet { page-break-before: always; }
  .label {
    position: relative; width: ${LABEL_W}; height: ${LABEL_H};
    padding: ${PAD_Y} ${PAD_X}; box-sizing: border-box; overflow: hidden; break-inside: avoid;
  }
  .row {
    position: relative; z-index: 2;
    display: grid; grid-template-columns: calc(100% - ${QR_SIZE} - 0.12in) ${QR_SIZE};
    gap: 0.10in; align-items: stretch;
  }
  .content { position: relative; min-width: 0; height: 100%; min-height: ${QR_SIZE}; }
  .qr { width: ${QR_SIZE}; height: ${QR_SIZE}; }
  .wm {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: calc(${QR_SIZE} * ${LOGO_SCALE}); height: calc(${QR_SIZE} * ${LOGO_SCALE});
    opacity: ${LOGO_OPACITY}; pointer-events: none; filter: grayscale(100%); object-fit: contain; z-index: 1;
  }
  .t1 { position: relative; z-index: 2; font-weight: 700; font-size: ${T1_PT}pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t2 { position: relative; z-index: 2; font-weight: 600; font-size: ${T2_PT}pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fields { margin-top: 0.02in; position: relative; z-index: 2; }
  .f { position: relative; z-index: 2; font-size: ${F_PT}pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
</head>
<body>
  <div id="sheets">${sheetsInnerHTML}</div>
  <script>setTimeout(() => { window.focus(); window.print(); }, 30);</script>
</body>
</html>`;

  const printNow = async () => {
    if (!selectedGrows.length) {
      alert("Select at least one label to print.");
      return;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sheetsEl = printSheetsRef.current;
    if (!sheetsEl) return alert("Print sheets not found.");

    const html = buildPrintHTML(sheetsEl.innerHTML);
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    doc.open(); doc.write(html); doc.close();

    setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 1500);
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = (checked) => {
    if (checked) setSelectedIds(new Set(allGrows.map((g) => g.id)));
    else setSelectedIds(new Set());
  };

  return (
    <div className="px-6 py-6">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-400">
          Avery 5160 / 8160 — 2.625&quot; × 1&quot; · {allGrows.length} labels
        </div>

        <div className="inline-flex flex-wrap items-center gap-4">
          {/* Start position */}
          <div className="inline-flex items-center gap-2">
            <span className="text-sm">Start at</span>
            <label className="text-xs opacity-70">Row</label>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              value={startRow}
              onChange={(e) => setStartRow(Math.max(1, Math.min(ROWS, parseInt(e.target.value || "1", 10))))}
            >
              {Array.from({ length: ROWS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <label className="text-xs opacity-70">Col</label>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              value={startCol}
              onChange={(e) => setStartCol(Math.max(1, Math.min(COLS, parseInt(e.target.value || "1", 10))))}
            >
              {Array.from({ length: COLS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          {/* Select all (indeterminate aware) */}
          <label className="inline-flex items-center gap-2 select-none">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="h-4 w-4 align-middle"
              checked={Boolean(selectedIds.size) && selectedIds.size === allGrows.length}
              onChange={(e) => toggleSelectAll(e.target.checked)}
              aria-label="Select all labels"
              data-testid="select-all"
            />
            <span className="text-sm">
              Select all
              <span className="ml-2 rounded bg-zinc-200/50 px-1 py-[1px] text-xs text-zinc-600">
                {selectedGrows.length}/{allGrows.length} selected
              </span>
            </span>
          </label>

          {/* Watermark toggle */}
          <label className="inline-flex items-center gap-2 select-none">
            <input
              type="checkbox"
              className="h-4 w-4 align-middle"
              checked={watermarkEnabled}
              onChange={(e) => setWatermarkEnabled(e.target.checked)}
              data-testid="watermark-toggle"
              aria-label="Watermark toggle"
            />
            <span className="text-sm">Watermark</span>
          </label>

          <button
            onClick={printNow}
            className="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white border border-blue-600 inline-flex items-center gap-2"
            disabled={!selectedGrows.length}
            title={!selectedGrows.length ? "Select at least one label" : "Print selected labels"}
          >
            <Printer className="w-4 h-4" /> Print labels ({selectedGrows.length})
          </button>
        </div>
      </div>

      {/* On-screen preview: TRUE SIZE single sheet with blank placeholders for offset */}
      <div className="w-full overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white">
        <div id="screenSheet" style={sheetStyle}>
          {Array.from({ length: Math.max(0, Math.min(PER_SHEET - 1, (startRow - 1) * COLS + (startCol - 1))) }).map((_, i) => (
            <div key={`blank-${i}`} style={blankLabelStyle} aria-hidden="true" />
          ))}
          {allGrows.map((g) => {
            const strain = getStrain(g);
            const sub = getAbbrev(g);
            const type = getType(g);
            const inoc = getInoc(g);
            const url = `${origin}/quick/${g.id}`;
            const selected = selectedIds.has(g.id);
            return (
              <div
                key={g.id}
                style={labelStyle(selected)}
                data-testid="label"
                onClick={() => toggleSelect(g.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleSelect(g.id)}
                role="button"
                tabIndex={0}
                title={selected ? "Click to deselect" : "Click to select"}
              >
                <div style={selectBadgeStyle(selected)} />
                <div style={rowStyle}>
                  <div className="content" style={contentContainerStyle} data-testid="label-text">
                    {watermarkEnabled ? <img src={LOGO_URL} alt="" style={wmTextStyle} data-testid="watermark-image" /> : null}
                    <div style={t1Style} title={strain} data-testid="label-strain">{strain}</div>
                    {sub ? (
                      <div style={t2Style} title={sub} data-testid="label-abbr">{sub}</div>
                    ) : (
                      <div style={{ ...t2Style, opacity: 0 }} data-testid="label-abbr">&nbsp;</div>
                    )}
                    <div style={fieldsWrapStyle} className="fields">
                      <div style={fStyle} title={type || ""} data-testid="label-type">Type: {type || "—"}</div>
                      <div style={fStyle} title={inoc || ""} data-testid="label-inoc">Inoc: {inoc || "—"}</div>
                    </div>
                  </div>
                  <div className="qr" style={{ width: QR_SIZE, height: QR_SIZE }} aria-label="QR code">
                    <QRCodeSVG value={url} width="100%" height="100%" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hidden printable sheets (render ONLY SELECTED grows with offset; may span multiple pages) */}
      <div
        ref={printSheetsRef}
        style={{ position: "absolute", left: "-10000px", top: 0, visibility: "hidden" }}
        aria-hidden
        id="sheets"
      >
        {pagesWithOffset(selectedGrows, Math.max(0, Math.min(PER_SHEET - 1, (startRow - 1) * COLS + (startCol - 1)))).map((page, pIdx) => (
          <div key={`sheet-${pIdx}`} className="sheet">
            {Array.from({ length: page.prefill }).map((_, i) => (
              <div key={`p${pIdx}-blank-${i}`} className="label" />
            ))}
            {page.grows.map((g, i) => {
              const strain = getStrain(g);
              const sub = getAbbrev(g);
              const type = getType(g);
              const inoc = getInoc(g);
              const url = `${origin}/quick/${g.id}`;
              return (
                <div key={`${g.id || i}`} className="label">
                  <div className="row">
                    <div className="content">
                      {watermarkEnabled ? <img src={LOGO_URL} alt="" className="wm" /> : null}
                      <div className="t1" title={strain}>{strain}</div>
                      {sub ? (
                        <div className="t2" title={sub}>{sub}</div>
                      ) : (
                        <div className="t2" style={{ opacity: 0 }}>&nbsp;</div>
                      )}
                      <div className="fields">
                        <div className="f" title={type || ""}>Type: {type || "—"}</div>
                        <div className="f" title={inoc || ""}>Inoc: {inoc || "—"}</div>
                      </div>
                    </div>
                    <div className="qr" style={{ width: QR_SIZE, height: QR_SIZE }}>
                      <QRCodeSVG value={url} width="100%" height="100%" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
