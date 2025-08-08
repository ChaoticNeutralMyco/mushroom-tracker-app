// src/components/Grow/GrowNotesModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { db, auth } from "../../firebase-config";

// Fallback-only Firestore calls (used when App doesn't pass props/handlers yet)
import { doc, getDoc, updateDoc } from "firebase/firestore";

/**
 * GrowNotesModal
 *
 * Preferred (prop-driven) usage — NO reads/writes here:
 *   <GrowNotesModal
 *     grow={grow}                            // { id, strain, stageDates, inoculation? }
 *     notes={notesArray}                     // [{ id?, text, date|timestamp, stage? }]
 *     onAddNote={(growId, stage, text) => ...}
 *     onEditNote={(growId, noteIdOrIndex, text) => ...}
 *     onDeleteNote={(growId, noteIdOrIndex) => ...}
 *     onClose={() => ...}
 *   />
 *
 * Fallback (legacy) — if notes/handlers are not provided:
 *   - Reads full grow doc (to get grow.notes array) and mutates it in-place.
 */
export default function GrowNotesModal({
  grow,
  notes,                  // optional notes array (prop-driven path)
  onAddNote,              // optional
  onEditNote,             // optional
  onDeleteNote,           // optional
  onClose,
}) {
  // ---------- Local state ----------
  const [noteText, setNoteText] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingText, setEditingText] = useState("");

  // Fallback-only grow doc mirror (when notes prop not provided)
  const [fullGrow, setFullGrow] = useState(null);

  const growId = grow?.id;

  // ---------- Derived notes & stage dates ----------
  const propStageDates = grow?.stageDates || {};
  const fallbackNotes = (fullGrow?.notes || []).map((n, i) => ({
    ...n,
    _index: i,
  }));

  const propNotes = Array.isArray(notes)
    ? notes.map((n, i) => ({ ...n, _index: n.id ?? i }))
    : null;

  const viewNotes = propNotes ?? fallbackNotes;

  // ---------- Fallback fetch (only if notes prop is not provided) ----------
  useEffect(() => {
    if (Array.isArray(notes)) return; // prop-driven: skip fetch
    (async () => {
      const user = auth.currentUser;
      if (!user || !growId) return;
      const snap = await getDoc(doc(db, "users", user.uid, "grows", growId));
      if (snap.exists()) setFullGrow({ id: snap.id, ...snap.data() });
    })();
  }, [growId, notes]);

  // ---------- Fallback write helper (mutates grow.notes array in doc) ----------
  const updateNotesFallback = async (newNotes) => {
    const user = auth.currentUser;
    if (!user || !growId) return;
    const ref = doc(db, "users", user.uid, "grows", growId);
    await updateDoc(ref, { notes: newNotes });
    setFullGrow((prev) => (prev ? { ...prev, notes: newNotes } : prev));
  };

  // ---------- Actions ----------
  const handleAddNote = async () => {
    const text = noteText.trim();
    if (!text) return;

    // Prop-driven path
    if (typeof onAddNote === "function" && Array.isArray(notes)) {
      await onAddNote(growId, "General", text);
      setNoteText("");
      return;
    }

    // Fallback path
    const newNote = { text, date: new Date().toISOString() };
    const next = [...(fullGrow?.notes || []), newNote];
    await updateNotesFallback(next);
    setNoteText("");
  };

  const handleDeleteNote = async (idxOrId) => {
    // Prop-driven
    if (typeof onDeleteNote === "function" && Array.isArray(notes)) {
      await onDeleteNote(growId, idxOrId);
      return;
    }
    // Fallback
    const idx = Number(idxOrId);
    const next = [...(fullGrow?.notes || [])];
    next.splice(idx, 1);
    await updateNotesFallback(next);
  };

  const handleSaveEdit = async (idxOrId) => {
    const newText = editingText.trim();
    if (!newText) return;

    // Prop-driven
    if (typeof onEditNote === "function" && Array.isArray(notes)) {
      await onEditNote(growId, idxOrId, newText);
      setEditingIndex(null);
      setEditingText("");
      return;
    }

    // Fallback
    const idx = Number(idxOrId);
    const next = [...(fullGrow?.notes || [])];
    next[idx] = { ...next[idx], text: newText };
    await updateNotesFallback(next);
    setEditingIndex(null);
    setEditingText("");
  };

  // ---------- Utils ----------
  const fmtWhen = (t) => {
    if (!t) return "";
    try {
      if (typeof t?.toDate === "function") return t.toDate().toLocaleString();
      if (t instanceof Date) return t.toLocaleString();
      return new Date(t).toLocaleString();
    } catch {
      return String(t);
    }
  };

  const exportLogbook = () => {
    const g = fullGrow || grow || {};
    const stageDates = g.stageDates || propStageDates || {};
    const lines = [];
    lines.push(`📘 Logbook for: ${g.strain || "Unnamed"}`);
    lines.push(`Inoculated: ${g.inoculation || g.createdAt || "N/A"}`);
    lines.push(`Stage: ${g.stage || "N/A"}`);
    lines.push("");
    lines.push("🔄 Stage History:");
    Object.entries(stageDates).forEach(([stage, date]) => {
      lines.push(`- ${stage}: ${fmtWhen(date)}`);
    });
    lines.push("");
    lines.push("📝 Notes:");
    (viewNotes || []).forEach((note, idx) => {
      lines.push(`${idx + 1}. ${note.text}`);
      lines.push(`   [${fmtWhen(note.date || note.timestamp)}]`);
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grow-logbook-${g.strain || g.id || "unknown"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Render ----------
  const isLoadingFallback = !Array.isArray(notes) && !fullGrow;

  if (isLoadingFallback) {
    return (
      <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-lg max-w-md w-full">
          <p className="text-zinc-700 dark:text-zinc-200">Loading notes…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl w-full max-w-md relative shadow-xl text-zinc-900 dark:text-white">
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-zinc-500 hover:text-red-500 text-lg rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
          aria-label="Close notes modal"
        >
          ✖
        </button>

        <h2 className="text-xl font-bold mb-4">
          📝 Grow Notes{" "}
          <span className="text-sm opacity-70">
            {grow?.strain || fullGrow?.strain || ""}
          </span>
        </h2>

        {/* Stage Timeline */}
        <div className="mb-4 text-sm">
          <h3 className="font-semibold mb-1">🔄 Stage Timeline</h3>
          <ul className="list-disc list-inside space-y-1">
            {Object.entries(propStageDates || fullGrow?.stageDates || {}).map(
              ([stage, date]) => (
                <li key={stage}>
                  <strong>{stage}:</strong> {fmtWhen(date)}
                </li>
              )
            )}
          </ul>
        </div>

        {/* Notes List */}
        <div className="space-y-3 max-h-48 overflow-y-auto mb-4 pr-1">
          {(viewNotes || []).map((note, index) => {
            const key = note.id ?? note._index ?? index;
            const date = note.date || note.timestamp;
            return (
              <div
                key={key}
                className="border-b border-zinc-200 dark:border-zinc-700 pb-2"
              >
                {editingIndex === key ? (
                  <>
                    <textarea
                      className="w-full p-2 border rounded-md dark:bg-zinc-800 dark:text-white mb-1 text-sm"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={2}
                      aria-label="Edit note text"
                    />
                    <div className="flex gap-3 text-sm">
                      <button
                        onClick={() => handleSaveEdit(key)}
                        className="text-green-600 hover:underline"
                        aria-label="Save edited note"
                      >
                        ✅ Save
                      </button>
                      <button
                        onClick={() => {
                          setEditingIndex(null);
                          setEditingText("");
                        }}
                        className="text-zinc-400 hover:underline"
                        aria-label="Cancel edit"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap">{note.text}</p>
                    <p className="text-xs text-zinc-500">{fmtWhen(date)}</p>
                    <div className="flex gap-4 text-xs mt-1">
                      <button
                        onClick={() => {
                          setEditingIndex(key);
                          setEditingText(note.text);
                        }}
                        className="text-blue-600 hover:underline disabled:opacity-50"
                        aria-label="Edit note"
                        disabled={
                          // If using prop-driven notes but no edit handler, disable edit
                          Array.isArray(notes) && typeof onEditNote !== "function"
                        }
                        title={
                          Array.isArray(notes) && typeof onEditNote !== "function"
                            ? "Editing requires an onEditNote handler from App"
                            : undefined
                        }
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteNote(key)}
                        className="text-red-600 hover:underline disabled:opacity-50"
                        aria-label="Delete note"
                        disabled={
                          Array.isArray(notes) && typeof onDeleteNote !== "function"
                        }
                        title={
                          Array.isArray(notes) && typeof onDeleteNote !== "function"
                            ? "Deleting requires an onDeleteNote handler from App"
                            : undefined
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {(!viewNotes || viewNotes.length === 0) && (
            <div className="text-sm opacity-70">No notes yet.</div>
          )}
        </div>

        {/* Add Note */}
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note…"
          className="w-full p-2 border rounded-md dark:bg-zinc-800 dark:text-white mb-3 text-sm"
          rows={3}
          aria-label="New note text"
        />

        <div className="flex justify-between items-center">
          <button
            onClick={handleAddNote}
            className="accent-bg text-white px-4 py-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current disabled:opacity-60"
            aria-label="Add note"
            disabled={!noteText.trim()}
          >
            Add Note
          </button>
          <button
            onClick={exportLogbook}
            className="text-sm text-zinc-600 dark:text-zinc-300 hover:underline"
            aria-label="Export logbook as text file"
          >
            📤 Export Logbook
          </button>
        </div>
      </div>
    </div>
  );
}
