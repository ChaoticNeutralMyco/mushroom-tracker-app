import React, { useMemo, useRef, useState } from "react";

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

  // Keep selection stable as list updates
  React.useEffect(() => {
    if (!selGrowId && options[0]?.id) setSelGrowId(options[0].id);
  }, [options, selGrowId]);

  const closeAll = () => {
    setPanel(null);
    setOpen(false);
    setCaption("");
    if (fileRef.current) fileRef.current.value = "";
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

  const handlePickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selGrowId) return;
    try {
      await onUploadPhoto?.(selGrowId, file, caption);
      closeAll();
    } catch (err) {
      console.error("Upload failed:", err);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 select-none">
      {/* Panels */}
      {open && (
        <div className="mb-3 w-72 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
            <div className="text-sm font-semibold">Quick actions</div>
            <button
              className="px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Action list */}
          <div className="p-3 space-y-3">
            {/* New Grow */}
            <button
              className="w-full px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 text-sm font-medium"
              onClick={handleNew}
            >
              + New Grow
            </button>

            {/* Log Status */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
              <button
                className="w-full px-3 py-2 text-left rounded-t-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-sm font-medium"
                onClick={() => setPanel(panel === "log" ? null : "log")}
              >
                Log Status
              </button>
              {panel === "log" && (
                <div className="px-3 pb-3 space-y-2">
                  <select
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                    value={selGrowId}
                    onChange={(e) => setSelGrowId(e.target.value)}
                  >
                    {options.length === 0 && <option>No active grows</option>}
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-50"
                    onClick={handleLog}
                    disabled={!selGrowId}
                  >
                    Open Logger
                  </button>
                </div>
              )}
            </div>

            {/* Upload Photo */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
              <button
                className="w-full px-3 py-2 text-left rounded-t-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-sm font-medium"
                onClick={() => setPanel(panel === "photo" ? null : "photo")}
              >
                Upload Photo
              </button>
              {panel === "photo" && (
                <div className="px-3 pb-3 space-y-2">
                  <select
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                    value={selGrowId}
                    onChange={(e) => setSelGrowId(e.target.value)}
                  >
                    {options.length === 0 && <option>No active grows</option>}
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="block w-full text-sm file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-zinc-200 dark:file:bg-zinc-800 file:text-zinc-900 dark:file:text-zinc-100 file:hover:opacity-90"
                    onChange={handlePickFile}
                  />
                  <input
                    type="text"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Caption (optional)"
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main FAB */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-14 w-14 rounded-full shadow-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xl grid place-items-center"
        aria-label="Open quick actions"
      >
        {open ? "–" : "＋"}
      </button>
    </div>
  );
}
