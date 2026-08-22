// src/lib/quick-actions.js

export function buildQuickPhotoUploadRequest({ growId, file, caption } = {}) {
  const normalizedGrowId = String(growId || "").trim();

  if (!normalizedGrowId) {
    return {
      ok: false,
      error: "Choose an active grow before uploading a photo.",
    };
  }

  if (!file) {
    return {
      ok: false,
      error: "Choose a photo before uploading.",
    };
  }

  return {
    ok: true,
    growId: normalizedGrowId,
    file,
    caption: String(caption || "").trim(),
  };
}

export function getQuickPhotoFileLabel(file) {
  if (!file) return "No photo selected";
  return String(file.name || "Selected photo");
}
