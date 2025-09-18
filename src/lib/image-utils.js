// Lightweight in-browser image processing: EXIF-safe decode, compress, and thumbnail.
// No extra deps. Outputs JPEG blobs (EXIF stripped).

export async function decodeBitmap(file) {
  if ("createImageBitmap" in window) {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fitWithin(w, h, maxDim) {
  if (w <= maxDim && h <= maxDim) return { w, h };
  const s = Math.min(maxDim / w, maxDim / h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

function makeCanvas(width, height) {
  if ("OffscreenCanvas" in window) return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  return c;
}

async function drawToBlob(src, w, h, mime = "image/jpeg", q = 0.82) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: mime, quality: q });
  return new Promise((res) => canvas.toBlob((b) => res(b), mime, q));
}

/** Compress + thumbnail a File */
export async function compressAndThumb(file, { maxDim = 1600, thumbDim = 320, quality = 0.82 } = {}) {
  const bmp = await decodeBitmap(file);
  const width = bmp.width || bmp.drawingBufferWidth || bmp.canvas?.width || 0;
  const height = bmp.height || bmp.drawingBufferHeight || bmp.canvas?.height || 0;

  const main = fitWithin(width, height, maxDim);
  const th = fitWithin(width, height, thumbDim);

  const [originalBlob, thumbBlob] = await Promise.all([
    drawToBlob(bmp, main.w, main.h, "image/jpeg", quality),
    drawToBlob(bmp, th.w, th.h, "image/jpeg", Math.min(0.76, quality)),
  ]);

  return { originalBlob, thumbBlob, width: main.w, height: main.h };
}
