// src/components/ui/PhotoUpload.jsx
import React, { useState } from "react";

/**
 * PhotoUpload – prop-driven
 *
 * Props:
 *  - grows: Array<{ id, strain, ... }>
 *  - photosByGrow?: Record<growId, Array<{ id, url, caption, timestamp }>>  (optional)
 *  - onUpload: (growId: string, file: File, caption: string) => Promise<void>
 */
export default function PhotoUpload({
  grows = [],
  photosByGrow = {},
  onUpload,
}) {
  const [selectedGrow, setSelectedGrow] = useState(grows?.[0]?.id || "");
  const [image, setImage] = useState(null);
  const [caption, setCaption] = useState("");
  const photos = photosByGrow?.[selectedGrow] || [];

  const handleUpload = async () => {
    if (!onUpload || !selectedGrow || !image) return;
    await onUpload(selectedGrow, image, caption || "");
    setImage(null);
    setCaption("");
  };

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
      <div className="grid gap-3 sm:grid-cols-3">
        <select
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={selectedGrow}
          onChange={(e) => setSelectedGrow(e.target.value)}
        >
          {grows.map((g) => (
            <option key={g.id} value={g.id}>
              {g.strain} ({g.abbreviation || g.id.slice(0, 6)})
            </option>
          ))}
        </select>

        <input
          type="file"
          accept="image/*"
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          onChange={(e) => setImage(e.target.files?.[0] || null)}
        />

        <input
          type="text"
          placeholder="Caption (optional)"
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />

        <button
          onClick={handleUpload}
          className="sm:col-span-3 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          disabled={!image || !selectedGrow}
        >
          Upload Photo
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {photos.map((p) => (
          <figure key={p.id} className="rounded-lg overflow-hidden bg-gray-100 dark:bg-zinc-800">
            <img src={p.url} alt={p.caption || ""} className="w-full h-40 object-cover" />
            <figcaption className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
              <div className="font-medium">{p.caption || "—"}</div>
              <div className="text-xs text-gray-500">
                {p.timestamp ? new Date(p.timestamp).toLocaleString() : ""}
              </div>
            </figcaption>
          </figure>
        ))}
        {photos.length === 0 && (
          <div className="text-sm text-gray-600 dark:text-gray-300">
            No photos for this grow yet.
          </div>
        )}
      </div>
    </div>
  );
}
