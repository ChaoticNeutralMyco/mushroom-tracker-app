// src/components/Grow/GrowTimeline.jsx
import React, { useMemo, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { db, auth } from "../../firebase-config";
import { doc, updateDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { getGrowTypeIconPath } from "../../lib/grow-images";
import { isArchivedish } from "../../lib/growFilters";
import { enqueueReusablesForGrow } from "../../lib/clean-queue";

const STAGES_BULK = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvesting", "Harvested"];
const STAGES_NON_BULK = ["Inoculated", "Colonizing", "Colonized"];

function isBulkGrow(g) {
  if (g?.isBulk === true) return true;
  const t = String(g?.type || g?.growType || g?.container || "").toLowerCase();
  return t.includes("bulk") || t.includes("tub") || t.includes("monotub");
}
function allowedStagesForGrow(g) {
  return isBulkGrow(g) ? STAGES_BULK : STAGES_NON_BULK;
}
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function firstNumber(values) { for (const v of values) { const n = numOrNull(v); if (n !== null) return n; } return null; }
function isConsumableType(g) {
  const t = String(g?.type || g?.growType || g?.container || "").toLowerCase();
  return t.includes("grain") || t.includes("jar") || t.includes("lc") || t.includes("liquid") || t.includes("agar") || t.includes("plate") || t.includes("slant");
}

// Timeline-visible = not archived + not contaminated + has remaining (for consumables)
// Also hide Harvested from Active for legacy safety.
function isTimelineVisible(g) {
  if (!g) return false;
  if (isArchivedish(g)) return false;
  const stageLc = String(g.stage || "").toLowerCase();
  if (stageLc === "harvested") return false;
  const status = String(g.status || "").toLowerCase();
  if (status === "contaminated") return false;
  if (g.active === false) return false;

  if (isConsumableType(g)) {
    const remaining = firstNumber([g.amountAvailable, g.unitsRemaining, g.volumeRemaining, g.jarsRemaining]) ?? Infinity;
    if (remaining <= 0) return false;
    if (g.empty || g.consumed || g.usedUp) return false;
  }
  return true;
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

function isValidISODate(s){
  return typeof s==="string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
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
  const [view, setView] = useState("active");
  const [sortFrozen, setSortFrozen] = useState(false);
  const frozenOrderRef = useRef/** @type {string[]} */([]);
  const [optimisticallyHidden, setOptimisticallyHidden] = useState(() => new Set());

  const freezeSorting = useCallback((currentIds) => {
    if (!sortFrozen) {
      frozenOrderRef.current = currentIds.slice();
      setSortFrozen(true);
    }
  }, [sortFrozen]);

  const unfreezeSorting = useCallback(() => {
    frozenOrderRef.current = [];
    setSortFrozen(false);
  }, []);

  const filtered = useMemo(() => {
    const arr = Array.isArray(grows) ? [...grows] : [];
    const base = (view === "active")
      ? arr.filter(isTimelineVisible)
      : (view === "archived")
        ? arr.filter(isArchivedish)
        : arr.filter((g) => isTimelineVisible(g) || isArchivedish(g));
    return base.filter(g => !optimisticallyHidden.has(g.id));
  }, [grows, view, optimisticallyHidden]);

  const items = useMemo(() => {
    const byTime = filtered.slice().sort((a, b) => getTimeForSort(b) - getTimeForSort(a));
    if (!sortFrozen || frozenOrderRef.current.length === 0) return byTime;
    const index = new Map(frozenOrderRef.current.map((id, i) => [id, i]));
    const inFrozen = []; const notFrozen = [];
    for (const g of byTime) (index.has(g.id) ? inFrozen : notFrozen).push(g);
    inFrozen.sort((a,b)=> index.get(a.id) - index.get(b.id));
    return inFrozen.concat(notFrozen);
  }, [filtered, sortFrozen]);

  // Firestore fallbacks if parent didn’t provide handlers
  const fb = {
    addFlush: async (growId) => {
      if (onAddFlush) return onAddFlush(growId);
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
        arr.push({ wet: 0, dry: 0, note: "", createdAt: Date.now() });
        tx.update(ref, { flushes: arr });
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
        if (!arr[index]) arr[index] = { wet: 0, dry: 0, note: "", createdAt: Date.now() };
        arr[index] = { ...arr[index], ...patch };
        tx.update(ref, { flushes: arr });
      });
    },
    deleteFlush: async (growId, index) => {
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
        if (index >= 0 && index < arr.length) {
          arr.splice(index, 1);
          tx.update(ref, { flushes: arr });
        }
      });
    },
    finishHarvest: async (growId, _ignoredUserISO) => {
      // Optimistically hide from Active list
      setOptimisticallyHidden(prev => { const next = new Set(prev); next.add(growId); return next; });
      if (onFinishHarvest) return onFinishHarvest(growId);
      const uid = auth.currentUser?.uid; if (!uid) return;

      const ref = doc(db, "users", uid, "grows", growId);

      // 🔧 Surgical fix: derive stageDates.Harvested from the LATEST flush date (YYYY-MM-DD)
      // and write harvestedAt as serverTimestamp().
      let harvestedLocal = null;
      const toLocalYYYYMMDD = (d) => {
        try {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          return `${y}-${m}-${day}`;
        } catch { return ""; }
      };

      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          const data = snap.data() || {};
          const arr = Array.isArray(data.flushes)
            ? data.flushes
            : Array.isArray(data?.harvest?.flushes)
            ? data.harvest.flushes
            : [];
          let latest = null;
          for (const f of arr) {
            const raw = (f && (f.createdAt ?? f.date ?? f.when)) ?? null;
            if (!raw) continue;
            let d;
            if (typeof raw === "number") d = new Date(raw < 100000000000 ? raw * 1000 : raw);
            else if (raw && typeof raw.toDate === "function") d = raw.toDate();
            else d = new Date(String(raw));
            if (!isNaN(d)) { if (!latest || d > latest) latest = d; }
          }
          if (latest) harvestedLocal = toLocalYYYYMMDD(latest);
        });
      } catch {}

      const patch = {
        stage: "Harvested",
        archived: true,
        status: "Archived",
        archivedAt: serverTimestamp(),
        harvestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (harvestedLocal) patch["stageDates.Harvested"] = harvestedLocal;

      await updateDoc(ref, patch);
      try { await enqueueReusablesForGrow(uid, growId); } catch {}
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs opacity-70">Show:</span>
        <Segment value={view} setValue={setView} />
      </div>

      {items.map((g) => (
        <GrowRow
          key={g.id}
          grow={g}
          onUpdateStage={onUpdateStage}
          onUpdateStageDate={onUpdateStageDate}
          onAdvanceStageWithDate={onAdvanceStageWithDate}
          onUpdateAbbreviation={onUpdateAbbreviation}
          fb={fb}
          onFreezeSorting={() => freezeSorting(items.map(i=>i.id))}
          onUnfreezeSorting={unfreezeSorting}
        />
      ))}
      {items.length === 0 && (
        <div className="text-sm opacity-70">
          {view === "active" ? "No active grows right now." : "Nothing to show."}
        </div>
      )}
    </div>
  );
}

function Segment({ value, setValue }) {
  const base = "px-3 py-1.5 rounded-full text-xs border";
  const onCls = "bg-emerald-600 text-white border-transparent";
  const off = "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700";
  return (
    <div className="inline-flex gap-1">
      <button className={`${base} ${value === "active" ? onCls : off}`} onClick={() => setValue("active")} type="button">
        Active
      </button>
      <button className={`${base} ${value === "archived" ? onCls : off}`} onClick={() => setValue("archived")} type="button">
        Archived
      </button>
      <button className={`${base} ${value === "all" ? onCls : off}`} onClick={() => setValue("all")} type="button">
        All
      </button>
    </div>
  );
}

function clampStage(allowed, current) {
  const order = STAGES_BULK; // global ordering
  const idxAll = order.indexOf(current);
  if (idxAll < 0) return allowed[0];
  const clampedIdx = Math.min(idxAll, allowed.length - 1);
  return allowed[clampedIdx];
}

function GrowRow({
  grow,
  onUpdateStage,
  onUpdateStageDate,
  onAdvanceStageWithDate,
  onUpdateAbbreviation,
  fb,
  onFreezeSorting,
  onUnfreezeSorting,
}) {
  const { title, subLabel } = useMemo(() => {
    const name = grow.strain || grow.strainName || grow.name || grow.title || "Unknown";
    const sub = grow.abbreviation || grow.subname || (grow.id ? `#${grow.id.slice(0, 8)}` : "");
    return { title: name, subLabel: sub };
  }, [grow]);

  const archived = isArchivedish(grow);

  const ALLOWED = allowedStagesForGrow(grow);
  const stageRaw = grow.stage || ALLOWED[0];
  theStage: { /* clamp to allowed to keep UI coherent */ }
  const stage = ALLOWED.includes(stageRaw) ? stageRaw : clampStage(ALLOWED, stageRaw);
  const stageIdx = ALLOWED.indexOf(stage);
  const isHarvesting = stage === "Harvesting";

  const advanceStage = () => {
    if (archived) return;
    if (stageIdx < 0 || stageIdx === ALLOWED.length - 1) return;
    const next = ALLOWED[stageIdx + 1];
    if (next === "Harvested") {
      fb.finishHarvest(grow.id);
    } else {
      onUpdateStage?.(grow.id, next);
    }
  };

  const dates = grow.stageDates || {};
  const valueOf = (s) =>
    toInputDate(dates[s] || (s === "Inoculated" ? grow.createdDate || grow.createdAt : null));

  const commitStageDate = (s, iso) => {
    if (archived) return;
    const v = iso || "";
    onUpdateStageDate?.(grow.id, s, v);

    if (s === "Inoculated" && v) {
      const nextAbbr = regenerateAbbreviation(grow, v);
      if (nextAbbr) onUpdateAbbreviation?.(grow.id, nextAbbr);
    }

    if (v && ALLOWED.includes(s)) {
      const newIdx = ALLOWED.indexOf(s);
      if (newIdx > stageIdx) {
        if (s === "Harvested") {
          if (onAdvanceStageWithDate) onAdvanceStageWithDate(grow.id, s, v);
          fb.finishHarvest(grow.id, v);
        } else {
          onUpdateStage?.(grow.id, s);
          // Re-commit exact date after the stage write to avoid any auto-stamp race
          setTimeout(() => onUpdateStageDate?.(grow.id, s, v), 0);
        }
      }
    }
  }; // fixed brace alignment

  const flushes =
    grow.flushes ||
    (grow.harvest && Array.isArray(grow.harvest.flushes) ? grow.harvest.flushes : []) ||
    [];

  const showHarvestPanel = isHarvesting && isBulkGrow(grow);

  const totals = flushes.reduce(
    (acc, f) => {
      const wet = Number(f?.wet) || 0;
      const dry = Number(f?.dry) || 0;
      acc.wet += wet; acc.dry += dry;
      return acc;
    },
    { wet: 0, dry: 0 }
  );

  const iconSrc = getGrowTypeIconPath(grow.type || grow.growType);

  return (
    <div className="rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <img
            src={iconSrc}
            alt=""
            className="w-10 h-10 rounded-md object-cover border border-zinc-200 dark:border-zinc-700"
            loading="lazy"
          />
          <div>
            <div className="text-lg font-semibold truncate">
              {title}
              {subLabel ? <span className="ml-2 text-xs opacity-70">({subLabel})</span> : null}
              {archived && (
                <span className="ml-2 px-2 py-0.5 text-[10px] rounded bg-zinc-200 dark:bg-zinc-700">
                  Archived
                </span>
              )}
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
        </div>

        <div className="flex items-center gap-2">
          <Link
            to={`/quick/${grow.id}`}
            className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-xs"
          >
            Notes &amp; Photos
          </Link>
          {!archived && (
            <button
              onClick={advanceStage}
              disabled={stage === ALLOWED[ALLOWED.length - 1]}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              title={stage === ALLOWED[ALLOWED.length - 1] ? "Already at final stage" : "Advance Stage"}
            >
              Advance Stage
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ALLOWED.includes("Inoculated") && (
          <StageDateField
            label="Inoculated Date"
            value={valueOf("Inoculated")}
            disabled={archived}
            onCommit={(v)=>commitStageDate("Inoculated", v)}
            onFreezeSorting={onFreezeSorting}
            onUnfreezeSorting={onUnfreezeSorting}
          />
        )}
        {ALLOWED.includes("Colonizing") && (
          <StageDateField
            label="Colonizing Date"
            value={valueOf("Colonizing")}
            disabled={archived}
            onCommit={(v)=>commitStageDate("Colonizing", v)}
            onFreezeSorting={onFreezeSorting}
            onUnfreezeSorting={onUnfreezeSorting}
          />
        )}
        {ALLOWED.includes("Colonized") && (
          <StageDateField
            label="Colonized Date"
            value={valueOf("Colonized")}
            disabled={archived}
            onCommit={(v)=>commitStageDate("Colonized", v)}
            onFreezeSorting={onFreezeSorting}
            onUnfreezeSorting={onUnfreezeSorting}
          />
        )}
        {ALLOWED.includes("Fruiting") && (
          <StageDateField
            label="Fruiting Date"
            value={valueOf("Fruiting")}
            disabled={archived}
            onCommit={(v)=>commitStageDate("Fruiting", v)}
            onFreezeSorting={onFreezeSorting}
            onUnfreezeSorting={onUnfreezeSorting}
          />
        )}
        {ALLOWED.includes("Harvesting") && (
          <StageDateField
            label="Harvesting Date"
            value={valueOf("Harvesting")}
            disabled={archived}
            onCommit={(v)=>commitStageDate("Harvesting", v)}
            onFreezeSorting={onFreezeSorting}
            onUnfreezeSorting={onUnfreezeSorting}
          />
        )}
        {ALLOWED.includes("Harvested") && (
          <StageDateField
            label="Harvested Date"
            value={valueOf("Harvested")}
            disabled={archived}
            onCommit={(v)=>commitStageDate("Harvested", v)}
            onFreezeSorting={onFreezeSorting}
            onUnfreezeSorting={onUnfreezeSorting}
          />
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
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                <LabeledDate
                  label="Date"
                  value={toInputDate(flush?.createdAt)}
                  onChange={(v) => isHarvesting && fb.updateFlush(grow.id, idx, { createdAt: v || Date.now() })}
                  disabled={!isHarvesting || archived}
                />
                <FlushNumberField
                  label="Wet (g)"
                  value={safeNum(flush.wet)}
                  min={0}
                  step={0.1}
                  disabled={!isHarvesting || archived}
                  onCommit={(n) => isHarvesting && fb.updateFlush(grow.id, idx, { dry: Number(flush?.dry)||0, wet: n })}
                />
                <FlushNumberField
                  label="Dry (g)"
                  value={safeNum(flush.dry)}
                  min={0}
                  step={0.1}
                  disabled={!isHarvesting || archived}
                  onCommit={(n) => isHarvesting && fb.updateFlush(grow.id, idx, { wet: Number(flush?.wet)||0, dry: n })}
                />
                <FlushTextField
                  label="Notes"
                  value={flush?.note || ""}
                  disabled={!isHarvesting || archived}
                  onCommit={(t) => isHarvesting && fb.updateFlush(grow.id, idx, { note: t })}
                />
                <div className="flex justify-end">
                  <button
                    className="chip bg-red-600 text-white"
                    disabled={!isHarvesting || archived}
                    onClick={() => fb.deleteFlush(grow.id, idx)}
                    title="Delete this flush"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!archived && isHarvesting && (
              <button
                onClick={() => fb.addFlush(grow.id)}
                className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs"
              >
                + Add flush
              </button>
            )}

            <div className="flex-1" />

            {!archived && isHarvesting && (
              <button
                onClick={() => fb.finishHarvest(grow.id)}
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                title="Finish harvest & archive this grow"
              >
                Finish harvest &amp; Archive
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * StageDateField
 * - Local draft while focused (no writes while typing)
 * - **Commit on blur only** (stops mid-type commit → resort → “jump”)
 * - Freezes sorting on focus; unfreezes after commit/blur
 */
function StageDateField({ label, value, onCommit, disabled, onFreezeSorting, onUnfreezeSorting }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value || "");

  React.useEffect(() => {
    if (!focused) setDraft(value || "");
  }, [value, focused]);

  const handleFocus = () => {
    setFocused(true);
    setDraft(value || "");
    onFreezeSorting?.();
  };

  const handleBlur = () => {
    if (disabled) { setFocused(false); onUnfreezeSorting?.(); return; }
    if (isValidISODate(draft) && draft !== (value || "")) {
      onCommit?.(draft);
    }
    setFocused(false);
    onUnfreezeSorting?.();
  };

  return (
    <label className="block">
      <div className="text-xs mb-1 opacity-70">{label}</div>
      <div className="relative">
        <input
          type="date"
          value={focused ? (draft || "") : (value || "")}
          onFocus={handleFocus}
          onChange={(e) => setDraft(e.target.value || "")}
          onBlur={handleBlur}
          disabled={disabled}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 pr-10 disabled:opacity-60"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 select-none">⌚</span>
      </div>
    </label>
  );
}

/**
 * FlushNumberField
 * - Local draft while typing; commit on blur/Enter
 * - Shows 0 placeholder; clears on focus if 0
 */
function FlushNumberField({ label, value, onCommit, min = 0, step = 1, disabled = false }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value ?? 0));

  React.useEffect(() => {
    if (!focused) setDraft(String(value ?? 0));
  }, [value, focused]);

  const commit = () => {
    if (disabled) return;
    const n = Number.parseFloat(draft);
    onCommit?.(Number.isFinite(n) ? n : 0);
  };

  const handleFocus = () => {
    setFocused(true);
    const numeric = Number.parseFloat(String(value ?? 0));
    if (!Number.isFinite(numeric) || numeric === 0) setDraft("");
  };

  return (
    <label className="block">
      <div className="text-xs mb-1 opacity-70">{label}</div>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        placeholder="0"
        value={focused ? draft : String(value ?? 0)}
        onFocus={handleFocus}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.currentTarget.blur(); commit(); }
        }}
        onBlur={() => { commit(); setFocused(false); }}
        disabled={disabled}
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-60"
      />
    </label>
  );
}

/**
 * FlushTextField
 * - Local draft; commit on blur/Enter
 */
function FlushTextField({ label, value, onCommit, disabled = false }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value || "");

  React.useEffect(() => {
    if (!focused) setDraft(value || "");
  }, [value, focused]);

  const commit = () => { if (!disabled) onCommit?.(draft || ""); };

  return (
    <label className="block">
      <div className="text-xs mb-1 opacity-70">{label}</div>
      <input
        type="text"
        value={focused ? draft : (value || "")}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); commit(); } }}
        onBlur={() => { commit(); setFocused(false); }}
        disabled={disabled}
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-60"
        placeholder="Optional"
      />
    </label>
  );
}

function LabeledDate({ label, value, onChange, disabled }) {
  return (
    <label className="block">
      <div className="text-xs mb-1 opacity-70">{label}</div>
      <input
        type="date"
        value={value || ""}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-60"
      />
    </label>
  );
}

function getTimeForSort(g) {
  const s = g?.stageDates?.Harvested || g?.stageDates?.Colonized || g?.stageDates?.Inoculated || g?.createdDate || g?.createdAt;
  const d = toDate(s);
  return d ? d.getTime() : 0;
}

// Hardened: do NOT feed through UTC serialization; return YYYY-MM-DD using LOCAL parts
function toInputDate(raw) {
  if (!raw) return "";
  if (typeof raw === "string") {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const m2 = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m2) {
      const y = m2[3], mm = m2[1].padStart(2,"0"), dd = m2[2].padStart(2,"0");
      return `${y}-${mm}-${dd}`;
    }
  }
  if (raw && typeof raw.toDate === "function") {
    const d = raw.toDate();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth()+1).padStart(2,"0");
    const day = String(raw.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  if (typeof raw === "number") {
    let ms = raw;
    if (ms < 100000000000) ms = ms * 1000; // seconds → ms
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  const d2 = new Date(String(raw));
  if (!isNaN(d2)) {
    const y = d2.getFullYear();
    const m = String(d2.getMonth()+1).padStart(2,"0");
    const day = String(d2.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  return "";
}

// Hardened: parse YYYY-MM-DD as LOCAL midnight; detect seconds vs ms
function toDate(raw) {
  if (!raw) return null;
  try {
    if (raw && typeof raw.toDate === "function") return raw.toDate();
    if (raw instanceof Date) return raw;
    if (typeof raw === "number") {
      let ms = raw;
      if (ms < 100000000000) ms = ms * 1000;
      const d = new Date(ms);
      return isNaN(d) ? null : d;
    }
    const s = String(raw);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = parseInt(m[1],10), mm = parseInt(m[2],10), dd = parseInt(m[3],10);
      return new Date(y, mm-1, dd); // local midnight
    }
    const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m2) {
      const mm = parseInt(m2[1],10), dd = parseInt(m2[2],10), y = parseInt(m2[3],10);
      return new Date(y, mm-1, dd);
    }
    const d2 = new Date(s);
    return isNaN(d2) ? null : d2;
  } catch {
    return null;
  }
}

function safeNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function fmtGram(g) { const n = Math.round((Number(g)||0)*10)/10; return `${n}g`; }
