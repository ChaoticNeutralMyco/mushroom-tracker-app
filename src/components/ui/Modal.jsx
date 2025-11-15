// src/components/ui/Modal.jsx
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * CNM Modal
 * - Overlay is the ONLY scroll container (single scrollbar).
 * - Page lock is class-based on html/body/#root with a ref counter
 *   to avoid stuck locks when multiple modals mount/unmount.
 * - ESC + backdrop close, simple focus containment.
 *
 * Usage:
 * <Modal open={isOpen} onClose={...} title="New Grow">
 *   <GrowForm .../>
 * </Modal>
 */

// ---- Class-based lock with reference counting (robust across multiple modals) ----
let __modalLockCount = 0;
function addPageLock() {
  if (__modalLockCount === 0) {
    const root = document.getElementById("root");
    document.documentElement.classList.add("modal-open");
    document.body.classList.add("modal-open");
    if (root) root.classList.add("modal-open");
  }
  __modalLockCount += 1;
}
function removePageLock() {
  if (__modalLockCount > 0) {
    __modalLockCount -= 1;
    if (__modalLockCount === 0) {
      const root = document.getElementById("root");
      document.documentElement.classList.remove("modal-open");
      document.body.classList.remove("modal-open");
      if (root) root.classList.remove("modal-open");
    }
  }
}

export default function Modal({
  open = false,
  onClose = () => {},
  title,
  children,
  className = "",
  size = "xl", // md | lg | xl
  closeOnBackdrop = true,
}) {
  const overlayRef = useRef(null);
  const containerRef = useRef(null);

  // Tie page lock strictly to `open`, with cleanup on unmount.
  useEffect(() => {
    if (open) addPageLock();
    return () => {
      if (open) removePageLock();
    };
  }, [open]);

  // ESC to close + simple focus containment within the modal container.
  useEffect(() => {
    if (!open) return;

    const trapFocus = (e) => {
      if (e.key !== "Tab") return;
      const root = containerRef.current;
      if (!root) return;
      const nodes = Array.from(
        root.querySelectorAll(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || active === root) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      trapFocus(e);
    };

    document.addEventListener("keydown", onKey);
    // initial focus
    const firstFocusable = containerRef.current?.querySelector(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass =
    size === "md" ? "max-w-lg" : size === "lg" ? "max-w-3xl" : "max-w-5xl";

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-start justify-center p-4 overflow-auto"
      onMouseDown={(e) => {
        if (!closeOnBackdrop) return;
        if (e.target === overlayRef.current) onClose?.();
      }}
      role="presentation"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || "Dialog"}
        className={`w-full ${sizeClass} my-6 rounded-2xl shadow-2xl border border-zinc-200/70 dark:border-zinc-800/70 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 flex flex-col ${className}`}
        // IMPORTANT: no overflow on the content container to avoid a second scrollbar.
      >
        {(title || onClose) && (
          <div className="sticky top-0 z-10 flex items-center gap-2 px-5 py-4 border-b border-zinc-200/70 dark:border-zinc-800/70 bg-white/90 dark:bg-zinc-900/90 backdrop-blur">
            <h2 className="text-lg font-semibold flex-1">{title}</h2>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm"
            >
              Close
            </button>
          </div>
        )}

        {/* Body — overlay owns scrolling; keep this container non-scrollable */}
        <div className="p-5">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
