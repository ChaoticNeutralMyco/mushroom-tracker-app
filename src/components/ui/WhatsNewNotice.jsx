// src/components/ui/WhatsNewNotice.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  APP_VERSION,
  WHATS_NEW_EVENT,
  getWhatsNewRelease,
  markWhatsNewSeen,
  shouldShowWhatsNew,
} from "../../lib/whatsNew.js";

const AUTO_OPEN_DELAY_MS = 900;

export default function WhatsNewNotice({ uid }) {
  const release = useMemo(() => getWhatsNewRelease(APP_VERSION), []);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  const lastFocusRef = useRef(null);

  useEffect(() => {
    if (!uid) {
      setOpen(false);
      return undefined;
    }

    if (!shouldShowWhatsNew({ uid, version: APP_VERSION })) {
      return undefined;
    }

    let cancelled = false;
    let observer = null;

    const tryOpen = () => {
      if (cancelled) return false;

      if (!shouldShowWhatsNew({ uid, version: APP_VERSION })) {
        observer?.disconnect();
        observer = null;
        return true;
      }

      // The guided tour auto-opens on first page visits. Do not stack two
      // dialogs on top of each other; open release notes after the tour closes.
      if (document.querySelector(".onb-overlay")) return false;

      setOpen(true);
      observer?.disconnect();
      observer = null;
      return true;
    };

    const timer = window.setTimeout(() => {
      if (tryOpen()) return;

      if (typeof MutationObserver === "function") {
        observer = new MutationObserver(() => {
          tryOpen();
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }
    }, AUTO_OPEN_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [uid]);

  useEffect(() => {
    const handleOpenRequest = () => {
      setOpen(true);
    };

    window.addEventListener(WHATS_NEW_EVENT, handleOpenRequest);
    return () =>
      window.removeEventListener(WHATS_NEW_EVENT, handleOpenRequest);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const appShell = document.getElementById("app-shell");
    const previousAriaHidden = appShell?.getAttribute("aria-hidden");
    const previouslyInert = appShell?.hasAttribute("inert") === true;
    lastFocusRef.current = document.activeElement;

    if (appShell) {
      appShell.setAttribute("aria-hidden", "true");
      appShell.setAttribute("inert", "");
    }

    const focusTimer = window.setTimeout(() => {
      const focusable = getFocusable(dialogRef.current);
      (focusable[0] || dialogRef.current)?.focus?.({ preventScroll: true });
    }, 0);

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRemember();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusable(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus?.();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);

      if (appShell) {
        if (previousAriaHidden === null) {
          appShell.removeAttribute("aria-hidden");
        } else {
          appShell.setAttribute("aria-hidden", previousAriaHidden);
        }

        if (!previouslyInert) {
          appShell.removeAttribute("inert");
        }
      }

      lastFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, uid]);

  const closeAndRemember = () => {
    markWhatsNewSeen({ uid, version: APP_VERSION });
    setOpen(false);
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10020] grid place-items-center overflow-y-auto bg-black/60 p-4"
      role="presentation"
      data-testid="whats-new-overlay"
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        aria-describedby="whats-new-summary"
        tabIndex={-1}
        className="my-auto w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--_accent-rgb))]">
              Version {release.version}
            </p>
            <h2 id="whats-new-title" className="mt-1 text-2xl font-bold">
              {release.title}
            </h2>
          </div>

          <button
            type="button"
            className="chip !px-2 !py-1"
            onClick={closeAndRemember}
            aria-label="Close What’s New"
          >
            ×
          </button>
        </div>

        <p
          id="whats-new-summary"
          className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300"
        >
          {release.summary}
        </p>

        <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
          {release.items.map((item) => (
            <li key={item} className="flex gap-3">
              <span
                className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[rgb(var(--_accent-rgb))]"
                aria-hidden="true"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className="btn btn-accent"
            onClick={closeAndRemember}
            autoFocus
          >
            Got it
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function getFocusable(root) {
  if (!root) return [];

  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  return Array.from(root.querySelectorAll(selector)).filter(
    (element) =>
      element.offsetParent !== null || element === document.activeElement
  );
}
