import React, { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];
const STATUSES = ["Active", "Archived", "Contaminated"];

/**
 * QuickEdit (prop-driven; no Firestore reads)
 *
 * Props:
 * - grows
 * - notesByGrowStage
 * - photosByGrowStage
 * - onUpdateStage(growId, stage)
 * - onUpdateStatus(growId, status)
 * - onAddNote(growId, stage, text)
 * - onUploadStagePhoto(growId, stage, file, caption)
 */
export default function QuickEdit({
  grows = [],
  notesByGrowStage = {},
  photosByGrowStage = {},
  onUpdateStage,
  onUpdateStatus,
  onAddNote,
  onUploadStagePhoto,
}) {
  const { growId } = useParams();
  const grow = useMemo(
    () => (Array.isArray(grows) ? grows.find((g) => g.id === growId) : null),
    [grows, growId]
  );

  const [stage, setStage] = useState(grow?.stage || STAGES[0]);
  const [status, setStatus] = useState(grow?.status || "Active");
  const [activeTab, setActiveTab] = useState(stage);

  // --- Compatibility helpers: handle either nested-object or Map<string,"growId::Stage"> shapes
  const pickStageItems = (byGrowStage, id, stg) => {
    if (!byGrowStage || !id || !stg) return [];
    // If it's a Map keyed by `${id}::${stg}`
    if (typeof byGrowStage.get === "function") {
      const key = `${id}::${stg}`;
      const list = byGrowStage.get(key) ?? byGrowStage.get(`${id}::General`);
      return Array.isArray(list) ? list : [];
    }
    // If it's a nested object shape: { [id]: { [stage]: [...] } }
    const bucket = byGrowStage[id] || {};
    const list = bucket[stg] ?? bucket.General;
    return Array.isArray(list) ? list : [];
  };

  const notes = pickStageItems(notesByGrowStage, growId, activeTab);
  const photos = pickStageItems(photosByGrowStage, growId, activeTab);

  const [noteText, setNoteText] = useState("");
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");

  if (!grow) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-700 p-6 bg-white dark:bg-zinc-900">
          <div className="text-lg font-semibold mb-2">Grow not found</div>
          <div className="text-sm opacity-70 mb-4">
            This ID doesn’t exist in your current list. Make sure you’re signed in to the correct account.
          </div>
          <Link
            to="/"
            className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const inocDate =
    getDateString(
      grow?.stageDates?.Inoculated ||
        grow?.stageDates?.inoculated ||
        grow?.createdDate ||
        grow?.createdAt
    ) || "";

  const saveStage = async () => {
    if (stage && stage !== grow.stage && onUpdateStage) {
      await onUpdateStage(grow.id, stage);
    }
  };
  const saveStatus = async () => {
    if (status && status !== grow.status && onUpdateStatus) {
      await onUpdateStatus(grow.id, status);
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    await onAddNote?.(grow.id, activeTab, noteText.trim());
    setNoteText("");
  };

  const uploadPhoto = async () => {
    if (!file) return;
    await onUploadStagePhoto?.(grow.id, activeTab, file, caption || "");
    setFile(null);
    setCaption("");
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold">
            {grow.strain || grow.abbreviation || "Grow"}
          </div>
          <div className="text-sm opacity-75">
            {(grow.type || grow.growType || "—")} • Inoc: {inocDate || "—"} • ID:{" "}
            {grow.id?.slice?.(0, 8)}
          </div>
        </div>
        <Link
          to="/"
          className="px-3 py-1.5 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 text-sm"
        >
          Back to app
        </Link>
      </div>

      {/* Quick edit controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-300 dark:border-zinc-700 p-4">
        <label className="text-sm">
          <div className="mb-1 opacity-80">Stage</div>
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setActiveTab(e.target.value);
            }}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <div className="mb-1 opacity-80">Status</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button
            onClick={saveStage}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-sm"
          >
            Save Stage
          </button>
          <button
            onClick={saveStatus}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm"
          >
            Save Status
          </button>
        </div>
      </div>

      {/* Stage tabs */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setActiveTab(s)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              activeTab === s
                ? "bg-emerald-600 text-white border-emerald-700"
                : "bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Notes & Photos for active stage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notes */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-300 dark:border-zinc-700">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 font-medium">
            Notes - {activeTab}
          </div>
          <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
            {notes.map((n) => (
              <div
                key={n.id}
                className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2"
              >
                <div className="text-sm whitespace-pre-wrap">{n.text}</div>
                <div className="text-xs mt-1 text-zinc-500">
                  {n.timestamp ? new Date(n.timestamp).toLocaleString() : ""}
                </div>
              </div>
            ))}
            {notes.length === 0 && (
              <div className="text-sm text-zinc-500">No notes yet.</div>
            )}
          </div>
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
            <textarea
              className="flex-1 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 px-3 py-2"
              placeholder="Add a note…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={2}
            />
            <button
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
              onClick={addNote}
              disabled={!noteText.trim()}
            >
              Add
            </button>
          </div>
        </div>

        {/* Photos */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-300 dark:border-zinc-700">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 font-medium">
            Photos - {activeTab}
          </div>
          <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto">
            {photos.map((p) => (
              <figure
                key={p.id}
                className="rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800"
              >
                <img
                  src={p.url}
                  alt={p.caption || ""}
                  className="w-full h-32 object-cover"
                />
                <figcaption className="px-2 py-1 text-xs">
                  <div className="truncate" title={p.caption || ""}>
                    {p.caption || "—"}
                  </div>
                  <div className="text-[10px] opacity-60">
                    {p.timestamp ? new Date(p.timestamp).toLocaleString() : ""}
                  </div>
                </figcaption>
              </figure>
            ))}
            {photos.length === 0 && (
              <div className="text-sm text-zinc-500 col-span-full">
                No photos yet.
              </div>
            )}
          </div>
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="file"
              accept="image/*"
              className="rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 px-3 py-2"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <input
              type="text"
              placeholder="Caption (optional)"
              className="rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 px-3 py-2"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <button
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
              onClick={uploadPhoto}
              disabled={!file}
            >
              Upload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getDateString(raw) {
  if (!raw) return "";
  try {
    if (typeof raw === "string") {
      const d = new Date(raw);
      if (!isNaN(d)) return d.toISOString().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    } else if (raw?.toDate) {
      return raw.toDate().toISOString().slice(0, 10);
    } else if (raw instanceof Date) {
      return raw.toISOString().slice(0, 10);
    }
  } catch {}
  return "";
}
