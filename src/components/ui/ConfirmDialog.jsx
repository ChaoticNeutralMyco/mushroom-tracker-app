// src/components/ui/ConfirmDialog.jsx
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

const ConfirmContext = createContext(null);

function normalizeInput(raw, fallbackKind = "confirm") {
  const base =
    typeof raw === "string"
      ? { message: raw }
      : raw && typeof raw === "object"
        ? raw
        : {};

  const inferredDanger =
    base.tone === "danger" ||
    /delete|permanent|remove|cannot be undone/i.test(String(base.message || ""));

  const kind = base.kind || fallbackKind;

  return {
    kind,
    title:
      base.title ||
      (kind === "prompt"
        ? "Enter a value"
        : kind === "alert"
          ? "Notice"
          : "Please confirm"),
    message: String(base.message || ""),
    confirmLabel:
      base.confirmLabel ||
      (kind === "alert" ? "OK" : inferredDanger ? "Delete" : "Confirm"),
    cancelLabel: kind === "alert" ? "" : base.cancelLabel || "Cancel",
    tone: inferredDanger ? "danger" : "default",
    inputLabel: String(base.inputLabel || "Value"),
    inputPlaceholder: String(base.inputPlaceholder || ""),
    inputType: String(base.inputType || "text"),
    defaultValue:
      base.defaultValue === undefined || base.defaultValue === null
        ? ""
        : String(base.defaultValue),
    validate: typeof base.validate === "function" ? base.validate : null,
    min: base.min,
    max: base.max,
    step: base.step,
  };
}

export function ConfirmProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState(() => normalizeInput({}, "confirm"));
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");

  const resolverRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const cancelBtnRef = useRef(null);
  const confirmBtnRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  const closeWith = useCallback((value) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    setInputValue("");
    setInputError("");
    if (typeof resolve === "function") resolve(value);
  }, []);

  const openRequest = useCallback((input, fallbackKind = "confirm") => {
    const next = normalizeInput(input, fallbackKind);
    setOpts(next);
    setInputValue(next.defaultValue || "");
    setInputError("");
    previouslyFocusedRef.current = document.activeElement;
    setOpen(true);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const confirm = useCallback((input) => openRequest(input, "confirm"), [openRequest]);
  const alert = useCallback(async (input) => {
    await openRequest(input, "alert");
    return true;
  }, [openRequest]);
  const prompt = useCallback((input) => openRequest(input, "prompt"), [openRequest]);

  const onCancel = useCallback(() => {
    if (opts.kind === "prompt") {
      closeWith(null);
      return;
    }
    closeWith(false);
  }, [closeWith, opts.kind]);

  const onConfirm = useCallback(() => {
    if (opts.kind === "prompt") {
      const value = String(inputValue ?? "");
      if (typeof opts.validate === "function") {
        const result = opts.validate(value);
        if (result !== true && result) {
          setInputError(String(result));
          return;
        }
      }
      closeWith(value);
      return;
    }
    closeWith(true);
  }, [closeWith, inputValue, opts]);

  useEffect(() => {
    if (!open) {
      const el = previouslyFocusedRef.current;
      if (el && typeof el.focus === "function") {
        try {
          el.focus();
        } catch {}
      }
      return;
    }

    const t = setTimeout(() => {
      if (opts.kind === "prompt") {
        inputRef.current?.focus?.();
        inputRef.current?.select?.();
        return;
      }
      if (opts.kind === "alert") {
        confirmBtnRef.current?.focus?.();
        return;
      }
      cancelBtnRef.current?.focus?.();
    }, 0);

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === "Enter") {
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (opts.kind === "prompt") {
          if (tag !== "textarea") {
            e.preventDefault();
            onConfirm();
          }
          return;
        }
        if (!["input", "textarea", "select"].includes(tag || "")) {
          e.preventDefault();
          onConfirm();
        }
        return;
      }

      if (e.key === "Tab") {
        const focusables = [inputRef.current, cancelBtnRef.current, confirmBtnRef.current].filter(
          Boolean
        );
        if (!focusables.length) return;

        const idx = focusables.indexOf(document.activeElement);
        if (e.shiftKey) {
          if (idx <= 0) {
            e.preventDefault();
            focusables[focusables.length - 1].focus();
          }
        } else if (idx === -1 || idx >= focusables.length - 1) {
          e.preventDefault();
          focusables[0].focus();
        }
      }
    };

    const node = panelRef.current;
    node?.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(t);
      node?.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onCancel, onConfirm, opts.kind]);

  const ctxValue = useMemo(() => {
    const callable = Object.assign((input) => confirm(input), {
      alert,
      prompt,
    });
    return { confirm: callable };
  }, [alert, confirm, prompt]);

  const showCancel = opts.kind !== "alert";

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

                <div className="px-5 py-4 space-y-3">
                  <p
                    id="cnm-confirm-desc"
                    className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap"
                  >
                    {opts.message}
                  </p>

                  {opts.kind === "prompt" && (
                    <div>
                      <label className="block text-sm font-medium mb-1">{opts.inputLabel}</label>
                      <input
                        ref={inputRef}
                        type={opts.inputType}
                        min={opts.min}
                        max={opts.max}
                        step={opts.step}
                        value={inputValue}
                        onChange={(e) => {
                          setInputValue(e.target.value);
                          if (inputError) setInputError("");
                        }}
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
                        placeholder={opts.inputPlaceholder}
                      />
                      {inputError ? (
                        <div className="mt-2 text-xs text-rose-600 dark:text-rose-300">
                          {inputError}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="px-5 pb-5 flex items-center justify-end gap-2">
                  {showCancel ? (
                    <button
                      ref={cancelBtnRef}
                      type="button"
                      className="chip"
                      onClick={onCancel}
                    >
                      {opts.cancelLabel}
                    </button>
                  ) : null}
                  <button
                    ref={confirmBtnRef}
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
    const fallback = async (input) => {
      const msg = typeof input === "string" ? input : String(input?.message || "");
      try {
        return window.confirm(msg);
      } catch {
        return false;
      }
    };
    fallback.alert = async (input) => {
      const msg = typeof input === "string" ? input : String(input?.message || "");
      try {
        window.alert(msg);
      } catch {}
      return true;
    };
    fallback.prompt = async (input) => {
      const raw = typeof input === "string" ? { message: input } : input || {};
      const msg = String(raw.message || raw.title || "Enter a value");
      try {
        return window.prompt(msg, raw.defaultValue == null ? "" : String(raw.defaultValue));
      } catch {
        return null;
      }
    };
    return fallback;
  }
  return ctx.confirm;
}

export default ConfirmProvider;
export { ConfirmProvider as ConfirmDialog };
