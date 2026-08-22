// src/pages/QuickEdit.jsx
import React, { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { sortPhotoRecordsNewestFirst } from "../lib/photo-storage";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];
const STATUSES = ["Active", "Archived", "Contaminated"];

function pickStageItems(byGrowStage, id, stage) {
  if (!byGrowStage || !id || !stage) return [];

  if (typeof byGrowStage.get === "function") {
    const list =
      byGrowStage.get(`${id}::${stage}`) ??
      byGrowStage.get(`${id}::General`);
    return Array.isArray(list) ? list : [];
  }

  const bucket = byGrowStage[id] || {};
  const list = bucket[stage] ?? bucket.General;
  return Array.isArray(list) ? list : [];
}

function formatPhotoDate(photo) {
  const raw = photo?.createdAt || photo?.timestamp;
  if (!raw) return "";
  try {
    const date = typeof raw?.toDate === "function" ? raw.toDate() : new Date(raw);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  } catch {
    return "";
  }
}

/**
 * QuickEdit (prop-driven; no direct Firestore reads)
 *
 * Props:
 * - grows
 * - notesByGrowStage
 * - photosByGrowStage
 * - onUpdateStage(growId, stage)
 * - onUpdateStatus(growId, status)
 * - onAddNote(growId, stage, text)
 * - onUploadStagePhoto(growId, stage, file, caption)
 * - onDeletePhoto(growId, photo)
 */
export default function QuickEdit({
  grows = [],
  notesByGrowStage = {},
  photosByGrowStage = {},
  onUpdateStage,
  onUpdateStatus,
  onAddNote,
  onUploadStagePhoto,
  onDeletePhoto,
}) {
  const confirm = useConfirm();
  const { growId } = useParams();
  const grow = useMemo(
    () => (Array.isArray(grows) ? grows.find((item) => item.id === growId) : null),
    [grows, growId]
  );

  const [stage, setStage] = useState(grow?.stage || STAGES[0]);
  const [status, setStatus] = useState(grow?.status || "Active");
  const [activeTab, setActiveTab] = useState(stage);
  const [noteText, setNoteText] = useState("");
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState("");
  const [photoNotice, setPhotoNotice] = useState(null);

  const notes = pickStageItems(notesByGrowStage, growId, activeTab);
  const photos = sortPhotoRecordsNewestFirst(
    pickStageItems(photosByGrowStage, growId, activeTab)
  );

  if (!grow) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <div className="rounded-xl border border-zinc-300 dark:border-zinc-700 p-6 bg-white dark:bg-zinc-900">
          <div className="text-lg font-semibold mb-2">Grow not found</div>
          <div className="text-sm opacity-70 mb-4">
            This ID doesn’t exist in your current list. Make sure you’re signed in to the correct account.
          </div>
          <Link to="/" className="btn btn-accent text-sm">
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
    if (!file || uploading) return;
    setUploading(true);
    setPhotoNotice(null);
    try {
      if (typeof onUploadStagePhoto !== "function") {
        throw new Error("Photo upload is unavailable.");
      }
      await onUploadStagePhoto(grow.id, activeTab, file, caption || "");
      setFile(null);
      setCaption("");
      setFileInputKey((value) => value + 1);
      setPhotoNotice({ tone: "success", message: "Photo uploaded." });
    } catch (error) {
      setPhotoNotice({
        tone: "error",
        message: error?.message || "Photo upload failed.",
      });
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = async (photo) => {
    if (!photo?.id || deletingPhotoId) return;
    const accepted = await confirm({
      title: "Delete photo?",
      message: "Delete this photo from the grow and Firebase Storage? This cannot be undone.",
      tone: "danger",
    });
    if (!accepted) return;

    setDeletingPhotoId(photo.id);
    setPhotoNotice(null);
    try {
      if (typeof onDeletePhoto !== "function") {
        throw new Error("Photo deletion is unavailable.");
      }
      await onDeletePhoto(grow.id, photo);
      setPhotoNotice({ tone: "success", message: "Photo deleted." });
    } catch (error) {
      setPhotoNotice({
        tone: "error",
        message: error?.message || "Photo deletion failed.",
      });
    } finally {
      setDeletingPhotoId("");
    }
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
        <Link to="/" className="btn text-sm">
          Back to app
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-300 dark:border-zinc-700 p-4">
        <label className="text-sm">
          <div className="mb-1 opacity-80">Stage</div>
          <select
            value={stage}
            onChange={(event) => {
              setStage(event.target.value);
              setActiveTab(event.target.value);
            }}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
          >
            {STAGES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <div className="mb-1 opacity-80">Status</div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
          >
            {STATUSES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button onClick={saveStage} className="btn btn-accent text-sm">
            Save Stage
          </button>
          <button onClick={saveStatus} className="btn btn-accent text-sm">
            Save Status
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STAGES.map((item) => (
          <button
            key={item}
            onClick={() => setActiveTab(item)}
            className="chip"
            data-active={activeTab === item ? "true" : undefined}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-300 dark:border-zinc-700">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 font-medium">
            Notes - {activeTab}
          </div>
          <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
            {notes.map((note) => (
              <div
                key={note.id}
                className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2"
              >
                <div className="text-sm whitespace-pre-wrap">{note.text}</div>
                <div className="text-xs mt-1 text-zinc-500">
                  {note.timestamp ? new Date(note.timestamp).toLocaleString() : ""}
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
              onChange={(event) => setNoteText(event.target.value)}
              rows={2}
            />
            <button
              className="btn btn-accent disabled:opacity-60"
              onClick={addNote}
              disabled={!noteText.trim()}
            >
              Add
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-300 dark:border-zinc-700">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 font-medium">
            Photos - {activeTab}
          </div>

          {photoNotice ? (
            <div
              className={`mx-4 mt-4 rounded-lg border px-3 py-2 text-sm ${
                photoNotice.tone === "error"
                  ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                  : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              }`}
            >
              {photoNotice.message}
            </div>
          ) : null}

          <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto">
            {photos.map((photo) => (
              <figure
                key={photo.id || photo.url}
                className="relative rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
              >
                <a href={photo.url} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={photo.url}
                    alt={photo.caption || "Grow photo"}
                    className="w-full h-32 object-cover"
                  />
                </a>
                <button
                  type="button"
                  onClick={() => deletePhoto(photo)}
                  disabled={Boolean(deletingPhotoId)}
                  className="absolute right-2 top-2 rounded-md bg-red-600/90 px-2 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-60"
                  aria-label="Delete photo"
                  title="Delete photo"
                >
                  {deletingPhotoId === photo.id ? "Deleting…" : "Delete"}
                </button>
                <figcaption className="px-2 py-1 text-xs">
                  <div className="truncate" title={photo.caption || ""}>
                    {photo.caption || "—"}
                  </div>
                  <div className="text-[10px] opacity-60">
                    {formatPhotoDate(photo)}
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
              key={fileInputKey}
              type="file"
              accept="image/*"
              className="rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 px-3 py-2"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <input
              type="text"
              placeholder="Caption (optional)"
              className="rounded-lg bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 px-3 py-2"
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
            <button
              className="btn btn-accent disabled:opacity-60"
              onClick={uploadPhoto}
              disabled={!file || uploading}
            >
              {uploading ? "Uploading…" : "Upload"}
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
      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    } else if (raw?.toDate) {
      return raw.toDate().toISOString().slice(0, 10);
    } else if (raw instanceof Date) {
      return raw.toISOString().slice(0, 10);
    }
  } catch {
    return "";
  }
  return "";
}
