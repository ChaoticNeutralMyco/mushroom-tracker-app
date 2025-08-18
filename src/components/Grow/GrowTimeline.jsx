// src/components/Grow/GrowTimeline.jsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";

// Firestore fallbacks (only used if parent doesn't pass handlers)
import { db, auth } from "../../firebase-config";
import { doc, updateDoc, runTransaction } from "firebase/firestore";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];

function isBulkGrow(g) {
  if (g?.isBulk === true) return true;
  const t = String(g?.type || g?.growType || g?.container || "").toLowerCase();
  return t.includes("bulk") || t.includes("tub") || t.includes("monotub");
}
function allowedStagesForGrow(g) {
  return isBulkGrow(g) ? STAGES : STAGES.slice(0, 3);
}
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function firstNumber(values) { for (const v of values) { const n = numOrNull(v); if (n !== null) return n; } return null; }
function isConsumableType(g) {
  const t = String(g?.type || g?.growType || g?.container || "").toLowerCase();
  return t.includes("grain") || t.includes("jar") || t.includes("lc") || t.includes("liquid") || t.includes("agar") || t.includes("plate") || t.includes("slant");
}
function isTimelineVisible(g) {
  if (!g) return false;
  if (g.archived === true) return false;
  const status = String(g.status || "").toLowerCase();
  if (status === "archived" || status === "contaminated") return false;
  if (g.active === false) return false;
  if (isConsumableType(g)) {
    const remaining = firstNumber([g.amountAvailable, g.unitsRemaining, g.volumeRemaining, g.jarsRemaining]) ?? Infinity;
    if (remaining <= 0) return false;
    if (g.empty || g.consumed || g.usedUp) return false;
  }
  return true; // keep bulk @ Harvested visible on Timeline
}

function yyyymmdd(iso){ if(!iso) return ""; return iso.replace(/-/g,"").slice(0,8); }
function regenerateAbbreviation(g, inocISO){
  const date = yyyymmdd(inocISO); if(!date) return null;
  const existing = g?.abbreviation || g?.subname || g?.code || g?.labelCode || "";
  if (existing){
    const parts = existing.split("-"); const last = parts[parts.length-1] || "";
    if(/^\d{6,8}$/.test(last)){ parts[parts.length-1]=date; return parts.join("-"); }
    return `${existing}-${date}`;
  }
  const strain=(g?.strain||g?.strainName||"GROW").trim();
  const initials=strain.split(/\s+/).map(w=>w[0]).filter(Boolean).join("").toUpperCase();
  const mid=isConsumableType(g)?"GJ":isBulkGrow(g)?"BK":"GR";
  return `${initials}-${mid}-${date}`;
}

export default function GrowTimeline({
  grows = [],
  onUpdateStage,
  onUpdateStageDate,
  onAdvanceStageWithDate,
  onUpdateAbbreviation,
  onAddFlush,
  onUpdateFlush,
  onFinishHarvest,
}) {
  const items = useMemo(() => {
    const arr = Array.isArray(grows) ? grows.filter(isTimelineVisible) : [];
    arr.sort((a,b)=>getTimeForSort(b)-getTimeForSort(a));
    return arr;
  }, [grows]);

  // Firestore fallbacks if parent didn't provide handlers
  const fb = {
    addFlush: async (growId) => {
      if (onAddFlush) return onAddFlush(growId);
      const uid = auth.currentUser?.uid; if (!uid) return;
      const ref = doc(db, "users", uid, "grows", growId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() || {};
        const existing = Array.isArray(data.flushes)
          ? data.flushes.slice()
          : Array.isArray(data?.harvest?.flushes)
          ? data.harvest.flushes.slice()
          : [];
        // Firestore DOES NOT allow serverTimestamp() inside arrays → use client time
        existing.push({ wet: 0, dry: 0, createdAt: Date.now() });
        tx.update(ref, { flushes: existing });
      });
    },
    updateFlush: async (growId, index, patch) => {
      if (onUpdateFlush) return onUpdateFlush(growId, index, patch);
      const uid = auth.currentUser?.uid; if (!uid) return;
      const ref = doc(db, "users", uid, "grows", growId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() || {};
        const arr = Array.isArray(data.flushes)
          ? data.flushes.slice()
          : Array.isArray(data?.harvest?.flushes)
          ? data.harvest.flushes.slice()
          : [];
        if (!arr[index]) arr[index] = { wet: 0, dry: 0 };
        arr[index] = { ...arr[index], ...patch };
        tx.update(ref, { flushes: arr });
      });
    },
    finishHarvest: async (growId) => {
      if (onFinishHarvest) return onFinishHarvest(growId);
      const uid = auth.currentUser?.uid; if (!uid) return;
      await updateDoc(doc(db, "users", uid, "grows", growId), {
        archived: true,
        status: "Archived",
      });
    },
  };

  return (
    <div className="space-y-4">
      {items.map((g) => (
        <GrowRow
          key={g.id}
          grow={g}
          onUpdateStage={onUpdateStage}
          onUpdateStageDate={onUpdateStageDate}
          onAdvanceStageWithDate={onAdvanceStageWithDate}
          onUpdateAbbreviation={onUpdateAbbreviation}
          fb={fb}
        />
      ))}
      {items.length === 0 && <div className="text-sm opacity-70">No active grows right now.</div>}
    </div>
  );
}

function GrowRow({
  grow,
  onUpdateStage,
  onUpdateStageDate,
  onAdvanceStageWithDate,
  onUpdateAbbreviation,
  fb,
}) {
  const { title, subLabel } = useMemo(() => {
    const name = grow.strain || grow.strainName || grow.name || grow.title || "Unknown";
    const sub = grow.abbreviation || grow.subname || (grow.id ? `#${grow.id.slice(0, 8)}` : "");
    return { title: name, subLabel: sub };
  }, [grow]);

  const bulk = isBulkGrow(grow);
  const ALLOWED = allowedStagesForGrow(grow);
  const stage = ALLOWED.includes(grow.stage) ? grow.stage : ALLOWED[0];
  const stageIdx = ALLOWED.indexOf(stage);

  const advanceStage = () => {
    if (stageIdx < 0 || stageIdx === ALLOWED.length - 1) return;
    const next = ALLOWED[stageIdx + 1];
    onUpdateStage?.(grow.id, next);
  };

  const dates = grow.stageDates || {};
  const valueOf = (s) =>
    toInputDate(dates[s] || (s === "Inoculated" ? grow.createdDate || grow.createdAt : null));

  const setDate = (s, v) => {
    const iso = v || "";
    onUpdateStageDate?.(grow.id, s, iso);

    if (s === "Inoculated" && iso) {
      const nextAbbr = regenerateAbbreviation(grow, iso);
      if (nextAbbr) onUpdateAbbreviation?.(grow.id, nextAbbr);
    }

    if (iso && ALLOWED.includes(s)) {
      const newIdx = ALLOWED.indexOf(s);
      if (newIdx > stageIdx) {
        if (onAdvanceStageWithDate) onAdvanceStageWithDate(grow.id, s, iso);
        else {
          onUpdateStage?.(grow.id, s);
          setTimeout(() => onUpdateStageDate?.(grow.id, s, iso), 0);
        }
      }
    }
  };

  const flushes =
    grow.flushes ||
    (grow.harvest && Array.isArray(grow.harvest.flushes) ? grow.harvest.flushes : []) ||
    [];

  const showHarvestPanel = bulk && (stage === "Harvested" || (flushes && flushes.length > 0));

  const totals = flushes.reduce(
    (acc, f) => {
      const wet = Number(f?.wet) || 0;
      const dry = Number(f?.dry) || 0;
      acc.wet += wet; acc.dry += dry;
      return acc;
    },
    { wet: 0, dry: 0 }
  );

  return (
    <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold truncate">
            {title}{subLabel ? <span className="ml-2 text-xs opacity-70">({subLabel})</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {ALLOWED.map((s) => (
              <span
                key={s}
                className={`px-2 py-1 rounded-full text-xs border ${
                  stage === s
                    ? "bg-emerald-600 text-white border-transparent"
                    : "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link to={`/quick/${grow.id}`} className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-xs">
            Notes &amp; Photos
          </Link>
          <button
            onClick={advanceStage}
            disabled={stage === ALLOWED[ALLOWED.length - 1]}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            title={stage === ALLOWED[ALLOWED.length - 1] ? "Already at final stage" : "Advance Stage"}
          >
            Advance Stage
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ALLOWED.includes("Inoculated") && (
          <DateField label="Inoculated Date" value={valueOf("Inoculated")} onChange={(v)=>setDate("Inoculated",v)} />
        )}
        {ALLOWED.includes("Colonizing") && (
          <DateField label="Colonizing Date" value={valueOf("Colonizing")} onChange={(v)=>setDate("Colonizing",v)} />
        )}
        {ALLOWED.includes("Colonized") && (
          <DateField label="Colonized Date" value={valueOf("Colonized")} onChange={(v)=>setDate("Colonized",v)} />
        )}
        {ALLOWED.includes("Fruiting") && (
          <DateField label="Fruiting Date" value={valueOf("Fruiting")} onChange={(v)=>setDate("Fruiting",v)} />
        )}
        {ALLOWED.includes("Harvested") && (
          <DateField label="Harvested Date" value={valueOf("Harvested")} onChange={(v)=>setDate("Harvested",v)} />
        )}
      </div>

      {showHarvestPanel && (
        <div className="mt-3 rounded-lg border border-zinc-300 dark:border-zinc-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-medium">Harvest (per flush)</div>
            <div className="text-xs opacity-70">Totals: <b>{fmtGram(totals.wet)}</b> wet · <b>{fmtGram(totals.dry)}</b> dry</div>
          </div>

          <div className="space-y-2">
            {flushes.length === 0 && <div className="text-xs opacity-70">No flushes recorded yet.</div>}
            {flushes.map((flush, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <LabeledNumber
                  label={`Flush #${idx + 1} — Wet (g)`}
                  value={safeNum(flush.wet)}
                  onChange={(v) => fb.updateFlush(grow.id, idx, { wet: v })}
                  min={0}
                  step={0.1}
                />
                <LabeledNumber
                  label="Dry (g)"
                  value={safeNum(flush.dry)}
                  onChange={(v) => fb.updateFlush(grow.id, idx, { dry: v })}
                  min={0}
                  step={0.1}
                />
                <div className="text-xs opacity-60 sm:text-right">
                  {flush.note ? flush.note : <>&nbsp;</>}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => fb.addFlush(grow.id)}
              className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs"
            >
              + Add flush
            </button>

            <div className="flex-1" />

            <button
              onClick={() => fb.finishHarvest(grow.id)}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
              title="Finish harvest & archive this grow"
            >
              Finish harvest &amp; Archive
            </button>
          </div>
        </div>
      )}
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
        <span className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 select-none">⌚</span>
      </div>
    </label>
  );
}

function LabeledNumber({ label, value, onChange, min = 0, step = 1 }) {
  return (
    <label className="block">
      <div className="text-xs mb-1 opacity-70">{label}</div>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange?.(parseFloat(e.target.value || "0") || 0)}
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
      />
    </label>
  );
}

function getTimeForSort(g) {
  const s = g?.stageDates?.Harvested || g?.stageDates?.Colonized || g?.stageDates?.Inoculated || g?.createdDate || g?.createdAt;
  const d = toDate(s);
  return d ? d.getTime() : 0;
}
function toInputDate(raw) { const d = toDate(raw); return d ? d.toISOString().slice(0, 10) : ""; }
function toDate(raw) {
  if (!raw) return null;
  try {
    if (raw?.toDate) return raw.toDate();
    if (raw instanceof Date) return raw;
    if (typeof raw === "number") return new Date(raw);
    const asStr = String(raw);
    if (/^\d{4}-\d{2}-\d{2}/.test(asStr)) return new Date(asStr);
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(asStr)) { const [m,d,y] = asStr.split("/").map(n=>parseInt(n,10)); return new Date(y, m-1, d); }
    const d2 = new Date(asStr); return isNaN(d2) ? null : d2;
  } catch { return null; }
}
function safeNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmtGram(g) { const n = Math.round((Number(g)||0)*10)/10; return `${n}g`; }
