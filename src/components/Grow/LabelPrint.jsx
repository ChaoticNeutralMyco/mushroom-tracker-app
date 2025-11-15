// src/components/Grow/LabelPrint.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "../../firebase-config";
import { collection, getDocs } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import { isActiveGrow } from "../../lib/growFilters";

/** ---------- Templates (no new files) ---------- */
const LABEL_TEMPLATES = {
  "5160": {
    id: "5160",
    name: 'Avery 5160 / 8160 (2.625" × 1")',
    cols: 3,
    rows: 10,
    labelW: "2.625in",
    labelH: "1in",
    sheetW: "8.5in",
    sheetH: "11in",
    sheetPad: "0.5in 0.1875in",
    gapX: "0.125in",
    gapY: "0in",
  },
  "5167": {
    id: "5167",
    name: 'Avery 5167 (1.75" × 0.5")',
    cols: 4,
    rows: 20,
    labelW: "1.75in",
    labelH: "0.5in",
    sheetW: "8.5in",
    sheetH: "11in",
    sheetPad: "0.5in 0.1875in",
    gapX: "0.125in",
    gapY: "0in",
  },
};

/** ---------- Typography & QR ---------- */
const QR_SIZE = "0.80in";         // fixed QR in both templates
const PAD_X = "0.16in";           // inner side padding
const PAD_Y = "0.06in";           // inner top/bottom padding

const T1_PT = 8.7;   // Strain (bold)
const T2_PT = 7.2;   // Abbrev/code (semibold)
const F_PT  = 6.7;   // Type / Inoc lines

/** ---------- Watermark ---------- */
const WM_CANDIDATES = [
  "/labels-watermark.png",
  "/logo.png",
  "/logo512.png",
  "/logo192.png",
  "/android-chrome-192x192.png",
  "/favicon.png",
];
const LOGO_OPACITY = 0.20;
const LOGO_SCALE = 1.2;

/** ---------- localStorage keys ---------- */
const LOCAL_KEY_WATERMARK_ENABLED = "labels.watermark.enabled";
const LOCAL_KEY_WATERMARK_URL = "labels.watermark.url";
const LOCAL_KEY_STARTPOS = "labels.start.position";
const LOCAL_KEY_TEMPLATE = "labels.template";       // "5160" | "5167"
const LOCAL_KEY_GRID = "labels.gridOverlay";        // "1" | "0"
const LOCAL_KEY_SCALE = "labels.previewScale";      // "50..150"
const LOCAL_KEY_CODE = "labels.codeType";           // "qr" | "none"

/* ---------------- helpers ---------------- */
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
  const keys = ["abbreviation","abbr","code","labelCode","growCode","batchCode","subName"];
  for (const k of keys) {
    const v = toText(g?.[k]);
    if (v) return v;
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

const preloadOK = (url) => new Promise((resolve) => {
  if (!url) return resolve(false);
  const img = new Image();
  img.onload = () => resolve(true);
  img.onerror = () => resolve(false);
  img.src = url;
});

/** ---------- component ---------- */
function LabelPrint(props) {
  const hasGrowsProp = Object.prototype.hasOwnProperty.call(props || {}, "grows");
  const propGrows = hasGrowsProp ? (props.grows || []) : undefined;

  const uid = useMemo(() => auth.currentUser?.uid || null, [auth?.currentUser]);
  const [fetched, setFetched] = useState([]);

  // Template / overlay / scale / code
  const [templateId, setTemplateId] = useState(() => {
    try { return localStorage.getItem(LOCAL_KEY_TEMPLATE) || "5160"; } catch {}
    return "5160";
  });
  const template = LABEL_TEMPLATES[templateId] || LABEL_TEMPLATES["5160"];
  const COLS = template.cols;
  const ROWS = template.rows;
  const PER_SHEET = COLS * ROWS;
  const [gridOverlay, setGridOverlay] = useState(() => {
    try { return localStorage.getItem(LOCAL_KEY_GRID) === "1"; } catch {}
    return false;
  });
  const [scalePct, setScalePct] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(LOCAL_KEY_SCALE) || "100", 10);
      return Number.isFinite(v) ? Math.min(150, Math.max(50, v)) : 100;
    } catch {}
    return 100;
  });
  const [codeType, setCodeType] = useState(() => {
    try { return localStorage.getItem(LOCAL_KEY_CODE) || "qr"; } catch {}
    return "qr";
  });

  // Watermark
  const [watermarkEnabled, setWatermarkEnabled] = useState(() => {
    try { return localStorage.getItem(LOCAL_KEY_WATERMARK_ENABLED) !== "0"; } catch {}
    return true;
  });
  const [wmInput, setWmInput] = useState(() => {
    try { return localStorage.getItem(LOCAL_KEY_WATERMARK_URL) || ""; } catch {}
    return "";
  });
  const [wmUrl, setWmUrl] = useState("");
  const [wmTextFallback, setWmTextFallback] = useState(false);

  // Selection & start position
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [startRow, setStartRow] = useState(1);
  const [startCol, setStartCol] = useState(1);

  const printSheetsRef = useRef(null);
  const selectAllRef = useRef(null);

  // Persist options
  useEffect(() => { try { localStorage.setItem(LOCAL_KEY_TEMPLATE, templateId); } catch {} }, [templateId]);
  useEffect(() => { try { localStorage.setItem(LOCAL_KEY_GRID, gridOverlay ? "1" : "0"); } catch {} }, [gridOverlay]);
  useEffect(() => { try { localStorage.setItem(LOCAL_KEY_SCALE, String(scalePct)); } catch {} }, [scalePct]);
  useEffect(() => { try { localStorage.setItem(LOCAL_KEY_CODE, codeType); } catch {} }, [codeType]);
  useEffect(() => { try { localStorage.setItem(LOCAL_KEY_WATERMARK_ENABLED, watermarkEnabled ? "1" : "0"); } catch {} }, [watermarkEnabled]);
  useEffect(() => { try { localStorage.setItem(LOCAL_KEY_WATERMARK_URL, wmInput || ""); } catch {} }, [wmInput]);

  // Keep start pos in bounds when template changes
  useEffect(() => {
    setStartRow((r) => Math.min(Math.max(1, r), ROWS));
    setStartCol((c) => Math.min(Math.max(1, c), COLS));
  }, [ROWS, COLS]);

  // Load start position (once)
  useEffect(() => {
    try {
      const s = localStorage.getItem(LOCAL_KEY_STARTPOS);
      if (s) {
        const [r, c] = String(s).split(",").map((n) => parseInt(n, 10));
        if (r >= 1 && r <= ROWS && c >= 1 && c <= COLS) { setStartRow(r); setStartCol(c); }
      }
    } catch {}
  }, []); // intentional: only once on mount
  useEffect(() => {
    try { localStorage.setItem(LOCAL_KEY_STARTPOS, `${startRow},${startCol}`); } catch {}
  }, [startRow, startCol]);

  // Fetch grows when not passed in
  useEffect(() => {
    if (hasGrowsProp || !uid) return;
    (async () => {
      const snap = await getDocs(collection(db, "users", uid, "grows"));
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setFetched(items.filter(isActiveGrow));
    })();
  }, [hasGrowsProp, uid]);

  // Resolve watermark (now also listens to wmInput)
  useEffect(() => {
    let abort = false;
    (async () => {
      let custom = "";
      try { custom = localStorage.getItem(LOCAL_KEY_WATERMARK_URL) || ""; } catch {}
      const list = [wmInput || custom, ...(props.watermarkUrl ? [props.watermarkUrl] : []), ...WM_CANDIDATES]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i);
      for (const url of list) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await preloadOK(url);
        if (abort) return;
        if (ok) {
          setWmUrl(url);
          setWmTextFallback(false);
          return;
        }
      }
      setWmUrl("");
      setWmTextFallback(true);
    })();
    return () => { abort = true; };
  }, [props.watermarkUrl, wmInput]);

  // Base data source
  const baseGrows = hasGrowsProp ? propGrows : fetched;
  const allGrows = useMemo(() => baseGrows || [], [baseGrows]);

  // Maintain selection
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
  }, [allGrows]);

  // Indeterminate select-all
  useEffect(() => {
    if (!selectAllRef.current) return;
    const all = allGrows.length;
    const sel = selectedIds.size;
    selectAllRef.current.indeterminate = sel > 0 && sel < all;
  }, [allGrows.length, selectedIds]);

  // Screen styles (derived from template)
  const sheetStyle = {
    width: template.sheetW,
    height: template.sheetH,
    padding: template.sheetPad,
    background: "white",
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: `repeat(${COLS}, ${template.labelW})`,
    gridTemplateRows: `repeat(${ROWS}, ${template.labelH})`,
    columnGap: template.gapX,
    rowGap: template.gapY,
    alignContent: "start",
    justifyContent: "start",
    transform: `scale(${scalePct / 100})`,
    transformOrigin: "top left",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial',
    color: "#000",
  };
  const labelStyle = (selected) => ({
    width: template.labelW,
    height: template.labelH,
    boxSizing: "border-box",
    overflow: "hidden",
    breakInside: "avoid",
    position: "relative",
    userSelect: "none",
    cursor: "pointer",
    padding: `${PAD_Y} ${PAD_X}`,
    border: gridOverlay ? "1px solid rgba(14,165,233,0.35)" : "none",
    outline: selected ? "2px solid #22c55e" : "none",
  });
  const blankLabelStyle = { width: template.labelW, height: template.labelH };
  const rowStyle = {
    position: "relative",
    zIndex: 2,
    display: "grid",
    gridTemplateColumns: `calc(100% - ${QR_SIZE} - 0.12in) ${codeType === "qr" ? QR_SIZE : "0px"}`,
    gap: "0.10in",
    alignItems: "stretch",
  };
  const fieldsWrapStyle = { marginTop: "0.02in", position: "relative", zIndex: 2 };
  const TEXT_SHADOW = "0 0 2px rgba(255,255,255,0.95), 0 0 1px rgba(255,255,255,0.95)";
  const t1Style = { position: "relative", zIndex: 2, fontWeight: 700, fontSize: `${T1_PT}pt`, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: TEXT_SHADOW };
  const t2Style = { position: "relative", zIndex: 2, fontWeight: 600, fontSize: `${T2_PT}pt`, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: TEXT_SHADOW };
  const fStyle  = { position: "relative", zIndex: 2, fontSize: `${F_PT}pt`,  lineHeight: 1.1,  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: TEXT_SHADOW };
  const wmImgStyle = { position: "absolute", left: 0, top: 0, width: `calc(${QR_SIZE}*${LOGO_SCALE})`, height: `calc(${QR_SIZE}*${LOGO_SCALE})`, opacity: LOGO_OPACITY, objectFit: "contain", pointerEvents: "none", filter: "grayscale(100%)", zIndex: 1, mixBlendMode: "multiply" };
  const wmTextStyle = { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: `calc(${QR_SIZE}*${LOGO_SCALE})`, height: `calc(${QR_SIZE}*${LOGO_SCALE})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: ".42in", letterSpacing: ".02in", color: "rgba(0,0,0,.85)", opacity: LOGO_OPACITY, pointerEvents: "none", filter: "grayscale(100%)", zIndex: 1, mixBlendMode: "multiply" };
  const contentContainerStyle = { position: "relative", minWidth: 0, height: "100%", minHeight: QR_SIZE };
  const selectBadgeStyle = (selected) => ({ position: "absolute", inset: 0, border: selected ? "2px solid #22c55e" : "none", borderRadius: "2px", pointerEvents: "none" });

  const origin =
    window.location.origin || (typeof location !== "undefined" ? location.origin : "");

  /** ---------- Print HTML (uses current template) ---------- */
  const buildPrintHTML = (sheetsInnerHTML) => {
    const columnsCSS = Array.from({ length: COLS }, () => template.labelW).join(" ");
    const wmCSS = `
      .wm{
        position:absolute;left:0;top:0;width:calc(${QR_SIZE}*${LOGO_SCALE});height:calc(${QR_SIZE}*${LOGO_SCALE});
        opacity:${LOGO_OPACITY};object-fit:contain;pointer-events:none;filter:grayscale(100%);z-index:1;mix-blend-mode:multiply;
      }
      .wmtxt{
        position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        width:calc(${QR_SIZE}*${LOGO_SCALE});height:calc(${QR_SIZE}*${LOGO_SCALE});
        display:flex;align-items:center;justify-content:center;
        font-weight:800;font-size:.42in;letter-spacing:.02in;color:rgba(0,0,0,.85);
        opacity:${LOGO_OPACITY};pointer-events:none;filter:grayscale(100%);z-index:1;mix-blend-mode:multiply;
      }
      .t1,.t2,.f{ text-shadow: 0 0 2px rgba(255,255,255,.95), 0 0 1px rgba(255,255,255,.95); }
    `;
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Labels</title>
<style>
  @page { size: ${template.sheetW} ${template.sheetH}; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .sheet {
    width: ${template.sheetW}; height: ${template.sheetH}; padding: ${template.sheetPad}; box-sizing: border-box;
    display: grid; grid-template-columns: ${columnsCSS}; column-gap: ${template.gapX}; row-gap: ${template.gapY};
    align-content: start; justify-content: start;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #000;
  }
  .sheet + .sheet { page-break-before: always; }
  .label { position: relative; width: ${template.labelW}; height: ${template.labelH}; padding: ${PAD_Y} ${PAD_X}; box-sizing: border-box; overflow: hidden; break-inside: avoid; }
  .row { position: relative; z-index: 2; display: grid; grid-template-columns: calc(100% - ${QR_SIZE} - 0.12in) ${codeType === "qr" ? QR_SIZE : "0px"}; gap: 0.10in; align-items: stretch; }
  .content { position: relative; min-width: 0; height: 100%; min-height: ${QR_SIZE}; }
  .qr { width: ${QR_SIZE}; height: ${QR_SIZE}; }
  .t1 { position: relative; z-index: 2; font-weight: 700; font-size: ${T1_PT}pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t2 { position: relative; z-index: 2; font-weight: 600; font-size: ${T2_PT}pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fields { margin-top: 0.02in; position: relative; z-index: 2; }
  .f { position: relative; z-index: 2; font-size: ${F_PT}pt; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  ${wmCSS}
</style>
</head>
<body>
  <div id="sheets">${sheetsInnerHTML}</div>
  <script>setTimeout(() => { window.focus(); window.print(); }, 30);</script>
</body>
</html>`;
  };

  const printNow = async () => {
    if (!selectedGrows.length) {
      alert("Select at least one label to print.");
      return;
    }
    // double rAF to ensure hidden DOM is laid out before snapshot
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
          {LABEL_TEMPLATES[templateId]?.name || 'Avery 5160 / 8160'} · {allGrows.length} labels
        </div>

        <div className="inline-flex flex-wrap items-center gap-4">
          {/* Template */}
          <div className="inline-flex items-center gap-2">
            <span className="text-sm">Template</span>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              value={templateId}
              onChange={(e) => {
                const next = e.target.value === "5167" ? "5167" : "5160";
                setTemplateId(next);
                setStartRow(1);
                setStartCol(1);
              }}
            >
              <option value="5160">Avery 5160 / 8160</option>
              <option value="5167">Avery 5167 (mini)</option>
            </select>
          </div>

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

          {/* Select all */}
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
                {Array.from(selectedIds).length}/{allGrows.length} selected
              </span>
            </span>
          </label>

          {/* Grid */}
          <label className="inline-flex items-center gap-2 select-none">
            <input
              type="checkbox"
              className="h-4 w-4 align-middle"
              checked={gridOverlay}
              onChange={(e) => setGridOverlay(e.target.checked)}
              aria-label="Grid overlay"
            />
            <span className="text-sm">Grid</span>
          </label>

          {/* Scale */}
          <div className="inline-flex items-center gap-2">
            <span className="text-sm">Scale</span>
            <input
              type="range"
              min={50}
              max={150}
              step={5}
              value={scalePct}
              onChange={(e) => setScalePct(parseInt(e.target.value || "100", 10))}
            />
            <span className="text-xs opacity-70">{scalePct}%</span>
          </div>

          {/* Watermark */}
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

          {/* Watermark URL */}
          <div className="inline-flex items-center gap-2">
            <span className="text-sm">WM URL</span>
            <input
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm w-[220px]"
              placeholder="https://… or data:image/png;base64,…"
              value={wmInput}
              onChange={(e) => setWmInput(e.target.value)}
            />
          </div>

          {/* Code type */}
          <div className="inline-flex items-center gap-2">
            <span className="text-sm">Code</span>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              value={codeType}
              onChange={(e) => setCodeType(e.target.value === "none" ? "none" : "qr")}
            >
              <option value="qr">QR</option>
              <option value="none">None</option>
            </select>
          </div>

          {/* Print */}
          <button
            onClick={printNow}
            className="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white border border-blue-600 inline-flex items-center gap-2"
            disabled={Array.from(selectedIds).length === 0}
          >
            <Printer className="w-4 h-4" />
            Print labels ({Array.from(selectedIds).length})
          </button>
        </div>
      </div>

      {/* On-screen preview */}
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
                    {/* watermark image or fallback */}
                    {watermarkEnabled ? (
                      wmUrl ? (
                        <img src={wmUrl} alt="" style={wmImgStyle} />
                      ) : wmTextFallback ? (
                        <div style={wmTextStyle}>CN</div>
                      ) : null
                    ) : null}
                    <div style={t1Style} title={sub ? sub : strain} data-testid={sub ? "label-abbr" : "label-title"}>
                      {sub ? sub : strain}
                    </div>
                    {sub ? (
                      <div style={t2Style} title={strain} data-testid="label-strain">{strain}</div>
                    ) : (
                      <div style={{ ...t2Style, opacity: 0 }} aria-hidden="true">&nbsp;</div>
                    )}
                    <div style={fieldsWrapStyle} className="fields">
                      <div style={fStyle} title={type || ""} data-testid="label-type">Type: {type || "—"}</div>
                      <div style={fStyle} title={inoc || ""} data-testid="label-inoc">Inoc: {inoc || "—"}</div>
                    </div>
                  </div>
                  {codeType === "qr" ? (
                    <div className="qr" style={{ width: QR_SIZE, height: QR_SIZE }} aria-label="QR code">
                      <QRCodeSVG value={url} width="100%" height="100%" />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hidden printable sheets */}
      <div
        ref={printSheetsRef}
        style={{ position: "absolute", left: "-10000px", top: 0, visibility: "hidden" }}
        aria-hidden
        id="sheets"
      >
        {(() => {
          const pages = [];
          const items = Array.from(selectedIds).map((id) => allGrows.find((g) => g.id === id)).filter(Boolean);
          const prefill = Math.max(0, Math.min(PER_SHEET - 1, (startRow - 1) * COLS + (startCol - 1)));

          // Make a label DOM block (print version)
          const makeLabel = (g, key) => {
            const strain = getStrain(g);
            const sub = getAbbrev(g);
            const type = getType(g);
            const inoc = getInoc(g);
            const url = `${origin}/quick/${g.id}`;
            return (
              <div key={key} className="label">
                <div className="row">
                  <div className="content">
                    {watermarkEnabled ? (
                      wmUrl ? (
                        <img src={wmUrl} alt="" className="wm" />
                      ) : wmTextFallback ? (
                        <div className="wmtxt">CN</div>
                      ) : null
                    ) : null}
                    <div className="t1" title={sub ? sub : strain} data-testid={sub ? "label-abbr" : "label-title"}>
                      {sub ? sub : strain}
                    </div>
                    {sub ? (
                      <div className="t2" title={strain} data-testid="label-strain">{strain}</div>
                    ) : (
                      <div className="t2" style={{ opacity: 0 }} aria-hidden="true">&nbsp;</div>
                    )}
                    <div className="fields">
                      <div className="f" title={type || ""} data-testid="label-type">Type: {type || "—"}</div>
                      <div className="f" title={inoc || ""} data-testid="label-inoc">Inoc: {inoc || "—"}</div>
                    </div>
                  </div>
                  {codeType === "qr" ? (
                    <div className="qr">
                      <QRCodeSVG value={url} width="100%" height="100%" />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          };

          // If starting mid-sheet, add blanks first
          const blanks = Array.from({ length: prefill }, (_, i) => <div key={`blank-${i}`} className="label" />);
          let page = [ ...blanks ];
          let countOnPage = blanks.length;

          for (const g of items) {
            page.push(makeLabel(g, `g-${g.id}-${countOnPage}`));
            countOnPage++;
            if (countOnPage === PER_SHEET) {
              pages.push(<div key={`sheet-${pages.length}`} className="sheet">{page}</div>);
              page = [];
              countOnPage = 0;
            }
          }
          if (page.length) {
            pages.push(<div key={`sheet-${pages.length}`} className="sheet">{page}</div>);
          }
          return pages;
        })()}
      </div>
    </div>
  );
}

export default LabelPrint;
