// src/utils/OnboardingCoach.jsx
import React, {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import stepsByRoute, { TOUR_CONTROL_EVENT, TOUR_VERSION } from "./tourSteps";

const TOUR_VERSION_STORAGE_KEY = "tour.version";
const TOUR_SEEN_PREFIX = "tour.seen:";

/**
 * OnboardingCoach
 * - Per-route, per-version guided tour with a floating "?" button.
 * - Menu: Replay, Reset this page, Reset ALL pages.
 * - Missing/conditional spotlight targets never block the guide; the tooltip
 *   safely centers and explains that the control is not visible.
 * - Accessibility:
 *    • Focus trap within tooltip; Esc closes; focus is restored afterward.
 *    • Help menu supports keyboard focus and Escape.
 *    • Renders via portal to <body>; while the tour is open, #app-shell is
 *      inert/aria-hidden and its previous accessibility state is restored.
 *
 * Props:
 *   - pageKey?: string  // optional route key (e.g., "dashboard"); falls back to URL segment
 *   - enabled?: boolean // when false, hides help menu AND disables auto-onboarding
 */
export default function OnboardingCoach({ pageKey, enabled = true }) {
  const isEnabled = enabled !== false;

  const { pathname } = useLocation();
  const routeKey = useMemo(
    () =>
      normalizeRouteKey(
        pageKey ? String(pageKey) : routeToKey(pathname)
      ),
    [pageKey, pathname]
  );
  const steps = stepsByRoute[routeKey] || [];

  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [targetState, setTargetState] = useState({
    checked: false,
    available: false,
  });

  const spotlightRef = useRef(null);
  const tooltipRef = useRef(null);
  const menuRef = useRef(null);
  const helpBtnRef = useRef(null);
  const lastFocusRef = useRef(null);

  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const bodyId = `${dialogId}-body`;
  const menuId = `${dialogId}-menu`;

  const currentStep = steps[idx] || null;
  const currentSelector = currentStep?.selector || "";
  const targetUnavailable =
    Boolean(currentSelector) &&
    targetState.checked &&
    !targetState.available;

  useEffect(() => {
    if (!isEnabled) {
      setOpen(false);
      setMenuOpen(false);
      setTargetState({ checked: false, available: false });
    }
  }, [isEnabled]);

  useEffect(() => {
    if (!isEnabled) return;

    try {
      const stored = Number(
        localStorage.getItem(TOUR_VERSION_STORAGE_KEY) || "0"
      );

      if (stored !== Number(TOUR_VERSION)) {
        clearAllSeenTours();
        localStorage.setItem(
          TOUR_VERSION_STORAGE_KEY,
          String(TOUR_VERSION)
        );
      }
    } catch {}
  }, [isEnabled]);

  useEffect(() => {
    if (!isEnabled) return;

    let seen = false;
    try {
      seen = localStorage.getItem(seenStorageKey(routeKey)) === "1";
    } catch {}

    setIdx(0);
    setMenuOpen(false);
    setOpen(false);
    setTargetState({ checked: false, available: false });

    if (!seen && steps.length) {
      const timer = window.setTimeout(() => setOpen(true), 400);
      return () => window.clearTimeout(timer);
    }
  }, [isEnabled, routeKey, steps.length]);

  const [portalEl, setPortalEl] = useState(null);
  useEffect(() => {
    setPortalEl(document.body);
  }, []);

  useEffect(() => {
    if (!isEnabled || !menuOpen || open) return;

    const focusTimer = window.setTimeout(() => {
      const firstItem = menuRef.current?.querySelector(
        '[role="menuitem"]'
      );
      firstItem?.focus?.({ preventScroll: true });
    }, 0);

    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      if (helpBtnRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
      helpBtnRef.current?.focus?.({ preventScroll: true });
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener(
        "pointerdown",
        handlePointerDown,
        true
      );
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isEnabled, menuOpen, open]);

  useEffect(() => {
    if (!isEnabled || !open) return;

    const appShell = document.getElementById("app-shell");
    const priorShellState = appShell
      ? {
          ariaHidden: appShell.getAttribute("aria-hidden"),
          hadInert: appShell.hasAttribute("inert"),
        }
      : null;

    lastFocusRef.current = document.activeElement;

    if (appShell) {
      appShell.setAttribute("aria-hidden", "true");
      appShell.setAttribute("inert", "");
    }

    const focusFirst = () => {
      const el = tooltipRef.current;
      if (!el) return;
      const focusable = getFocusable(el);
      (focusable[0] || el).focus({ preventScroll: true });
    };

    const focusTimer = window.setTimeout(focusFirst, 0);

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeForRoute(true);
        return;
      }

      if (event.key !== "Tab") return;

      const el = tooltipRef.current;
      if (!el) return;

      const focusable = getFocusable(el);
      if (!focusable.length) {
        event.preventDefault();
        el.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);

      if (appShell && priorShellState) {
        if (priorShellState.ariaHidden === null) {
          appShell.removeAttribute("aria-hidden");
        } else {
          appShell.setAttribute(
            "aria-hidden",
            priorShellState.ariaHidden
          );
        }

        if (!priorShellState.hadInert) {
          appShell.removeAttribute("inert");
        }
      }

      (
        helpBtnRef.current ||
        lastFocusRef.current
      )?.focus?.({ preventScroll: true });
    };
  }, [isEnabled, open, routeKey]);

  useEffect(() => {
    if (!isEnabled || !open) return;

    setTargetState({ checked: false, available: false });

    const initialTarget = getTargetEl(currentSelector);
    if (initialTarget) {
      const initialRect = initialTarget.getBoundingClientRect();
      const outsideViewport =
        initialRect.top < 12 ||
        initialRect.bottom > window.innerHeight - 12;

      if (outsideViewport) {
        initialTarget.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "auto",
        });
      }
    }

    const update = () => {
      const currentTarget = getTargetEl(currentSelector);
      const rect = currentTarget
        ? currentTarget.getBoundingClientRect()
        : null;
      const available = Boolean(currentTarget);

      setTargetState((current) =>
        current.checked && current.available === available
          ? current
          : { checked: true, available }
      );

      positionSpotlight(spotlightRef.current, rect);
      positionTooltip(tooltipRef.current, rect);
    };

    update();

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(update)
        : null;
    resizeObserver?.observe(document.documentElement);

    if (initialTarget) {
      try {
        resizeObserver?.observe(initialTarget);
      } catch {}
    }

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    const mutationObserver =
      typeof MutationObserver === "function"
        ? new MutationObserver(update)
        : null;
    mutationObserver?.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      try {
        resizeObserver?.disconnect();
      } catch {}
      try {
        mutationObserver?.disconnect();
      } catch {}
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [currentSelector, idx, isEnabled, open, routeKey]);

  const startReplay = () => {
    if (!isEnabled || !steps.length) return;

    setIdx(0);
    setTargetState({ checked: false, available: false });
    setOpen(true);
    setMenuOpen(false);
  };

  const resetThisPage = () => {
    if (!isEnabled) return;

    try {
      localStorage.removeItem(seenStorageKey(routeKey));
    } catch {}

    startReplay();
  };

  const resetAllPages = () => {
    if (!isEnabled) return;

    clearAllSeenTours();

    try {
      localStorage.setItem(
        TOUR_VERSION_STORAGE_KEY,
        String(TOUR_VERSION)
      );
    } catch {}

    startReplay();
  };

  useEffect(() => {
    const handleTourControl = (event) => {
      const action = event?.detail?.action;
      const requestedRoute = normalizeRouteKey(
        event?.detail?.routeKey || routeKey
      );

      if (action === "reset-all") {
        clearAllSeenTours();

        try {
          localStorage.setItem(
            TOUR_VERSION_STORAGE_KEY,
            String(TOUR_VERSION)
          );
        } catch {}

        if (isEnabled && steps.length) startReplay();
        return;
      }

      if (requestedRoute !== routeKey) return;

      if (action === "reset-page") {
        try {
          localStorage.removeItem(seenStorageKey(routeKey));
        } catch {}
        startReplay();
      } else if (action === "replay") {
        startReplay();
      }
    };

    window.addEventListener(
      TOUR_CONTROL_EVENT,
      handleTourControl
    );

    return () =>
      window.removeEventListener(
        TOUR_CONTROL_EVENT,
        handleTourControl
      );
  }, [isEnabled, routeKey, steps.length]);

  const closeForRoute = (markSeen = true) => {
    if (markSeen) {
      try {
        localStorage.setItem(seenStorageKey(routeKey), "1");
      } catch {}
    }

    setOpen(false);
    setTargetState({ checked: false, available: false });
  };

  if (!isEnabled || !steps.length) return null;
  if (!portalEl) return null;

  return createPortal(
    <>
      <style>{styles}</style>

      <HelpButton
        ref={helpBtnRef}
        menuId={menuId}
        onClick={() => setMenuOpen((current) => !current)}
        ariaExpanded={menuOpen ? "true" : "false"}
      />

      {menuOpen && (
        <Menu
          id={menuId}
          ref={menuRef}
          onReplay={startReplay}
          onResetThis={resetThisPage}
          onResetAll={resetAllPages}
        />
      )}

      {open && (
        <div
          className={`onb-overlay ${
            targetState.available
              ? "onb-overlay--spotlight"
              : "onb-overlay--centered"
          }`}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          role="dialog"
          onClick={(event) => {
            if (tooltipRef.current?.contains(event.target)) return;

            if (idx < steps.length - 1) {
              next(1);
            } else {
              closeForRoute(true);
            }
          }}
        >
          <div
            ref={spotlightRef}
            className="onb-spotlight"
            aria-hidden="true"
          />

          <div
            ref={tooltipRef}
            className="onb-tooltip"
            tabIndex="-1"
          >
            <div id={titleId} className="onb-title">
              {currentStep?.title || "Welcome"}
            </div>

            <div id={bodyId} className="onb-body">
              {currentStep?.body || ""}
            </div>

            {targetUnavailable ? (
              <div className="onb-context-note">
                This control is not visible in the current view. It may
                depend on your plan, current data, or screen layout. You
                can continue the guide normally.
              </div>
            ) : null}

            <div className="onb-actions">
              <button
                type="button"
                className="onb-btn ghost"
                onClick={() => closeForRoute(true)}
              >
                Skip
              </button>

              <div className="onb-grow" />

              {idx > 0 && (
                <button
                  type="button"
                  className="onb-btn"
                  onClick={() => next(-1)}
                  aria-label="Previous step"
                >
                  Back
                </button>
              )}

              <button
                type="button"
                className="onb-btn primary"
                onClick={() => {
                  if (idx < steps.length - 1) {
                    next(1);
                  } else {
                    closeForRoute(true);
                  }
                }}
                aria-label={
                  idx < steps.length - 1
                    ? "Next step"
                    : "Finish tour"
                }
              >
                {idx < steps.length - 1 ? "Next" : "Done"}
              </button>
            </div>

            <div
              className="onb-progress"
              aria-live="polite"
              aria-label={`Guide step ${idx + 1} of ${steps.length}`}
            >
              {idx + 1} / {steps.length}
            </div>
          </div>
        </div>
      )}
    </>,
    portalEl
  );

  function next(delta) {
    const nextIndex = Math.max(
      0,
      Math.min(steps.length - 1, idx + delta)
    );

    setTargetState({ checked: false, available: false });
    setIdx(nextIndex);
  }
}

/* ---------- helpers ---------- */

function normalizeRouteKey(value) {
  return String(value || "dashboard")
    .trim()
    .toLowerCase() || "dashboard";
}

function routeToKey(pathname) {
  const segment =
    (pathname || "/").split("/").filter(Boolean)[0] ||
    "dashboard";
  return normalizeRouteKey(segment);
}

function seenStorageKey(routeKey) {
  return `${TOUR_SEEN_PREFIX}v${TOUR_VERSION}:${normalizeRouteKey(
    routeKey
  )}`;
}

function clearAllSeenTours() {
  try {
    const keys = [];

    for (
      let index = 0;
      index < localStorage.length;
      index += 1
    ) {
      const key = localStorage.key(index);
      if (key?.startsWith(TOUR_SEEN_PREFIX)) {
        keys.push(key);
      }
    }

    keys.forEach((key) => localStorage.removeItem(key));
  } catch {}
}

function getTargetEl(selector) {
  if (!selector) return null;

  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function positionSpotlight(el, rect) {
  if (!el) return;

  if (rect) {
    const pad = 8;
    el.style.display = "block";
    el.style.left = `${Math.max(0, rect.left - pad)}px`;
    el.style.top = `${Math.max(0, rect.top - pad)}px`;
    el.style.width = `${Math.max(0, rect.width + pad * 2)}px`;
    el.style.height = `${Math.max(0, rect.height + pad * 2)}px`;
  } else {
    el.style.display = "none";
  }
}

function positionTooltip(el, rect) {
  if (!el) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 12;
  const gap = 16;
  const availableWidth = Math.max(
    0,
    viewportWidth - margin * 2
  );
  const desiredWidth = Math.min(420, availableWidth);

  el.style.width = `${desiredWidth}px`;
  el.style.maxHeight = `${Math.max(
    120,
    viewportHeight - margin * 2
  )}px`;

  const measured = el.getBoundingClientRect();
  const tooltipWidth =
    measured.width || desiredWidth || availableWidth;
  const tooltipHeight = Math.min(
    measured.height || 180,
    Math.max(120, viewportHeight - margin * 2)
  );

  let left = Math.max(
    margin,
    (viewportWidth - tooltipWidth) / 2
  );
  let top = Math.max(
    margin,
    (viewportHeight - tooltipHeight) / 2
  );

  if (rect) {
    const centeredLeft =
      rect.left + rect.width / 2 - tooltipWidth / 2;
    left = clamp(
      centeredLeft,
      margin,
      Math.max(margin, viewportWidth - tooltipWidth - margin)
    );

    const above = rect.top - gap - tooltipHeight;
    const below = rect.bottom + gap;

    if (above >= margin) {
      top = above;
    } else if (
      below + tooltipHeight <=
      viewportHeight - margin
    ) {
      top = below;
    } else {
      top = clamp(
        (viewportHeight - tooltipHeight) / 2,
        margin,
        Math.max(
          margin,
          viewportHeight - tooltipHeight - margin
        )
      );
    }
  }

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getFocusable(root) {
  if (!root) return [];

  const selector = [
    "a[href]",
    "area[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  return Array.from(root.querySelectorAll(selector)).filter(
    (el) =>
      el.offsetParent !== null ||
      el === document.activeElement
  );
}

/* ---------- UI bits ---------- */

const HelpButton = React.forwardRef(function HelpButton(
  { onClick, ariaExpanded, menuId },
  ref
) {
  return (
    <button
      ref={ref}
      className="onb-help"
      aria-label="Guide menu"
      aria-expanded={ariaExpanded}
      aria-controls={menuId}
      aria-haspopup="menu"
      onClick={onClick}
      title="Guide menu"
      type="button"
    >
      ?
    </button>
  );
});

const Menu = React.forwardRef(function Menu(
  { id, onReplay, onResetThis, onResetAll },
  ref
) {
  return (
    <div
      id={id}
      ref={ref}
      className="onb-menu"
      role="menu"
      aria-label="Guide menu"
    >
      <button
        type="button"
        role="menuitem"
        className="onb-menu-item"
        onClick={onReplay}
      >
        ▶ Replay this page
      </button>

      <button
        type="button"
        role="menuitem"
        className="onb-menu-item"
        onClick={onResetThis}
      >
        ↺ Restart this page tour
      </button>

      <hr className="onb-menu-sep" />

      <button
        type="button"
        role="menuitem"
        className="onb-menu-item danger"
        onClick={onResetAll}
      >
        ⟲ Restart all page tours
      </button>
    </div>
  );
});

/* NOTE: bottom-left placement; respects safe areas. */
const styles = `
.onb-overlay{
  position:fixed;
  inset:0;
  z-index:9999;
}
.onb-overlay--centered{
  background:rgba(10,12,16,0.62);
}
.onb-overlay--spotlight{
  background:transparent;
}
.onb-spotlight{
  position:fixed;
  pointer-events:none;
  border-radius:12px;
  box-shadow:
    0 0 0 9999px rgba(10,12,16,0.62),
    0 8px 24px rgba(0,0,0,0.45);
  outline:2px solid rgba(99,102,241,0.9);
  transition:
    left .18s ease,
    top .18s ease,
    width .18s ease,
    height .18s ease;
}
.onb-tooltip{
  position:fixed;
  max-width:420px;
  overflow-y:auto;
  background:#0b1020;
  color:#e6e8f0;
  border:1px solid rgba(99,102,241,.35);
  border-radius:14px;
  padding:14px 14px 12px 14px;
  box-shadow:0 12px 30px rgba(0,0,0,.35);
  outline:none;
}
.onb-title{
  font-weight:700;
  margin-bottom:4px;
  font-size:16px;
}
.onb-body{
  font-size:14px;
  line-height:1.4;
  opacity:.95;
}
.onb-context-note{
  margin-top:10px;
  padding:8px 10px;
  border-radius:10px;
  background:rgba(148,163,184,.12);
  border:1px solid rgba(148,163,184,.22);
  font-size:12px;
  line-height:1.4;
  color:#cbd5e1;
}
.onb-actions{
  display:flex;
  align-items:center;
  gap:8px;
  margin-top:12px;
  padding-right:48px;
}
.onb-btn{
  border-radius:10px;
  padding:8px 12px;
  border:1px solid #3b3f7a;
  background:#121635;
  color:#eef;
}
.onb-btn.ghost{
  background:transparent;
  color:#cbd5e1;
  border-color:#334155;
}
.onb-btn.primary{
  background:#4f46e5;
  border-color:#4f46e5;
  color:white;
}
.onb-btn:hover{
  filter:brightness(1.05);
}
.onb-btn:focus-visible,
.onb-help:focus-visible,
.onb-menu-item:focus-visible{
  outline:3px solid rgba(129,140,248,.8);
  outline-offset:2px;
}
.onb-grow{
  flex:1;
}
.onb-progress{
  position:absolute;
  right:12px;
  bottom:12px;
  font-size:11px;
  opacity:.72;
}

/* Help button: bottom-left */
.onb-help{
  position:fixed;
  left:max(16px, env(safe-area-inset-left));
  bottom:max(16px, env(safe-area-inset-bottom));
  z-index:9998;
  width:40px;
  height:40px;
  border-radius:9999px;
  border:1px solid #3b3f7a;
  background:#111633;
  color:#c7d2fe;
  font-weight:700;
  font-size:18px;
  display:flex;
  align-items:center;
  justify-content:center;
  box-shadow:0 8px 20px rgba(0,0,0,.35);
}
.onb-help:hover{
  filter:brightness(1.08);
}

/* Menu aligned to the left, above the button */
.onb-menu{
  position:fixed;
  left:max(16px, env(safe-area-inset-left));
  bottom:calc(max(16px, env(safe-area-inset-bottom)) + 48px);
  z-index:9999;
  width:min(240px, calc(100vw - 32px));
  background:#0b1020;
  color:#e6e8f0;
  border:1px solid rgba(99,102,241,.35);
  border-radius:12px;
  box-shadow:0 12px 30px rgba(0,0,0,.35);
  overflow:hidden;
}
.onb-menu-item{
  width:100%;
  text-align:left;
  padding:10px 12px;
  background:transparent;
  border:none;
  color:inherit;
  cursor:pointer;
}
.onb-menu-item:hover{
  background:#131a35;
}
.onb-menu-item.danger{
  color:#fecaca;
}
.onb-menu-sep{
  margin:0;
  border:0;
  border-top:1px solid #1e2748;
}

@media (max-width:480px){
  .onb-tooltip{
    border-radius:12px;
  }
  .onb-actions{
    flex-wrap:wrap;
    padding-right:0;
    padding-bottom:18px;
  }
  .onb-grow{
    display:none;
  }
  .onb-btn{
    flex:1 1 auto;
  }
  .onb-progress{
    right:12px;
    bottom:8px;
  }
}

@media (prefers-reduced-motion:reduce){
  .onb-spotlight{
    transition:none;
  }
}

@media (prefers-color-scheme:light){
  .onb-tooltip{
    background:#ffffff;
    color:#0f172a;
    border-color:rgba(99,102,241,.5);
  }
  .onb-btn{
    background:#f4f4ff;
    color:#0f172a;
    border-color:#c7d2fe;
  }
  .onb-btn.ghost{
    background:transparent;
    color:#1f2937;
    border-color:#cbd5e1;
  }
  .onb-context-note{
    background:#f8fafc;
    border-color:#e2e8f0;
    color:#475569;
  }
  .onb-menu{
    background:#ffffff;
    color:#0f172a;
    border-color:rgba(99,102,241,.5);
  }
  .onb-menu-item:hover{
    background:#eef2ff;
  }
}
`;
