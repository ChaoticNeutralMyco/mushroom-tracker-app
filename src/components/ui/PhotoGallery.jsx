src/components/ui/PhotoGallery.jsx
// src/components/ui/PhotoGallery.jsx
import React, { useMemo, useState } from "react";
import { usePhotos } from "../../hooks/usePhotos";
import { useConfirm } from "./ConfirmDialog";

/**
 * PhotoGallery
 * - Always-visible toolbar with Select / Select all / Clear / Delete(N) / Set cover / Done
 * - Inline caption editing (✎ on each tile)
 * - Per-tile Delete (with confirm)
 * - Cover badge
 * - Click-through to open full image in a new tab
 */
export default function PhotoGallery({
  growId,
  emptyHint = "No photos yet.",
  confirmText = "Delete this photo? This cannot be undone.",
}) {
  const {
    data: photos = [],
    isLoading,
    deletePhoto,
    deletePhotos,
    updatePhoto,
    setCover,
    coverPhotoId,
  } = usePhotos(growId);

  const confirm = useConfirm();

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const [editingId, setEditingId] = useState(null);
  const [editingCaption, setEditingCaption] = useState("");

  const selectedCount = selected.size;
  const selectedOne = useMemo(() => {
    if (selected.size !== 1) return null;
    const id = [...selected][0];
    return photos.find((p) => p.id === id) || null;
  }, [selected, photos]);

  const toggleSelect = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const clearSelection = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(photos.map((p) => p.id)));

  const onBatchDelete = async () => {
    if (!selectedCount) return;
    const list = photos.filter((p) => selected.has(p.id));
    if (!(await confirm(`Delete ${list.length} photo(s)? This cannot be undone.`))) return;
    await deletePhotos(list);
    clearSelection();
    setSelectMode(false);
  };

  const onSetCover = async () => {
    if (!selectedOne) return;
    if (!(await confirm("Set this photo as the cover image for this grow?"))) return;
    await setCover(selectedOne);
    clearSelection();
    setSelectMode(false);
  };

  const beginEdit = (p) => {
    setEditingId(p.id);
    setEditingCaption(p.caption || "");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingCaption("");
  };
  const saveEdit = async () => {
    if (!editingId) return;
    await updatePhoto(editingId, { caption: editingCaption });
    cancelEdit();
  };

  if (isLoading) return <div className="text-sm text-gray-500">Loading photos…</div>;
  if (!photos.length) return <div className="text-sm text-gray-400">{emptyHint}</div>;

  return (
    <div className="space-y-2">
      {/* --- Toolbar (always visible) --- */}
      <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/40 px-2 py-1 flex items-center gap-2">
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {`${photos.length} photo${photos.length === 1 ? "" : "s"}`}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!selectMode ? (
            <button
              className="chip"
              onClick={() => {
                clearSelection();
                setSelectMode(true);
              }}
              title="Select multiple photos for batch actions"
            >
              Select
            </button>
          ) : (
            <>
              <button className="chip" onClick={selectAll}>
                Select all
              </button>
              <button className="chip" onClick={clearSelection}>
                Clear
              </button>
              <button
                className="chip bg-red-600 text-white hover:bg-red-700"
                onClick={onBatchDelete}
                disabled={!selectedCount}
                title="Delete selected photos"
              >
                Delete {selectedCount ? `(${selectedCount})` : ""}
              </button>
              <button
                className="chip"
                onClick={onSetCover}
                disabled={!selectedOne}
                title="Set selected photo as cover"
              >
                Set cover
              </button>
              <button
                className="btn-outline"
                onClick={() => {
                  clearSelection();
                  setSelectMode(false);
                }}
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>

      {/* --- Grid --- */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {photos.map((p) => {
          const isSelected = selected.has(p.id);
          const isEditing = editingId === p.id;
          const isCover = coverPhotoId && coverPhotoId === p.id;

          return (
            <figure
              key={p.id}
              className={`relative rounded-md overflow-hidden border bg-white dark:bg-zinc-900 ${
                isSelected ? "border-indigo-400 dark:border-indigo-500" : "border-gray-300 dark:border-gray-700"
              }`}
              title={p.caption || ""}
            >
              {/* Open full image in new tab */}
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="block focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <img
                  src={p.url}
                  alt={p.caption || "Grow photo"}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-40 object-cover bg-gray-100"
                />
              </a>

              {/* Select checkbox (only in select mode) */}
              {selectMode && (
                <label className="absolute left-2 top-2 z-20 bg-black/40 rounded px-1.5 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mr-1 align-middle"
                    checked={isSelected}
                    onChange={() => toggleSelect(p.id)}
                  />
                  <span className="text-white text-xs align-middle">Select</span>
                </label>
              )}

              {/* Cover badge */}
              {isCover ? (
                <span className="absolute left-2 bottom-2 z-10 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                  Cover
                </span>
              ) : null}

              {/* Per-tile Delete (hidden during select mode) */}
              {!selectMode && (
                <button
                  onClick={async () => {
                    if (!(await confirm(confirmText))) return;
                    try {
                      await deletePhoto(p);
                    } catch (e) {
                      // eslint-disable-next-line no-alert
                      alert(e?.message || String(e));
                    }
                  }}
                  className="absolute right-2 top-2 z-20 rounded-md bg-red-600/90 px-2 py-1 text-xs text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400"
                  aria-label="Delete photo"
                  title="Delete photo"
                >
                  Delete
                </button>
              )}

              {/* Caption display / edit */}
              <figcaption className="p-2 text-xs text-gray-700 dark:text-gray-300">
                {!isEditing ? (
                  <div className="flex items-center gap-2">
                    <div className="font-medium truncate flex-1">{p.caption || "—"}</div>
                    <button
                      className="chip px-2 py-0.5 text-[11px]"
                      onClick={() => beginEdit(p)}
                      title="Edit caption"
                    >
                      ✎ Edit
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-zinc-900 px-2 py-1"
                      value={editingCaption}
                      onChange={(e) => setEditingCaption(e.target.value)}
                      placeholder="Caption…"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                    <button className="chip px-2 py-0.5 text-[11px]" onClick={saveEdit}>
                      Save
                    </button>
                    <button className="btn-outline px-2 py-0.5 text-[11px]" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </div>
                )}
                {p.createdAt ? (
                  <div className="opacity-70 mt-1">
                    {p.stage || "General"} ·{" "}
                    {typeof p.createdAt?.toDate === "function"
                      ? p.createdAt.toDate().toLocaleString()
                      : new Date(p.createdAt || Date.now()).toLocaleString()}
                  </div>
                ) : null}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
