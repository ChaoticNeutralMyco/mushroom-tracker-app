// src/components/ui/PhotoUpload.jsx
import React, { useState } from "react";
import { usePhotos } from "../../hooks/usePhotos";

/**
 * Small uploader used in Grow detail screen.
 * - Lets the user choose a Stage and an optional caption.
 * - Uploads to Storage and creates a Firestore doc via usePhotos().
 */
export default function PhotoUpload({ growId }) {
  const { uploadPhoto } = usePhotos(growId);
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onChoose = (e) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setErr("");
  };

  const onUpload = async () => {
    setErr("");
    if (!file) {
      setErr("Please choose a photo first.");
      return;
    }
    try {
      setBusy(true);
      await uploadPhoto(file, { stage, caption });
      // reset
      setFile(null);
      setCaption("");
      // keep stage for convenience
      // clear the input value so the same file can be reselected
      const input = document.getElementById("photo-file-input");
      if (input) input.value = "";
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col md:flex-row gap-2 items-stretch">
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="w-full md:w-56 rounded-md border border-gray-600 bg-transparent px-3 py-2"
        >
          <option value="">Stage (optional)</option>
          <option>Inoculated</option>
          <option>Colonizing</option>
          <option>Colonized</option>
          <option>Fruiting</option>
          <option>Harvested</option>
          <option>Contaminated</option>
          <option>Other</option>
        </select>

        <input
          id="photo-file-input"
          type="file"
          accept="image/*"
          onChange={onChoose}
          className="w-full md:w-64 rounded-md border border-gray-600 bg-transparent file:mr-3 file:rounded file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-white"
        />

        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption (optional)"
          className="w-full rounded-md border border-gray-600 bg-transparent px-3 py-2"
        />

        <button
          disabled={busy}
          onClick={onUpload}
          className="rounded-md bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload Photo"}
        </button>
      </div>

      {file ? (
        <div className="text-xs text-gray-400">Selected: {file.name}</div>
      ) : null}

      {err ? <div className="text-sm text-red-400">{err}</div> : null}
    </div>
  );
}
