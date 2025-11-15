src/components/Grow/StageNotesPhotosModal.jsx
// src/components/Grow/StageNotesPhotosModal.jsx
import React, { useMemo, useState } from "react";
import {
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../../firebase-config";
import { useConfirm } from "../ui/ConfirmDialog";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested", "General"];

const normalizeType = (t = "") => {
  const s = String(t || "").toLowerCase();
  if (s.includes("agar")) return "Agar";
  if (s.includes("lc") || s.includes("liquid")) return "LC";
  return "Other";
};

export default function StageNotesPhotosModal({
  grow,
  notesByStage = {},           // {stage: [{ id, text, timestamp }]}
  photosByStage = {},          // {stage: [{ id, url, caption, timestamp, storagePath? }]}
  onAddNote,                   // (stage, text) => void
  onUpload,                    // (stage, file, caption) => void
  onAdvanceStage,              // optional: (nextStage) => Promise
  onArchiveToggle,             // optional: () => Promise
  onStoreToggle,               // optional: () => Promise
  onDeleteGrow,                // optional: () => Promise
  onEditNote,                  // optional: (stage, noteId, newText) => Promise
  onDeleteNote,                // optional: (stage, noteId) => Promise
  onSetCoverPhoto,             // optional: (photo) => Promise
  onClose,
}) {
  const confirm = useConfirm();

  const [activeStage, setActiveStage] = useState(
    STAGES.includes(grow?.stage) ? grow.stage : "General"
  );
  const [noteText, setNoteText] = useState("");
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState("");

  // Inline note edit
  const [editNoteId, setEditNoteId] = useState(null);
  const [editNoteText, setEditNoteText] = useState("");

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

  // ----- Inline actions with confirm + fallbacks -----
  const uid = auth.currentUser?.uid || null;
  const stageIdx = STAGES.indexOf(grow?.stage || "");
  const hasNext = stageIdx >= 0 && stageIdx < STAGES.length - 2; // ignore "General"

  const doAdvance = async () => {
    if (!hasNext) return;
    const next = STAGES[stageIdx + 1];
    if (!(await confirm(`Advance stage to "${next}"?`))) return;
    if (typeof onAdvanceStage === "function") {
      await onAdvanceStage(next);
      return;
    }
    if (!uid || !grow?.id) return;
    await updateDoc(doc(db, "users", uid, "grows", grow.id), {
      stage: next,
      [`stageDates.${next}`]: serverTimestamp(),
    });
  };

  const doArchiveToggle = async () => {
    const isArchived = String(grow?.status || "").toLowerCase() === "archived";
    if (!(await confirm(`${isArchived ? "Unarchive" : "Archive"} this grow?`))) return;
    if (typeof onArchiveToggle === "function") {
      await onArchiveToggle();
      return;
    }
    if (!uid || !grow?.id) return;
    await updateDoc(doc(db, "users", uid, "grows", grow.id), {
      status: isArchived ? "Active" : "Archived",
    });
  };

  const canStore = useMemo(() => {
    const t = normalizeType(grow?.type || grow?.growType || "");
    return t === "Agar" || t === "LC";
  }, [grow]);

  const doStoreToggle = async () => {
    if (!canStore) return;
    const isStored = String(grow?.status || "").toLowerCase() === "stored";
    if (!(await confirm(`${isStored ? "Unstore" : "Store"} this grow?`))) return;
    if (typeof onStoreToggle === "function") {
      await onStoreToggle();
      return;
    }
    if (!uid || !grow?.id) return;
    await updateDoc(doc(db, "users", uid, "grows", grow.id), {
      status: isStored ? "Active" : "Stored",
    });
  };

  const doDeleteGrow = async () => {
    if (!(await confirm("Delete this grow? This cannot be undone."))) return;
    if (typeof onDeleteGrow === "function") {
      await onDeleteGrow();
      return;
    }
    if (!uid || !grow?.id) return;
    await deleteDoc(doc(db, "users", uid, "grows", grow.id));
  };

  // Note edit/delete (D)
  const beginEdit = (n) => {
    setEditNoteId(n.id);
    setEditNoteText(n.text || "");
  };
  const cancelEdit = () => {
    setEditNoteId(null);
    setEditNoteText("");
  };
  const saveEdit = async () => {
    if (!editNoteId) return;
    if (typeof onEditNote === "function") {
      await onEditNote(activeStage, editNoteId, editNoteText.trim());
      cancelEdit();
      return;
    }
    // Fallback: assume notes are in a subcollection users/{uid}/grows/{growId}/notes/{noteId}
    if (!uid || !grow?.id) return;
    await updateDoc(doc(db, "users", uid, "grows", grow.id, "notes", editNoteId), {
      text: editNoteText.trim(),
      editedAt: serverTimestamp(),
    });
    cancelEdit();
  };
  const deleteNote = async (n) => {
    if (!(await confirm("Delete this note?"))) return;
    if (typeof onDeleteNote === "function") {
      await onDeleteNote(activeStage, n.id);
      return;
    }
    if (!uid || !grow?.id || !n?.id) return;
    await deleteDoc(doc(db, "users", uid, "grows", grow.id, "notes", n.id));
  };

  // Set Cover (C)
  const setCoverFromPhoto = async (p) => {
    if (!(await confirm("Set this photo as the cover image?"))) return;
    if (typeof onSetCoverPhoto === "function") {
      await onSetCoverPhoto(p);
      return;
    }
    if (!uid || !grow?.id) return;
    await updateDoc(doc(db, "users", uid, "grows", grow.id), {
      coverPhotoId: p.id || null,
      coverUrl: p.url || null,
      coverStoragePath: p.storagePath || null,
      coverUpdatedAt: serverTimestamp(),
    });
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
          <div className="flex items-center gap-2">
            <button
              className={`px-3 py-1.5 rounded-full text-sm border ${hasNext ? "bg-emerald-600 border-emerald-700" : "bg-zinc-900 border-zinc-700 opacity-60 cursor-not-allowed"}`}
              onClick={hasNext ? doAdvance : undefined}
              aria-disabled={!hasNext}
              title={hasNext ? "Advance to next stage" : "No next stage"}
            >
              Stage +
            </button>
            <button
              className="px-3 py-1.5 rounded-full text-sm border bg-zinc-900 border-zinc-700"
              onClick={doArchiveToggle}
              title={String(grow?.status || "").toLowerCase() === "archived" ? "Unarchive" : "Archive"}
            >
              {String(grow?.status || "").toLowerCase() === "archived" ? "Unarchive" : "Archive"}
            </button>
            {canStore && (
              <button
                className="px-3 py-1.5 rounded-full text-sm border bg-zinc-900 border-zinc-700"
                onClick={doStoreToggle}
                title={String(grow?.status || "").toLowerCase() === "stored" ? "Unstore" : "Store"}
              >
                {String(grow?.status || "").toLowerCase() === "stored" ? "Unstore" : "Store"}
              </button>
            )}
            <button
              className="text-zinc-400 hover:text-white"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
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
          {/* Notes (D) */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800">
            <div className="px-4 py-3 border-b border-zinc-800 font-medium">Notes</div>
            <div className="p-4 space-y-3 max-h-[420px] overflow-y-auto">
              {notes.map((n) => (
                <div key={n.id} className="rounded-lg bg-zinc-800 px-3 py-2">
                  {editNoteId === n.id ? (
                    <div className="flex items-start gap-2">
                      <textarea
                        className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-2 py-1"
                        value={editNoteText}
                        onChange={(e) => setEditNoteText(e.target.value)}
                        rows={2}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <div className="flex gap-2">
                        <button className="chip px-2 py-1" onClick={saveEdit}>Save</button>
                        <button className="btn-outline px-2 py-1" onClick={cancelEdit}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm whitespace-pre-wrap">{n.text}</div>
                        <div className="text-[11px] mt-1 text-zinc-400">
                          {n.timestamp ? new Date(n.timestamp).toLocaleString() : ""}
                          {n.editedAt ? ` · edited ${new Date(n.editedAt).toLocaleString()}` : ""}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button className="chip px-2 py-1" onClick={() => { setEditNoteId(n.id); setEditNoteText(n.text || ""); }}>
                          Edit
                        </button>
                        <button className="chip px-2 py-1 bg-red-600 text-white" onClick={() => deleteNote(n)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
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

          {/* Photos (C) */}
          <div className="bg-zinc-900 rounded-xl border border-zinc-800">
            <div className="px-4 py-3 border-b border-zinc-800 font-medium">Photos</div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto">
              {photos.map((p) => {
                const isCover = grow?.coverPhotoId && p.id === grow.coverPhotoId;
                return (
                  <figure key={p.id} className="rounded-lg overflow-hidden bg-zinc-800 relative">
                    <img src={p.url} alt={p.caption || ""} className="w-full h-32 object-cover" />

                    {/* Cover badge */}
                    {isCover ? (
                      <span className="absolute left-2 top-2 rounded bg-amber-500/90 px-2 py-0.5 text-[11px] text-black font-semibold">
                        Cover
                      </span>
                    ) : null}

                    {/* Set Cover action */}
                    {!isCover && (
                      <button
                        onClick={() => setCoverFromPhoto(p)}
                        className="absolute right-2 top-2 rounded-md bg-indigo-600/90 px-2 py-1 text-[11px] text-white hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        title="Set as cover photo"
                      >
                        Set Cover
                      </button>
                    )}

                    <figcaption className="px-2 py-1 text-xs text-zinc-300">
                      <div className="truncate" title={p.caption || ""}>
                        {p.caption || "—"}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {p.timestamp ? new Date(p.timestamp).toLocaleString() : ""}
                      </div>
                    </figcaption>
                  </figure>
                );
              })}
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
