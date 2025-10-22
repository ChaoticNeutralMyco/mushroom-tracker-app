// src/pages/Analytics.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, Cell, ZAxis
} from "recharts";

import { db, auth } from "../firebase-config";
import { collection, onSnapshot } from "firebase/firestore";

/* ---------- helpers ---------- */
function isActiveGrow(g) {
  const s = String(g?.stage || "").toLowerCase();
  const status = String(g?.status || "").toLowerCase();

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
  if (g?.active === true) return true;

  // ✅ Include the new stage as active
  return ["inoculated", "colonizing", "colonized", "fruiting", "harvesting"].includes(s);
}
const isContaminated = (g) => {
  const s = String(g?.stage || "").toLowerCase();
  const status = String(g?.status || "").toLowerCase();
  return (
    g?.contaminated === true ||
    g?.isContaminated === true ||
    s === "contaminated" ||
    status === "contaminated"
  );
};

const PALETTE = {
  wet: "#60a5fa",
  dry: "#a78bfa",
  cost: "#f59e0b",
  line: "#34d399",
  axis: "#94a3b8",
  grid: "#475569",
  scatter: "#22d3ee",
};
const PIE_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#facc15", "#a78bfa", "#fb923c", "#22d3ee", "#f87171"];

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
  if (!t.Wet && g?.wetYield) t.Wet = Number(g.wetYield) || 0;
  if (!t.Dry && g?.dryYield) t.Dry = Number(g.dryYield) || 0;
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
const diffDays = (a, b) => Math.max(0, Math.round((b - a) / 86400000));
const median = (arr) => {
  const xs = arr.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
};
const monthKey = (d) => d.toISOString().slice(0, 7);
const recipeNameById = (recipes) => new Map((recipes || []).map((r) => [r.id, r.name]));

/* ---------- component ---------- */
export default function Analytics({
  grows = [],
  activeGrows = null,
  growsActive = null,
  archivedGrows = [],
  growsAll = null,
  recipes = [],
  supplies = [],
  tasks = [],
  supplyAudits = null,
}) {
  // Default to something that always has data
  const [chartKey, setChartKey] = useState("stageCounts");
  const [showValues, setShowValues] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [groupMode, setGroupMode] = useState("strain"); // "strain" | "recipe"

  // Live-load audits if not provided
  const [audits, setAudits] = useState(Array.isArray(supplyAudits) ? supplyAudits : []);
  useEffect(() => setAudits(Array.isArray(supplyAudits) ? supplyAudits : []), [supplyAudits]);
  useEffect(() => {
    if (Array.isArray(supplyAudits)) return;
    const u = auth.currentUser;
    if (!u) return;
    const col = collection(db, "users", u.uid, "supply_audits");
    const unsub = onSnapshot(col, (snap) => setAudits(snap.docs.map((d) => d.data())));
    return () => unsub && unsub();
  }, []);

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

  // Merge active + archived
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

  // Toggle sources
  const datasetActive = useMemo(
    () => (
      Array.isArray(growsActive) ? growsActive
      : Array.isArray(activeGrows) ? activeGrows
      : Array.isArray(grows) ? grows.filter(isActiveGrow)
      : []
    ),
    [growsActive, activeGrows, grows]
  );
  const datasetAll = useMemo(() => (Array.isArray(growsAll) ? growsAll : allGrows), [growsAll, allGrows]);

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
  const activeSource = useMemo(() => datasetActive, [datasetActive]);
  const activeFiltered = useMemo(
    () => activeSource.filter(isActiveGrow).filter(filterPredicate),
    [activeSource, filterPredicate]
  );
  const filteredAll = useMemo(
    () => (showAll ? datasetAll : datasetActive).filter(filterPredicate),
    [showAll, datasetAll, datasetActive, filterPredicate]
  );

  // Tiny active-only overview (cards)
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

  const recipesMap = useMemo(() => recipeNameById(recipes), [recipes]);
  const recipeById = useMemo(() => new Map((recipes || []).map((r) => [r.id, r])), [recipes]);
  const supplyNameById = useMemo(() => new Map((supplies || []).map((s) => [s.id, s.name])), [supplies]);
  const supplyQtyById = useMemo(() => new Map((supplies || []).map((s) => [s.id, Number(s.quantity || 0)])), [supplies]);
  const supplyIdByName = useMemo(() => {
    const m = new Map();
    for (const s of supplies || []) if (s?.name) m.set(String(s.name), s.id);
    return m;
  }, [supplies]);

  const {
    stageCounts,
    yieldData,
    avgYieldPerStrain,
    growCosts,
    mostUsedSupplies,
    recipeUseCounts,
    stageTransitions,
    contamRate,
    ttsSeries,
    burnRateSeries,
    burnTopSupplies,
    burnNote,
    yieldVsCost,
    throughputSeries,
  } = useMemo(() => {
    // Stage distribution
    const stageCounts = Object.entries(
      activeFiltered.reduce((acc, x) => {
        const s = x.stage || "Active";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {})
    ).map(([name, value]) => ({ name, value }));

    // Wet vs Dry
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

    // Avg yield per strain
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

    // Most used supplies (via recipes)
    const supplyCount = {};
    filteredAll.forEach((x) => {
      let items = Array.isArray(x.recipeItems) && x.recipeItems.length ? x.recipeItems : null;
      if (!items) {
        const rid = x.recipeId || x.recipe_id || x.recipe?.id;
        const rec = rid ? recipeById.get(rid) : null;
        if (rec && Array.isArray(rec.items)) items = rec.items;
      }
      if (!items) return;
      items.forEach((it) => {
        const n = it?.name || supplyNameById.get(it?.supplyId) || "Unknown";
        supplyCount[n] = (supplyCount[n] || 0) + 1;
      });
    });
    const mostUsedSupplies = Object.entries(supplyCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Recipe usage count
    const usageAcc = {};
    filteredAll.forEach((g) => {
      const rid = g.recipeId || g.recipe_id || g.recipe?.id || null;
      const rname =
        (rid && (recipesMap.get(rid) || g.recipeName || g.recipe?.name)) ||
        g.recipeName ||
        g.recipe?.name ||
        null;
      if (!rname) return;
      if (!usageAcc[rname]) usageAcc[rname] = { name: rname, count: 0, totalCost: 0 };
      usageAcc[rname].count += 1;
      usageAcc[rname].totalCost += Number(g.cost || 0);
    });
    const recipeUseCounts = Object.values(usageAcc)
      .map((x) => ({ ...x, avgCost: x.count ? x.totalCost / x.count : 0 }))
      .sort((a, b) => b.count - a.count);

    // Stage transitions over time
    const perMonthTransitions = {};
    filteredAll.forEach((x) => {
      const sd = x.stageDates || {};
      Object.values(sd).forEach((date) => {
        const d = toDateMaybe(date);
        if (d) {
          const k = monthKey(d);
          perMonthTransitions[k] = (perMonthTransitions[k] || 0) + 1;
        }
      });
      const created = getRefDate(x);
      if (created) perMonthTransitions[monthKey(created)] = (perMonthTransitions[monthKey(created)] || 0) + 1;
      const harvest =
        toDateMaybe(sd.Harvested) ||
        (Array.isArray(x?.harvest?.flushes) ? toDateMaybe(x.harvest.flushes.at(-1)?.date) : null);
      if (harvest) perMonthTransitions[monthKey(harvest)] = (perMonthTransitions[monthKey(harvest)] || 0) + 1;
    });
    const stageTransitions = Object.entries(perMonthTransitions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count }));

    // Contamination rate by group
    const groupKey = (g) => {
      if (groupMode === "recipe") {
        const rid = g.recipeId || g.recipe_id || g.recipe?.id || null;
        return (rid && (recipesMap.get(rid) || g.recipeName || g.recipe?.name)) || g.recipeName || g.recipe?.name || "No recipe";
      }
      return g.strain || "Unknown";
    };
    const contamTotals = {};
    filteredAll.forEach((g) => {
      const key = groupKey(g);
      if (!contamTotals[key]) contamTotals[key] = { name: key, total: 0, bad: 0 };
      contamTotals[key].total += 1;
      if (isContaminated(g)) contamTotals[key].bad += 1;
    });
    const contamRate = Object.values(contamTotals)
      .map((r) => ({ name: r.name, rate: r.total ? (r.bad / r.total) * 100 : 0, bad: r.bad, total: r.total }))
      .sort((a, b) => b.rate - a.rate);

    // Time-to-stage (median days)
    const ttsBuckets = {};
    filteredAll.forEach((g) => {
      const sd = g.stageDates || {};
      const inoc = toDateMaybe(sd.Inoculated) || getRefDate(g);
      const colon = toDateMaybe(sd.Colonized);
      const fruit = toDateMaybe(sd.Fruiting);
      const harvest =
        toDateMaybe(sd.Harvested) ||
        (Array.isArray(g?.harvest?.flushes) ? toDateMaybe(g.harvest.flushes.at(-1)?.date) : null);
      const k = groupKey(g);
      if (!ttsBuckets[k]) ttsBuckets[k] = { ic: [], cf: [], fh: [] };
      if (inoc && colon) ttsBuckets[k].ic.push(diffDays(inoc, colon));
      if (colon && fruit) ttsBuckets[k].cf.push(diffDays(colon, fruit));
      if (fruit && harvest) ttsBuckets[k].fh.push(diffDays(fruit, harvest));
    });
    const ttsSeries = Object.entries(ttsBuckets).map(([name, v]) => ({
      name,
      Inoc_to_Colonized: median(v.ic),
      Colonized_to_Fruiting: median(v.cf),
      Fruiting_to_Harvested: median(v.fh),
    }));

    // ===== Supply burn rate =====
    const now = new Date();
    const weeksBack = 8;
    const weekKey = (d) => {
      const dt = new Date(d);
      const year = dt.getUTCFullYear();
      const day = (dt.getUTCDay() + 6) % 7;
      const thurs = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() - day + 3));
      const week1 = new Date(Date.UTC(thurs.getUTCFullYear(), 0, 4));
      const w = 1 + Math.round((thurs - week1) / 604800000);
      return `${year}-W${String(w).padStart(2, "0")}`;
    };
    const weekLabels = [];
    const temp = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (let i = weeksBack - 1; i >= 0; i--) {
      const d = new Date(temp);
      d.setUTCDate(d.getUTCDate() - i * 7);
      weekLabels.push(weekKey(d));
    }

    const consumeEvents = (audits || []).filter((a) => String(a?.action).toLowerCase() === "consume" && a?.timestamp);
    const usingAudits = consumeEvents.length > 0;

    // byKey maps LABEL -> { weeks:{wk:amount}, total }
    const byKey = {};

    if (usingAudits) {
      // Real consumption from audits
      consumeEvents.forEach((a) => {
        const d = new Date(a.timestamp);
        if (!Number.isFinite(d.getTime())) return;
        const wk = weekKey(d);
        if (!weekLabels.includes(wk)) return;
        const sid = a.supplyId || a.supply_id || "unknown";
        const label = (supplyNameById.get(sid) || sid) + "";
        if (!byKey[label]) byKey[label] = { weeks: {}, total: 0, sid };
        const amt = Number(a.amount || 0);
        byKey[label].weeks[wk] = (byKey[label].weeks[wk] || 0) + (Number.isFinite(amt) ? amt : 0);
        byKey[label].total += Number.isFinite(amt) ? amt : 0;
      });
    } else {
      // Synthetic estimate from recipe items on the grow's start week
      const windowStart = new Date(temp);
      windowStart.setUTCDate(windowStart.getUTCDate() - (weeksBack - 1) * 7);
      filteredAll.forEach((g) => {
        const start = getRefDate(g);
        if (!start || start < windowStart) return;
        const wk = weekKey(start);
        if (!weekLabels.includes(wk)) return;
        let items = Array.isArray(g.recipeItems) && g.recipeItems.length ? g.recipeItems : null;
        if (!items) {
          const rid = g.recipeId || g.recipe_id || g.recipe?.id;
          const rec = rid ? recipeById.get(rid) : null;
          if (rec && Array.isArray(rec.items)) items = rec.items;
        }
        if (!items) return;
        items.forEach((it) => {
          const label =
            it?.name ||
            supplyNameById.get(it?.supplyId) ||
            (it?.supplyId ? `Supply ${it.supplyId}` : "Unknown");
          if (!byKey[label]) byKey[label] = { weeks: {}, total: 0, sid: it?.supplyId || null };
          const amt = Number(it?.amount);
          const use = Number.isFinite(amt) ? amt : 1; // assume 1 if undefined
          byKey[label].weeks[wk] = (byKey[label].weeks[wk] || 0) + use;
          byKey[label].total += use;
        });
      });
    }

    const topKeys = Object.entries(byKey)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([label]) => label);

    const burnRateSeries = weekLabels.map((wk) => {
      const row = { week: wk };
      topKeys.forEach((label) => {
        row[label] = byKey[label]?.weeks[wk] || 0;
      });
      return row;
    });

    const windowDays = weeksBack * 7;
    const burnTopSupplies = topKeys.map((label, idx) => {
      const entry = byKey[label];
      const sid = entry?.sid || null;
      // try by id then by name
      let qty = null;
      if (sid && supplyQtyById.has(sid)) qty = supplyQtyById.get(sid);
      if (qty == null) {
        const possibleId = supplyIdByName.get(label);
        if (possibleId && supplyQtyById.has(possibleId)) qty = supplyQtyById.get(possibleId);
      }
      const used = entry?.total || 0;
      const perDay = used / windowDays;
      const days = perDay > 0 && qty != null ? Math.round(qty / perDay) : null;
      return { id: sid || label, name: label, daysToZero: days, color: PIE_COLORS[idx % PIE_COLORS.length] };
    });

    const burnNote = usingAudits ? "(from audits)" : "(estimated from recipes and start dates)";

    // Yield vs Cost
    const yieldVsCost = filteredAll
      .map((g) => {
        const t = totalsFromGrow(g);
        const y = t.Dry || t.Wet || 0;
        return {
          x: Number(g.cost || 0),
          y: Number(y),
          name: g.abbreviation || g.strain || (g.id ? g.id.slice(0, 6) : ""),
        };
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    // Throughput
    const started = {};
    filteredAll.forEach((g) => {
      const d = getRefDate(g);
      if (!d) return;
      const key = d.toISOString().slice(0, 7);
      started[key] = (started[key] || 0) + 1;
    });
    const harvested = {};
    filteredAll.forEach((g) => {
      const sd = g.stageDates || {};
      const d = toDateMaybe(sd.Harvested) || (Array.isArray(g?.harvest?.flushes) ? toDateMaybe(g.harvest.flushes.at(-1)?.date) : null);
      if (!d) return;
      const key = d.toISOString().slice(0, 7);
      harvested[key] = (harvested[key] || 0) + 1;
    });
    const months = Array.from(new Set([...Object.keys(started), ...Object.keys(harvested)])).sort();
    const throughputSeries = months.map((m) => ({
      month: m,
      Started: started[m] || 0,
      Harvested: harvested[m] || 0,
    }));

    return {
      stageCounts,
      yieldData,
      avgYieldPerStrain,
      growCosts,
      mostUsedSupplies,
      recipeUseCounts,
      stageTransitions,
      contamRate,
      ttsSeries,
      burnRateSeries,
      burnTopSupplies,
      burnNote,
      yieldVsCost,
      throughputSeries,
    };
  }, [
    activeFiltered,
    filteredAll,
    recipesMap,
    groupMode,
    audits,
    supplies,
    recipeById,
    supplyNameById,
    supplyQtyById,
    supplyIdByName,
  ]);

  // CSV export
  const exportCSV = () => {
    const lines = [
      "Type,Name,ValueA,ValueB",
      ...stageCounts.map((d) => ["StageCount (active)", d.name, d.value, ""].join(",")),
      ...yieldData.map((d) => ["Yield", d.name, d.Wet, d.Dry].join(",")),
      ...avgYieldPerStrain.map((d) => ["AvgYieldPerStrain", d.name, d.Wet, d.Dry].join(",")),
      ...growCosts.map((d) => ["Cost", d.name, d.Cost, ""].join(",")),
      ...mostUsedSupplies.map((d) => ["MostUsedSupplies", d.name, d.count, ""].join(",")),
      ...recipeUseCounts.map((d) =>
        ["RecipeUseCount", d.name, d.count, (Number(d.avgCost) || 0).toFixed(2)].join(",")
      ),
      ...stageTransitions.map((d) => ["StageTransition", d.month, d.count, ""].join(",")),
      ...contamRate.map((d) => ["ContamRate(" + groupMode + ")", d.name, d.rate.toFixed(1) + "%", `${d.bad}/${d.total}`].join(",")),
      ...ttsSeries.map((d) => ["TimeToStage(" + groupMode + ")", d.name, d.Inoc_to_Colonized, d.Colonized_to_Fruiting + "|" + d.Fruiting_to_Harvested].join(",")),
      ...burnRateSeries.map((row) => ["BurnRate", row.week, JSON.stringify({ ...row, week: undefined }), ""].join(",")),
      ...yieldVsCost.map((p) => ["YieldVsCost", p.name, p.x, p.y].join(",")),
      ...throughputSeries.map((r) => ["Throughput", r.month, r.Started, r.Harvested].join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "analytics.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // JSON export
  const exportJSON = () => {
    const chosenGrows = showAll ? (Array.isArray(growsAll) ? growsAll : allGrows) : datasetActive;
    const payload = {
      app: "Mushroom Tracker",
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      dataset: showAll ? "all" : "active",
      counts: {
        grows: Array.isArray(chosenGrows) ? chosenGrows.length : 0,
        tasks: Array.isArray(tasks) ? tasks.length : 0,
        recipes: Array.isArray(recipes) ? recipes.length : 0,
        supplies: Array.isArray(supplies) ? supplies.length : 0,
        audits: Array.isArray(audits) ? audits.length : 0,
      },
      data: {
        grows: Array.isArray(chosenGrows) ? chosenGrows : [],
        tasks: Array.isArray(tasks) ? tasks : [],
        recipes: Array.isArray(recipes) ? recipes : [],
        supplies: Array.isArray(supplies) ? supplies : [],
        audits: Array.isArray(audits) ? audits : [],
      },
      analytics: {
        recipeUseCounts,
        mostUsedSupplies,
        contamRate,
        ttsSeries,
        burnTopSupplies,
        throughputSeries,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `myco-backup-${payload.dataset}-${new Date().toISOString().slice(0,10)}.json`;
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

      case "recipeUseCounts":
        return (
          <>
            <KeyLegend items={[{ label: "Grows using recipe", color: PALETTE.line }]} />
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={recipeUseCounts}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip
                  formatter={(v, n) => (n === "count" ? fmtInt(v) : fmt$(v))}
                  labelFormatter={(label, payload) => {
                    const row = payload && payload[0] && payload[0].payload;
                    if (!row) return label;
                    return `${label} — ${fmtInt(row.count)} uses · avg cost ${fmt$(row.avgCost)}`;
                  }}
                  contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }}
                />
                <Bar dataKey="count" fill={PALETTE.line}>
                  {showValues && <LabelList dataKey="count" position="top" formatter={fmtInt} />}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "recipeUsage":
        return (
          <>
            <KeyLegend items={[{ label: "Times in recipes", color: PALETTE.line }]} />
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={mostUsedSupplies}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Bar dataKey="count" fill={PALETTE.line}>{showValues && <LabelList dataKey="count" position="top" formatter={fmtInt} />}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "contamRate":
        return (
          <>
            <KeyLegend items={[{ label: "Contamination rate (%)", color: "#f87171" }]} />
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={contamRate}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={(v) => `${Math.round(v)}%`} />
                <Tooltip
                  formatter={(v) => `${Math.round(v)}%`}
                  labelFormatter={(label, payload) => {
                    const r = payload?.[0]?.payload;
                    return r ? `${label} — ${Math.round(r.rate)}% (${r.bad}/${r.total})` : label;
                  }}
                  contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }}
                />
                <Bar dataKey="rate" fill="#f87171">
                  {showValues && <LabelList dataKey="rate" position="top" formatter={(v) => `${Math.round(v)}%`} />}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "timeToStage":
        return (
          <>
            <KeyLegend items={[
              { label: "Inoc → Colonized", color: "#60a5fa" },
              { label: "Colonized → Fruiting", color: "#34d399" },
              { label: "Fruiting → Harvested", color: "#f59e0b" },
            ]} />
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={ttsSeries}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => `${fmtInt(v)} days`} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Bar dataKey="Inoc_to_Colonized" fill="#60a5fa" />
                <Bar dataKey="Colonized_to_Fruiting" fill="#34d399" />
                <Bar dataKey="Fruiting_to_Harvested" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </>
        );

      case "burnRate":
        return (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs opacity-80">
              {burnTopSupplies.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-2 rounded-full px-2 py-1 border border-zinc-700">
                  <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: s.color }} />
                  {s.name}
                  <span className="opacity-70">· {s.daysToZero != null ? `${s.daysToZero}d to zero` : "no est."}</span>
                </span>
              ))}
              <span className="ml-2 italic opacity-70">{burnNote}</span>
            </div>
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={burnRateSeries}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="week" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                {burnTopSupplies.map((s) => (
                  <Line key={s.id} dataKey={s.name} stroke={s.color} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        );

      case "yieldVsCost":
        return (
          <>
            <KeyLegend items={[{ label: "Point = Grow", color: PALETTE.scatter }]} />
            <ResponsiveContainer width="100%" height={360}>
              <ScatterChart>
                <CartesianGrid {...gridProps} />
                <XAxis type="number" dataKey="x" name="Cost" unit="$" {...axisProps} tickFormatter={(v) => `$${v}`} />
                <YAxis type="number" dataKey="y" name="Yield" unit=" g" {...axisProps} tickFormatter={(v) => fmtInt(v)} />
                <ZAxis type="number" dataKey="z" range={[60, 60]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }}
                  formatter={(value, name) => name === "x" ? fmt$(value) : name === "y" ? fmtG(value) : fmtInt(value)}
                  labelFormatter={() => ""} />
                <Scatter data={yieldVsCost} fill={PALETTE.scatter} />
              </ScatterChart>
            </ResponsiveContainer>
          </>
        );

      case "throughput":
        return (
          <>
            <KeyLegend items={[{ label: "Started", color: "#60a5fa" }, { label: "Harvested", color: "#a78bfa" }]} />
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={throughputSeries}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="month" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={fmtInt} />
                <Tooltip formatter={(v) => fmtInt(v)} contentStyle={{ background: "#0b0f19", border: "1px solid #334155", color: "#e5e7eb" }} />
                <Legend />
                <Line dataKey="Started" stroke="#60a5fa" strokeWidth={2} dot={false} />
                <Line dataKey="Harvested" stroke="#a78bfa" strokeWidth={2} dot={false} />
              </LineChart>
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
                <Legend />
                <Line dataKey="count" stroke={PALETTE.line} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        );

      default:
        return null;
    }
  };

  const showGroupChooser = chartKey === "contamRate" || chartKey === "timeToStage";

  return (
    <div className="space-y-4 p-4 bg-white dark:bg-zinc-900 rounded-2xl shadow">
      {/* overview cards */}
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
          <option value="recipeUseCounts">Recipe Usage Count</option>
          <option value="recipeUsage">Most Used Supplies</option>
          <option value="contamRate">Contamination Rate</option>
          <option value="timeToStage">Time to Stage (median)</option>
          <option value="burnRate">Supply Burn Rate + Forecast</option>
          <option value="yieldVsCost">Yield vs Cost</option>
          <option value="throughput">Throughput (Started vs Harvested)</option>
          <option value="stageTransitions">Stage Transitions Over Time</option>
        </select>

        {showGroupChooser && (
          <select
            className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            value={groupMode}
            onChange={(e) => setGroupMode(e.target.value)}
            title="Group by"
          >
            <option value="strain">By Strain</option>
            <option value="recipe">By Recipe</option>
          </select>
        )}

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

        <label className="inline-flex items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            className="accent-blue-600"
            checked={showValues}
            onChange={(e) => setShowValues(e.target.checked)}
          />
          Show values
        </label>

        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex items-center gap-0 rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-700">
            <span className="px-2 py-2 text-xs uppercase tracking-wide bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-r border-zinc-300 dark:border-zinc-700 select-none">DATASET</span>
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className={`px-3 py-2 text-sm border-r border-zinc-300 dark:border-zinc-700 ${!showAll ? "bg-emerald-600 text-white" : "bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-200"}`}
              aria-pressed={!showAll}
              title="Show only active grows"
            >
              Active only
            </button>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className={`px-3 py-2 text-sm ${showAll ? "bg-emerald-600 text-white" : "bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-200"}`}
              aria-pressed={showAll}
              title="Include archived and contaminated"
            >
              All
            </button>
          </div>

          <button onClick={exportCSV} className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            Export CSV
          </button>
          <button
            onClick={exportJSON}
            className="px-3 py-2 rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 border border-zinc-700"
            title="Export grows, tasks, recipes, supplies, audits as JSON + analytic snapshots"
          >
            Export JSON
          </button>
        </div>
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

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
