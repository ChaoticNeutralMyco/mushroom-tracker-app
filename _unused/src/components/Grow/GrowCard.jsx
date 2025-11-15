// src/components/Grow/GrowCard.jsx
import React, { useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { db, auth } from "../../firebase-config";
import { updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { useConfirm } from "../ui/ConfirmDialog";

/**
 * GrowCard
 * Single-row card for a grow with the same actions/wording used elsewhere:
 * - Stage +
 * - Archive/Unarchive
 * - Store/Unstore (Agar/LC only)
 * - Edit
 * - Delete
 *
 * Props supported (all optional; will fall back to Firestore writes if not provided):
 *   - grow (required): the grow document object (must include id)
 *   - setEditingGrow: function to open edit UI (called with grow)
 *   - onUpdateStatus(id, next): optimistic/centralized status updates
 *   - onUpdateStage(id, next): optimistic/centralized stage updates
 *   - onDeleteGrow(id): centralized delete logic
 *   - showNotesLink (bool): show "Notes" quick link (default true)
 *   - className (string): extra classes for container
 *
 * Keyboard/ARIA:
 * - The ConfirmDialog provider handles ESC=cancel, ENTER=confirm.
 * - Buttons include aria-labels/titles for accessibility.
 */

export default function GrowCard({
  grow,
  setEditingGrow,
  onUpdateStatus,
  onUpdateStage,
  onDeleteGrow,
  showNotesLink = true,
  className = "",
}) {
  const confirm = useConfirm();

  // ---------- Helpers ----------
  const STAGE_FLOW = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested", "Consumed"];

  const normalizeType = (t = "") => {
    const s = String(t).toLowerCase();
    if (s.includes("agar")) return "Agar";
    if (s.includes("lc") || s.includes("liquid")) return "LC";
    if (s.includes("grain")) return "Grain Jar";
    if (s.includes("bulk")) return "Bulk";
    return "Other";
  };
  const normalizeStage = (st = "") => {
    const s = String(st).toLowerCase();
    if (s.startsWith("inoc")) return "Inoculated";
    if (s.includes("colonizing")) return "Colonizing";
    if (s.includes("colonized")) return "Colonized";
    if (s.includes("fruit")) return "Fruiting";
    if (s.includes("harvest")) return "Harvested";
    if (s.includes("consum")) return "Consumed";
    if (s.includes("contam")) return "Contaminated";
    return "Other";
  };
  const nextStageOf = (cur) => {
    const idx = STAGE_FLOW.indexOf(cur);
    return idx >= 0 && idx < STAGE_FLOW.length - 1 ? STAGE_FLOW[idx + 1] : null;
  };
  const canStoreType = (g) => {
    const t = normalizeType(g?.type || g?.growType);
    return t === "Agar" || t === "LC";
  };

  // ---------- Derived display fields ----------
  const title = useMemo(() => {
    return grow?.abbreviation || grow?.abbr || grow?.subName || grow?.strain || "Unknown strain";
  }, [grow]);

  const inoc = useMemo(() => {
    const raw = (grow?.inoc || grow?.inoculationDate || grow?.createdAt || "");
    return raw ? String(raw).slice(0, 10) : "—";
  }, [grow]);

  const typeLabel = useMemo(() => grow?.type || grow?.growType || "—", [grow]);

  const costNumber = useMemo(() => {
    const v = grow?.cost;
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  }, [grow]);

  const stage = useMemo(() => grow?.stage || "—", [grow]);
  const status = useMemo(() => grow?.status || "—", [grow]);
  const curNorm = useMemo(() => normalizeStage(stage), [stage]);
  const atEnd = useMemo(
    () => STAGE_FLOW.indexOf(curNorm) === STAGE_FLOW.length - 1 || curNorm === "Other",
    [curNorm]
  );

  // ---------- Firestore fallbacks (if no callbacks provided) ----------
  const uid = auth.currentUser?.uid || null;
  const applyStatus = useCallback(
    async (id, next) => {
      if (typeof onUpdateStatus === "function") return onUpdateStatus(id, next);
      if (!uid) return;
      await updateDoc(doc(db, "users", uid, "grows", id), { status: next });
    },
    [onUpdateStatus, uid]
  );

  const applyStage = useCallback(
    async (id, next) => {
      if (typeof onUpdateStage === "function") return onUpdateStage(id, next);
      if (!uid) return;
      await updateDoc(doc(db, "users", uid, "grows", id), {
        stage: next,
        [`stageDates.${next}`]: serverTimestamp(),
      });
    },
    [onUpdateStage, uid]
  );

  const applyDelete = useCallback(
    async (id) => {
      if (typeof onDeleteGrow === "function") return onDeleteGrow(id);
      if (!uid) return;
      await deleteDoc(doc(db, "users", uid, "grows", id));
    },
    [onDeleteGrow, uid]
  );

  // ---------- Actions with confirms (identical wording) ----------
  const handleStoreToggle = async () => {
    if (!grow?.id) return;
    const isStored = String(grow?.status || "").toLowerCase() === "stored";
    const next = isStored ? "Active" : "Stored";
    const ok = await confirm(`${isStored ? "Unstore" : "Store"} this grow?`);
    if (!ok) return;
    await applyStatus(grow.id, next);
  };

  const handleNextStage = async () => {
    if (!grow?.id) return;
    const next = nextStageOf(curNorm);
    if (!next) return;
    const ok = await confirm(`Advance stage to "${next}"?`);
    if (!ok) return;
    await applyStage(grow.id, next);
  };

  const handleArchiveToggle = async () => {
    if (!grow?.id) return;
    const statusLower = String(grow?.status || "").toLowerCase();
    const next = statusLower === "archived" ? "Active" : "Archived";
    const ok = await confirm(`${statusLower === "archived" ? "Unarchive" : "Archive"} this grow?`);
    if (!ok) return;
    await applyStatus(grow.id, next);
  };

  const handleDelete = async () => {
    if (!grow?.id) return;
    const ok = await confirm("Delete this grow? This cannot be undone.");
    if (!ok) return;
    await applyDelete(grow.id);
  };

  // ---------- UI ----------
  return (
    <div
      className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 ${className}`}
      role="group"
      aria-label={`Grow ${title}`}
    >
      <div className="grid grid-cols-12 items-center gap-3">
        {/* Cover + Title */}
        <div className="col-span-5 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            {grow?.coverUrl ? (
              <img
                src={grow.coverUrl}
                alt=""
                className="w-14 h-14 rounded object-cover border border-zinc-200 dark:border-zinc-700 flex-none"
                loading="lazy"
              />
            ) : null}
            <div className="min-w-0">
              {grow?.id ? (
                <Link
                  to={`/grow/${grow.id}`}
                  className="font-medium truncate hover:underline focus:underline block"
                  title="Open grow details"
                >
                  {title}
                </Link>
              ) : (
                <span className="font-medium truncate block">{title}</span>
              )}
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {grow?.strain || "Unknown strain"}
              </div>
            </div>
          </div>
        </div>

        {/* Type / Inoc / Cost */}
        <div className="col-span-3 min-w-0">
          <div className="text-sm truncate">{typeLabel}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
            Inoc: {inoc}
            {costNumber !== null ? (
              <>
                {" · "}Cost: <strong>${costNumber.toFixed(2)}</strong>
              </>
            ) : null}
          </div>
        </div>

        {/* Stage / Status */}
        <div className="col-span-2 min-w-0">
          <div className="text-sm truncate">Stage: {stage}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">Status: {status}</div>
        </div>

        {/* Actions */}
        <div className="col-span-2 flex justify-end gap-2 whitespace-nowrap">
          <button
            type="button"
            className={`chip text-xs ${atEnd ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={!atEnd ? handleNextStage : undefined}
            title={atEnd ? "No next stage" : "Advance to next stage"}
            aria-disabled={atEnd}
          >
            Stage +
          </button>

          <button
            type="button"
            className="chip text-xs"
            onClick={handleArchiveToggle}
            title={String(status).toLowerCase() === "archived" ? "Unarchive" : "Archive"}
          >
            {String(status).toLowerCase() === "archived" ? "Unarchive" : "Archive"}
          </button>

          {showNotesLink && grow?.id ? (
            <Link to={`/quick/${grow.id}`} className="chip text-xs" title="Notes & Photos quick view">
              Notes
            </Link>
          ) : null}

          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => setEditingGrow && setEditingGrow(grow)}
            aria-label={`Edit ${title}`}
            title="Edit"
          >
            Edit
          </button>

          <button type="button" className="chip text-xs" onClick={handleDelete} title="Delete" aria-label="Delete grow">
            Delete
          </button>

          {canStoreType(grow) && (
            <button
              type="button"
              className="chip text-xs"
              onClick={handleStoreToggle}
              title={String(status).toLowerCase() === "stored" ? "Unstore" : "Store"}
            >
              {String(status).toLowerCase() === "stored" ? "Unstore" : "Store"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
