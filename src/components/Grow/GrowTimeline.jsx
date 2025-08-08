// src/components/Grow/GrowTimeline.jsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";

// Canonical stage order
const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];

export default function GrowTimeline({
  grows = [],
  onUpdateStage,
  onUpdateStageDate,
}) {
  const items = useMemo(() => {
    const arr = Array.isArray(grows) ? [...grows] : [];
    // sort newest first (by created/stage date fallback)
    arr.sort((a, b) => {
      const ad = getTimeForSort(a);
      const bd = getTimeForSort(b);
      return bd - ad;
    });
    return arr;
  }, [grows]);

  return (
    <div className="space-y-4">
      {items.map((g) => (
        <GrowRow
          key={g.id}
          grow={g}
          onUpdateStage={onUpdateStage}
          onUpdateStageDate={onUpdateStageDate}
        />
      ))}
      {items.length === 0 && (
        <div className="text-sm opacity-70">No grows yet.</div>
      )}
    </div>
  );
}

function GrowRow({ grow, onUpdateStage, onUpdateStageDate }) {
  const { title, subLabel } = useMemo(() => {
    const name = grow.strain || "Unknown";
    const sub =
      grow.abbreviation ||
      grow.subname ||
      (grow.id ? `#${grow.id.slice(0, 8)}` : "");
    return { title: name, subLabel: sub };
  }, [grow]);

  const stage = grow.stage || "Inoculated";

  const advanceStage = () => {
    const idx = STAGES.indexOf(stage);
    if (idx < 0 || idx === STAGES.length - 1) return;
    const next = STAGES[idx + 1];
    onUpdateStage?.(grow.id, next);
  };

  const dates = grow.stageDates || {};
  const valueOf = (s) =>
    toInputDate(
      dates[s] ||
        (s === "Inoculated" ? grow.createdDate || grow.createdAt : null)
    );

  const setDate = (s, v) => {
    const iso = v || "";
    onUpdateStageDate?.(grow.id, s, iso);
  };

  return (
    <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
      {/* Header: title + subname */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold truncate">
            {title}
            {subLabel ? (
              <span className="ml-2 text-xs opacity-70">({subLabel})</span>
            ) : null}
          </div>

          {/* Stage chips */}
          <div className="mt-2 flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <span
                key={s}
                className={`px-2 py-1 rounded-full text-xs border ${
                  stage === s
                    ? "accent-chip"
                    : "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to={`/quick/${grow.id}`}
            className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-xs"
          >
            Notes &amp; Photos
          </Link>
          <button
            onClick={advanceStage}
            disabled={stage === "Harvested"}
            className="px-3 py-1.5 rounded-lg accent-bg text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            title={stage === "Harvested" ? "Already at final stage" : "Advance Stage"}
          >
            Advance Stage
          </button>
        </div>
      </div>

      {/* Dates grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DateField
          label="Inoculated Date"
          value={valueOf("Inoculated")}
          onChange={(v) => setDate("Inoculated", v)}
        />
        <DateField
          label="Colonizing Date"
          value={valueOf("Colonizing")}
          onChange={(v) => setDate("Colonizing", v)}
        />
        <DateField
          label="Colonized Date"
          value={valueOf("Colonized")}
          onChange={(v) => setDate("Colonized", v)}
        />
        <DateField
          label="Fruiting Date"
          value={valueOf("Fruiting")}
          onChange={(v) => setDate("Fruiting", v)}
        />
        <DateField
          label="Harvested Date"
          value={valueOf("Harvested")}
          onChange={(v) => setDate("Harvested", v)}
        />
      </div>
    </div>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="text-xs mb-1 opacity-70">{label}</div>
      <div className="relative">
        <input
          type="date"
          value={value || ""}
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 pr-10"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 select-none">
          ⌚
        </span>
      </div>
    </label>
  );
}

/* -------- utils -------- */

function getTimeForSort(g) {
  const s =
    g?.stageDates?.Harvested ||
    g?.stageDates?.Colonized ||
    g?.stageDates?.Inoculated ||
    g?.createdDate ||
    g?.createdAt;
  const d = toDate(s);
  return d ? d.getTime() : 0;
}

function toInputDate(raw) {
  const d = toDate(raw);
  return d ? d.toISOString().slice(0, 10) : "";
}

function toDate(raw) {
  if (!raw) return null;
  try {
    if (raw?.toDate) return raw.toDate();
    if (raw instanceof Date) return raw;
    if (typeof raw === "number") return new Date(raw);
    // Support "MM/DD/YYYY" or ISO
    const asStr = String(raw);
    if (/^\d{4}-\d{2}-\d{2}/.test(asStr)) return new Date(asStr);
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(asStr)) {
      const [m, d, y] = asStr.split("/").map((n) => parseInt(n, 10));
      return new Date(y, m - 1, d);
    }
    const d2 = new Date(asStr);
    return isNaN(d2) ? null : d2;
  } catch {
    return null;
  }
}
