import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * ConfirmProvider + useConfirm()
 * Unified, accessible confirm dialog to replace window.confirm.
 *
 * Usage (root):
 *   import { ConfirmProvider } from "./components/ui/ConfirmDialog";
 *   // <ConfirmProvider>{app}</ConfirmProvider>
 */

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState({
    title: "Please confirm",
    message: "",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    tone: "default", // "default" | "danger"
  });

  const resolverRef = useRef(null);
  const firstBtnRef = useRef(null);
  const lastBtnRef = useRef(null);
  const panelRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  const resolveAndClose = useCallback((value) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    if (typeof resolve === "function") resolve(value);
  }, []);

  const onCancel = useCallback(() => resolveAndClose(false), [resolveAndClose]);
  const onConfirm = useCallback(() => resolveAndClose(true), [resolveAndClose]);

  const confirm = useCallback((input) => {
    const raw =
      typeof input === "string"
        ? { message: input }
        : input && typeof input === "object"
        ? input
        : {};
    const isDanger =
      raw.tone === "danger" ||
      /delete|permanent|remove|cannot be undone/i.test(String(raw.message || ""));

    setOpts({
      title: raw.title || "Please confirm",
      message: String(raw.message || ""),
      confirmLabel: raw.confirmLabel || (isDanger ? "Delete" : "Confirm"),
      cancelLabel: raw.cancelLabel || "Cancel",
      tone: isDanger ? "danger" : "default",
    });

    previouslyFocusedRef.current = document.activeElement;
    setOpen(true);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  // Focus management: trap within dialog and restore on close
  useEffect(() => {
    if (!open) {
      // restore focus after close
      const el = previouslyFocusedRef.current;
      if (el && typeof el.focus === "function") {
        try {
          el.focus();
        } catch {}
      }
      return;
    }

    // autofocus first button after mount
    const t = setTimeout(() => {
      firstBtnRef.current?.focus?.();
    }, 0);

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        // only treat Enter as confirm when not typing in inputs
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (!["input", "textarea", "select"].includes(tag || "")) {
          e.preventDefault();
          onConfirm();
        }
      } else if (e.key === "Tab") {
        // simple trap between the two footer buttons
        const focusables = [firstBtnRef.current, lastBtnRef.current].filter(Boolean);
        if (focusables.length) {
          const idx = focusables.indexOf(document.activeElement);
          if (e.shiftKey) {
            if (idx <= 0) {
              e.preventDefault();
              focusables[focusables.length - 1].focus();
            }
          } else {
            if (idx === -1 || idx >= focusables.length - 1) {
              e.preventDefault();
              focusables[0].focus();
            }
          }
        }
      }
    };

    const node = panelRef.current;
    node?.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(t);
      node?.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onCancel, onConfirm]);

  const ctxValue = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={ctxValue}>
      {children}
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cnm-confirm-title"
              aria-describedby="cnm-confirm-desc"
              onMouseDown={(e) => {
                // click on the backdrop cancels
                if (e.target === e.currentTarget) onCancel();
              }}
            >
              <div
                ref={panelRef}
                className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl outline-none ring-1 ring-zinc-200 dark:ring-zinc-800"
                tabIndex={-1}
              >
                <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
                  <h2 id="cnm-confirm-title" className="text-lg font-semibold">
                    {opts.title}
                  </h2>
                </div>

                <div className="px-5 py-4">
                  <p
                    id="cnm-confirm-desc"
                    className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap"
                  >
                    {opts.message}
                  </p>
                </div>

                <div className="px-5 pb-5 flex items-center justify-end gap-2">
                  <button
                    ref={firstBtnRef}
                    type="button"
                    className="chip"
                    onClick={onCancel}
                  >
                    {opts.cancelLabel}
                  </button>
                  <button
                    ref={lastBtnRef}
                    type="button"
                    className={
                      opts.tone === "danger"
                        ? "rounded-full px-4 py-2 bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                        : "rounded-full px-4 py-2 accent-bg text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-current"
                    }
                    onClick={onConfirm}
                  >
                    {opts.confirmLabel}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fallback to native confirm if provider is missing (shouldn't happen in production).
    return async (input) => {
      const msg = typeof input === "string" ? input : String(input?.message || "");
      try {
        // eslint-disable-next-line no-alert
        return window.confirm(msg);
      } catch {
        return false;
      }
    };
  }
  return ctx.confirm;
}
