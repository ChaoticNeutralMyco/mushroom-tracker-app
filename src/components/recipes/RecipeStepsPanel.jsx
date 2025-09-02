import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebase-config";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

/**
 * Simple editor to store human-readable steps/instructions on each recipe.
 * Data shape stored in Firestore (per recipe doc):
 *   { instructions: string }  // markdown or plain text
 */
export default function RecipeStepsPanel() {
  const uid = auth.currentUser?.uid || null;

  const [recipes, setRecipes] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const selected = useMemo(
    () => recipes.find((r) => r.id === selectedId),
    [recipes, selectedId]
  );

  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // Load recipes list
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(collection(db, "users", uid, "recipes"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRecipes(list);
      if (!selectedId && list.length) setSelectedId(list[0].id);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // When switching recipes, load its instructions
  useEffect(() => {
    setText(selected?.instructions || "");
    setSavedAt(null);
  }, [selectedId]); // only when changing selection

  const save = async () => {
    if (!uid || !selected?.id) return;
    try {
      setSaving(true);
      await updateDoc(doc(db, "users", uid, "recipes", selected.id), {
        instructions: text || "",
      });
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+S to save
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, selected?.id, uid]);

  return (
    <section className="mt-6 rounded-2xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Recipe Steps / Instructions</h2>

        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          {savedAt ? <span>Saved {savedAt.toLocaleTimeString()}</span> : null}
          {saving ? <span className="opacity-80">Saving…</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="text-sm opacity-70">Recipe</label>
        <select
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-sm"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name || "(untitled recipe)"}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="chip"
            type="button"
            title="Insert a step template"
            onClick={() =>
              setText(
                (prev) =>
                  prev ||
                  `# Steps\n\n1. Prep workspace\n2. Measure ingredients\n3. Mix/sterilize\n4. Cool & store\n\nNotes:\n- \n- `
              )
            }
          >
            Insert template
          </button>
          <button className="btn-accent text-sm" onClick={save} disabled={saving || !selectedId}>
            {saving ? "Saving…" : "Save Instructions"}
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        <textarea
          className="min-h-[240px] w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm leading-5"
          placeholder="Write step-by-step instructions here (Markdown or plain text)…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Tip: Use Markdown for headings and lists. Press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd> +{" "}
          <kbd>S</kbd> to save quickly.
        </div>
      </div>
    </section>
  );
}
