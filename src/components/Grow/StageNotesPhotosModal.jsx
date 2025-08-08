// src/components/Grow/StageNotesPhotosModal.jsx
import React, { useMemo, useState } from "react";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested", "General"];

export default function StageNotesPhotosModal({
  grow,
  notesByStage = {},           // {stage: [{ id, text, timestamp }]}
  photosByStage = {},          // {stage: [{ id, url, caption, timestamp }]}
  onAddNote,                   // (stage, text) => void
  onUpload,                    // (stage, file, caption) => void
  onClose,
}) {
  const [activeStage, setActiveStage] = useState(
    STAGES.includes(grow?.stage) ? grow.stage : "General"
  );
  const [noteText, setNoteText] = useState("");
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");

  const notes = useMemo(() => notesByStage[activeStage] || [], [notesByStage, activeStage]);
  const photos = useMemo(() => photosByStage[activeStage] || [], [photosByStage, activeStage]);

  const submitNote = async () => {
    if (!noteText.trim() || !onAddNote) return;
    await onAddNote(activeStage, noteText.trim());
    setNoteText("");
  };

  const submitPhoto = async () => {
    if (!file || !onUpload) return;
    await onUpload(activeStage, file, caption || "");
    setFile(null);
    setCaption("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* modal */}
      <div className="relative z-10 w-full max-w-5xl mx-auto rounded-2xl bg-zinc-950 text-white shadow-xl border border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-lg font-semibold">
            {grow?.strain || "Grow"} — Notes & Photos
          </h3>
          <button className="text-zinc-400 hover:text-white" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* stage tabs */}
        <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-zinc-800">
          {STAGES.map((s) => (
            <button
              key={s}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                activeStage === s
                  ? "bg-emerald-600 text-white border-emerald-700"
                  : "bg-zinc-900 border-zinc-700 text-zinc-200"
              }`}
              onClick={() => setActiveStage(s)}
            >
              {s}
            </button>
          ))}
        </div>

        {/* body */}
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Notes */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800">
            <div className="px-4 py-3 border-b border-zinc-800 font-medium">Notes</div>
            <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
              {notes.map((n) => (
                <div key={n.id} className="rounded-lg bg-zinc-800 px-3 py-2">
                  <div className="text-sm whitespace-pre-wrap">{n.text}</div>
                  <div className="text-xs mt-1 text-zinc-400">
                    {n.timestamp ? new Date(n.timestamp).toLocaleString() : ""}
                  </div>
                </div>
              ))}
              {notes.length === 0 && (
                <div className="text-sm text-zinc-400">No notes for this stage yet.</div>
              )}
            </div>
            <div className="p-4 border-t border-zinc-800 flex gap-2">
              <textarea
                className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2"
                placeholder="Add a note…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
              />
              <button
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
                onClick={submitNote}
                disabled={!noteText.trim()}
              >
                Add
              </button>
            </div>
          </div>

          {/* Photos */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800">
            <div className="px-4 py-3 border-b border-zinc-800 font-medium">Photos</div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto">
              {photos.map((p) => (
                <figure key={p.id} className="rounded-lg overflow-hidden bg-zinc-800">
                  <img src={p.url} alt={p.caption || ""} className="w-full h-32 object-cover" />
                  <figcaption className="px-2 py-1 text-xs text-zinc-300">
                    <div className="truncate" title={p.caption || ""}>
                      {p.caption || "—"}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {p.timestamp ? new Date(p.timestamp).toLocaleString() : ""}
                    </div>
                  </figcaption>
                </figure>
              ))}
              {photos.length === 0 && (
                <div className="text-sm text-zinc-400 col-span-full">
                  No photos for this stage yet.
                </div>
              )}
            </div>
            <div className="p-4 border-t border-zinc-800 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="file"
                accept="image/*"
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <input
                type="text"
                placeholder="Caption (optional)"
                className="rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
              <button
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
                onClick={submitPhoto}
                disabled={!file}
              >
                Upload Photo
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 flex items-center justify-end border-t border-zinc-800">
          <button className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
