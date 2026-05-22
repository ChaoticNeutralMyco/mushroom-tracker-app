// src/lib/sopPrint.js

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const SOP_PRINT_FRAME_STYLES = `
  @page { margin: 0.35in; }

  * { box-sizing: border-box; }

  html,
  body {
    margin: 0;
    padding: 0;
    background: #ffffff !important;
    color: #111827 !important;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .sop-print-document,
  .recipe-print-document {
    position: static !important;
    left: auto !important;
    top: auto !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    color: #111827 !important;
    pointer-events: auto !important;
    box-shadow: none !important;
    border-radius: 0 !important;
  }

  .sop-print-header {
    border-bottom: 2px solid #111827;
    padding-bottom: 0.15in;
    margin-bottom: 0.18in;
  }

  .sop-print-kicker {
    font-size: 9pt;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #4b5563;
    margin-bottom: 0.06in;
  }

  .sop-print-header h1 {
    font-size: 21pt;
    line-height: 1.1;
    margin: 0 0 0.08in;
    color: #111827;
  }

  .sop-print-header p {
    margin: 0;
    color: #374151;
  }

  .sop-print-meta-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.08in;
    margin-top: 0.16in;
  }

  .sop-print-meta-grid div {
    border: 1px solid #d1d5db;
    border-radius: 0.06in;
    padding: 0.07in;
    min-height: 0.48in;
  }

  .sop-print-meta-grid strong,
  .sop-print-meta-grid span {
    display: block;
  }

  .sop-print-meta-grid strong {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6b7280;
    margin-bottom: 0.04in;
  }

  .sop-print-meta-grid span {
    font-size: 10pt;
    color: #111827;
  }

  .sop-print-badge-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.05in;
    margin-top: 0.12in;
  }

  .sop-print-badge-row span {
    border: 1px solid #d1d5db;
    border-radius: 999px;
    padding: 0.03in 0.08in;
    font-size: 8pt;
    color: #374151;
    background: #ffffff !important;
  }

  .sop-print-section {
    margin: 0 0 0.18in;
    break-inside: auto;
    page-break-inside: auto;
  }

  .sop-print-section + .sop-print-section {
    border-top: 1px solid #e5e7eb;
    padding-top: 0.12in;
  }

  .sop-print-section h2 {
    font-size: 14pt;
    margin: 0 0 0.08in;
    color: #111827;
  }

  .sop-print-section h3 {
    font-size: 11pt;
    margin: 0 0 0.05in;
    color: #111827;
  }

  .sop-print-section p,
  .sop-print-section li,
  .sop-print-section td,
  .sop-print-section th,
  .sop-print-section pre {
    font-size: 10pt;
    line-height: 1.35;
  }

  .sop-print-section pre {
    white-space: pre-wrap;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    margin: 0;
  }

  .sop-print-tags {
    color: #374151;
    font-style: italic;
  }

  .sop-print-checklists {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.12in;
  }

  .sop-print-checklist {
    border: 1px solid #d1d5db;
    border-radius: 0.06in;
    padding: 0.09in;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .sop-print-checklist ul {
    margin: 0;
    padding-left: 0.18in;
  }

  .sop-print-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 0.08in;
  }

  .sop-print-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .sop-print-table th,
  .sop-print-table td {
    border: 1px solid #d1d5db;
    padding: 0.06in;
    text-align: left;
    vertical-align: top;
  }

  .sop-print-table th {
    background: #f3f4f6 !important;
    font-weight: 700;
    page-break-after: avoid;
  }

  .sop-print-lines {
    height: 0.38in;
    border-bottom: 1px solid #d1d5db;
  }

  .sop-print-signoff {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.12in;
  }

  .sop-print-signoff div {
    border: 1px solid #d1d5db;
    border-radius: 0.06in;
    padding: 0.08in;
    min-height: 0.62in;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .sop-print-signoff strong {
    display: block;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6b7280;
  }

  .sop-print-signoff span {
    display: block;
    min-height: 0.34in;
    border-bottom: 1px solid #d1d5db;
  }

  .sop-print-disclaimer {
    margin-top: 0.18in;
    padding-top: 0.08in;
    border-top: 1px solid #d1d5db;
    color: #6b7280;
    font-size: 8pt;
    line-height: 1.35;
  }

  .sop-no-print { display: none !important; }
`;

export function printElementBySelector(selector, title = "SOP Print", onDone) {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const source = document.querySelector(selector);
  if (!source) {
    onDone?.();
    return false;
  }

  const iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";

  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = frameWindow?.document;

  if (!frameWindow || !frameDocument) {
    iframe.remove();
    onDone?.();
    return false;
  }

  let cleaned = false;
  let fallbackTimer = null;
  let printed = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    frameWindow.removeEventListener("afterprint", cleanup);
    window.setTimeout(() => iframe.remove(), 250);
    onDone?.();
  };

  const runPrint = () => {
    if (printed) return;
    printed = true;
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch (error) {
      console.warn("SOP print failed:", error?.message || error);
      cleanup();
    }
  };

  frameWindow.addEventListener("afterprint", cleanup, { once: true });
  fallbackTimer = window.setTimeout(cleanup, 120000);

  frameDocument.open();
  frameDocument.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${SOP_PRINT_FRAME_STYLES}</style>
  </head>
  <body>${source.outerHTML}</body>
</html>`);
  frameDocument.close();

  const schedulePrint = () => {
    window.setTimeout(runPrint, 160);
  };

  if (frameDocument.readyState === "complete") {
    schedulePrint();
  } else {
    iframe.addEventListener("load", schedulePrint, { once: true });
    window.setTimeout(schedulePrint, 300);
  }

  return true;
}
