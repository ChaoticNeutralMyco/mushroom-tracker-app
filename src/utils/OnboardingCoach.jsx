import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import stepsByRoute, { TOUR_VERSION } from "./tourSteps";

/**
 * OnboardingCoach
 * - Per-route guided tour with a floating "?" button (bottom-left).
 * - Menu: Replay, Reset this page, Reset ALL pages.
 * - Accessibility:
 *    • Focus trap within tooltip; Esc to close; restores focus to "?".
 *    • Renders via portal to <body>; while open, sets inert/aria-hidden on #app-shell.
 *
 * Props:
 *   - pageKey?: string  // optional route key (e.g., "dashboard"); falls back to URL segment
 *   - enabled?: boolean // when false, hides help menu AND disables auto-onboarding
 */
export default function OnboardingCoach({ pageKey, enabled = true }) {
  const isEnabled = enabled !== false;

  const { pathname } = useLocation();
  const routeKey = useMemo(
    () => (pageKey ? String(pageKey).toLowerCase() : routeToKey(pathname)),
    [pageKey, pathname]
  );
  const steps = stepsByRoute[routeKey] || [];

  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const spotlightRef = useRef(null);
  const tooltipRef = useRef(null);
  const menuRef = useRef(null);
  const helpBtnRef = useRef(null);
  const lastFocusRef = useRef(null);

  // Ensure UI is closed when disabled
  useEffect(() => {
    if (!isEnabled) {
      setOpen(false);
      setMenuOpen(false);
    }
  }, [isEnabled]);

  /* ---------- one-time: versioned tours ---------- */
  useEffect(() => {
    if (!isEnabled) return;
    try {
      const stored = Number(localStorage.getItem("tour.version") || "0");
      if (stored !== Number(TOUR_VERSION)) {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("tour.seen:")) keys.push(k);
        }
        keys.forEach((k) => localStorage.removeItem(k));
        localStorage.setItem("tour.version", String(TOUR_VERSION));
      }
    } catch {}
  }, [isEnabled]);

  /* ---------- auto-open on first visit ---------- */
  useEffect(() => {
    if (!isEnabled) return;
    const seenKey = seenStorageKey(routeKey);
    const seen = localStorage.getItem(seenKey) === "1";
    setIdx(0);
    setMenuOpen(false);
    if (!seen && steps.length) {
      const t = setTimeout(() => setOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, [isEnabled, routeKey, steps.length]);

  /* ---------- portal mount target ---------- */
  const [portalEl, setPortalEl] = useState(null);
  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  /* ---------- when open: focus trap, esc, inert app shell ---------- */
  useEffect(() => {
    if (!isEnabled || !open) return;
    const appShell = document.getElementById("app-shell");

    // Save last focused node and inert the app (excluding portal overlay)
    lastFocusRef.current = document.activeElement;
    if (appShell) {
      appShell.setAttribute("aria-hidden", "true");
      appShell.setAttribute("inert", "");
    }

    // Move focus into the tooltip
    const focusFirst = () => {
      const el = tooltipRef.current;
      if (!el) return;
      const f = getFocusable(el);
      (f[0] || el).focus({ preventScroll: true });
    };
    const t = setTimeout(focusFirst, 0);

    // Esc + Tab trap
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeForRoute(false); // don't mark seen on ESC
        return;
      }
      if (e.key === "Tab") {
        const el = tooltipRef.current;
        if (!el) return;
        const f = getFocusable(el);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      if (appShell) {
        appShell.removeAttribute("inert");
        appShell.removeAttribute("aria-hidden");
      }
      // Restore focus to the "?" button
      (helpBtnRef.current || lastFocusRef.current)?.focus?.();
    };
  }, [isEnabled, open]);

  /* ---------- keep spotlight aligned ---------- */
  useEffect(() => {
    if (!isEnabled || !open) return;

    const update = () => {
      const target = getTargetEl(steps[idx]?.selector);
      const rect = target ? target.getBoundingClientRect() : null;
      positionSpotlight(spotlightRef.current, rect);
      positionTooltip(tooltipRef.current, rect);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    window.addEventListener("scroll", update, true);
    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      try { ro.disconnect(); } catch {}
      try { mo.disconnect(); } catch {}
      window.removeEventListener("scroll", update, true);
    };
  }, [isEnabled, open, idx, steps]);

  const startReplay = () => {
    if (!isEnabled) return;
    setIdx(0);
    setOpen(true);
    setMenuOpen(false);
  };

  const resetThisPage = () => {
    if (!isEnabled) return;
    try { localStorage.removeItem(seenStorageKey(routeKey)); } catch {}
    startReplay();
  };

  const resetAllPages = () => {
    if (!isEnabled) return;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("tour.seen:")) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {}
    startReplay();
  };

  const closeForRoute = (markSeen = true) => {
    if (markSeen) try { localStorage.setItem(seenStorageKey(routeKey), "1"); } catch {}
    setOpen(false);
  };

  if (!isEnabled) return null;            // <-- hides both help menu and onboarding
  if (!portalEl) return null;

  const bodyUI = (
    <>
      {/* Help button + menu (bottom-left) */}
      <HelpButton
        ref={helpBtnRef}
        onClick={() => setMenuOpen((v) => !v)}
        ariaExpanded={menuOpen ? "true" : "false"}
      />
      {menuOpen && (
        <Menu
          ref={menuRef}
          onReplay={startReplay}
          onResetThis={resetThisPage}
          onResetAll={resetAllPages}
        />
      )}

      {/* Overlay + spotlight + tooltip */}
      {open && (
        <div
          className="onb-overlay"
          aria-modal="true"
          role="dialog"
          onClick={(e) => {
            if (!tooltipRef.current?.contains(e.target)) next(1);
          }}
        >
          <div ref={spotlightRef} className="onb-spotlight" aria-hidden="true" />
          <div ref={tooltipRef} className="onb-tooltip" role="document">
            <div className="onb-title">{steps[idx]?.title || "Welcome"}</div>
            <div className="onb-body">{steps[idx]?.body || ""}</div>
            <div className="onb-actions">
              <button className="onb-btn ghost" onClick={() => closeForRoute(true)}>Skip</button>
              <div className="onb-grow" />
              {idx > 0 && (
                <button className="onb-btn" onClick={() => next(-1)} aria-label="Previous step">Back</button>
              )}
              <button
                className="onb-btn primary"
                onClick={() => {
                  if (idx < steps.length - 1) next(1);
                  else closeForRoute(true);
                }}
                aria-label={idx < steps.length - 1 ? "Next step" : "Finish tour"}
              >
                {idx < steps.length - 1 ? "Next" : "Done"}
              </button>
            </div>
            <div className="onb-progress">{idx + 1} / {steps.length}</div>
          </div>

          <style>{styles}</style>
        </div>
      )}
    </>
  );

  return createPortal(
    <>
      {bodyUI}
      <style>{styles}</style>
    </>,
    portalEl
  );

  function next(delta) {
    const n = Math.max(0, Math.min(steps.length - 1, idx + delta));
    setIdx(n);
  }
}

/* ---------- helpers ---------- */

function routeToKey(pathname) {
  const seg = (pathname || "/").split("/").filter(Boolean)[0] || "dashboard";
  return seg.toLowerCase();
}
function seenStorageKey(routeKey) {
  return `tour.seen:${routeKey}`;
}
function getTargetEl(selector) {
  if (!selector) return null;
  try { return document.querySelector(selector); } catch { return null; }
}
function positionSpotlight(el, rect) {
  if (!el) return;
  if (rect) {
    const pad = 8;
    el.style.display = "block";
    el.style.left = `${Math.max(0, rect.left - pad)}px`;
    el.style.top = `${Math.max(0, rect.top - pad)}px`;
    el.style.width = `${rect.width + pad * 2}px`;
    el.style.height = `${rect.height + pad * 2}px`;
  } else {
    el.style.display = "none";
  }
}
function positionTooltip(el, rect) {
  if (!el) return;
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const estimateW = 360;
  const estimateH = 160;

  let left = (vpW - estimateW) / 2;
  let top = vpH * 0.12;

  if (rect) {
    const above = rect.top >= estimateH + 24;
    if (above) top = rect.top - estimateH - 16;
    else top = Math.min(vpH - estimateH - 16, rect.bottom + 16);
    left = Math.min(vpW - estimateW - 16, Math.max(16, rect.left));
  }

  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
  el.style.width = `${estimateW}px`;
}
function getFocusable(root) {
  if (!root) return [];
  const sel = [
    "a[href]", "area[href]", "button:not([disabled])", "input:not([disabled])",
    "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  return Array.from(root.querySelectorAll(sel)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/* ---------- UI bits ---------- */

const HelpButton = React.forwardRef(function HelpButton({ onClick, ariaExpanded }, ref) {
  return (
    <>
      <button
        ref={ref}
        className="onb-help"
        aria-label="Guide menu"
        aria-expanded={ariaExpanded}
        onClick={onClick}
        title="Guide menu"
      >
        ?
      </button>
      <style>{styles}</style>
    </>
  );
});

const Menu = React.forwardRef(function Menu({ onReplay, onResetThis, onResetAll }, ref) {
  return (
    <>
      <div ref={ref} className="onb-menu" role="menu" aria-label="Guide menu">
        <button className="onb-menu-item" onClick={onReplay}>▶ Replay guide (this page)</button>
        <button className="onb-menu-item" onClick={onResetThis}>↺ Reset this page</button>
        <hr className="onb-menu-sep" />
        <button className="onb-menu-item danger" onClick={onResetAll}>⟲ Reset ALL pages</button>
      </div>
      <style>{styles}</style>
    </>
  );
});

/* NOTE: bottom-left placement; respects safe areas. */
const styles = `
.onb-overlay{
  position:fixed; inset:0; z-index:9999;
  background: rgba(10,12,16,0.55);
  backdrop-filter: blur(1px);
}
.onb-spotlight{
  position:fixed; pointer-events:none;
  border-radius:12px; box-shadow:0 0 0 9999px rgba(0,0,0,0.55), 0 8px 24px rgba(0,0,0,0.45);
  outline:2px solid rgba(99,102,241,0.9);
  transition: all .18s ease;
}
.onb-tooltip{
  position:fixed; max-width:420px;
  background:#0b1020; color:#e6e8f0;
  border:1px solid rgba(99,102,241,.35); border-radius:14px;
  padding:14px 14px 10px 14px; box-shadow: 0 12px 30px rgba(0,0,0,.35);
}
.onb-title{ font-weight:700; margin-bottom:4px; font-size:16px; }
.onb-body{ font-size:14px; line-height:1.35; opacity:.95; }
.onb-actions{ display:flex; align-items:center; gap:8px; margin-top:12px; }
.onb-btn{ border-radius:10px; padding:8px 12px; border:1px solid #3b3f7a; background:#121635; color:#eef; }
.onb-btn.ghost{ background:transparent; color:#cbd5e1; border-color:#334155; }
.onb-btn.primary{ background:#4f46e5; border-color:#4f46e5; color:white; }
.onb-btn:hover{ filter:brightness(1.05); }
.onb-grow{ flex:1; }
.onb-progress{ position:absolute; right:10px; bottom:8px; font-size:11px; opacity:.7; }

/* Help button: bottom-left */
.onb-help{
  position: fixed;
  left: max(16px, env(safe-area-inset-left));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 9998;
  width: 40px; height: 40px; border-radius: 9999px;
  border:1px solid #3b3f7a; background:#111633; color:#c7d2fe;
  font-weight:700; font-size:18px; display:flex; align-items:center; justify-content:center;
  box-shadow: 0 8px 20px rgba(0,0,0,.35);
}
.onb-help:hover{ filter:brightness(1.08); }

/* Menu aligned to the left, above the button */
.onb-menu{
  position: fixed;
  left: max(16px, env(safe-area-inset-left));
  bottom: calc(max(16px, env(safe-area-inset-bottom)) + 48px);
  z-index: 9999;
  width: 240px; background:#0b1020; color:#e6e8f0;
  border:1px solid rgba(99,102,241,.35); border-radius:12px;
  box-shadow: 0 12px 30px rgba(0,0,0,.35); overflow:hidden;
}
.onb-menu-item{
  width:100%; text-align:left; padding:10px 12px;
  background:transparent; border:none; color:inherit; cursor:pointer;
}
.onb-menu-item:hover{ background:#131a35; }
.onb-menu-item.danger{ color:#fecaca; }
.onb-menu-sep{ margin:0; border:0; border-top:1px solid #1e2748; }

@media (prefers-color-scheme: light){
  .onb-tooltip{ background:#ffffff; color:#0f172a; border-color:rgba(99,102,241,.5); }
  .onb-btn{ background:#f4f4ff; color:#0f172a; border-color:#c7d2fe; }
  .onb-btn.ghost{ background:transparent; color:#1f2937; border-color:#cbd5e1; }
  .onb-menu{ background:#ffffff; color:#0f172a; border-color:rgba(99,102,241,.5); }
  .onb-menu-item:hover{ background:#eef2ff; }
}
`;
