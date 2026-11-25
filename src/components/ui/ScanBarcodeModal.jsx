// src/components/ui/ScanBarcodeModal.jsx
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useNavigate } from "react-router";

export default function ScanBarcodeModal({ open = true, onClose }) {
  const videoRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let handled = false;
    let controls = null;
    const video = videoRef.current;
    const codeReader = new BrowserMultiFormatReader();

    const stopScanner = (activeControls = controls) => {
      try {
        activeControls?.stop?.();
      } catch {}
      try {
        codeReader.reset?.();
      } catch {}
      try {
        video?.srcObject?.getTracks?.().forEach((track) => track.stop());
        if (video) {
          video.pause();
          video.srcObject = null;
        }
      } catch {}
      controls = null;
    };

    const finishScan = (destination, activeControls) => {
      if (cancelled || handled) return;
      handled = true;
      stopScanner(activeControls);
      setScanning(false);
      onCloseRef.current?.();
      navigate(destination);
    };

    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelled = true;
      stopScanner();
      onCloseRef.current?.();
    };

    async function startScan() {
      setError("");
      setScanning(true);

      try {
        if (!video) {
          setError("Camera unavailable.");
          return;
        }

        const scannerControls = await codeReader.decodeFromConstraints(
          { video: { facingMode: "environment" }, audio: false },
          video,
          (result, scanError, activeControls) => {
            if (cancelled || handled || !result) return;
            const rawText = String(result.getText() || "").trim();
            if (!rawText) return;

            // Legacy storage and library labels.
            const pref = rawText.match(/^(storage|library)\s*:\s*(.+)$/i);
            if (pref) {
              const id = String(pref[2] || "").trim();
              if (id) {
                finishScan(`/?tab=strains&lib=${encodeURIComponent(id)}&_=${Date.now()}`, activeControls);
              }
              return;
            }

            // URL-based grow and stored-item labels.
            try {
              const url = new URL(rawText);
              const qp = new URLSearchParams(url.search || "");
              const libQ = qp.get("lib") || qp.get("library") || qp.get("storage");
              if (libQ) {
                finishScan(`/?tab=strains&lib=${encodeURIComponent(libQ)}&_=${Date.now()}`, activeControls);
                return;
              }

              const pathParts = url.pathname.split("/").filter(Boolean);
              if (pathParts[0] === "quick" || pathParts[0] === "grow") {
                const growId = pathParts[1];
                if (growId) {
                  finishScan(`/quick/${growId}`, activeControls);
                  return;
                }
              }

              if (pathParts[0] === "library" || pathParts[0] === "storage") {
                const libId = pathParts[1];
                if (libId) {
                  finishScan(`/?tab=strains&lib=${encodeURIComponent(libId)}&_=${Date.now()}`, activeControls);
                  return;
                }
              }
            } catch {
              // Continue checking non-URL labels.
            }

            // Fallback for plain grow IDs.
            if (/^[A-Za-z0-9_-]+$/.test(rawText)) {
              finishScan(`/quick/${rawText}`, activeControls);
            }
          }
        );

        // Close any late-starting reader after the modal is dismissed.
        if (cancelled || handled) {
          try {
            scannerControls?.stop?.();
          } catch {}
          return;
        }
        controls = scannerControls;
      } catch (e) {
        if (!cancelled && !handled) {
          stopScanner();
          setError(e?.message || "Unable to start the camera.");
        }
      } finally {
        if (!cancelled && !handled) setScanning(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    startScan();

    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleEscape);
      stopScanner();
    };
  }, [open, navigate]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Scan Label"
    >
      <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <h2 className="text-lg font-semibold text-white">Scan Label</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-600 bg-zinc-800 text-white hover:bg-zinc-700 active:bg-zinc-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="relative aspect-[4/3] max-h-[45dvh] overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-contain"
              autoPlay
              muted
              playsInline
            />

            {!error && !scanning && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative aspect-square w-[58%] max-h-[78%]">
                  <div className="absolute left-0 top-0 h-7 w-7 rounded-tl-lg border-l-[3px] border-t-[3px] border-white" />
                  <div className="absolute right-0 top-0 h-7 w-7 rounded-tr-lg border-r-[3px] border-t-[3px] border-white" />
                  <div className="absolute bottom-0 left-0 h-7 w-7 rounded-bl-lg border-b-[3px] border-l-[3px] border-white" />
                  <div className="absolute bottom-0 right-0 h-7 w-7 rounded-br-lg border-b-[3px] border-r-[3px] border-white" />
                </div>
              </div>
            )}

            {scanning && !error && (
              <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <span className="text-sm text-white">Starting camera...</span>
              </div>
            )}
          </div>

          {error ? (
            <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950 px-3 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : (
            <p className="text-center text-sm text-zinc-300">Align the label within the frame.</p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300"
          >
            <X className="h-5 w-5" />
            Close Scanner
          </button>
        </div>
      </div>
    </div>
  );
}
