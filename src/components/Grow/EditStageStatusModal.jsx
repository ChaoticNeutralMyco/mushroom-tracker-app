// src/components/Grow/EditStageStatusModal.jsx
import React, { useMemo, useState } from "react";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];
const STATUSES = ["Active", "Archived", "Contaminated"];

export default function EditStageStatusModal({
  grow,
  onUpdateStage,     // (growId, nextStage) => Promise<void>
  onUpdateStatus,    // (growId, status) => Promise<void>
  onClose,           // () => void
}) {
  const initialStage = useMemo(() => grow?.stage || "Inoculated", [grow]);
  const initialStatus = useMemo(() => grow?.status || "Active", [grow]);

  const [stage, setStage] = useState(initialStage);
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!grow?.id) return;
    setSaving(true);
    try {
      const ops = [];
      if (stage !== initialStage && onUpdateStage) {
        ops.push(onUpdateStage(grow.id, stage));
      }
      if (status !== initialStatus && onUpdateStatus) {
        ops.push(onUpdateStatus(grow.id, status));
      }
      await Promise.all(ops);
      onClose && onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !saving && onClose && onClose()}
      />
      {/* modal */}
      <div className="relative z-10 w-full max-w-lg mx-auto rounded-2xl bg-zinc-900 text-white shadow-xl border border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-lg font-semibold">Edit Grow</h3>
          <button
            className="text-zinc-400 hover:text-white"
            onClick={() => !saving && onClose && onClose()}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm mb-1 text-zinc-300">Stage</label>
            <select
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              disabled={saving}
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1 text-zinc-300">Status</label>
            <select
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={saving}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-4 py-3 flex items-center justify-end gap-2 border-t border-zinc-800">
          <button
            className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60"
            onClick={() => onClose && onClose()}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
            onClick={handleSave}
            disabled={saving || (stage === initialStage && status === initialStatus)}
          >
            {saving ? "Saving…" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}
