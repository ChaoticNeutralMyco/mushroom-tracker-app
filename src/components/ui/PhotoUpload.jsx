// src/components/ui/PhotoUpload.jsx
import React, { useMemo, useState } from "react";

/**
 * PhotoUpload – prop-driven
 *
 * Props:
 *  - grows: Array<{ id, strain, abbreviation?, ... }>
 *  - photosByGrow?: Record<growId, Array<{ id, url, caption, timestamp }>>  (optional)
 *  - onUpload: (growId: string, file: File, caption: string) => Promise<void>
 */

// Reasonable defaults for photos from phones
const MAX_DIMENSION = 1600; // px (longest side)
const JPEG_QUALITY = 0.82;  // 0..1

async function blobToFile(blob, name, type) {
  return new File([blob], name, { type, lastModified: Date.now() });
}

function extOf(name = "") {
  const m = String(name).match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function baseName(name = "") {
  return String(name).replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Compress an image using canvas.
 * - Respects EXIF orientation (via createImageBitmap options when available)
 * - Scales so the longest side <= MAX_DIMENSION
 * - Encodes to JPEG at JPEG_QUALITY by default
 * Returns a File (compressed or original if not beneficial)
 */
async function compressImageIfNeeded(file, {
  maxDimension = MAX_DIMENSION,
  quality = JPEG_QUALITY,
} = {}) {
  // Guard rails: only images, skip SVG
  if (!file || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file;
  }

  // If already small (< 300KB), skip
  if (file.size <= 300 * 1024) {
    return file;
  }

  // Decode image
  let bmp, imgEl;
  try {
    if ("createImageBitmap" in window) {
      // Try to respect EXIF orientation
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    }
  } catch {
    /* fall back to <img> below */
  }

  // Get size
  let width, height;
  if (bmp) {
    width = bmp.width;
    height = bmp.height;
  } else {
    // Fallback to <img> decode
    const url = URL.createObjectURL(file);
    try {
      imgEl = new Image();
      imgEl.decoding = "async";
      imgEl.src = url;
      await imgEl.decode();
      width = imgEl.naturalWidth || imgEl.width;
      height = imgEl.naturalHeight || imgEl.height;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  if (!width || !height) return file;

  // Compute target dimensions
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  // If no resize and we just want to re-encode, keep going (often still smaller for huge JPEGs)
  // Create canvas and draw
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { alpha: false });

  if (bmp) {
    ctx.drawImage(bmp, 0, 0, targetW, targetH);
    bmp.close?.();
  } else {
    ctx.drawImage(imgEl, 0, 0, targetW, targetH);
  }

  // Encode to JPEG
  const outType = "image/jpeg";
  const outBlob = await new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob || null),
      outType,
      quality
    );
  });

  if (!outBlob) return file;

  // If compression didn't help, keep the original
  if (outBlob.size >= file.size) {
    return file;
  }

  const originalBase = baseName(file.name) || "photo";
  const newName = `${originalBase}__${targetW}x${targetH}_q${Math.round(
    quality * 100
  )}.jpg`;
  return blobToFile(outBlob, newName, outType);
}

export default function PhotoUpload({
  grows = [],
  photosByGrow = {},
  onUpload,
}) {
  const [selectedGrow, setSelectedGrow] = useState(grows?.[0]?.id || "");
  const [image, setImage] = useState(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewInfo, setPreviewInfo] = useState(null); // {origKB, estKB, dims?}

  const photos = photosByGrow?.[selectedGrow] || [];

  const selectedGrowLabel = useMemo(() => {
    const g = grows.find((x) => x.id === selectedGrow);
    if (!g) return "";
    return `${g.strain} (${g.abbreviation || (g.id || "").slice(0, 6)})`;
  }, [grows, selectedGrow]);

  const handleFilePick = async (file) => {
    setImage(file || null);
    setPreviewInfo(null);
    if (!file) return;
    try {
      // Peek at dimensions (cheap) to show a rough estimate
      let width = 0,
        height = 0;
      if ("createImageBitmap" in window) {
        try {
          const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
          width = bmp.width;
          height = bmp.height;
          bmp.close?.();
        } catch {
          /* ignore */
        }
      }
      if (!width || !height) {
        const url = URL.createObjectURL(file);
        try {
          const img = new Image();
          img.decoding = "async";
          img.src = url;
          await img.decode();
          width = img.naturalWidth || img.width;
          height = img.naturalHeight || img.height;
        } catch {
          /* ignore */
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      const scale = Math.min(1, MAX_DIMENSION / Math.max(width || 0, height || 0));
      const tW = Math.round((width || 0) * scale);
      const tH = Math.round((height || 0) * scale);

      const origKB = Math.round(file.size / 1024);
      // Rough estimate: JPEG ~ quality * pixels ratio vs original
      const estKB =
        scale < 1 || file.type !== "image/jpeg"
          ? Math.max(60, Math.round((tW * tH * (JPEG_QUALITY * 0.25)) / 10))
          : Math.round(origKB * 0.85);

      setPreviewInfo({
        origKB,
        estKB,
        dims: width && height ? `${width}×${height} → ${tW}×${tH}` : null,
      });
    } catch {
      // ignore preview errors
    }
  };

  const handleUpload = async () => {
    if (!onUpload || !selectedGrow || !image) return;
    setBusy(true);
    try {
      const optimized = await compressImageIfNeeded(image);
      await onUpload(selectedGrow, optimized, caption || "");
      setImage(null);
      setCaption("");
      setPreviewInfo(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
      <div className="grid gap-3 sm:grid-cols-3">
        <select
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={selectedGrow}
          onChange={(e) => setSelectedGrow(e.target.value)}
        >
          {grows.map((g) => (
            <option key={g.id} value={g.id}>
              {g.strain} ({g.abbreviation || g.id.slice(0, 6)})
            </option>
          ))}
        </select>

        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          onChange={(e) => handleFilePick(e.target.files?.[0] || null)}
        />

        <input
          type="text"
          placeholder="Caption (optional)"
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />

        <button
          onClick={handleUpload}
          className="sm:col-span-3 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          disabled={!image || !selectedGrow || busy}
        >
          {busy ? "Uploading…" : "Upload Photo"}
        </button>
      </div>

      {/* Tiny hint showing compression plan */}
      {image && (
        <div className="text-xs text-gray-600 dark:text-gray-300">
          <div>
            <span className="font-medium">Selected:</span>{" "}
            {image.name} ({Math.round(image.size / 1024)} KB)
          </div>
          {previewInfo?.dims && <div>Resize: {previewInfo.dims}</div>}
          {previewInfo?.estKB && (
            <div>
              Estimated upload size: ~{previewInfo.estKB} KB{" "}
              <span className="opacity-70">(was {previewInfo.origKB} KB)</span>
            </div>
          )}
          <div>
            Destination grow: <span className="font-medium">{selectedGrowLabel}</span>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {photos.map((p) => (
          <figure
            key={p.id}
            className="rounded-lg overflow-hidden bg-gray-100 dark:bg-zinc-800"
            title={p.caption || ""}
          >
            <img src={p.url} alt={p.caption || ""} className="w-full h-40 object-cover" />
            <figcaption className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
              <div className="font-medium truncate">{p.caption || "—"}</div>
              <div className="text-xs text-gray-500">
                {p.timestamp ? new Date(p.timestamp).toLocaleString() : ""}
              </div>
            </figcaption>
          </figure>
        ))}
        {photos.length === 0 && (
          <div className="text-sm text-gray-600 dark:text-gray-300">
            No photos for this grow yet.
          </div>
        )}
      </div>
    </div>
  );
}
