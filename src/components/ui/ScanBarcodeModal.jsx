import React, { useEffect, useRef } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useNavigate } from "react-router-dom";

export default function ScanBarcodeModal({ onClose }) {
  const videoRef = useRef(null);
  const codeReader = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    codeReader.current = new BrowserMultiFormatReader();

    codeReader.current
      .decodeOnceFromVideoDevice(undefined, videoRef.current)
      .then((result) => {
        const growId = result?.text;
        if (growId) {
          onClose(); // close modal
          navigate(`/grow/${growId}`);
        }
      })
      .catch((err) => {
        console.error("Scan error", err);
        onClose(); // fallback
      });

    return () => {
      // ✅ Proper cleanup — stop camera and decoding
      try {
        codeReader.current?.stopContinuousDecode?.();
      } catch (err) {
        console.warn("Scanner cleanup failed", err);
      }
    };
  }, [navigate, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-60 flex items-center justify-center">
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl shadow max-w-sm w-full space-y-4 relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-zinc-500 hover:text-red-500 text-lg"
        >
          ✖
        </button>
        <h2 className="text-lg font-bold text-center text-zinc-800 dark:text-white">
          📷 Scan Grow Barcode
        </h2>
        <video ref={videoRef} className="w-full rounded shadow" />
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          Point at a barcode to view grow details.
        </p>
      </div>
    </div>
  );
}
