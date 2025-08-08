// src/components/Grow/LabelPrint.jsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * LabelPrint (prop-driven)
 * - Renders selectable grow labels and prints them.
 * - Shows strain, inoc/created date, grow type, parent grow, and optional QR.
 * - NO Firestore reads. Everything comes from props.
 *
 * Optional dependency for QR generation:
 *   npm i qrcode
 */

export default function LabelPrint({ grows = [], prefs = {} }) {
  const items = useMemo(() => (Array.isArray(grows) ? grows : []), [grows]);

  // quick lookup for parent display
  const growById = useMemo(() => {
    const m = new Map();
    for (const g of items) m.set(g.id, g);
    return m;
  }, [items]);

  // settings
  const qrEnabled = prefs.labelQR !== false;
  const qrMode = prefs.qrMode || "quickEditUrl"; // "quickEditUrl" | "deepLink"

  const [selectedIds, setSelectedIds] = useState(items.map((g) => g.id));
  const [qrReady, setQrReady] = useState(false);
  const [qrModule, setQrModule] = useState(null);

  // Auto-select all when list changes
  useEffect(() => {
    setSelectedIds(items.map((g) => g.id));
  }, [items]);

  // Lazy-load the QR lib if enabled
  useEffect(() => {
    if (!qrEnabled) {
      setQrReady(false);
      setQrModule(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const mod = await import(/* @vite-ignore */ "qrcode");
        if (active) {
          setQrModule(mod);
          setQrReady(true);
        }
      } catch {
        setQrReady(false);
        setQrModule(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [qrEnabled]);

  const toggle = (id) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const selected = useMemo(
    () => items.filter((g) => selectedIds.includes(g.id)),
    [items, selectedIds]
  );

  const printSelected = async () => {
    const toPrint = selected;
    const win = window.open("", "_blank", "width=950,height=750");
    if (!win) return;

    // Build rows; include QR data URIs if enabled+available
    const rows = [];
    for (const g of toPrint) {
      const urlOrDeepLink = buildQrUrlOrDeepLink(g, qrMode);
      const qrDataUrl =
        qrEnabled && qrModule?.toDataURL
          ? await qrModule.toDataURL(urlOrDeepLink, { margin: 0, scale: 4 })
          : null;
      rows.push({ g, qrDataUrl, urlOrDeepLink });
    }

    const html = rows
      .map(({ g, qrDataUrl, urlOrDeepLink }) => {
        const { title, sub, idShort, inocDate, parentLabel } = deriveDisplay(g, growById);
        const qrHtml = qrEnabled
          ? qrDataUrl
            ? `<img class="qr" src="${qrDataUrl}" alt="QR">`
            : `<div class="qr-fallback">${escapeHtml(idShort)}</div>`
          : "";
        const qrCaption = qrEnabled
          ? `<div class="qr-caption">${escapeHtml(urlOrDeepLink)}</div>`
          : "";

        return `
          <div class="label">
            <div class="left">
              <div class="title">${escapeHtml(title)}</div>
              <div class="sub">${escapeHtml(sub)}</div>
              <div class="meta">Inoc: ${escapeHtml(inocDate || "—")}</div>
              <div class="meta">Parent: ${escapeHtml(parentLabel || "—")}</div>
              <div class="meta">ID: ${escapeHtml(idShort)}</div>
            </div>
            ${
              qrEnabled
                ? `<div class="right">${qrHtml}${qrCaption}</div>`
                : ""
            }
          </div>
        `;
      })
      .join("");

    win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Labels</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 16px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .label { border: 1px solid #999; border-radius: 10px; padding: 10px 12px; display: flex; gap: 10px; height: 120px; }
  .left { flex: 1 1 auto; min-width: 0; }
  .right { width: 92px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
  .title { font-weight: 700; font-size: 16px; }
  .sub { font-size: 12px; opacity: 0.9; margin-top: 2px; }
  .meta { font-size: 11px; opacity: 0.75; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qr { display: block; width: 90px; height: 90px; }
  .qr-fallback { width: 90px; height: 90px; border: 1px dashed #888; border-radius: 6px; display: grid; place-items: center; font-size: 10px; opacity: 0.7; }
  .qr-caption { font-size: 9px; opacity: 0.6; text-align: center; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;}
  @media print { body { margin: 0; } .grid { gap: 8px; } .label { height: 110px; } }
</style>
</head>
<body>
  <div class="grid">${html || "<p>No labels selected.</p>"}</div>
  <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };</script>
</body>
</html>`);
    win.document.close();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSelectedIds(items.map((g) => g.id))}
          className="px-3 py-1.5 rounded-lg bg-zinc-700 text-white hover:bg-zinc-600 text-sm"
        >
          Select all
        </button>
        <button
          onClick={() => setSelectedIds([])}
          className="px-3 py-1.5 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 text-sm"
        >
          Clear
        </button>

        <div className="ml-auto text-xs opacity-70">
          {qrEnabled ? (
            <>
              Scan opens: <code>/quick/&lt;growId&gt;</code>
            </>
          ) : (
            "QR disabled in Settings"
          )}
        </div>
        <button
          onClick={printSelected}
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm"
          disabled={selectedIds.length === 0}
        >
          Print selected
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((g) => {
          const { title, sub, idShort, inocDate, parentLabel } = deriveDisplay(g, growById);
          return (
            <label
              key={g.id}
              className={`rounded-xl border p-3 cursor-pointer select-none flex gap-3 ${
                selectedIds.includes(g.id)
                  ? "border-emerald-600 bg-emerald-600/10"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
              onClick={() => toggle(g.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{title}</div>
                <div className="text-xs opacity-80 truncate">{sub}</div>
                <div className="text-[11px] opacity-70 mt-1">
                  Inoc: {inocDate || "—"}
                </div>
                <div className="text-[11px] opacity-70">
                  Parent: {parentLabel || "—"}
                </div>
                <div className="text-[11px] opacity-60 mt-1">ID: {idShort}</div>
              </div>

              {/* tiny QR preview if enabled */}
              {qrEnabled && (
                <div className="hidden sm:flex w-[72px] items-center justify-center">
                  {qrReady ? (
                    <TinyQr data={buildQrUrlOrDeepLink(g, qrMode)} qrcode={qrModule} />
                  ) : (
                    <div className="w-[64px] h-[64px] border border-dashed rounded-md opacity-50 grid place-items-center text-[10px]">
                      QR
                    </div>
                  )}
                </div>
              )}
            </label>
          );
        })}
        {items.length === 0 && (
          <div className="text-sm opacity-70">No grows to label yet.</div>
        )}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function deriveDisplay(g, growById) {
  const title = g.strain || g.abbreviation || "Grow";
  const type = g.type || g.growType || ""; // flexible field names
  const sub = [type, g.stage].filter(Boolean).join(" — ");

  const inocDate =
    getDateString(
      g?.stageDates?.Inoculated ||
        g?.stageDates?.inoculated ||
        g?.createdDate ||
        g?.createdAt
    ) || "";

  const parentId = g.parentId || g.parentGrowId || g.parent || g.parentRefId || "";
  let parentLabel = "";
  if (parentId) {
    const pg = growById.get(parentId);
    parentLabel = pg
      ? pg.abbreviation || pg.strain || parentId
      : String(parentId);
  }

  const idShort = g.id?.slice?.(0, 8) || "";
  return { title, sub, inocDate, parentLabel, idShort };
}

function getDateString(raw) {
  if (!raw) return "";
  try {
    if (typeof raw === "string") {
      const d = new Date(raw);
      if (!isNaN(d)) return fmt(d);
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    } else if (raw?.toDate) {
      return fmt(raw.toDate());
    } else if (raw instanceof Date) {
      return fmt(raw);
    }
  } catch {}
  return "";
}
function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function buildQrUrlOrDeepLink(grow, mode) {
  if (mode === "deepLink") {
    const id = grow?.id || "";
    const stage = (grow?.stage || "").toLowerCase();
    return `myco:/grow/${id}${stage ? `?stage=${encodeURIComponent(stage)}` : ""}`;
  }
  const id = grow?.id || "";
  const base = (typeof window !== "undefined" && window.location?.origin) || "";
  return `${base}/quick/${id}`;
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* tiny preview QR (client-side) — only rendered if "qrcode" is present */
function TinyQr({ data, qrcode }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const url = await qrcode.toDataURL(data, { margin: 0, scale: 3 });
        if (alive) setSrc(url);
      } catch {
        if (alive) setSrc(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [data, qrcode]);
  if (!src) return null;
  return <img src={src} alt="QR" className="w-[64px] h-[64px] rounded" />;
}
