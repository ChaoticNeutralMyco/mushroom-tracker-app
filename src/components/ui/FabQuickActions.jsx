// src/components/ui/FabQuickActions.jsx
import React, { useMemo, useRef, useState } from "react";
import {
  buildQuickPhotoUploadRequest,
  getQuickPhotoFileLabel,
} from "../../lib/quick-actions";

/**
 * Floating Quick Actions (desktop + Android)
 * Props:
 *  - grows: Array of active grows (id, abbreviation/subName/strain shown)
 *  - onNewGrow: () => void
 *  - onLogStatus: (growId: string) => void
 *  - onUploadPhoto: (growId: string, file: File, caption?: string) => Promise<void> | void
 */
export default function FabQuickActions({
  grows = [],
  onNewGrow,
  onLogStatus,
  onUploadPhoto,
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(null); // null | "log" | "photo"
  const [selGrowId, setSelGrowId] = useState(grows[0]?.id || "");
  const [caption, setCaption] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef(null);

  const options = useMemo(
    () =>
      (Array.isArray(grows) ? grows : []).map((g) => ({
        id: g.id,
        label:
          g.abbreviation ||
          g.subName ||
          g.strain ||
          g.recipeName ||
          g.id?.slice(0, 6) ||
          "Grow",
      })),
    [grows]
  );

  React.useEffect(() => {
    const selectionStillExists = options.some((option) => option.id === selGrowId);
    if (!selectionStillExists) setSelGrowId(options[0]?.id || "");
  }, [options, selGrowId]);

  const resetPhotoForm = () => {
    setCaption("");
    setSelectedFile(null);
    setUploadError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const closeAll = () => {
    if (uploading) return;
    setPanel(null);
    setOpen(false);
    resetPhotoForm();
  };

  const handleNew = () => {
    onNewGrow?.();
    closeAll();
  };

  const handleLog = () => {
    if (!selGrowId) return;
    onLogStatus?.(selGrowId);
    closeAll();
  };

  const handlePickFile = (event) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setUploadError("");
  };

  const handleUploadPhoto = async () => {
    const request = buildQuickPhotoUploadRequest({
      growId: selGrowId,
      file: selectedFile,
      caption,
    });

    if (!request.ok) {
      setUploadError(request.error);
      return;
    }

    if (typeof onUploadPhoto !== "function") {
      setUploadError("Photo upload is not available right now.");
      return;
    }

    setUploading(true);
    setUploadError("");
    try {
      await onUploadPhoto(request.growId, request.file, request.caption);
      setPanel(null);
      setOpen(false);
      resetPhotoForm();
    } catch (error) {
      console.error("Upload failed:", error);
      setUploadError(error?.message || "Photo upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const togglePanel = (nextPanel) => {
    if (uploading) return;
    setPanel((current) => (current === nextPanel ? null : nextPanel));
    setUploadError("");
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 select-none">
      {open && (
        <div className="mb-3 w-72 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
            <div className="text-sm font-semibold">Quick actions</div>
            <button
              type="button"
              className="px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
              onClick={closeAll}
              disabled={uploading}
              aria-label="Close quick actions"
            >
              ✕
            </button>
          </div>

          <div className="p-3 space-y-3">
            <button
              type="button"
              className="w-full px-3 py-2 rounded-xl accent-bg text-sm font-medium"
              onClick={handleNew}
            >
              + New Grow
            </button>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                className="w-full px-3 py-2 text-left rounded-t-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-sm font-medium"
                onClick={() => togglePanel("log")}
                aria-expanded={panel === "log"}
              >
                Log Status
              </button>
              {panel === "log" && (
                <div className="px-3 pb-3 space-y-2">
                  <select
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                    value={selGrowId}
                    onChange={(event) => setSelGrowId(event.target.value)}
                    disabled={!options.length}
                  >
                    {!options.length && <option value="">No active grows</option>}
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-50"
                    onClick={handleLog}
                    disabled={!selGrowId}
                  >
                    Open Logger
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                className="w-full px-3 py-2 text-left rounded-t-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-sm font-medium"
                onClick={() => togglePanel("photo")}
                aria-expanded={panel === "photo"}
              >
                Upload Photo
              </button>
              {panel === "photo" && (
                <div className="px-3 pb-3 space-y-2">
                  <select
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                    value={selGrowId}
                    onChange={(event) => setSelGrowId(event.target.value)}
                    disabled={!options.length || uploading}
                  >
                    {!options.length && <option value="">No active grows</option>}
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    placeholder="Caption (optional)"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                    disabled={uploading}
                  />

                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="block w-full text-sm file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-zinc-200 dark:file:bg-zinc-800 file:text-zinc-900 dark:file:text-zinc-100 file:hover:opacity-90 disabled:opacity-50"
                    onChange={handlePickFile}
                    disabled={!options.length || uploading}
                  />

                  <div className="text-xs text-zinc-500 dark:text-zinc-400 break-all">
                    {getQuickPhotoFileLabel(selectedFile)}
                  </div>

                  {uploadError ? (
                    <div
                      className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-200"
                      role="alert"
                    >
                      {uploadError}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="w-full px-3 py-2 rounded-lg accent-bg text-sm font-medium disabled:opacity-50"
                    onClick={handleUploadPhoto}
                    disabled={!selGrowId || !selectedFile || uploading}
                  >
                    {uploading ? "Uploading…" : "Upload selected photo"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        data-tour="quick-actions"
        onClick={() => {
          if (!uploading) setOpen((current) => !current);
        }}
        className="h-14 w-14 rounded-full shadow-xl accent-bg text-xl grid place-items-center"
        aria-label={open ? "Close quick actions" : "Open quick actions"}
        aria-expanded={open}
      >
        {open ? "–" : "＋"}
      </button>
    </div>
  );
}
