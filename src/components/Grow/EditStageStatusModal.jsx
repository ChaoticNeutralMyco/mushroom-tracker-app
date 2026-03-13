// src/components/Grow/EditStageStatusModal.jsx
import React, { useEffect, useMemo, useState } from "react";

const BULK_STAGES = [
  "Inoculated",
  "Colonizing",
  "Colonized",
  "Fruiting",
  "Harvesting",
  "Harvested",
];

const NON_BULK_STAGES = ["Inoculated", "Colonizing", "Colonized"];

const TERMINAL_STAGES = ["Consumed", "Contaminated"];
const BASE_STATUSES = ["Active", "Stored", "Archived", "Contaminated"];

function normalizeType(t = "") {
  const s = String(t || "").toLowerCase();
  if (s.includes("agar")) return "Agar";
  if (s.includes("lc") || s.includes("liquid")) return "LC";
  if (s.includes("grain")) return "Grain Jar";
  if (s.includes("bulk")) return "Bulk";
  return "Other";
}

function isBulkGrow(grow) {
  if (grow?.isBulk === true) return true;
  return normalizeType(grow?.type || grow?.growType || grow?.container || "") === "Bulk";
}

function allowedStagesForGrow(grow) {
  return isBulkGrow(grow) ? BULK_STAGES : NON_BULK_STAGES;
}

function stageOptionsForGrow(grow) {
  const base = allowedStagesForGrow(grow);
  const current = String(grow?.stage || "").trim();
  const set = new Set([...base, ...TERMINAL_STAGES]);
  if (current) set.add(current);
  return Array.from(set);
}

function statusOptionsForGrow(grow) {
  const t = normalizeType(grow?.type || grow?.growType || grow?.container || "");
  const current = String(grow?.status || "").trim();
  const set = new Set(BASE_STATUSES);

  if (!(t === "Agar" || t === "LC")) {
    set.delete("Stored");
  }

  if (current) set.add(current);
  return Array.from(set);
}

function deriveStatusFromStage(stage, prevStatus) {
  if (stage === "Harvested" || stage === "Consumed") return "Archived";
  if (stage === "Contaminated") return "Contaminated";
  return prevStatus;
}

function deriveStageFromStatus(status, prevStage, grow) {
  if (status === "Contaminated") return "Contaminated";

  const allowed = allowedStagesForGrow(grow);
  if (status === "Active") {
    if (prevStage === "Contaminated" || prevStage === "Consumed") {
      return allowed[0];
    }
  }

  return prevStage;
}

export default function EditStageStatusModal({
  grow,
  onUpdateStage,
  onUpdateStatus,
  onClose,
}) {
  const initialStage = useMemo(() => grow?.stage || "Inoculated", [grow]);
  const initialStatus = useMemo(() => grow?.status || "Active", [grow]);

  const stageOptions = useMemo(() => stageOptionsForGrow(grow), [grow]);
  const statusOptions = useMemo(() => statusOptionsForGrow(grow), [grow]);
  const typeLabel = useMemo(
    () => normalizeType(grow?.type || grow?.growType || grow?.container || ""),
    [grow]
  );

  const [stage, setStage] = useState(initialStage);
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStage(initialStage);
    setStatus(initialStatus);
  }, [initialStage, initialStatus, grow?.id]);

  const handleStageChange = (nextStage) => {
    setStage(nextStage);
    setStatus((prev) => deriveStatusFromStage(nextStage, prev));
  };

  const handleStatusChange = (nextStatus) => {
    setStatus(nextStatus);
    setStage((prev) => deriveStageFromStatus(nextStatus, prev, grow));
  };

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

  const nothingChanged = stage === initialStage && status === initialStatus;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !saving && onClose && onClose()}
      />

      <div className="relative z-10 w-full max-w-lg mx-auto rounded-2xl bg-zinc-900 text-white shadow-xl border border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div>
            <h3 className="text-lg font-semibold">Edit Grow</h3>
            <div className="text-xs text-zinc-400 mt-0.5">
              {grow?.strain || "Unknown strain"} · {typeLabel}
            </div>
          </div>
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
              onChange={(e) => handleStageChange(e.target.value)}
              disabled={saving}
            >
              {stageOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-zinc-500">
              Allowed progression for {typeLabel}:{" "}
              {allowedStagesForGrow(grow).join(" → ")}
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1 text-zinc-300">Status</label>
            <select
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2"
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={saving}
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-zinc-500">
              Harvested and Consumed default to Archived. Contaminated syncs to the Contaminated stage.
            </div>
          </div>
        </div>

        <div className="px-4 py-3 flex items-center justify-end gap-2 border-t border-zinc-800">
          <button
            className="btn disabled:opacity-60"
            onClick={() => onClose && onClose()}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="btn btn-accent disabled:opacity-60"
            onClick={handleSave}
            disabled={saving || nothingChanged}
          >
            {saving ? "Saving…" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}