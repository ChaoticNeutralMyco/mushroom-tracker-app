import React, { useState, useEffect } from "react";
import { db, auth } from "../firebase-config";
import { doc, getDoc, updateDoc } from "firebase/firestore";

export default function GrowNotesModal({ grow, onClose }) {
  const [noteText, setNoteText] = useState("");
  const [fullGrow, setFullGrow] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingText, setEditingText] = useState("");

  useEffect(() => {
    const fetchGrow = async () => {
      const user = auth.currentUser;
      if (!user || !grow?.id) return;

      const growRef = doc(db, "users", user.uid, "grows", grow.id);
      const snap = await getDoc(growRef);
      if (snap.exists()) {
        setFullGrow({ id: snap.id, ...snap.data() });
      }
    };
    fetchGrow();
  }, [grow]);

  const updateNotes = async (newNotes) => {
    const user = auth.currentUser;
    if (!user || !fullGrow) return;
    const growRef = doc(db, "users", user.uid, "grows", fullGrow.id);
    await updateDoc(growRef, { notes: newNotes });
    setFullGrow((prev) => ({ ...prev, notes: newNotes }));
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    const newNote = { text: noteText.trim(), date: new Date().toISOString() };
    const updatedNotes = [...(fullGrow.notes || []), newNote];
    await updateNotes(updatedNotes);
    setNoteText("");
  };

  const handleDeleteNote = async (index) => {
    const updatedNotes = [...(fullGrow.notes || [])];
    updatedNotes.splice(index, 1);
    await updateNotes(updatedNotes);
  };

  const handleSaveEdit = async (index) => {
    const updatedNotes = [...(fullGrow.notes || [])];
    updatedNotes[index] = { ...updatedNotes[index], text: editingText.trim() };
    await updateNotes(updatedNotes);
    setEditingIndex(null);
    setEditingText("");
  };

  const exportLogbook = () => {
    const lines = [];
    lines.push(`📘 Logbook for: ${fullGrow.strain || "Unnamed"}`);
    lines.push(`Inoculated: ${fullGrow.inoculation || "N/A"}`);
    lines.push(`Stage: ${fullGrow.stage || "N/A"}`);
    lines.push("");
    lines.push("🔄 Stage History:");
    Object.entries(fullGrow.stageDates || {}).forEach(([stage, date]) => {
      lines.push(`- ${stage}: ${new Date(date).toLocaleString()}`);
    });
    lines.push("");
    lines.push("📝 Notes:");
    (fullGrow.notes || []).forEach((note, idx) => {
      lines.push(`${idx + 1}. ${note.text}`);
      lines.push(`   [${new Date(note.date).toLocaleString()}]`);
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grow-logbook-${fullGrow.strain || fullGrow.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!fullGrow) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-lg max-w-md w-full">
          <p className="text-zinc-700 dark:text-zinc-200">Loading notes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl w-full max-w-md relative shadow-xl text-zinc-900 dark:text-white">
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-zinc-500 hover:text-red-500 text-lg"
        >
          ✖
        </button>

        <h2 className="text-xl font-bold mb-4 text-blue-700 dark:text-blue-400">
          📝 Grow Notes
        </h2>

        {/* Stage Timeline */}
        <div className="mb-4 text-sm">
          <h3 className="font-semibold text-blue-600 dark:text-blue-300 mb-1">
            🔄 Stage Timeline
          </h3>
          <ul className="list-disc list-inside space-y-1">
            {Object.entries(fullGrow.stageDates || {}).map(([stage, date]) => (
              <li key={stage}>
                <strong>{stage}:</strong> {new Date(date).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>

        {/* Notes List */}
        <div className="space-y-3 max-h-48 overflow-y-auto mb-4 pr-1">
          {(fullGrow.notes || []).map((note, index) => (
            <div
              key={index}
              className="border-b border-zinc-200 dark:border-zinc-700 pb-2"
            >
              {editingIndex === index ? (
                <>
                  <textarea
                    className="w-full p-2 border rounded-md dark:bg-zinc-800 dark:text-white mb-1 text-sm"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={2}
                  />
                  <div className="flex gap-3 text-sm">
                    <button
                      onClick={() => handleSaveEdit(index)}
                      className="text-green-500 hover:underline"
                    >
                      ✅ Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingIndex(null);
                        setEditingText("");
                      }}
                      className="text-zinc-400 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap">{note.text}</p>
                  <p className="text-xs text-zinc-500">
                    {new Date(note.date).toLocaleString()}
                  </p>
                  <div className="flex gap-4 text-xs mt-1">
                    <button
                      onClick={() => {
                        setEditingIndex(index);
                        setEditingText(note.text);
                      }}
                      className="text-blue-500 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteNote(index)}
                      className="text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Add Note */}
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note..."
          className="w-full p-2 border rounded-md dark:bg-zinc-800 dark:text-white mb-3 text-sm"
          rows={3}
        />

        <div className="flex justify-between items-center">
          <button
            onClick={handleAddNote}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
          >
            Add Note
          </button>
          <button
            onClick={exportLogbook}
            className="text-sm text-zinc-500 dark:text-zinc-300 hover:underline"
          >
            📤 Export Logbook
          </button>
        </div>
      </div>
    </div>
  );
}
