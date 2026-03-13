// src/components/ui/ScanBarcodeModal.jsx
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useNavigate } from "react-router-dom";

export default function ScanBarcodeModal({ open = true, onClose }) {
  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);
  const controlsRef = useRef(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const stopScanner = () => {
      try {
        controlsRef.current?.stop?.();
      } catch {}
      try {
        codeReaderRef.current?.reset?.();
      } catch {}
      controlsRef.current = null;
      codeReaderRef.current = null;
    };

    async function startScan() {
      setError("");
      setScanning(true);

      try {
        if (!videoRef.current) {
          setError("Camera element not ready.");
          return;
        }

        const codeReader = new BrowserMultiFormatReader();
        codeReaderRef.current = codeReader;

        const constraints = {
          video: { facingMode: "environment" },
          audio: false,
        };

        const controls = await codeReader.decodeFromConstraints(
          constraints,
          videoRef.current,
          (result) => {
            if (cancelled) return;
            if (!result) return;

            const rawText = String(result.getText() || "").trim();
            if (!rawText) return;

            // stop ASAP to avoid double navigations
            stopScanner();

            // 1) legacy: storage:<itemId> / library:<itemId>
            const pref = rawText.match(/^(storage|library)\s*:\s*(.+)$/i);
            if (pref) {
              const id = String(pref[2] || "").trim();
              if (id) {
                onClose?.();
                navigate(`/?tab=strains&lib=${encodeURIComponent(id)}&_=${Date.now()}`);
              }
              return;
            }

            // 2) URL: support /quick/:id, /grow/:id, /library/:id, /storage/:id, and ?lib=<id>
            try {
              const url = new URL(rawText);

              const qp = new URLSearchParams(url.search || "");
              const libQ = qp.get("lib") || qp.get("library") || qp.get("storage");
              if (libQ) {
                onClose?.();
                navigate(`/?tab=strains&lib=${encodeURIComponent(libQ)}&_=${Date.now()}`);
                return;
              }

              const pathParts = url.pathname.split("/").filter(Boolean);

              if (pathParts[0] === "quick" || pathParts[0] === "grow") {
                const growId = pathParts[1];
                if (growId) {
                  onClose?.();
                  navigate(`/quick/${growId}`);
                  return;
                }
              }

              if (pathParts[0] === "library" || pathParts[0] === "storage") {
                const libId = pathParts[1];
                if (libId) {
                  onClose?.();
                  navigate(`/?tab=strains&lib=${encodeURIComponent(libId)}&_=${Date.now()}`);
                  return;
                }
              }
            } catch {
              // not a URL
            }

            // 3) Fallback: treat as growId if it's an ID-like token
            if (/^[A-Za-z0-9_-]+$/.test(rawText)) {
              onClose?.();
              navigate(`/quick/${rawText}`);
              return;
            }
          }
        );

        controlsRef.current = controls;
      } catch (e) {
        setError(e?.message || "Camera scan failed.");
      } finally {
        setScanning(false);
      }
    }

    startScan();

    return () => {
      cancelled = true;
      stopScanner();
      setScanning(false);
    };
  }, [open, navigate, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-lg">
        <div className="flex items-center justify-between border-b p-3">
          <div className="font-semibold">Scan Label</div>
          <button
            className="rounded-lg p-2 hover:bg-zinc-100"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-3 space-y-3">
          <div className="rounded-lg overflow-hidden bg-black">
            <video
              ref={videoRef}
              className="w-full h-64 object-cover"
              muted
              playsInline
            />
          </div>

          {scanning ? (
            <div className="text-sm text-zinc-600">Starting camera…</div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          ) : (
            <div className="text-xs text-zinc-500">
              Scans grow labels (<span className="font-mono">/quick/&lt;id&gt;</span>) and stored item labels (
              <span className="font-mono">?tab=strains&amp;lib=&lt;id&gt;</span>). Also supports legacy{" "}
              <span className="font-mono">storage:&lt;id&gt;</span>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
