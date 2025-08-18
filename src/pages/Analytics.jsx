// src/pages/Analytics.jsx
import React, { useMemo, useState } from "react";
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, Cell
} from "recharts";

/* ---------- robust 'isActiveGrow' ---------- */
function isActiveGrow(g) {
  const s = String(g?.stage || "").toLowerCase();
  const status = String(g?.status || "").toLowerCase();

  // archive/finish markers (support many possible field names)
  const archivedLike =
    g?.archived === true ||
    g?.isArchived === true ||
    !!g?.archivedAt ||
    !!g?.archived_on ||
    !!g?.archivedOn ||
    s === "archived" ||
    status === "archived";

  const consumedLike =
    g?.consumed === true ||
    g?.isConsumed === true ||
    status === "consumed" ||
    s === "consumed";

  const contaminatedLike =
    g?.contaminated === true ||
    g?.isContaminated === true ||
    status === "contaminated" ||
    s === "contaminated";

  const finishedLike =
    g?.finished === true ||
    s === "harvested" ||
    s === "finished";

  if (archivedLike || consumedLike || contaminatedLike || finishedLike) return false;
  if (g?.active === false) return false;
  if (g?.active === true) return true; // explicit override

  // Positive set of stages that we consider active
  return ["inoculated", "colonizing", "colonized", "fruiting"].includes(s);
}

const PALETTE = {
  wet: "#60a5fa",
  dry: "#a78bfa",
  cost: "#f59e0b",
  line: "#34d399",
  axis: "#94a3b8",
  grid: "#475569",
};
const PIE_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#facc15", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];

/* ---------- helpers ---------- */
function totalsFromGrow(g) {
  const flushes =
    (Array.isArray(g?.flushes) && g.flushes) ||
    (Array.isArray(g?.harvest?.flushes) && g.harvest.flushes) ||
    [];
  const t = flushes.reduce((acc, f) => {
    acc.Wet += Number(f?.wet) || 0;
    acc.Dry += Number(f?.dry) || 0;
    return acc;
  }, { Wet: 0, Dry: 0 });
  if (!t.Wet && g?.wetYield) t.Wet = Number(g.wetYield) || 0;   // legacy
  if (!t.Dry && g?.dryYield) t.Dry = Number(g.dryYield) || 0;   // legacy
  return t;
}
const fmtInt = (n) => new Intl.NumberFormat().format(Math.round(Number(n) || 0));
const fmtG = (n) => `${fmtInt(n)} g`;
const fmt$ = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function KeyLegend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm px-2 py-1">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span className="inline-block w-3.5 h-3.5 rounded" style={{ background: it.color }} />
          <span className="text-zinc-300">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function toDateMaybe(v) {
  if (!v && v !== 0) return null;
  try {
    if (v?.toDate) return v.toDate();
    if (typeof v === "object" && "seconds" in v) return new Date(v.seconds * 1000);
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}
function getRefDate(g) {
  const sd = g?.stageDates || {};
  return (
    toDateMaybe(sd.Inoculated) ||
    toDateMaybe(g?.inoculatedAt) ||
    toDateMaybe(g?.inoculationDate) ||
    toDateMaybe(g?.createdAt) ||
    toDateMaybe(g?.created_on) ||
    toDateMaybe(g?.startDate) ||
    null
  );
}

/* ---------- component ---------- */
/**
 * Props:
 *  - grows:           array
 *  - activeGrows:     array of *active* grows (optional, preferred for stage pie)
 *  - archivedGrows:   array of archived grows (used for non-pie charts)
 *  - recipes, supplies: kept for future cross-refs
 */
export default function Analytics({
  grows = [],
  activeGrows = null,
  archivedGrows = [],
  recipes = [],
  supplies = [],
}) {
  const [chartKey, setChartKey] = useState("avgYieldPerStrain");
  const [showValues, setShowValues] = useState(true);

  // Filters (strain + date)
  const allStrainOptions = useMemo(() => {
    const set = new Set(
      [...(grows || []), ...(archivedGrows || [])]
        .map((g) => (g?.strain ? String(g.strain).trim() : null))
        .filter(Boolean)
    );
    return ["All strains", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [grows, archivedGrows]);
  const [strainFilter, setStrainFilter] = useState("All strains");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Merge active + archived (for non-pie charts)
  const allGrows = useMemo(() => {
    const listA = Array.isArray(grows) ? grows : [];
    const listB = Array.isArray(archivedGrows) ? archivedGrows : [];
    if (listB.length === 0) return listA;
    const byId = new Map();
    for (const g of [...listA, ...listB]) {
      const prev = byId.get(g.id);
      if (!prev) byId.set(g.id, g);
      else if (g?.archived && !prev?.archived) byId.set(g.id, g);
    }
    return Array.from(byId.values());
  }, [grows, archivedGrows]);

  // Filter predicate (strain/date)
  const filterPredicate = useMemo(() => {
    const wantStrain = strainFilter !== "All strains" ? String(strainFilter) : null;
    const from = fromDate ? new Date(fromDate) : null;
    const to = toDate ? new Date(toDate) : null;
    if (to) to.setHours(23, 59, 59, 999);
    return (g) => {
      if (wantStrain && String(g?.strain || "").trim() !== wantStrain) return false;
      const d = getRefDate(g);
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      return true;
    };
  }, [strainFilter, fromDate, toDate]);

  /* ===== Stage pie source ===== */
  const activeSource = useMemo(
    () => (Array.isArray(activeGrows) ? activeGrows : (Array.isArray(grows) ? grows : [])),
    [activeGrows, grows]
  );
  const activeFiltered = useMemo(
    () => activeSource.filter(isActiveGrow).filter(filterPredicate),
    [activeSource, filterPredicate]
  );
  const filteredAll = useMemo(() => allGrows.filter(filterPredicate), [allGrows, filterPredicate]);

  // NEW: tiny active-only overview (cards)
  const overview = useMemo(() => {
    const totalActive = activeFiltered.length;
    const uniqueStrains = new Set(activeFiltered.map((g) => g.strain || "Unknown")).size;
    const runningCost = activeFiltered.reduce((sum, g) => sum + Number(g.cost || 0), 0);
    const ages = activeFiltered
      .map((g) => getRefDate(g))
      .filter(Boolean)
      .map((d) => (Date.now() - d.getTime()) / 86400000);
    const avgAgeDays = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    return { totalActive, uniqueStrains, runningCost: Number(runningCost.toFixed(2)), avgAgeDays };
  }, [activeFiltered]);

  const {
    stageCounts,
    yieldData,
    avgYieldPerStrain,
    growCosts,
    recipeUsage,
    stageTransitions,
  } = useMemo(() => {
    // Stage distribution — strictly from activeFiltered
    const stageCounts = Object.entries(
      activeFiltered.reduce((acc, x) => {
        const s = x.stage || "Active";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {})
    ).map(([name, value]) => ({ name, value }));

    // Wet vs Dry — includes archived
    const yieldData = filteredAll
      .filter((x) => x.stage === "Harvested" || x.archived)
      .map((x) => {
        const t = totalsFromGrow(x);
        return {
          name: x.strain || x.abbreviation || (x.id ? x.id.slice(0, 6) : ""),
          Wet: t.Wet,
          Dry: t.Dry,
        };
      })
      .filter((d) => d.Wet || d.Dry);

    // Average yield per strain
    const stats = {};
    filteredAll.forEach((x) => {
      if (!x.strain) return;
      const key = String(x.strain).trim();
      const t = totalsFromGrow(x);
      if (!stats[key]) stats[key] = { wet: 0, dry: 0, count: 0 };
      if (t.Wet || t.Dry) {
        stats[key].wet += t.Wet;
        stats[key].dry += t.Dry;
        stats[key].count += 1;
      }
    });
    const avgYieldPerStrain = Object.entries(stats).map(([name, v]) => ({
      name,
      Wet: v.count ? v.wet / v.count : 0,
      Dry: v.count ? v.dry / v.count : 0,
    }));

    // Cost per grow
    const growCosts = filteredAll.map((x) => ({
      name: x.abbreviation || x.strain || (x.id ? x.id.slice(0, 6) : ""),
      Cost: Number(x.cost || 0),
    }));

    // Most used supplies
    const supplyCount = {};
    filteredAll.forEach((x) => {
      (x.recipeItems || []).forEach((it) => {
        const n = it?.name || it?.supplyName || "Unknown";
        supplyCount[n] = (supplyCount[n] || 0) + 1;
      });
    });
    const recipeUsage = Object.entries(supplyCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Stage transitions over time
    const perMonth = {};
    filteredAll.forEach((x) => {
      const sd = x.stageDates || {};
      Object.entries(sd).forEach(([_, date]) => {
        const d = toDateMaybe(date);
        if (!d) return;
        const key = d.toISOString().slice(0, 7);
        perMonth[key] = (perMonth[key] || 0) + 1;
      });
    });
    const stageTransitions = Object.entries(perMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count }));

    return {
      stageCounts,
      yieldData,
      avgYieldPerStrain,
      growCosts,
      recipeUsage,
      stageTransitions,
    };
  }, [activeFiltered, filteredAll]);

  // CSV export
  const exportCSV = () => {
    const lines = [
      "Type,Name,ValueA,ValueB",
      ...stageCounts.map((d) => ["StageCount (active)", d.name, d.value, ""].join(",")),
      ...yieldData.map((d) => ["Yield", d.name, d.Wet, d.Dry].join(",")),
      ...avgYieldPerStrain.map((d) => ["AvgYieldPerStrain", d.name, d.Wet, d.Dry].join(",")),
      ...growCosts.map((d) => ["Cost", d.name, d.Cost, ""].join(",")),
      ...recipeUsage.map((d) => ["RecipeUsage", d.name, d.count, ""].join(",")),
      ...stageTransitions.map((d) => ["StageTransition", d.month, d.count, ""].join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "analytics.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const axisProps = { stroke: PALETTE.axis, tick: { fill: PALETTE.axis, fontSize: 12 } };
  const gridProps = { stroke: PALETTE.grid, strokeDasharray: "3 3" };

  const renderChart = () => {
    switch (chartKey) {
      case "stageCounts":
        return (
          <ResponsiveContainer width="100%" height={360}>
            <PieChart>
              <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
              <Legend verticalAlign="bottom" />
              <Pie data={stageCounts} dataKey="value" nameKey="name" label>
                {stageCounts.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        );

      case "yieldData":
        return (
          <>
            <KeyLegend items={[{ label: "Wet (g)", color: PALETTE.wet }, { label: "Dry (g)", color: PALETTE.dry }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={yieldData}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v, n) => (n === "Wet" || n === "Dry" ? fmtG(v) : fmtInt(v))} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Bar dataKey="Wet" fill={PALETTE.wet}>{showValues && <LabelList dataKey="Wet" position="top" formatter={fmtInt} />}</Bar>
                <Bar dataKey="Dry" fill={PALETTE.dry}>{showValues && <LabelList dataKey="Dry" position="top" formatter={fmtInt} />}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "avgYieldPerStrain":
        return (
          <>
            <KeyLegend items={[{ label: "Avg Wet (g)", color: PALETTE.wet }, { label: "Avg Dry (g)", color: PALETTE.dry }]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={avgYieldPerStrain}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v, n) => (n === "Wet" || n === "Dry" ? fmtG(v) : fmtInt(v))} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Bar dataKey="Wet" fill={PALETTE.wet}>{showValues && <LabelList dataKey="Wet" position="top" formatter={fmtInt} />}</Bar>
                <Bar dataKey="Dry" fill={PALETTE.dry}>{showValues && <LabelList dataKey="Dry" position="top" formatter={fmtInt} />}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "growCosts":
        return (
          <>
            <KeyLegend items={[{ label: "Cost ($)", color: PALETTE.cost }]} />
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={growCosts}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmt$(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Line dataKey="Cost" stroke={PALETTE.cost} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        );

      case "recipeUsage":
        return (
          <>
            <KeyLegend items={[{ label: "Times used", color: PALETTE.line }]} />
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={recipeUsage}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Bar dataKey="count" fill={PALETTE.line}>{showValues && <LabelList dataKey="count" position="top" formatter={fmtInt} />}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "stageTransitions":
        return (
          <>
            <KeyLegend items={[{ label: "Stage changes / month", color: PALETTE.line }]} />
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={stageTransitions}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Line dataKey="count" stroke={PALETTE.line} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 p-4 bg-white dark:bg-zinc-900 rounded-2xl shadow">
      {/* NEW: active-only overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Grows" value={overview.totalActive} />
        <StatCard label="Unique Strains" value={overview.uniqueStrains} />
        <StatCard label="Avg Age (days)" value={overview.avgAgeDays} />
        <StatCard label="Est. Running Cost" value={`$${overview.runningCost}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={chartKey}
          onChange={(e) => setChartKey(e.target.value)}
        >
          <option value="stageCounts">Grow Stage Distribution</option>
          <option value="yieldData">Wet vs Dry Yield</option>
          <option value="avgYieldPerStrain">Average Yield per Strain</option>
          <option value="growCosts">Cost per Grow</option>
          <option value="recipeUsage">Most Used Supplies</option>
          <option value="stageTransitions">Stage Transitions Over Time</option>
        </select>

        {/* Strain filter */}
        <select
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={strainFilter}
          onChange={(e) => setStrainFilter(e.target.value)}
          title="Filter by strain"
        >
          {allStrainOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Date range */}
        <div className="flex items-center gap-2 text-sm">
          <span className="opacity-70">From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1"
          />
          <span className="opacity-70">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1"
          />
        </div>

        {/* Values toggle */}
        <label className="inline-flex items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            className="accent-blue-600"
            checked={showValues}
            onChange={(e) => setShowValues(e.target.checked)}
          />
          Show values
        </label>

        <button
          onClick={exportCSV}
          className="ml-auto px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
        >
          Export CSV
        </button>
      </div>

      <div className="text-xs opacity-60">
        Showing {filteredAll.length} grows ({activeFiltered.length} active in stage distribution)
        {strainFilter !== "All strains" ? ` · Strain: ${strainFilter}` : ""}
        {(fromDate || toDate) ? ` · Range: ${fromDate || "…"} → ${toDate || "…"}`
          : ""}
      </div>

      {renderChart()}
    </div>
  );
}

/* tiny helper for cards */
function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
