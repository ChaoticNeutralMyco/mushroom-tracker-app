// src/pages/Analytics.jsx
// sop-v52-reconnect-workflow-toolkit
// analytics-v44-workspace-overhaul-and-readable-charts
import React, { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell, ZAxis
} from "recharts";

import { db, auth } from "../firebase-config";
import { collection, onSnapshot } from "firebase/firestore";
import {
  getLotAvailableQuantity,
  isActiveMaterialLot,
  isArchivedOrDepletedMaterialLot,
  isFinishedGoodsLot,
} from "../lib/postprocess";
import { SUBSCRIPTION_FEATURE_KEYS } from "../lib/subscriptionPlans.js";
import { getSubscriptionFeatureGateState } from "../lib/subscriptionFeatureGates.js";
import {
  getAnalyticsExportScope,
  getAnalyticsReportFeatureKey,
  getAnalyticsSectionFeatureKey,
} from "../lib/subscriptionAnalyticsAccess.js";

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

const isSopWorkflowGrow = (g = {}) =>
  Boolean(
    g?.workflowTemplateId ||
      g?.sopTemplateId ||
      String(g?.source || "").toLowerCase() === "sop-template" ||
      String(g?.workflowSource || "").toLowerCase() === "sop-template" ||
      String(g?.parentSource || "").toLowerCase() === "sop"
  );

const getSopChecklist = (g = {}) => {
  const value = g?.sopChecklist || g?.sopChecklistItems || g?.workflowChecklist || [];
  return Array.isArray(value) ? value : [];
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


const TOOLTIP_STYLE = {
  background: "#0b0f19",
  border: "1px solid #334155",
  color: "#e5e7eb",
  borderRadius: "12px",
  boxShadow: "0 14px 40px rgba(0,0,0,0.35)",
};

function getHorizontalChartHeight(rowCount = 0) {
  return Math.min(1400, Math.max(320, rowCount * 62 + 90));
}

function wrapAxisLabel(value, maxChars = 34, maxLines = 4) {
  const text = String(value || "").trim();
  if (!text) return [""];

  const pieces = [];
  text.split(/\s+/).forEach((word) => {
    if (word.length <= maxChars) {
      pieces.push(word);
      return;
    }
    for (let index = 0; index < word.length; index += maxChars) {
      pieces.push(word.slice(index, index + maxChars));
    }
  });

  const lines = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = piece;
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = `${visible[maxLines - 1].replace(/[.\s]+$/, "")}…`;
  return visible;
}

function WrappedYAxisTick({ x = 0, y = 0, payload }) {
  const lines = wrapAxisLabel(payload?.value, 34, 4);
  const lineHeight = 14;
  const startY = -((lines.length - 1) * lineHeight) / 2;

  return (
    <g transform={`translate(${x},${y})`}>
      <title>{String(payload?.value || "")}</title>
      {lines.map((line, index) => (
        <text
          key={`${line}-${index}`}
          x={-10}
          y={startY + index * lineHeight}
          dy="0.35em"
          textAnchor="end"
          fill={PALETTE.axis}
          fontSize="12"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function ChartEmptyState({ message = "No matching data is available for this report." }) {
  return (
    <div className="min-h-52 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-950/30 flex items-center justify-center p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
      {message}
    </div>
  );
}

function AnalyticsLockedPanel({
  featureKey,
  actionLabel,
  supportingText,
  onRequest = () => false,
  compact = false,
}) {
  const gate = getSubscriptionFeatureGateState({
    allowed: false,
    featureKey,
    actionLabel,
    supportingText,
  });

  return (
    <div
      data-testid={`analytics-locked-${featureKey || "feature"}`}
      className={`rounded-2xl border border-violet-200 bg-violet-50/80 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-100 ${compact ? "p-3" : "p-5"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{gate.featureLabel}</div>
          <div className="mt-1 text-sm leading-6 text-violet-800/90 dark:text-violet-200/90">
            {gate.message}
          </div>
          {supportingText ? (
            <div className="mt-2 text-xs leading-5 text-violet-700/80 dark:text-violet-300/80">
              {supportingText}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onRequest({ featureKey, actionLabel, supportingText })}
          className="shrink-0 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
        >
          View plans
        </button>
      </div>
    </div>
  );
}

function FullDataTable({ data = [], columns = [], nameLabel = "Name" }) {
  if (!Array.isArray(data) || data.length === 0) return null;

  return (
    <details className="mt-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
        View full names and report data
      </summary>
      <div className="overflow-x-auto border-t border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">{nameLabel}</th>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr key={row?.key || row?.id || `${row?.name || "row"}-${index}`} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-3 py-2 text-left min-w-72 break-words text-zinc-800 dark:text-zinc-100">
                  {row?.name || "—"}
                </td>
                {columns.map((column) => {
                  const rawValue = row?.[column.key];
                  const formatted = column.formatter ? column.formatter(rawValue, row) : rawValue;
                  return (
                    <td key={column.key} className="px-3 py-2 text-right whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                      {formatted ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function HorizontalBarChartPanel({
  data = [],
  series = [],
  showValues = false,
  valueFormatter = fmtInt,
  axisFormatter = fmtInt,
  tooltipFormatter = null,
  tooltipLabelFormatter = null,
  emptyMessage = "No matching data is available for this report.",
  nameLabel = "Name",
}) {
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return <ChartEmptyState message={emptyMessage} />;

  const height = getHorizontalChartHeight(rows.length);
  const columns = series.map((item) => ({
    key: item.key,
    label: item.name,
    formatter: item.tableFormatter || item.formatter || valueFormatter,
  }));

  return (
    <>
      <KeyLegend items={series.map((item) => ({ label: item.name, color: item.color }))} />
      <div className="w-full overflow-x-auto">
        <div style={{ minWidth: 760, height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ top: 12, right: 110, bottom: 12, left: 18 }}
              barCategoryGap="24%"
            >
              <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                stroke={PALETTE.axis}
                tick={{ fill: PALETTE.axis, fontSize: 12 }}
                tickFormatter={axisFormatter}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={290}
                interval={0}
                tick={<WrappedYAxisTick />}
                axisLine={{ stroke: PALETTE.axis }}
                tickLine={{ stroke: PALETTE.axis }}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name, payload) => {
                  if (tooltipFormatter) return tooltipFormatter(value, name, payload?.payload);
                  const seriesItem = series.find((item) => item.name === name || item.key === name);
                  const formatter = seriesItem?.formatter || valueFormatter;
                  return [formatter(value, payload?.payload), seriesItem?.name || name];
                }}
                labelFormatter={(label, payload) => {
                  if (tooltipLabelFormatter) return tooltipLabelFormatter(label, payload?.[0]?.payload);
                  return label;
                }}
              />
              {series.map((item) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.name}
                  fill={item.color}
                  radius={[0, 6, 6, 0]}
                  maxBarSize={30}
                >
                  {showValues && rows.length <= 18 ? (
                    <LabelList
                      dataKey={item.key}
                      position="right"
                      formatter={(value) => (item.formatter || valueFormatter)(value)}
                      fill={PALETTE.axis}
                      fontSize={11}
                    />
                  ) : null}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <FullDataTable data={rows} columns={columns} nameLabel={nameLabel} />
    </>
  );
}

function VerticalBarChartPanel({
  data = [],
  series = [],
  showValues = false,
  valueFormatter = fmtInt,
  axisFormatter = fmtInt,
  tooltipFormatter = null,
  emptyMessage = "No matching data is available for this report.",
  height = 360,
}) {
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return <ChartEmptyState message={emptyMessage} />;

  return (
    <>
      <KeyLegend items={series.map((item) => ({ label: item.name, color: item.color }))} />
      <div className="w-full overflow-x-auto">
        <div style={{ minWidth: 660, height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 20, right: 28, bottom: 24, left: 10 }}>
              <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                stroke={PALETTE.axis}
                tick={{ fill: PALETTE.axis, fontSize: 12 }}
                interval={0}
              />
              <YAxis
                stroke={PALETTE.axis}
                tick={{ fill: PALETTE.axis, fontSize: 12 }}
                tickFormatter={axisFormatter}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name, payload) => {
                  if (tooltipFormatter) return tooltipFormatter(value, name, payload?.payload);
                  const seriesItem = series.find((item) => item.name === name || item.key === name);
                  const formatter = seriesItem?.formatter || valueFormatter;
                  return [formatter(value, payload?.payload), seriesItem?.name || name];
                }}
              />
              {series.map((item) => (
                <Bar key={item.key} dataKey={item.key} name={item.name} fill={item.color} radius={[6, 6, 0, 0]} maxBarSize={58}>
                  {showValues ? (
                    <LabelList
                      dataKey={item.key}
                      position="top"
                      formatter={(value) => (item.formatter || valueFormatter)(value)}
                      fill={PALETTE.axis}
                      fontSize={11}
                    />
                  ) : null}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <FullDataTable
        data={rows}
        columns={series.map((item) => ({
          key: item.key,
          label: item.name,
          formatter: item.tableFormatter || item.formatter || valueFormatter,
        }))}
      />
    </>
  );
}

function LineChartPanel({
  data = [],
  xKey = "name",
  series = [],
  valueFormatter = fmtInt,
  axisFormatter = fmtInt,
  emptyMessage = "No matching data is available for this report.",
  height = 360,
}) {
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return <ChartEmptyState message={emptyMessage} />;

  return (
    <>
      <KeyLegend items={series.map((item) => ({ label: item.name, color: item.color }))} />
      <div className="w-full overflow-x-auto">
        <div style={{ minWidth: 700, height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 18, right: 30, bottom: 22, left: 12 }}>
              <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
              <XAxis dataKey={xKey} stroke={PALETTE.axis} tick={{ fill: PALETTE.axis, fontSize: 12 }} />
              <YAxis stroke={PALETTE.axis} tick={{ fill: PALETTE.axis, fontSize: 12 }} tickFormatter={axisFormatter} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, name, payload) => {
                  const seriesItem = series.find((item) => item.name === name || item.key === name);
                  const formatter = seriesItem?.formatter || valueFormatter;
                  return [formatter(value, payload?.payload), seriesItem?.name || name];
                }}
              />
              {series.map((item) => (
                <Line
                  key={item.key}
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <FullDataTable
        data={rows.map((row) => ({ ...row, name: row?.[xKey] }))}
        columns={series.map((item) => ({
          key: item.key,
          label: item.name,
          formatter: item.tableFormatter || item.formatter || valueFormatter,
        }))}
        nameLabel={xKey === "week" ? "Week" : xKey === "month" ? "Month" : "Name"}
      />
    </>
  );
}

function AnalyticsReportCard({
  title,
  description,
  children,
  defaultOpen = false,
  testId,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section
      data-testid={testId}
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="w-full px-4 py-4 sm:px-5 text-left flex items-start justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-purple-500/70"
        aria-expanded={isOpen}
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
          <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">{description}</span>
        </span>
        <span className="shrink-0 rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {isOpen ? "Collapse" : "Open report"}
        </span>
      </button>
      {isOpen ? (
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 space-y-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

const ANALYTICS_SECTIONS = [
  { id: "overview", label: "Overview", description: "Key operating, inventory, financial, and risk indicators." },
  { id: "cultivation", label: "Cultivation", description: "Grow stages, yield, cost, contamination, timing, and throughput." },
  { id: "production", label: "Production & Inventory", description: "Parent batches, package inventory, production efficiency, valuation, and rework." },
  { id: "sales", label: "Sales & Financials", description: "Revenue, profit, product, SKU, package-size, pricing, and destination performance." },
  { id: "quality", label: "Quality & Risk", description: "Release status, expiration, overrides, destruction, waste, and losses." },
  { id: "supplies", label: "Supplies & Recipes", description: "Recipe use, supply consumption, stock runway, and packaging inventory." },
];

const ANALYTICS_REPORTS = {
  cultivation: [
    { key: "stageCounts", title: "Grow Stage Distribution", description: "Current active grows grouped by lifecycle stage." },
    { key: "yieldData", title: "Wet vs Dry Yield", description: "Harvest-level wet and dry output with readable grow names." },
    { key: "avgYieldPerStrain", title: "Average Yield per Strain", description: "Average wet and dry output for each strain represented in the selected dataset." },
    { key: "growCosts", title: "Cost per Grow", description: "Normalized recipe and supply cost assigned to each grow." },
    { key: "contamRate", title: "Contamination Rate", description: "Contamination percentage grouped by strain or recipe." },
    { key: "timeToStage", title: "Median Time to Stage", description: "Median days between inoculation, colonization, fruiting, and harvest." },
    { key: "yieldVsCost", title: "Yield vs Cost", description: "Relationship between grow cost and recorded yield." },
    { key: "throughput", title: "Started vs Harvested Throughput", description: "Monthly grow starts compared with completed harvests." },
    { key: "stageTransitions", title: "Stage Transitions Over Time", description: "Monthly lifecycle transition activity." },
    { key: "sopWorkflow", title: "SOP / Workflow Performance", description: "SOP-started grows, checklist completion, generated tasks, and recorded outcomes." },
  ],
  production: [
    { key: "ppInventoryStatus", title: "Active vs Depleted Inventory", description: "Current and historical parent finished batches and package lots." },
    { key: "ppBatchPerformance", title: "Parent Batch Performance", description: "Sold, sampled, destroyed, and available units rolled up to each parent finished batch." },
    { key: "ppEfficiency", title: "Production Batch Efficiency", description: "Expected output, actual output, waste, and variance by production batch." },
    { key: "ppValuation", title: "Available Inventory Valuation", description: "Current packaged inventory at locked cost and projected sales value." },
    { key: "ppRework", title: "Rework Salvage vs Waste", description: "Recovered output and loss from rework or repackaging activity." },
  ],
  sales: [
    { key: "ppFinancial", title: "Realized vs Remaining Financials", description: "Revenue, cost, and profit already realized compared with remaining projected inventory value." },
    { key: "ppProductPerformance", title: "Product Performance", description: "Revenue, profit, and remaining projected revenue by product." },
    { key: "ppSkuPerformance", title: "SKU Performance", description: "Retail, sample, promo, and internal performance by SKU and package configuration." },
    { key: "ppPackageSizePerformance", title: "Package-Size Performance", description: "Outbound and remaining inventory grouped by package size." },
    { key: "ppMargins", title: "Locked Cost, Default Price, and MSRP", description: "Average locked package economics for each SKU configuration." },
    { key: "ppSales", title: "Sales and Outbound by Destination", description: "Units and realized revenue grouped by customer, event, donation target, or other destination." },
  ],
  quality: [
    { key: "ppWorkflow", title: "Workflow and Release Status", description: "Released, pending, held, failed, quarantined, or recalled inventory." },
    { key: "ppOverrides", title: "Price and FEFO Overrides", description: "Recorded pricing exceptions and inventory-rotation overrides by product." },
    { key: "ppExpiring", title: "Expiring Inventory", description: "Available package lots grouped into practical best-by windows." },
    { key: "ppWaste", title: "Finished Inventory Losses", description: "Destroyed and wasted package units with estimated locked-cost loss." },
    { key: "ppProcessWaste", title: "Production Waste by Reason", description: "Manufacturing waste grouped by its recorded cause." },
  ],
  supplies: [
    { key: "recipeUseCounts", title: "Recipe Usage Count", description: "How often each recipe appears in the selected grow dataset, including average grow cost." },
    { key: "recipeUsage", title: "Most Used Supplies", description: "Supplies that appear most often across grow recipes." },
    { key: "burnRate", title: "Weekly Usage and Days Until Empty", description: "Eight-week supply consumption trend and estimated stock runway." },
    { key: "ppPackaging", title: "Packaging Usage vs On Hand", description: "Packaging consumption compared with current supply inventory." },
  ],
};

const ANALYTICS_FEATURE_SUPPORTING_TEXT = Object.freeze({
  [SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS]:
    "Basic grow summaries remain available on every public plan unless an account-specific override removes access.",
  [SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS]:
    "Basic grow counts, stage summaries, harvest totals, task status, and simple history remain available. Cultivator adds comparisons, trends, SOP performance, and advanced filters.",
  [SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS]:
    "Basic cost tracking remains available in grow records. Cultivator adds cross-grow cost reports and yield-versus-cost analysis.",
  [SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS]:
    "Settings backup and raw data export remain available on every tier. Downloadable analytics reports begin with Cultivator and only include reports the account can access.",
  [SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS]:
    "Existing Post Processing records remain available in their operational views. Lab analytics adds inventory, production, sales, quality, financial, and risk reporting.",
});

function getAnalyticsFeatureSupportingText(featureKey) {
  return ANALYTICS_FEATURE_SUPPORTING_TEXT[featureKey] || "";
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

/* ---------- NEW: normalized cost helpers (non-destructive) ---------- */
const toNumber = (n, fb = 0) => (Number.isFinite(Number(n)) ? Number(n) : fb);

function resolveRecipeItemsForGrow(g, recipeById) {
  if (Array.isArray(g?.recipeItems) && g.recipeItems.length) return g.recipeItems;
  const rid = g?.recipeId || g?.recipe_id || g?.recipe?.id;
  const rec = rid ? recipeById.get(rid) : null;
  return rec && Array.isArray(rec.items) ? rec.items : null;
}

/**
 * Compute TOTAL batch cost for a set of recipe items using supply costs.
 * (Per-serving normalization happens later using the recipe's yield.)
 */
function computeItemsCost(items, supplyCostById) {
  if (!Array.isArray(items) || !items.length) return null;
  let sum = 0;
  for (const it of items) {
    const sid = it?.supplyId;
    const per =
      sid && supplyCostById.has(sid)
        ? toNumber(supplyCostById.get(sid), toNumber(it?.cost, 0))
        : toNumber(it?.cost, 0);
    const amt = toNumber(it?.amount, 0);
    sum += per * amt;
  }
  return Math.max(0, Number(sum.toFixed(2)));
}

/**
 * Yield helper: how many jars/tubs a recipe makes.
 * Priority:
 *  - grow.recipeYield (inline override)
 *  - recipe.yield from the recipe document
 *  - default 1 when missing/invalid
 */
function getRecipeYieldForGrow(g, recipeById) {
  if (!g) return 1;

  const inline = toNumber(g?.recipeYield, 0);
  if (inline > 0) return inline;

  const rid = g?.recipeId || g?.recipe_id || g?.recipe?.id;
  if (!rid) return 1;

  const rec = recipeById.get(rid);
  if (!rec) return 1;

  const y = toNumber(rec?.yield, 0);
  return y > 0 ? y : 1;
}



/* ---------- post-process helpers ---------- */
const PACKAGING_TYPE_HINTS = new Set([
  "container", "packaging", "package", "bottle", "jar", "bag", "box", "label", "labels",
  "capsule", "capsules", "dropper", "droppers", "shrink_band", "shrink band", "wrapper", "wrappers",
]);
const lower = (v) => String(v || "").trim().toLowerCase();
const num = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

function isPackagedFinishedLot(lot = {}) {
  if (!isFinishedGoodsLot(lot)) return false;
  if (lot?.package?.isPackaged === true) return true;
  if (lower(lot?.sourceType) === "finished_package") return true;
  return Boolean(lot?.packageRunId && (lot?.parentLotId || lot?.sourceLotId));
}

function getSkuType(lot = {}) {
  const raw = lower(
    lot?.skuType ||
      lot?.packageSkuType ||
      lot?.package?.skuType ||
      lot?.labelMetadata?.skuType ||
      "retail"
  );
  if (["sample", "samples"].includes(raw)) return "sample";
  if (["promo", "promotion", "event"].includes(raw)) return "promo";
  if (["internal", "internal_use", "testing", "retention"].includes(raw)) return "internal";
  return "retail";
}

function getSkuTypeLabel(value = "retail") {
  const key = lower(value);
  if (key === "sample") return "Sample";
  if (key === "promo") return "Promo / event";
  if (key === "internal") return "Internal / testing";
  return "Retail";
}

function getPackageSizeLabel(lot = {}) {
  const explicit = String(
    lot?.packageSizeLabel || lot?.package?.label || lot?.labelMetadata?.packageSizeLabel || ""
  ).trim();
  if (explicit) return explicit;

  const capsules = Math.max(
    0,
    Math.floor(
      num(
        lot?.capsulesPerPackage ??
          lot?.package?.capsulesPerPackage ??
          lot?.labelMetadata?.capsulesPerPackage,
        0
      )
    )
  );
  const weight = num(
    lot?.actualPackageWeightG ?? lot?.package?.actualWeightG ?? lot?.labelMetadata?.actualPackageWeightG,
    0
  );
  if (capsules > 0 && weight > 0) return `${capsules} capsules · ≈ ${round3(weight)} g`;

  const size = num(lot?.packageSize ?? lot?.package?.size ?? lot?.labelMetadata?.packageSize, 0);
  const unit = String(
    lot?.packageSizeUnit ?? lot?.package?.unit ?? lot?.labelMetadata?.packageSizeUnit ?? ""
  ).trim();
  if (size > 0) return `${round3(size)} ${unit || "units"}`.trim();
  return "Unspecified package";
}

function getLockedPackageCost(lot = {}) {
  return round2(
    num(
      lot?.package?.costPerPackage ??
        lot?.package?.totalCostPerPackage ??
        lot?.pricing?.unitCost ??
        lot?.unitCost ??
        lot?.costPerUnit,
      0
    )
  );
}

function getLockedPackageMsrp(lot = {}) {
  return round2(
    num(
      lot?.suggestedMsrpPerPackage ??
        lot?.package?.suggestedMsrpPerPackage ??
        lot?.labelMetadata?.suggestedMsrpPerPackage ??
        lot?.msrpPerUnit ??
        lot?.pricing?.suggestedMsrpPerUnit,
      0
    )
  );
}

function getLockedPackagePrice(lot = {}) {
  const explicit = round2(
    num(
      lot?.pricePerUnit ??
        lot?.package?.defaultSalePricePerPackage ??
        lot?.labelMetadata?.defaultSalePricePerPackage ??
        lot?.pricing?.pricePerUnit,
      0
    )
  );
  if (explicit > 0) return explicit;
  return getSkuType(lot) === "retail" ? getLockedPackageMsrp(lot) : 0;
}

function getProductTypeLabel(lot = {}) {
  const raw = lower(lot?.productType || lot?.finishedGoodType || lot?.lotType || "finished product");
  if (raw === "capsule" || raw === "capsules") return "Capsules";
  if (raw === "gummy" || raw === "gummies") return "Gummies";
  if (raw === "chocolate" || raw === "chocolates") return "Chocolates";
  if (raw === "tincture" || raw === "tinctures") return "Tinctures";
  return raw ? raw.replace(/_/g, " ") : "Finished product";
}

function getProductLabel(lot = {}) {
  return (
    String(
      lot?.labelMetadata?.productName ||
        lot?.productName ||
        lot?.strainName ||
        lot?.strain ||
        lot?.sourceStrain ||
        lot?.batchName ||
        lot?.name ||
        "Finished product"
    ).trim() || "Finished product"
  );
}

function normalizedKeyPart(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getProductKey(lot = {}) {
  return [
    getProductTypeLabel(lot),
    getProductLabel(lot),
    lot?.variantTag || lot?.variant || "",
  ]
    .map(normalizedKeyPart)
    .filter(Boolean)
    .join("|");
}

function getParentBatchId(lot = {}) {
  return String(
    lot?.parentLotId || lot?.sourceLotId || lot?.package?.sourceLotId || lot?.sourceBatchId || ""
  ).trim();
}

function getParentBatchLabel(lot = {}, parentById = new Map()) {
  const parentId = getParentBatchId(lot);
  const parent = parentId ? parentById.get(parentId) : null;
  return (
    String(parent?.batchName || parent?.name || lot?.batchName || lot?.sourceBatchName || parentId || "Batch").trim() ||
    "Batch"
  );
}

function getBestByValue(lot = {}) {
  return String(
    lot?.shelfLife?.bestBy ||
      lot?.shelfLife?.bestByDate ||
      lot?.shelfLife?.expirationDate ||
      lot?.bestBy ||
      lot?.expirationDate ||
      lot?.labelMetadata?.bestBy ||
      lot?.labelMetadata?.bestByDate ||
      ""
  ).trim();
}

function getWorkflowState(lot = {}) {
  const workflow = lot?.workflow && typeof lot.workflow === "object" ? lot.workflow : {};
  const qc = lower(lot?.qc?.status || lot?.qcStatus);
  if (workflow?.recalled || lot?.recalled) return "recalled";
  if (workflow?.quarantined || lot?.quarantined) return "quarantined";
  if (workflow?.qcHold || lot?.qcHold || qc === "hold") return "hold";
  if (["fail", "failed", "rejected"].includes(qc)) return "failed";
  const releaseRequired = Boolean(workflow?.releaseRequired ?? lot?.releaseRequired ?? false);
  const releaseStatus = lower(
    workflow?.releaseStatus || lot?.releaseStatus || (releaseRequired ? "pending" : "released")
  );
  if (releaseRequired && releaseStatus !== "released") return "pending release";
  if (!lot?.qc?.checkedDate && qc === "pending") return "qc pending";
  return "released";
}

function getMoveRevenue(move = {}) {
  const direct = num(move?.revenue ?? move?.totalValue, NaN);
  if (Number.isFinite(direct)) return round2(direct);
  return round2(num(move?.pricePerUnit, 0) * num(move?.quantity, 0));
}

function getMovementDate(move = {}) {
  return toDateMaybe(move?.date || move?.createdAt || move?.updatedAt);
}

function isDateInRange(rawDate, fromDate = "", toDate = "") {
  if (!fromDate && !toDate) return true;
  const d = toDateMaybe(rawDate);
  if (!d) return false;
  const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
  const to = toDate ? new Date(`${toDate}T23:59:59.999`) : null;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function getMovementUnitCost(move = {}, lot = {}) {
  return round2(
    num(
      move?.priceOverride?.packageUnitCost ??
        move?.packageUnitCost ??
        move?.unitCost ??
        getLockedPackageCost(lot),
      0
    )
  );
}

function hasPriceOverride(move = {}) {
  return Boolean(
    move?.priceOverride?.hasOverride ||
      move?.priceOverride?.belowCost ||
      move?.priceOverride?.nonRetailSale ||
      Math.abs(num(move?.priceDifferencePerUnit, 0)) >= 0.01
  );
}

function hasFefoOverride(move = {}) {
  return Boolean(move?.fefoOverride?.applied || move?.inventoryRotation?.overrideApplied);
}

function getBatchExpectedOutput(batch = {}) {
  return num(
    batch?.yieldMetrics?.expectedQuantity ??
      batch?.expectedOutputCount ??
      batch?.expectedOutput ??
      batch?.expectedOutputAmount ??
      batch?.plannedOutput ??
      batch?.plannedCount,
    0
  );
}

function getBatchActualOutput(batch = {}) {
  return num(
    batch?.yieldMetrics?.actualQuantity ??
      batch?.actualOutputCount ??
      batch?.actualOutput ??
      batch?.actualOutputAmount ??
      batch?.finalOutput ??
      batch?.finalCount ??
      batch?.outputCount ??
      batch?.outputAmount,
    0
  );
}

function getBatchWasteQty(batch = {}) {
  return num(
    batch?.yieldMetrics?.wasteQuantity ?? batch?.wasteQuantity ?? batch?.waste?.quantity ?? batch?.shrinkQuantity,
    0
  );
}

function getBatchWasteReason(batch = {}) {
  return (
    batch?.yieldMetrics?.wasteReason ||
    batch?.wasteReason ||
    batch?.waste?.reason ||
    batch?.shrinkReason ||
    batch?.reason ||
    "Unspecified"
  );
}

function getBatchKind(batch = {}) {
  return lower(batch?.processType || batch?.processCategory || batch?.batchType || batch?.type);
}

function isReworkBatch(batch = {}) {
  const hay = `${getBatchKind(batch)} ${lower(batch?.name)}`;
  return /rework|repurpose|relabel|rebottle|repackage/.test(hay);
}

function isPackagingSupply(supply = {}) {
  const type = lower(supply?.type);
  const unit = lower(supply?.unit);
  const name = lower(supply?.name);
  return (
    PACKAGING_TYPE_HINTS.has(type) ||
    PACKAGING_TYPE_HINTS.has(unit) ||
    /bottle|jar|bag|label|capsule|dropper|box|wrapper|shrink/.test(name)
  );
}

function addMetricRow(map, key, label, seed = {}) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      name: label,
      available: 0,
      activeLots: 0,
      depletedLots: 0,
      sold: 0,
      samples: 0,
      promo: 0,
      internal: 0,
      donated: 0,
      destroyed: 0,
      wasted: 0,
      revenue: 0,
      cogs: 0,
      profit: 0,
      projectedRevenue: 0,
      projectedProfit: 0,
      priceOverrides: 0,
      fefoOverrides: 0,
      ...seed,
    });
  }
  return map.get(key);
}

function finalizeMetricRows(map, sortKey = "revenue") {
  return Array.from(map.values())
    .map((row) => ({
      ...row,
      available: round3(row.available),
      sold: round3(row.sold),
      samples: round3(row.samples),
      promo: round3(row.promo),
      internal: round3(row.internal),
      donated: round3(row.donated),
      destroyed: round3(row.destroyed),
      wasted: round3(row.wasted),
      revenue: round2(row.revenue),
      cogs: round2(row.cogs),
      profit: round2(row.profit),
      projectedRevenue: round2(row.projectedRevenue),
      projectedProfit: round2(row.projectedProfit),
      realizedMarginPercent: row.revenue > 0 ? round2((row.profit / row.revenue) * 100) : 0,
    }))
    .sort((a, b) => num(b?.[sortKey], 0) - num(a?.[sortKey], 0));
}

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
  canUseBasicAnalytics = true,
  canUseAdvancedAnalytics = true,
  canUseAdvancedCostAnalytics = true,
  canExportAnalytics = true,
  canUseLabAnalytics = true,
  onSubscriptionFeatureBlocked = () => false,
}) {
  // Default to something that always has data
  
  const [activeSection, setActiveSection] = useState("overview");
  const [showValues, setShowValues] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [groupMode, setGroupMode] = useState("strain"); // "strain" | "recipe"
  const [sortMode, setSortMode] = useState("recent"); // "recent" | "alpha"

  // Live-load audits if not provided
  const [audits, setAudits] = useState(Array.isArray(supplyAudits) ? supplyAudits : []);

  const [materialLots, setMaterialLots] = useState([]);
  const [processBatches, setProcessBatches] = useState([]);
  const [inventoryMoves, setInventoryMoves] = useState([]);

  const hasAnalyticsFeature = (featureKey) => {
    switch (featureKey) {
      case SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS:
        return Boolean(canUseBasicAnalytics);
      case SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS:
        return Boolean(canUseAdvancedAnalytics);
      case SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS:
        return Boolean(canUseAdvancedCostAnalytics);
      case SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS:
        return Boolean(canExportAnalytics);
      case SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS:
        return Boolean(canUseLabAnalytics);
      default:
        return false;
    }
  };

  const analyticsExportScope = useMemo(
    () =>
      getAnalyticsExportScope((featureKey) => {
        switch (featureKey) {
          case SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS:
            return Boolean(canUseBasicAnalytics);
          case SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS:
            return Boolean(canUseAdvancedAnalytics);
          case SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS:
            return Boolean(canUseAdvancedCostAnalytics);
          case SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS:
            return Boolean(canExportAnalytics);
          case SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS:
            return Boolean(canUseLabAnalytics);
          default:
            return false;
        }
      }),
    [
      canExportAnalytics,
      canUseAdvancedAnalytics,
      canUseAdvancedCostAnalytics,
      canUseBasicAnalytics,
      canUseLabAnalytics,
    ]
  );

  const analyticsExportGate = getSubscriptionFeatureGateState({
    allowed: analyticsExportScope.canExport,
    featureKey: SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS,
    actionLabel: "Export analytics",
  });
  const labAnalyticsGate = getSubscriptionFeatureGateState({
    allowed: canUseLabAnalytics,
    featureKey: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
    actionLabel: "View Lab analytics",
  });

  const requestAnalyticsFeature = (featureKey, actionLabel) =>
    onSubscriptionFeatureBlocked?.({
      featureKey,
      actionLabel,
      supportingText: getAnalyticsFeatureSupportingText(featureKey),
    });

  useEffect(() => setAudits(Array.isArray(supplyAudits) ? supplyAudits : []), [supplyAudits]);
  useEffect(() => {
    if (Array.isArray(supplyAudits)) return;
    const u = auth.currentUser;
    if (!u) return;
    const col = collection(db, "users", u.uid, "supply_audits");
    const unsub = onSnapshot(col, (snap) => setAudits(snap.docs.map((d) => d.data())));
    return () => unsub && unsub();
  }, []);
  useEffect(() => {
    if (!canUseLabAnalytics) {
      setMaterialLots([]);
      setProcessBatches([]);
      setInventoryMoves([]);
      return undefined;
    }

    const u = auth.currentUser;
    if (!u) return undefined;
    const lotsCol = collection(db, "users", u.uid, "materialLots");
    const batchCol = collection(db, "users", u.uid, "processBatches");
    const moveCol = collection(db, "users", u.uid, "inventoryMovements");
    const unsubLots = onSnapshot(lotsCol, (snap) => setMaterialLots(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const unsubBatches = onSnapshot(batchCol, (snap) => setProcessBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const unsubMoves = onSnapshot(moveCol, (snap) => setInventoryMoves(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => {
      unsubLots && unsubLots();
      unsubBatches && unsubBatches();
      unsubMoves && unsubMoves();
    };
  }, [canUseLabAnalytics]);

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

  const sopWorkflowPerformance = useMemo(() => {
    const rowsByKey = new Map();
    const growWorkflowById = new Map();

    (filteredAll || []).filter(isSopWorkflowGrow).forEach((grow) => {
      const key = String(
        grow?.workflowTemplateId ||
          grow?.sopTemplateId ||
          grow?.workflowTemplateTitle ||
          grow?.sopTemplateTitle ||
          "sop-workflow"
      );
      const title =
        grow?.workflowTemplateTitle ||
        grow?.sopTemplateTitle ||
        grow?.workflowTitle ||
        "Workflow SOP";

      if (!rowsByKey.has(key)) {
        rowsByKey.set(key, {
          key,
          name: title,
          grows: 0,
          checklistCompleted: 0,
          checklistTotal: 0,
          checklistCompletionPercent: 0,
          tasks: 0,
          completedTasks: 0,
          harvested: 0,
          contaminated: 0,
        });
      }

      const row = rowsByKey.get(key);
      const checklist = getSopChecklist(grow);
      row.grows += 1;
      row.checklistTotal += checklist.length;
      row.checklistCompleted += checklist.filter((item) => item?.completed === true).length;

      const stage = String(grow?.stage || "").toLowerCase();
      const status = String(grow?.status || "").toLowerCase();
      if (stage === "harvested" || stage === "finished" || status === "harvested") {
        row.harvested += 1;
      }
      if (isContaminated(grow)) row.contaminated += 1;

      if (grow?.id) growWorkflowById.set(String(grow.id), key);
    });

    (Array.isArray(tasks) ? tasks : []).forEach((task) => {
      const taskKey = String(
        task?.workflowTemplateId ||
          task?.sopTemplateId ||
          growWorkflowById.get(String(task?.growId || "")) ||
          ""
      );
      if (!taskKey || !rowsByKey.has(taskKey)) return;

      const row = rowsByKey.get(taskKey);
      row.tasks += 1;
      if (task?.completedAt || task?.completed === true || task?.done === true) {
        row.completedTasks += 1;
      }
    });

    return Array.from(rowsByKey.values())
      .map((row) => ({
        ...row,
        checklistCompletionPercent:
          row.checklistTotal > 0
            ? Math.round((row.checklistCompleted / row.checklistTotal) * 100)
            : 0,
      }))
      .sort((a, b) => b.grows - a.grows || a.name.localeCompare(b.name));
  }, [filteredAll, tasks]);

  // Tiny active-only overview (cards)
  // NEW: build normalized cost map once for the current dataset (active vs all)
  const supplyCostById = useMemo(
    () => new Map((supplies || []).map((s) => [s.id, toNumber(s.cost, 0)])),
    [supplies]
  );
  const recipesMap = useMemo(() => recipeNameById(recipes), [recipes]);
  const recipeById = useMemo(() => new Map((recipes || []).map((r) => [r.id, r])), [recipes]);

  const normalizedCostById = useMemo(() => {
    const src = showAll ? datasetAll : datasetActive;
    const map = new Map();

    for (const g of src) {
      if (!g?.id) continue;

      const items = resolveRecipeItemsForGrow(g, recipeById);

      // Derived per-serving cost from recipe + supplies
      let derived = null;
      if (items) {
        const batchCost = computeItemsCost(items, supplyCostById); // total recipe cost
        if (batchCost != null) {
          const y = getRecipeYieldForGrow(g, recipeById);          // jars/tubs per batch
          const divisor = y > 0 ? y : 1;
          derived = Math.max(
            0,
            Number(((batchCost || 0) / divisor).toFixed(2))
          );
        }
      }

      const stored = toNumber(g?.cost, null);
      const cost = derived != null ? derived : stored != null ? stored : 0;

      map.set(g.id, cost);
    }

    return map;
  }, [showAll, datasetAll, datasetActive, recipeById, supplyCostById]);

  const overview = useMemo(() => {
    const totalActive = activeFiltered.length;
    const uniqueStrains = new Set(activeFiltered.map((g) => g.strain || "Unknown")).size;
    const runningCost = activeFiltered.reduce((sum, g) => {
      const c = (g?.id && normalizedCostById.has(g.id)) ? normalizedCostById.get(g.id) : toNumber(g?.cost, 0);
      return sum + c;
    }, 0);
    const ages = activeFiltered
      .map((g) => getRefDate(g))
      .filter(Boolean)
      .map((d) => (Date.now() - d.getTime()) / 86400000);
    const avgAgeDays = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    return { totalActive, uniqueStrains, runningCost: Number(runningCost.toFixed(2)), avgAgeDays };
  }, [activeFiltered, normalizedCostById]);

  const taskSummary = useMemo(() => {
    const rows = Array.isArray(tasks) ? tasks : [];
    const nowMs = Date.now();
    let completed = 0;
    let overdue = 0;

    rows.forEach((task) => {
      const isComplete = Boolean(
        task?.completedAt || task?.completed === true || task?.done === true
      );
      if (isComplete) {
        completed += 1;
        return;
      }

      const due = toDateMaybe(task?.dueAt || task?.dueDate || task?.due);
      if (due && due.getTime() < nowMs) overdue += 1;
    });

    return {
      total: rows.length,
      completed,
      open: Math.max(0, rows.length - completed),
      overdue,
    };
  }, [tasks]);

  const supplyNameById = useMemo(() => new Map((supplies || []).map((s) => [s.id, s.name])), [supplies]);
  const supplyQtyById = useMemo(() => new Map((supplies || []).map((s) => [s.id, Number(s.quantity || 0)])), [supplies]);
  const supplyIdByName = useMemo(() => {
    const m = new Map();
    for (const s of supplies || []) if (s?.name) m.set(String(s.name), s.id);
    return m;
  }, [supplies]);

  const supplyMetaById = useMemo(() => new Map((supplies || []).map((s) => [s.id, s])), [supplies]);
  const packagingSupplyIds = useMemo(
    () => new Set((supplies || []).filter((s) => isPackagingSupply(s)).map((s) => s.id)),
    [supplies]
  );

  const postProcessAnalytics = useMemo(() => {
    const finishedLots = (materialLots || []).filter((lot) => isFinishedGoodsLot(lot));
    const parentFinishedLots = finishedLots.filter((lot) => !isPackagedFinishedLot(lot));
    const packageLots = finishedLots.filter((lot) => isPackagedFinishedLot(lot));
    const activeParentLots = parentFinishedLots.filter((lot) => isActiveMaterialLot(lot));
    const depletedParentLots = parentFinishedLots.filter((lot) => isArchivedOrDepletedMaterialLot(lot));
    const activePackageLots = packageLots.filter((lot) => isActiveMaterialLot(lot));
    const depletedPackageLots = packageLots.filter((lot) => isArchivedOrDepletedMaterialLot(lot));
    const parentById = new Map(parentFinishedLots.map((lot) => [lot.id, lot]));
    const packageById = new Map(packageLots.map((lot) => [lot.id, lot]));
    const hasActivityDateFilter = Boolean(fromDate || toDate);

    const movementTypes = new Set(["sell", "sample", "donate", "waste", "destroy", "adjustment"]);
    const finishedMoves = (inventoryMoves || [])
      .filter((move) => packageById.has(String(move?.lotId || "")))
      .filter((move) => movementTypes.has(lower(move?.movementType)))
      .filter((move) => isDateInRange(getMovementDate(move), fromDate, toDate));

    const movesByLot = new Map();
    finishedMoves.forEach((move) => {
      const lotId = String(move?.lotId || "");
      if (!movesByLot.has(lotId)) movesByLot.set(lotId, []);
      movesByLot.get(lotId).push(move);
    });

    const productMap = new Map();
    const batchMap = new Map();
    const skuMap = new Map();
    const packageSizeMap = new Map();
    const valuationMap = new Map();
    const destinationMap = new Map();
    const overrideMap = new Map();
    const lossMap = new Map();

    const summary = {
      activeParentBatches: activeParentLots.length,
      depletedParentBatches: depletedParentLots.length,
      activePackageLots: activePackageLots.length,
      depletedPackageLots: depletedPackageLots.length,
      availablePackagedUnits: 0,
      unitsSold: 0,
      samplesDistributed: 0,
      promoDistributed: 0,
      internalDistributed: 0,
      donatedUnits: 0,
      destroyedUnits: 0,
      wastedUnits: 0,
      adjustedOutUnits: 0,
      adjustedInUnits: 0,
      realizedRevenue: 0,
      realizedCogs: 0,
      realizedProfit: 0,
      realizedMarginPercent: 0,
      remainingProjectedRevenue: 0,
      remainingProjectedCogs: 0,
      remainingProjectedProfit: 0,
      priceOverrides: 0,
      belowCostSales: 0,
      nonRetailSales: 0,
      fefoOverrides: 0,
      expiring30Lots: 0,
      expiring30Units: 0,
      packagingShortages: 0,
      reworkBatches: 0,
    };

    packageLots.forEach((lot) => {
      const active = isActiveMaterialLot(lot);
      const available = active ? Math.max(0, getLotAvailableQuantity(lot)) : 0;
      const unitCost = getLockedPackageCost(lot);
      const lockedPrice = getLockedPackagePrice(lot);
      const msrp = getLockedPackageMsrp(lot);
      const projectedRevenue = round2(available * lockedPrice);
      const projectedCogs = round2(available * unitCost);
      const projectedProfit = round2(projectedRevenue - projectedCogs);
      const productKey = getProductKey(lot) || lot.id;
      const productLabel = getProductLabel(lot);
      const batchKey = getParentBatchId(lot) || lot?.sourceBatchId || lot?.batchName || lot.id;
      const batchLabel = getParentBatchLabel(lot, parentById);
      const skuType = getSkuType(lot);
      const packageSizeLabel = getPackageSizeLabel(lot);
      const skuKey = `${skuType}|${normalizedKeyPart(packageSizeLabel)}`;
      const typeLabel = getProductTypeLabel(lot);

      const productRow = addMetricRow(productMap, productKey, productLabel, {
        productType: typeLabel,
        variant: lot?.variant || lot?.variantTag || "",
      });
      const batchRow = addMetricRow(batchMap, String(batchKey), batchLabel, {
        product: productLabel,
        parentLotId: getParentBatchId(lot),
      });
      const skuRow = addMetricRow(skuMap, skuKey, `${getSkuTypeLabel(skuType)} · ${packageSizeLabel}`, {
        skuType,
        packageSize: packageSizeLabel,
      });
      const packageRow = addMetricRow(packageSizeMap, normalizedKeyPart(packageSizeLabel) || packageSizeLabel, packageSizeLabel, {
        packageSize: packageSizeLabel,
      });

      [productRow, batchRow, skuRow, packageRow].forEach((row) => {
        row.available += available;
        row.activeLots += active ? 1 : 0;
        row.depletedLots += active ? 0 : 1;
        row.projectedRevenue += projectedRevenue;
        row.projectedProfit += projectedProfit;
      });

      const valuationRow = addMetricRow(valuationMap, normalizedKeyPart(typeLabel), typeLabel);
      valuationRow.available += available;
      valuationRow.activeLots += active ? 1 : 0;
      valuationRow.depletedLots += active ? 0 : 1;
      valuationRow.projectedRevenue += projectedRevenue;
      valuationRow.projectedProfit += projectedProfit;
      valuationRow.inventoryCostValue = round2((valuationRow.inventoryCostValue || 0) + projectedCogs);

      summary.availablePackagedUnits += available;
      summary.remainingProjectedRevenue += projectedRevenue;
      summary.remainingProjectedCogs += projectedCogs;
      summary.remainingProjectedProfit += projectedProfit;

      const lotMoves = movesByLot.get(lot.id) || [];
      if (lotMoves.length > 0) {
        lotMoves.forEach((move) => {
          const type = lower(move?.movementType);
          const direction = lower(move?.direction || "out");
          const quantity = Math.max(0, num(move?.quantity, 0));
          const revenue = type === "sell" && direction === "out" ? getMoveRevenue(move) : 0;
          const cogs = type === "sell" && direction === "out" ? round2(getMovementUnitCost(move, lot) * quantity) : 0;
          const profit = round2(revenue - cogs);
          const isOverride = type === "sell" && hasPriceOverride(move);
          const isFefo = type === "sell" && hasFefoOverride(move);

          [productRow, batchRow, skuRow, packageRow].forEach((row) => {
            if (type === "sell" && direction === "out") {
              row.sold += quantity;
              row.revenue += revenue;
              row.cogs += cogs;
              row.profit += profit;
            } else if (type === "sample" && direction === "out") {
              row.samples += quantity;
              if (skuType === "promo") row.promo += quantity;
              if (skuType === "internal") row.internal += quantity;
            } else if (type === "donate" && direction === "out") row.donated += quantity;
            else if (type === "destroy" && direction === "out") row.destroyed += quantity;
            else if (type === "waste" && direction === "out") row.wasted += quantity;
            if (isOverride) row.priceOverrides += 1;
            if (isFefo) row.fefoOverrides += 1;
          });

          if (type === "sell" && direction === "out") {
            summary.unitsSold += quantity;
            summary.realizedRevenue += revenue;
            summary.realizedCogs += cogs;
            summary.realizedProfit += profit;
          } else if (type === "sample" && direction === "out") {
            summary.samplesDistributed += quantity;
            if (skuType === "promo") summary.promoDistributed += quantity;
            if (skuType === "internal") summary.internalDistributed += quantity;
          } else if (type === "donate" && direction === "out") summary.donatedUnits += quantity;
          else if (type === "destroy" && direction === "out") summary.destroyedUnits += quantity;
          else if (type === "waste" && direction === "out") summary.wastedUnits += quantity;
          else if (type === "adjustment" && direction === "in") summary.adjustedInUnits += quantity;
          else if (type === "adjustment") summary.adjustedOutUnits += quantity;

          if (isOverride) {
            summary.priceOverrides += 1;
            if (move?.priceOverride?.belowCost) summary.belowCostSales += 1;
            if (move?.priceOverride?.nonRetailSale) summary.nonRetailSales += 1;
          }
          if (isFefo) summary.fefoOverrides += 1;

          const destination = String(
            move?.destinationName || move?.counterparty || move?.destinationType || "Unspecified"
          ).trim() || "Unspecified";
          if (!destinationMap.has(destination)) {
            destinationMap.set(destination, { name: destination, quantity: 0, revenue: 0 });
          }
          if (["sell", "sample", "donate"].includes(type) && direction === "out") {
            destinationMap.get(destination).quantity += quantity;
            destinationMap.get(destination).revenue += revenue;
          }

          if (isOverride || isFefo) {
            const key = productKey || productLabel;
            if (!overrideMap.has(key)) {
              overrideMap.set(key, { name: productLabel, priceOverrides: 0, fefoOverrides: 0 });
            }
            if (isOverride) overrideMap.get(key).priceOverrides += 1;
            if (isFefo) overrideMap.get(key).fefoOverrides += 1;
          }

          if (["destroy", "waste"].includes(type) && direction === "out") {
            const reason = String(move?.reason || move?.note || `${type} inventory`).trim() || "Unspecified";
            if (!lossMap.has(reason)) {
              lossMap.set(reason, { name: reason, destroyed: 0, wasted: 0, costLoss: 0 });
            }
            const row = lossMap.get(reason);
            if (type === "destroy") row.destroyed += quantity;
            if (type === "waste") row.wasted += quantity;
            row.costLoss += round2(getMovementUnitCost(move, lot) * quantity);
          }
        });
      } else if (!hasActivityDateFilter) {
        const outbound = lot?.outboundSummary || {};
        const sold = Math.max(0, num(outbound?.sold, 0));
        const sampled = Math.max(0, num(outbound?.sampled, 0));
        const donated = Math.max(0, num(outbound?.donated, 0));
        const destroyed = Math.max(0, num(outbound?.destroyed, 0));
        const wasted = Math.max(0, num(outbound?.wasted, 0));
        const revenue = round2(num(outbound?.revenue, 0));
        const cogs = round2(unitCost * sold);
        const profit = round2(revenue - cogs);

        [productRow, batchRow, skuRow, packageRow].forEach((row) => {
          row.sold += sold;
          row.samples += sampled;
          if (skuType === "promo") row.promo += sampled;
          if (skuType === "internal") row.internal += sampled;
          row.donated += donated;
          row.destroyed += destroyed;
          row.wasted += wasted;
          row.revenue += revenue;
          row.cogs += cogs;
          row.profit += profit;
        });

        summary.unitsSold += sold;
        summary.samplesDistributed += sampled;
        if (skuType === "promo") summary.promoDistributed += sampled;
        if (skuType === "internal") summary.internalDistributed += sampled;
        summary.donatedUnits += donated;
        summary.destroyedUnits += destroyed;
        summary.wastedUnits += wasted;
        summary.realizedRevenue += revenue;
        summary.realizedCogs += cogs;
        summary.realizedProfit += profit;
      }

      const bestBy = toDateMaybe(getBestByValue(lot));
      if (active && available > 0 && bestBy) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(bestBy);
        target.setHours(0, 0, 0, 0);
        const days = Math.ceil((target - today) / 86400000);
        if (days >= 0 && days <= 30) {
          summary.expiring30Lots += 1;
          summary.expiring30Units += available;
        }
      }
    });

    summary.availablePackagedUnits = round3(summary.availablePackagedUnits);
    summary.unitsSold = round3(summary.unitsSold);
    summary.samplesDistributed = round3(summary.samplesDistributed);
    summary.promoDistributed = round3(summary.promoDistributed);
    summary.internalDistributed = round3(summary.internalDistributed);
    summary.donatedUnits = round3(summary.donatedUnits);
    summary.destroyedUnits = round3(summary.destroyedUnits);
    summary.wastedUnits = round3(summary.wastedUnits);
    summary.realizedRevenue = round2(summary.realizedRevenue);
    summary.realizedCogs = round2(summary.realizedCogs);
    summary.realizedProfit = round2(summary.realizedProfit);
    summary.realizedMarginPercent = summary.realizedRevenue > 0
      ? round2((summary.realizedProfit / summary.realizedRevenue) * 100)
      : 0;
    summary.remainingProjectedRevenue = round2(summary.remainingProjectedRevenue);
    summary.remainingProjectedCogs = round2(summary.remainingProjectedCogs);
    summary.remainingProjectedProfit = round2(summary.remainingProjectedProfit);
    summary.expiring30Units = round3(summary.expiring30Units);

    const workflowTally = new Map();
    [...activeParentLots, ...activePackageLots].forEach((lot) => {
      const state = getWorkflowState(lot);
      workflowTally.set(state, (workflowTally.get(state) || 0) + 1);
    });
    const workflowCounts = Array.from(workflowTally.entries())
      .map(([name, value]) => ({ name: name.replace(/\b\w/g, (c) => c.toUpperCase()), value }))
      .sort((a, b) => b.value - a.value);

    const inventoryStatus = [
      { name: "Parent finished batches", Active: activeParentLots.length, Depleted: depletedParentLots.length },
      { name: "Package lots", Active: activePackageLots.length, Depleted: depletedPackageLots.length },
    ];

    const financialSnapshot = [
      {
        name: "Realized",
        Revenue: summary.realizedRevenue,
        Cost: summary.realizedCogs,
        Profit: summary.realizedProfit,
      },
      {
        name: "Remaining",
        Revenue: summary.remainingProjectedRevenue,
        Cost: summary.remainingProjectedCogs,
        Profit: summary.remainingProjectedProfit,
      },
    ];

    const lockedPricingMap = new Map();
    packageLots.forEach((lot) => {
      const skuType = getSkuType(lot);
      const packageLabel = getPackageSizeLabel(lot);
      const key = `${skuType}|${normalizedKeyPart(packageLabel)}`;
      if (!lockedPricingMap.has(key)) {
        lockedPricingMap.set(key, {
          name: `${getSkuTypeLabel(skuType)} · ${packageLabel}`,
          costTotal: 0,
          priceTotal: 0,
          msrpTotal: 0,
          count: 0,
        });
      }
      const row = lockedPricingMap.get(key);
      row.costTotal += getLockedPackageCost(lot);
      row.priceTotal += getLockedPackagePrice(lot);
      row.msrpTotal += getLockedPackageMsrp(lot);
      row.count += 1;
    });
    const lockedPricing = Array.from(lockedPricingMap.values())
      .map((row) => ({
        name: row.name,
        Cost: row.count ? round2(row.costTotal / row.count) : 0,
        DefaultPrice: row.count ? round2(row.priceTotal / row.count) : 0,
        MSRP: row.count ? round2(row.msrpTotal / row.count) : 0,
      }))
      .sort((a, b) => b.DefaultPrice - a.DefaultPrice)
      .slice(0, 16);

    const expiringLots = activePackageLots
      .map((lot) => {
        const bestBy = toDateMaybe(getBestByValue(lot));
        if (!bestBy) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(bestBy);
        target.setHours(0, 0, 0, 0);
        return {
          id: lot.id,
          name: lot?.lotCode || lot?.batchLot || lot?.name || lot.id,
          product: getProductLabel(lot),
          packageSize: getPackageSizeLabel(lot),
          bestBy: getBestByValue(lot),
          days: Math.ceil((target - today) / 86400000),
          units: Math.max(0, getLotAvailableQuantity(lot)),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.days - b.days);

    const expirationBuckets = [
      { name: "Past best-by", units: 0, lots: 0 },
      { name: "0–30 days", units: 0, lots: 0 },
      { name: "31–60 days", units: 0, lots: 0 },
      { name: "61–90 days", units: 0, lots: 0 },
      { name: "90+ days", units: 0, lots: 0 },
    ];
    expiringLots.forEach((lot) => {
      let bucket = expirationBuckets[4];
      if (lot.days < 0) bucket = expirationBuckets[0];
      else if (lot.days <= 30) bucket = expirationBuckets[1];
      else if (lot.days <= 60) bucket = expirationBuckets[2];
      else if (lot.days <= 90) bucket = expirationBuckets[3];
      bucket.units += lot.units;
      bucket.lots += 1;
    });
    expirationBuckets.forEach((row) => {
      row.units = round3(row.units);
    });

    const efficiencyByBatch = (processBatches || [])
      .map((batch) => {
        const expected = getBatchExpectedOutput(batch);
        const actual = getBatchActualOutput(batch);
        const waste = getBatchWasteQty(batch);
        if (!(expected > 0 || actual > 0 || waste > 0)) return null;
        const variance = actual - expected;
        const variancePct = expected > 0 ? (variance / expected) * 100 : 0;
        return {
          name: batch?.name || batch?.id || "Batch",
          kind: getBatchKind(batch) || "batch",
          expected: round3(expected),
          actual: round3(actual),
          waste: round3(waste),
          variance: round3(variance),
          variancePct: round2(variancePct),
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
      .slice(0, 16);

    const reworkSeries = (processBatches || [])
      .filter((batch) => isReworkBatch(batch))
      .map((batch) => ({
        name: batch?.name || batch?.id || "Rework",
        salvage: num(
          batch?.salvageOutput ?? batch?.salvageQuantity ?? batch?.yieldMetrics?.actualQuantity ?? batch?.actualOutput,
          0
        ),
        waste: getBatchWasteQty(batch),
      }))
      .sort((a, b) => b.salvage + b.waste - (a.salvage + a.waste));
    summary.reworkBatches = reworkSeries.length;

    const processWasteMap = new Map();
    (processBatches || []).forEach((batch) => {
      const qty = getBatchWasteQty(batch);
      if (qty <= 0) return;
      const reason = getBatchWasteReason(batch);
      if (!processWasteMap.has(reason)) processWasteMap.set(reason, { name: reason, quantity: 0 });
      processWasteMap.get(reason).quantity += qty;
    });
    const processWasteByReason = Array.from(processWasteMap.values())
      .map((row) => ({ ...row, quantity: round3(row.quantity) }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 12);

    const packagingUsageMap = {};
    (audits || []).forEach((audit) => {
      const sid = audit?.supplyId || audit?.supply_id;
      if (!sid || !packagingSupplyIds.has(sid)) return;
      if (lower(audit?.action) !== "consume") return;
      const name = audit?.supplyName || supplyMetaById.get(sid)?.name || sid;
      if (!packagingUsageMap[name]) {
        packagingUsageMap[name] = {
          name,
          used: 0,
          onHand: num(supplyMetaById.get(sid)?.quantity, 0),
        };
      }
      packagingUsageMap[name].used += num(audit?.amount, 0);
    });
    const packagingUsage = Object.values(packagingUsageMap)
      .map((row) => ({
        ...row,
        used: round3(row.used),
        onHand: round3(row.onHand),
        daysCover: row.used > 0 ? Math.round(row.onHand / (row.used / 56 || 1)) : null,
      }))
      .sort((a, b) => b.used - a.used)
      .slice(0, 12);

    const packagingShortages = (supplies || [])
      .filter((s) => isPackagingSupply(s))
      .filter((s) => {
        const qty = num(s?.quantity, 0);
        const threshold = num(s?.lowStockThreshold ?? s?.reorderAt ?? s?.reorderThreshold, 0);
        return threshold > 0 ? qty <= threshold : qty <= 0;
      });
    summary.packagingShortages = packagingShortages.length;

    const labelCompleteness = packageLots.reduce(
      (acc, lot) => {
        const meta = lot?.labelMetadata || {};
        if (meta?.lotCode || lot?.lotCode) acc.codes += 1;
        if (meta?.packDate || lot?.packDate || lot?.package?.packagedDate) acc.packDates += 1;
        if (meta?.packageSizeLabel || lot?.packageSizeLabel) acc.packageSizes += 1;
        if (meta?.skuType || lot?.skuType) acc.skuTypes += 1;
        return acc;
      },
      { codes: 0, packDates: 0, packageSizes: 0, skuTypes: 0 }
    );

    const valuationByType = finalizeMetricRows(valuationMap, "projectedRevenue").map((row) => ({
      ...row,
      units: row.available,
      costValue: round2(row.inventoryCostValue || 0),
      salesValue: row.projectedRevenue,
    }));
    const salesByDestination = Array.from(destinationMap.values())
      .map((row) => ({ ...row, quantity: round3(row.quantity), revenue: round2(row.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 14);
    const overrideByProduct = Array.from(overrideMap.values())
      .sort((a, b) => b.priceOverrides + b.fefoOverrides - (a.priceOverrides + a.fefoOverrides));
    const finishedLossByReason = Array.from(lossMap.values())
      .map((row) => ({
        ...row,
        destroyed: round3(row.destroyed),
        wasted: round3(row.wasted),
        costLoss: round2(row.costLoss),
      }))
      .sort((a, b) => b.costLoss - a.costLoss || b.destroyed + b.wasted - (a.destroyed + a.wasted))
      .slice(0, 14);

    return {
      summary,
      workflowCounts,
      inventoryStatus,
      financialSnapshot,
      productPerformance: finalizeMetricRows(productMap, "revenue").slice(0, 18),
      batchPerformance: finalizeMetricRows(batchMap, "revenue").slice(0, 18),
      skuPerformance: finalizeMetricRows(skuMap, "revenue").slice(0, 18),
      packageSizePerformance: finalizeMetricRows(packageSizeMap, "revenue").slice(0, 18),
      lockedPricing,
      overrideByProduct,
      expirationBuckets,
      expiringLots,
      valuationByType,
      salesByDestination,
      finishedLossByReason,
      processWasteByReason,
      efficiencyByBatch,
      reworkSeries,
      packagingUsage,
      packagingShortages,
      labelCompleteness,
      activityMoveCount: finishedMoves.length,
      activityDateFiltered: hasActivityDateFilter,
    };
  }, [
    materialLots,
    processBatches,
    inventoryMoves,
    audits,
    packagingSupplyIds,
    supplyMetaById,
    supplies,
    fromDate,
    toDate,
  ]);


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

    // Cost per grow — NEW: use normalized cost if available
    const growCosts = filteredAll
      .map((x) => {
        const cost =
          (x?.id && normalizedCostById.has(x.id))
            ? normalizedCostById.get(x.id)
            : toNumber(x.cost, 0);
        const ref = getRefDate(x);
        return {
          name: x.abbreviation || x.strain || (x.id ? x.id.slice(0, 6) : ""),
          Cost: Number(cost || 0),
          _refTime: ref ? ref.getTime() : 0,
        };
      })
      .sort((a, b) => {
        if (sortMode === "alpha") {
          return a.name.localeCompare(b.name);
        }
        // default: most recently inoculated first
        return (b._refTime || 0) - (a._refTime || 0);
      });

    // Most used supplies (via recipes)
    const supplyCount = {};
    filteredAll.forEach((x) => {
      let items = resolveRecipeItemsForGrow(x, recipeById);
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

    // Recipe usage count — NEW: average cost via normalized cost
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
      const c = (g?.id && normalizedCostById.has(g.id)) ? normalizedCostById.get(g.id) : toNumber(g.cost, 0);
      usageAcc[rname].totalCost += c;
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
const temp = new Date(
  Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  )
);

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

        const sid = a.supplyId || a.supply_id || null;
        const friendly =
          a.supplyName ||
          a.name ||
          (sid ? supplyNameById.get(sid) : null);

        // If we still can't resolve a friendly name, ignore this audit
        if (!friendly) return;

        const label = String(friendly);

        if (!byKey[label]) byKey[label] = { weeks: {}, total: 0, sid };
        const amt = Number(a.amount || 0);
        const safe = Number.isFinite(amt) ? amt : 0;
        byKey[label].weeks[wk] =
          (byKey[label].weeks[wk] || 0) + safe;
        byKey[label].total += safe;
      });
    } else {
      // Synthetic estimate from recipe items on the grow's start week
      const windowStart = new Date(temp);
      windowStart.setUTCDate(
        windowStart.getUTCDate() - (weeksBack - 1) * 7
      );

      filteredAll.forEach((g) => {
        const start = getRefDate(g);
        if (!start || start < windowStart) return;
        const wk = weekKey(start);
        if (!weekLabels.includes(wk)) return;

        const items = resolveRecipeItemsForGrow(g, recipeById);
        if (!items) return;

        items.forEach((it) => {
          const sid = it?.supplyId || null;
          const friendly =
            it?.name ||
            (sid ? supplyNameById.get(sid) : null);

          // Skip items we can't map to a supply name
          if (!friendly) return;

          const label = String(friendly);

          if (!byKey[label]) {
            byKey[label] = {
              weeks: {},
              total: 0,
              sid,
            };
          }

          const amt = Number(it?.amount);
          const use = Number.isFinite(amt) ? amt : 1; // assume 1 if undefined
          byKey[label].weeks[wk] =
            (byKey[label].weeks[wk] || 0) + use;
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

    // Yield vs Cost — NEW: use normalized cost
    const yieldVsCost = filteredAll
      .map((g) => {
        const t = totalsFromGrow(g);
        const y = t.Dry || t.Wet || 0;
        const x =
          (g?.id && normalizedCostById.has(g.id))
            ? normalizedCostById.get(g.id)
            : toNumber(g.cost, 0);
        return {
          x: Number(x),
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
    normalizedCostById,
    sortMode,
  ]);

  const recordedYieldSummary = useMemo(
    () =>
      yieldData.reduce(
        (totals, row) => ({
          wet: totals.wet + num(row?.Wet, 0),
          dry: totals.dry + num(row?.Dry, 0),
        }),
        { wet: 0, dry: 0 }
      ),
    [yieldData]
  );

  // CSV export
  const exportCSV = () => {
    if (!analyticsExportScope.canExport) {
      requestAnalyticsFeature(
        SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS,
        "Export analytics as CSV"
      );
      return;
    }

    const csvCell = (value) => {
      const text = value == null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const row = (...values) => values.map(csvCell).join(",");
    const lines = [row("Type", "Name", "ValueA", "ValueB", "ValueC", "ValueD")];

    if (analyticsExportScope.includeBasic) {
      lines.push(
        ...stageCounts.map((d) => row("StageCount (active)", d.name, d.value)),
        ...yieldData.map((d) => row("Yield", d.name, d.Wet, d.Dry)),
        ...stageTransitions.map((d) => row("StageTransition", d.month, d.count)),
        ...throughputSeries.map((d) => row("Throughput", d.month, d.Started, d.Harvested))
      );
    }

    if (analyticsExportScope.includeAdvanced) {
      lines.push(
        ...avgYieldPerStrain.map((d) => row("AvgYieldPerStrain", d.name, d.Wet, d.Dry)),
        ...mostUsedSupplies.map((d) => row("MostUsedSupplies", d.name, d.count)),
        ...recipeUseCounts.map((d) => row("RecipeUseCount", d.name, d.count, round2(d.avgCost))),
        ...contamRate.map((d) => row(`ContamRate(${groupMode})`, d.name, round2(d.rate), d.bad, d.total)),
        ...ttsSeries.map((d) => row(
          `TimeToStage(${groupMode})`,
          d.name,
          d.Inoc_to_Colonized,
          d.Colonized_to_Fruiting,
          d.Fruiting_to_Harvested
        )),
        ...burnRateSeries.map((d) => row("BurnRate", d.week, JSON.stringify(d))),
        ...sopWorkflowPerformance.map((d) => row(
          "SOP Workflow",
          d.name,
          d.grows,
          d.checklistCompletionPercent,
          d.tasks,
          d.completedTasks
        ))
      );
    }

    if (analyticsExportScope.includeAdvancedCost) {
      lines.push(
        ...growCosts.map((d) => row("Cost", d.name, d.Cost)),
        ...yieldVsCost.map((d) => row("YieldVsCost", d.name, d.x, d.y))
      );
    }

    if (analyticsExportScope.includeLab) {
      lines.push(
        ...postProcessAnalytics.workflowCounts.map((d) => row("PP Workflow", d.name, d.value)),
        ...postProcessAnalytics.inventoryStatus.map((d) => row("PP Inventory Status", d.name, d.Active, d.Depleted)),
        ...postProcessAnalytics.financialSnapshot.map((d) => row("PP Financial", d.name, d.Revenue, d.Cost, d.Profit)),
        ...postProcessAnalytics.productPerformance.map((d) => row("PP Product", d.name, d.sold, d.revenue, d.profit, d.available)),
        ...postProcessAnalytics.batchPerformance.map((d) => row("PP Batch", d.name, d.sold, d.revenue, d.profit, d.available)),
        ...postProcessAnalytics.skuPerformance.map((d) => row("PP SKU", d.name, d.sold, d.samples, d.revenue, d.available)),
        ...postProcessAnalytics.packageSizePerformance.map((d) => row("PP Package Size", d.name, d.sold, d.samples, d.revenue, d.available)),
        ...postProcessAnalytics.lockedPricing.map((d) => row("PP Locked Pricing", d.name, d.Cost, d.DefaultPrice, d.MSRP)),
        ...postProcessAnalytics.overrideByProduct.map((d) => row("PP Overrides", d.name, d.priceOverrides, d.fefoOverrides)),
        ...postProcessAnalytics.expirationBuckets.map((d) => row("PP Expiration", d.name, d.units, d.lots)),
        ...postProcessAnalytics.salesByDestination.map((d) => row("PP Destination", d.name, d.quantity, d.revenue)),
        ...postProcessAnalytics.finishedLossByReason.map((d) => row("PP Finished Loss", d.name, d.destroyed, d.wasted, d.costLoss)),
        ...postProcessAnalytics.processWasteByReason.map((d) => row("PP Process Waste", d.name, d.quantity)),
        ...postProcessAnalytics.efficiencyByBatch.map((d) => row("PP Efficiency", d.name, d.expected, d.actual, d.waste, d.variancePct)),
        ...postProcessAnalytics.reworkSeries.map((d) => row("PP Rework", d.name, d.salvage, d.waste)),
        ...postProcessAnalytics.packagingUsage.map((d) => row("Packaging Usage", d.name, d.used, d.onHand, d.daysCover))
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "analytics.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // JSON export
  const exportJSON = () => {
    if (!analyticsExportScope.canExport) {
      requestAnalyticsFeature(
        SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS,
        "Export analytics as JSON"
      );
      return;
    }

    const chosenGrows = showAll ? (Array.isArray(growsAll) ? growsAll : allGrows) : datasetActive;
    const payload = {
      app: "Chaotic Neutral Myco Tracker",
      schemaVersion: 4,
      exportedAt: new Date().toISOString(),
      growDataset: showAll ? "all" : "active",
      activityRange: { from: fromDate || null, to: toDate || null },
      accessScope: {
        basicAnalytics: analyticsExportScope.includeBasic,
        advancedAnalytics: analyticsExportScope.includeAdvanced,
        advancedCostAnalytics: analyticsExportScope.includeAdvancedCost,
        labAnalytics: analyticsExportScope.includeLab,
      },
      counts: {
        grows: Array.isArray(chosenGrows) ? chosenGrows.length : 0,
        tasks: Array.isArray(tasks) ? tasks.length : 0,
        recipes: Array.isArray(recipes) ? recipes.length : 0,
        supplies: Array.isArray(supplies) ? supplies.length : 0,
        audits: Array.isArray(audits) ? audits.length : 0,
        ...(analyticsExportScope.includeLab
          ? {
              materialLots: materialLots.length,
              processBatches: processBatches.length,
              inventoryMovements: inventoryMoves.length,
            }
          : {}),
      },
      data: {
        grows: Array.isArray(chosenGrows) ? chosenGrows : [],
        tasks: Array.isArray(tasks) ? tasks : [],
        recipes: Array.isArray(recipes) ? recipes : [],
        supplies: Array.isArray(supplies) ? supplies : [],
        audits: Array.isArray(audits) ? audits : [],
        ...(analyticsExportScope.includeLab
          ? { materialLots, processBatches, inventoryMovements: inventoryMoves }
          : {}),
      },
      analytics: {
        ...(analyticsExportScope.includeBasic
          ? { stageCounts, yieldData, stageTransitions, throughputSeries, taskSummary }
          : {}),
        ...(analyticsExportScope.includeAdvanced
          ? {
              avgYieldPerStrain,
              recipeUseCounts,
              mostUsedSupplies,
              contamRate,
              ttsSeries,
              burnTopSupplies,
              sopWorkflowPerformance,
            }
          : {}),
        ...(analyticsExportScope.includeAdvancedCost
          ? { growCosts, yieldVsCost }
          : {}),
        ...(analyticsExportScope.includeLab
          ? { postProcess: postProcessAnalytics }
          : {}),
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `myco-analytics-${payload.growDataset}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const axisProps = { stroke: PALETTE.axis, tick: { fill: PALETTE.axis, fontSize: 12 } };
  const gridProps = { stroke: PALETTE.grid, strokeDasharray: "3 3" };

  const renderChart = (reportKey) => {
    switch (reportKey) {
      case "sopWorkflow":
        if (!sopWorkflowPerformance.length) {
          return (
            <ChartEmptyState message="No SOP-started grows match the current filters." />
          );
        }
        return (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {sopWorkflowPerformance.map((row) => (
                <div
                  key={row.key}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 p-3"
                >
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {row.name}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        Checklist
                      </div>
                      <div className="font-semibold">
                        {fmtInt(row.checklistCompletionPercent)}% complete
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        SOP tasks
                      </div>
                      <div className="font-semibold">
                        {fmtInt(row.completedTasks)} / {fmtInt(row.tasks)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        Harvested
                      </div>
                      <div className="font-semibold">{fmtInt(row.harvested)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        Contaminated
                      </div>
                      <div className="font-semibold">{fmtInt(row.contaminated)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <HorizontalBarChartPanel
              data={sopWorkflowPerformance}
              showValues={showValues}
              nameLabel="Workflow"
              series={[
                {
                  key: "grows",
                  name: "SOP-started grows",
                  color: PALETTE.line,
                  formatter: fmtInt,
                },
                {
                  key: "tasks",
                  name: "Generated SOP tasks",
                  color: PALETTE.cost,
                  formatter: fmtInt,
                },
                {
                  key: "completedTasks",
                  name: "Completed SOP tasks",
                  color: PALETTE.scatter,
                  formatter: fmtInt,
                },
              ]}
              emptyMessage="No SOP-started grows match the current filters."
            />
          </>
        );

      case "stageCounts":
        if (!stageCounts.length) return <ChartEmptyState message="No active grow stages match the current filters." />;
        return (
          <>
            <KeyLegend items={stageCounts.map((row, index) => ({ label: row.name, color: PIE_COLORS[index % PIE_COLORS.length] }))} />
            <div style={{ height: 390 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 10, right: 20, bottom: 18, left: 20 }}>
                  <Tooltip formatter={(value) => fmtInt(value)} contentStyle={TOOLTIP_STYLE} />
                  <Pie data={stageCounts} dataKey="value" nameKey="name" outerRadius="78%" labelLine={false} label={({ name, value }) => `${name}: ${fmtInt(value)}`}>
                    {stageCounts.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <FullDataTable data={stageCounts} columns={[{ key: "value", label: "Active grows", formatter: fmtInt }]} />
          </>
        );

      case "yieldData":
        return (
          <HorizontalBarChartPanel
            data={yieldData}
            showValues={showValues}
            valueFormatter={fmtG}
            axisFormatter={fmtInt}
            series={[
              { key: "Wet", name: "Wet (g)", color: PALETTE.wet, formatter: fmtG },
              { key: "Dry", name: "Dry (g)", color: PALETTE.dry, formatter: fmtG },
            ]}
            emptyMessage="No harvested grow yield matches the current filters."
            nameLabel="Grow / strain"
          />
        );

      case "avgYieldPerStrain":
        return (
          <HorizontalBarChartPanel
            data={avgYieldPerStrain}
            showValues={showValues}
            valueFormatter={fmtG}
            axisFormatter={fmtInt}
            series={[
              { key: "Wet", name: "Average wet (g)", color: PALETTE.wet, formatter: fmtG },
              { key: "Dry", name: "Average dry (g)", color: PALETTE.dry, formatter: fmtG },
            ]}
            emptyMessage="No strain-level yield is available for the current filters."
            nameLabel="Strain"
          />
        );

      case "growCosts":
        return (
          <HorizontalBarChartPanel
            data={growCosts}
            showValues={showValues}
            valueFormatter={fmt$}
            axisFormatter={(value) => `$${fmtInt(value)}`}
            series={[{ key: "Cost", name: "Grow cost", color: PALETTE.cost, formatter: fmt$ }]}
            emptyMessage="No grow cost data matches the current filters."
            nameLabel="Grow"
          />
        );

      case "recipeUseCounts":
        return (
          <HorizontalBarChartPanel
            data={recipeUseCounts}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[{ key: "count", name: "Grows using recipe", color: PALETTE.line, formatter: fmtInt }]}
            tooltipLabelFormatter={(label, row) => row ? `${label} · Average cost ${fmt$(row.avgCost)}` : label}
            emptyMessage="No recipe usage matches the current grow filters."
            nameLabel="Recipe"
          />
        );

      case "recipeUsage":
        return (
          <HorizontalBarChartPanel
            data={mostUsedSupplies}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[{ key: "count", name: "Recipe appearances", color: PALETTE.line, formatter: fmtInt }]}
            emptyMessage="No recipe-linked supplies match the current grow filters."
            nameLabel="Supply"
          />
        );

      case "contamRate":
        return (
          <HorizontalBarChartPanel
            data={contamRate}
            showValues={showValues}
            valueFormatter={(value) => `${round2(value)}%`}
            axisFormatter={(value) => `${Math.round(value)}%`}
            series={[{ key: "rate", name: "Contamination rate", color: "#f87171", formatter: (value) => `${round2(value)}%` }]}
            tooltipLabelFormatter={(label, row) => row ? `${label} · ${fmtInt(row.bad)} contaminated of ${fmtInt(row.total)}` : label}
            emptyMessage="No contamination-rate data matches the current filters."
            nameLabel={groupMode === "recipe" ? "Recipe" : "Strain"}
          />
        );

      case "timeToStage":
        return (
          <HorizontalBarChartPanel
            data={ttsSeries}
            showValues={showValues}
            valueFormatter={(value) => `${fmtInt(value)} days`}
            axisFormatter={fmtInt}
            series={[
              { key: "Inoc_to_Colonized", name: "Inoculated → Colonized", color: "#60a5fa", formatter: (value) => `${fmtInt(value)}d` },
              { key: "Colonized_to_Fruiting", name: "Colonized → Fruiting", color: "#34d399", formatter: (value) => `${fmtInt(value)}d` },
              { key: "Fruiting_to_Harvested", name: "Fruiting → Harvested", color: "#f59e0b", formatter: (value) => `${fmtInt(value)}d` },
            ]}
            emptyMessage="No complete stage-date sequences match the current filters."
            nameLabel={groupMode === "recipe" ? "Recipe" : "Strain"}
          />
        );

      case "burnRate":
        if (!burnTopSupplies.length || !burnRateSeries.length) {
          return <ChartEmptyState message="No recent supply-consumption data is available." />;
        }
        return (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              {burnTopSupplies.map((supply) => (
                <span key={supply.id} className="inline-flex items-center gap-2 rounded-full border border-zinc-300 dark:border-zinc-700 px-2.5 py-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: supply.color }} />
                  {supply.name}
                  <span className="opacity-75">· {supply.daysToZero != null ? `${supply.daysToZero}d to zero` : "no runway estimate"}</span>
                </span>
              ))}
              <span className="italic">{burnNote}</span>
            </div>
            <LineChartPanel
              data={burnRateSeries}
              xKey="week"
              valueFormatter={fmtInt}
              axisFormatter={fmtInt}
              series={burnTopSupplies.map((supply) => ({ key: supply.name, name: supply.name, color: supply.color, formatter: fmtInt }))}
            />
          </>
        );

      case "yieldVsCost":
        if (!yieldVsCost.length) return <ChartEmptyState message="No paired yield and cost data matches the current filters." />;
        return (
          <>
            <KeyLegend items={[{ label: "Each point represents one grow", color: PALETTE.scatter }]} />
            <div className="w-full overflow-x-auto">
              <div style={{ minWidth: 700, height: 390 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 34, bottom: 24, left: 12 }}>
                    <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="x" name="Cost" stroke={PALETTE.axis} tick={{ fill: PALETTE.axis, fontSize: 12 }} tickFormatter={(value) => `$${value}`} />
                    <YAxis type="number" dataKey="y" name="Yield" stroke={PALETTE.axis} tick={{ fill: PALETTE.axis, fontSize: 12 }} tickFormatter={fmtInt} />
                    <ZAxis type="number" dataKey="z" range={[70, 70]} />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      contentStyle={TOOLTIP_STYLE}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload || {};
                        return (
                          <div style={TOOLTIP_STYLE} className="p-3 text-sm">
                            <div className="font-semibold">{row.name || "Grow"}</div>
                            <div>Cost: {fmt$(row.x)}</div>
                            <div>Yield: {fmtG(row.y)}</div>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={yieldVsCost} fill={PALETTE.scatter} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
            <FullDataTable data={yieldVsCost} columns={[{ key: "x", label: "Cost", formatter: fmt$ }, { key: "y", label: "Yield", formatter: fmtG }]} nameLabel="Grow" />
          </>
        );

      case "throughput":
        return (
          <LineChartPanel
            data={throughputSeries}
            xKey="month"
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "Started", name: "Started", color: "#60a5fa", formatter: fmtInt },
              { key: "Harvested", name: "Harvested", color: "#a78bfa", formatter: fmtInt },
            ]}
            emptyMessage="No monthly start or harvest dates match the current filters."
          />
        );

      case "stageTransitions":
        return (
          <LineChartPanel
            data={stageTransitions}
            xKey="month"
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[{ key: "count", name: "Stage changes", color: PALETTE.line, formatter: fmtInt }]}
            emptyMessage="No stage-transition history matches the current filters."
          />
        );

      case "ppInventoryStatus":
        return (
          <VerticalBarChartPanel
            data={postProcessAnalytics.inventoryStatus}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "Active", name: "Active", color: "#34d399", formatter: fmtInt },
              { key: "Depleted", name: "Depleted / archived", color: "#a78bfa", formatter: fmtInt },
            ]}
          />
        );

      case "ppFinancial":
        return (
          <VerticalBarChartPanel
            data={postProcessAnalytics.financialSnapshot}
            showValues={showValues}
            valueFormatter={fmt$}
            axisFormatter={(value) => `$${fmtInt(value)}`}
            series={[
              { key: "Revenue", name: "Revenue", color: "#34d399", formatter: fmt$ },
              { key: "Cost", name: "Cost", color: "#f59e0b", formatter: fmt$ },
              { key: "Profit", name: "Profit", color: "#22d3ee", formatter: fmt$ },
            ]}
          />
        );

      case "ppProductPerformance":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.productPerformance}
            showValues={showValues}
            valueFormatter={fmt$}
            axisFormatter={(value) => `$${fmtInt(value)}`}
            series={[
              { key: "revenue", name: "Realized revenue", color: "#34d399", formatter: fmt$ },
              { key: "profit", name: "Realized profit", color: "#22d3ee", formatter: fmt$ },
              { key: "projectedRevenue", name: "Remaining projected revenue", color: "#a78bfa", formatter: fmt$ },
            ]}
            tooltipLabelFormatter={(label, row) => row ? `${label} · ${fmtInt(row.sold)} sold · ${fmtInt(row.available)} available` : label}
            emptyMessage="No product performance is available for the selected activity range."
            nameLabel="Product"
          />
        );

      case "ppBatchPerformance":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.batchPerformance}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "sold", name: "Sold", color: "#34d399", formatter: fmtInt },
              { key: "samples", name: "Samples / outbound", color: "#60a5fa", formatter: fmtInt },
              { key: "destroyed", name: "Destroyed", color: "#f87171", formatter: fmtInt },
              { key: "available", name: "Available", color: "#a78bfa", formatter: fmtInt },
            ]}
            tooltipLabelFormatter={(label, row) => row ? `${label} · Revenue ${fmt$(row.revenue)} · Profit ${fmt$(row.profit)}` : label}
            emptyMessage="No parent-batch package activity is available."
            nameLabel="Parent finished batch"
          />
        );

      case "ppSkuPerformance":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.skuPerformance}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "sold", name: "Sold", color: "#34d399", formatter: fmtInt },
              { key: "samples", name: "Samples / promo / internal", color: "#60a5fa", formatter: fmtInt },
              { key: "available", name: "Available", color: "#a78bfa", formatter: fmtInt },
            ]}
            tooltipLabelFormatter={(label, row) => row ? `${label} · Revenue ${fmt$(row.revenue)} · Margin ${row.realizedMarginPercent}%` : label}
            emptyMessage="No SKU performance is available for the selected activity range."
            nameLabel="SKU"
          />
        );

      case "ppPackageSizePerformance":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.packageSizePerformance}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "sold", name: "Sold", color: "#34d399", formatter: fmtInt },
              { key: "samples", name: "Samples", color: "#60a5fa", formatter: fmtInt },
              { key: "destroyed", name: "Destroyed", color: "#f87171", formatter: fmtInt },
              { key: "available", name: "Available", color: "#a78bfa", formatter: fmtInt },
            ]}
            tooltipLabelFormatter={(label, row) => row ? `${label} · Revenue ${fmt$(row.revenue)} · Profit ${fmt$(row.profit)}` : label}
            emptyMessage="No package-size performance is available."
            nameLabel="Package size"
          />
        );

      case "ppMargins":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.lockedPricing}
            showValues={showValues}
            valueFormatter={fmt$}
            axisFormatter={(value) => `$${fmtInt(value)}`}
            series={[
              { key: "Cost", name: "Locked package cost", color: "#f59e0b", formatter: fmt$ },
              { key: "DefaultPrice", name: "Locked default price", color: "#34d399", formatter: fmt$ },
              { key: "MSRP", name: "MSRP", color: "#a78bfa", formatter: fmt$ },
            ]}
            emptyMessage="No locked package pricing is available."
            nameLabel="SKU / package"
          />
        );

      case "ppOverrides":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.overrideByProduct}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "priceOverrides", name: "Price overrides", color: "#f59e0b", formatter: fmtInt },
              { key: "fefoOverrides", name: "FEFO overrides", color: "#f87171", formatter: fmtInt },
            ]}
            emptyMessage="No price or FEFO overrides are recorded in the selected activity range."
            nameLabel="Product"
          />
        );

      case "ppExpiring":
        return (
          <VerticalBarChartPanel
            data={postProcessAnalytics.expirationBuckets}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "units", name: "Available units", color: "#f59e0b", formatter: fmtInt },
              { key: "lots", name: "Package lots", color: "#60a5fa", formatter: fmtInt },
            ]}
          />
        );

      case "ppWorkflow":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.workflowCounts}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[{ key: "value", name: "Lots", color: "#60a5fa", formatter: fmtInt }]}
            emptyMessage="No active finished inventory workflow records are available."
            nameLabel="Workflow state"
          />
        );

      case "ppValuation":
        return (
          <VerticalBarChartPanel
            data={postProcessAnalytics.valuationByType}
            showValues={showValues}
            valueFormatter={fmt$}
            axisFormatter={(value) => `$${fmtInt(value)}`}
            series={[
              { key: "costValue", name: "Cost value", color: "#f59e0b", formatter: fmt$ },
              { key: "salesValue", name: "Projected sales value", color: "#34d399", formatter: fmt$ },
            ]}
            emptyMessage="No available packaged inventory has a locked valuation."
          />
        );

      case "ppSales":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.salesByDestination}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            tooltipFormatter={(value, name) => [name === "Revenue" ? fmt$(value) : fmtInt(value), name]}
            series={[
              { key: "revenue", name: "Revenue", color: "#22d3ee", formatter: fmt$ },
              { key: "quantity", name: "Units outbound", color: "#60a5fa", formatter: fmtInt },
            ]}
            emptyMessage="No sales, samples, or donations match the selected activity range."
            nameLabel="Destination"
          />
        );

      case "ppWaste":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.finishedLossByReason}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "destroyed", name: "Destroyed package units", color: "#f87171", formatter: fmtInt },
              { key: "wasted", name: "Wasted package units", color: "#f59e0b", formatter: fmtInt },
            ]}
            tooltipLabelFormatter={(label, row) => row ? `${label} · Estimated cost loss ${fmt$(row.costLoss)}` : label}
            emptyMessage="No finished-inventory destruction or waste is recorded in the selected activity range."
            nameLabel="Loss reason"
          />
        );

      case "ppProcessWaste":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.processWasteByReason}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[{ key: "quantity", name: "Process waste quantity", color: "#f87171", formatter: fmtInt }]}
            emptyMessage="No manufacturing waste quantities are recorded."
            nameLabel="Waste reason"
          />
        );

      case "ppEfficiency":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.efficiencyByBatch}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "expected", name: "Expected", color: "#60a5fa", formatter: fmtInt },
              { key: "actual", name: "Actual", color: "#34d399", formatter: fmtInt },
              { key: "waste", name: "Waste", color: "#f87171", formatter: fmtInt },
            ]}
            tooltipLabelFormatter={(label, row) => row ? `${label} · ${row.variancePct}% variance` : label}
            emptyMessage="No production batches have expected, actual, or waste metrics."
            nameLabel="Production batch"
          />
        );

      case "ppPackaging":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.packagingUsage}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "used", name: "Packaging used", color: "#a78bfa", formatter: fmtInt },
              { key: "onHand", name: "On hand", color: "#f59e0b", formatter: fmtInt },
            ]}
            tooltipLabelFormatter={(label, row) => row?.daysCover != null ? `${label} · Approximately ${row.daysCover} days of cover` : label}
            emptyMessage="No packaging-consumption audits are available."
            nameLabel="Packaging supply"
          />
        );

      case "ppRework":
        return (
          <HorizontalBarChartPanel
            data={postProcessAnalytics.reworkSeries}
            showValues={showValues}
            valueFormatter={fmtInt}
            axisFormatter={fmtInt}
            series={[
              { key: "salvage", name: "Salvage", color: "#34d399", formatter: fmtInt },
              { key: "waste", name: "Waste", color: "#f87171", formatter: fmtInt },
            ]}
            emptyMessage="No rework, repackaging, or salvage batches are recorded."
            nameLabel="Rework batch"
          />
        );

      default:
        return <ChartEmptyState message="This analytics report is not available." />;
    }
  };

  const ppSummary = postProcessAnalytics.summary;
  const expiringAttention = postProcessAnalytics.expiringLots.filter((lot) => lot.days <= 90).slice(0, 8);
  const activeSectionConfig = ANALYTICS_SECTIONS.find((section) => section.id === activeSection) || ANALYTICS_SECTIONS[0];
  const activeReports = ANALYTICS_REPORTS[activeSection] || [];
  const activeSectionFeatureKey = getAnalyticsSectionFeatureKey(activeSection);
  const activeSectionAllowed = hasAnalyticsFeature(activeSectionFeatureKey);
  const usesGrowFilters =
    activeSectionAllowed &&
    (activeSection === "cultivation" || activeSection === "supplies");
  const isPostProcessSection = ["production", "sales", "quality"].includes(activeSection);
  const reportIsAllowed = (reportKey) =>
    hasAnalyticsFeature(getAnalyticsReportFeatureKey(reportKey));

  const clearDateRange = () => {
    setFromDate("");
    setToDate("");
  };

  return (
    <div className="space-y-5 p-4 md:p-6 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
      <div className="rounded-2xl border border-purple-200/80 dark:border-purple-900/70 bg-linear-to-br/srgb from-purple-50 via-white to-sky-50 dark:from-purple-950/30 dark:via-zinc-950 dark:to-sky-950/20 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-700 dark:text-purple-300">Chaotic Neutral Intelligence</div>
            <h2 className="mt-1 text-2xl font-bold text-zinc-950 dark:text-white">Analytics Command Center</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Cultivation, production, inventory, sales, quality, and supply reports are organized into focused workspaces. Long names use readable horizontal charts and every report includes a full-name data table.
            </p>
          </div>
          <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-white/80 dark:bg-zinc-900/80 px-4 py-3 text-sm">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">Current workspace</div>
            <div className="text-purple-700 dark:text-purple-300">{activeSectionConfig.label}</div>
          </div>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Analytics workspaces"
        data-tour="analytics-workspaces"
        className="flex flex-wrap gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/40 p-2"
      >
        {ANALYTICS_SECTIONS.map((section) => {
          const active = section.id === activeSection;
          const reportCount = (ANALYTICS_REPORTS[section.id] || []).length;
          const sectionFeatureKey = getAnalyticsSectionFeatureKey(section.id);
          const sectionAllowed = hasAnalyticsFeature(sectionFeatureKey);
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveSection(section.id)}
              className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${active ? "bg-purple-600 text-white shadow-xs" : "text-zinc-700 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800"}`}
            >
              {section.label}
              {reportCount > 0 ? <span className={`ml-2 text-xs ${active ? "text-purple-100" : "text-zinc-400"}`}>{reportCount}</span> : null}
              {!sectionAllowed ? (
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${active ? "bg-white/20 text-white" : "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"}`}>
                  Locked
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 p-4 space-y-4" data-tour="analytics-filters">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Filters and exports</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Date filters apply to grow reference dates and Post Processing outbound activity. Current inventory remains a live snapshot.
            </div>
          </div>
          <div className="flex flex-wrap gap-2" data-tour="analytics-export">
            <button
              type="button"
              onClick={exportCSV}
              aria-disabled={!analyticsExportScope.canExport}
              className={`btn ${analyticsExportScope.canExport ? "btn-accent" : "border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300"}`}
            >
              Export CSV{analyticsExportScope.canExport ? "" : ` · ${analyticsExportGate.minimumPlanLabel}`}
            </button>
            <button
              type="button"
              onClick={exportJSON}
              aria-disabled={!analyticsExportScope.canExport}
              className={`btn ${analyticsExportScope.canExport ? "" : "border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300"}`}
              title="Export analytic reports allowed by the current entitlement"
            >
              Export JSON{analyticsExportScope.canExport ? "" : ` · ${analyticsExportGate.minimumPlanLabel}`}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">From</span>
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">To</span>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2" />
          </label>
          {(fromDate || toDate) ? (
            <button type="button" onClick={clearDateRange} className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-white dark:hover:bg-zinc-800">
              Clear dates
            </button>
          ) : null}

          {usesGrowFilters ? (
            <>
              {canUseAdvancedAnalytics ? (
                <label className="space-y-1 text-sm min-w-48">
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">Strain</span>
                  <select value={strainFilter} onChange={(event) => setStrainFilter(event.target.value)} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                    {allStrainOptions.map((strain) => <option key={strain} value={strain}>{strain}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="space-y-1 text-sm">
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">Grow dataset</span>
                <select value={showAll ? "all" : "active"} onChange={(event) => setShowAll(event.target.value === "all")} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                  <option value="active">Active only</option>
                  <option value="all">All history</option>
                </select>
              </label>
            </>
          ) : null}

          {activeSection === "cultivation" && canUseAdvancedAnalytics ? (
            <>
              <label className="space-y-1 text-sm">
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">Rate and timing groups</span>
                <select value={groupMode} onChange={(event) => setGroupMode(event.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                  <option value="strain">By strain</option>
                  <option value="recipe">By recipe</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">Grow-cost order</span>
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
                  <option value="recent">Newest first</option>
                  <option value="alpha">Name A → Z</option>
                </select>
              </label>
            </>
          ) : null}

          <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm select-none">
            <input type="checkbox" style={{ accentColor: "var(--_accent-600)" }} checked={showValues} onChange={(event) => setShowValues(event.target.checked)} />
            Show chart values
          </label>
        </div>

        {usesGrowFilters && !canUseAdvancedAnalytics ? (
          <AnalyticsLockedPanel
            compact
            featureKey={SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS}
            actionLabel="Use advanced analytics filters"
            supportingText={getAnalyticsFeatureSupportingText(
              SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS
            )}
            onRequest={onSubscriptionFeatureBlocked}
          />
        ) : null}

        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {isPostProcessSection && activeSectionAllowed ? (
            <>Post Processing activity: {postProcessAnalytics.activityMoveCount} matching outbound transaction{postProcessAnalytics.activityMoveCount === 1 ? "" : "s"}{(fromDate || toDate) ? ` · ${fromDate || "…"} → ${toDate || "…"}` : " · all history"}</>
          ) : !activeSectionAllowed ? (
            <>This workspace is locked. Basic cultivation summaries remain available in Overview and Cultivation.</>
          ) : usesGrowFilters ? (
            <>Grow dataset: {filteredAll.length} matching grow{filteredAll.length === 1 ? "" : "s"} · {activeFiltered.length} active{strainFilter !== "All strains" ? ` · ${strainFilter}` : ""}{(fromDate || toDate) ? ` · ${fromDate || "…"} → ${toDate || "…"}` : ""}</>
          ) : (
            <>Live inventory snapshot with {postProcessAnalytics.activityMoveCount} matching outbound transaction{postProcessAnalytics.activityMoveCount === 1 ? "" : "s"}.</>
          )}
        </div>
      </section>

      {activeSection === "overview" ? (
        <div className="space-y-5">
          {canUseBasicAnalytics ? (
            <>
              <div>
                <div className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Cultivation snapshot</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard label="Active grows" value={overview.totalActive} />
                  <StatCard label="Unique strains" value={overview.uniqueStrains} />
                  <StatCard label="Average age" value={`${overview.avgAgeDays} days`} />
                  <StatCard label="Recorded dry yield" value={fmtG(recordedYieldSummary.dry)} />
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Task snapshot</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard label="Total tasks" value={taskSummary.total} />
                  <StatCard label="Open tasks" value={taskSummary.open} />
                  <StatCard label="Completed tasks" value={taskSummary.completed} />
                  <StatCard label="Overdue tasks" value={taskSummary.overdue} />
                </div>
              </div>
            </>
          ) : (
            <AnalyticsLockedPanel
              featureKey={SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS}
              actionLabel="View basic analytics"
              supportingText={getAnalyticsFeatureSupportingText(
                SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS
              )}
              onRequest={onSubscriptionFeatureBlocked}
            />
          )}

          {canUseLabAnalytics ? (
            <>
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Post Processing snapshot</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">Inventory is current. Revenue and outbound totals follow the date range.</div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
                  <StatCard label="Active parent batches" value={ppSummary.activeParentBatches} />
                  <StatCard label="Active package lots" value={ppSummary.activePackageLots} />
                  <StatCard label="Available package units" value={fmtInt(ppSummary.availablePackagedUnits)} />
                  <StatCard label="Depleted package lots" value={ppSummary.depletedPackageLots} />
                  <StatCard label="Units sold" value={fmtInt(ppSummary.unitsSold)} />
                  <StatCard label="Samples distributed" value={fmtInt(ppSummary.samplesDistributed)} />
                  <StatCard label="Destroyed units" value={fmtInt(ppSummary.destroyedUnits)} />
                  <StatCard label="Realized revenue" value={fmt$(ppSummary.realizedRevenue)} />
                  <StatCard label="Realized profit" value={fmt$(ppSummary.realizedProfit)} hint={`${ppSummary.realizedMarginPercent}% realized margin`} />
                  <StatCard label="Remaining projected revenue" value={fmt$(ppSummary.remainingProjectedRevenue)} />
                  <StatCard label="Remaining projected profit" value={fmt$(ppSummary.remainingProjectedProfit)} />
                  <StatCard label="Price / FEFO overrides" value={`${ppSummary.priceOverrides} / ${ppSummary.fefoOverrides}`} />
                </div>
              </div>

              {(expiringAttention.length > 0 || ppSummary.packagingShortages > 0 || ppSummary.belowCostSales > 0) ? (
                <section className="rounded-2xl border border-amber-300/70 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/20 p-4 space-y-3">
                  <div>
                    <div className="font-semibold text-amber-900 dark:text-amber-100">Attention queue</div>
                    <div className="text-sm text-amber-800/80 dark:text-amber-200/80">
                      {expiringAttention.length} expiring or expired package lot{expiringAttention.length === 1 ? "" : "s"} · {ppSummary.packagingShortages} packaging shortage{ppSummary.packagingShortages === 1 ? "" : "s"} · {ppSummary.belowCostSales} below-cost sale{ppSummary.belowCostSales === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm">
                    {expiringAttention.map((lot) => (
                      <div key={lot.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
                        <div className="font-medium break-words">{lot.product}</div>
                        <div className="mt-1 text-zinc-500 dark:text-zinc-400 break-words">
                          {lot.name} · {lot.packageSize} · {fmtInt(lot.units)} units · Best by {lot.bestBy} · {lot.days < 0 ? `${Math.abs(lot.days)} days past` : `${lot.days} days`}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <div className="rounded-2xl border border-emerald-300/70 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/20 p-4 text-sm text-emerald-800 dark:text-emerald-200">
                  No expiring inventory, packaging shortages, or below-cost sales currently require attention.
                </div>
              )}
            </>
          ) : (
            <AnalyticsLockedPanel
              featureKey={SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS}
              actionLabel="View Post Processing analytics"
              supportingText={getAnalyticsFeatureSupportingText(
                SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS
              )}
              onRequest={onSubscriptionFeatureBlocked}
            />
          )}

          <div>
            <div className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Analytics workspaces</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {ANALYTICS_SECTIONS.filter((section) => section.id !== "overview").map((section) => {
                const sectionFeatureKey = getAnalyticsSectionFeatureKey(section.id);
                const sectionAllowed = hasAnalyticsFeature(sectionFeatureKey);
                return (
                  <button key={section.id} type="button" onClick={() => setActiveSection(section.id)} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-left hover:border-purple-400 dark:hover:border-purple-700 hover:shadow-xs transition">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">{section.label}</div>
                      <div className={`rounded-full px-2 py-0.5 text-xs ${sectionAllowed ? "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300" : "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"}`}>
                        {sectionAllowed ? `${(ANALYTICS_REPORTS[section.id] || []).length} reports` : "Locked"}
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{section.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/30 p-4">
            <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{activeSectionConfig.label}</div>
            <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{activeSectionConfig.description}</div>
          </div>

          {!activeSectionAllowed ? (
            <AnalyticsLockedPanel
              featureKey={activeSectionFeatureKey}
              actionLabel={`Open ${activeSectionConfig.label} analytics`}
              supportingText={getAnalyticsFeatureSupportingText(activeSectionFeatureKey)}
              onRequest={onSubscriptionFeatureBlocked}
            />
          ) : (
            <>
          {activeSection === "cultivation" ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Matching grows" value={filteredAll.length} />
              <StatCard label="Active grows" value={activeFiltered.length} />
              <StatCard label="Unique strains" value={overview.uniqueStrains} />
              <StatCard label="Recorded dry yield" value={fmtG(recordedYieldSummary.dry)} />
            </div>
          ) : null}

          {activeSection === "production" ? (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
              <StatCard label="Active parent batches" value={ppSummary.activeParentBatches} />
              <StatCard label="Active package lots" value={ppSummary.activePackageLots} />
              <StatCard label="Available package units" value={fmtInt(ppSummary.availablePackagedUnits)} />
              <StatCard label="Depleted package lots" value={ppSummary.depletedPackageLots} />
              <StatCard label="Projected inventory value" value={fmt$(ppSummary.remainingProjectedRevenue)} />
              <StatCard label="Rework batches" value={ppSummary.reworkBatches} />
            </div>
          ) : null}

          {activeSection === "sales" ? (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
              <StatCard label="Units sold" value={fmtInt(ppSummary.unitsSold)} />
              <StatCard label="Samples distributed" value={fmtInt(ppSummary.samplesDistributed)} />
              <StatCard label="Realized revenue" value={fmt$(ppSummary.realizedRevenue)} />
              <StatCard label="Realized profit" value={fmt$(ppSummary.realizedProfit)} hint={`${ppSummary.realizedMarginPercent}% margin`} />
              <StatCard label="Remaining projected revenue" value={fmt$(ppSummary.remainingProjectedRevenue)} />
              <StatCard label="Remaining projected profit" value={fmt$(ppSummary.remainingProjectedProfit)} />
            </div>
          ) : null}

          {activeSection === "quality" ? (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
              <StatCard label="Expiring ≤30 days" value={`${ppSummary.expiring30Lots} lots`} hint={`${fmtInt(ppSummary.expiring30Units)} units`} />
              <StatCard label="Destroyed units" value={fmtInt(ppSummary.destroyedUnits)} />
              <StatCard label="Wasted units" value={fmtInt(ppSummary.wastedUnits)} />
              <StatCard label="Price overrides" value={ppSummary.priceOverrides} />
              <StatCard label="FEFO overrides" value={ppSummary.fefoOverrides} />
              <StatCard label="Below-cost sales" value={ppSummary.belowCostSales} />
            </div>
          ) : null}

          {activeSection === "supplies" ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Recipes" value={Array.isArray(recipes) ? recipes.length : 0} />
              <StatCard label="Supplies" value={Array.isArray(supplies) ? supplies.length : 0} />
              <StatCard label="Supply audits" value={Array.isArray(audits) ? audits.length : 0} />
              {canUseLabAnalytics ? (
                <StatCard label="Packaging shortages" value={ppSummary.packagingShortages} />
              ) : (
                <div className="rounded-2xl border border-violet-200 bg-violet-50/80 p-4 text-violet-950 shadow-xs dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-100">
                  <div className="text-sm text-violet-700 dark:text-violet-300">Packaging analytics</div>
                  <div className="mt-1 text-lg font-semibold">{labAnalyticsGate.minimumPlanLabel}</div>
                </div>
              )}
            </div>
          ) : null}

          <div className="space-y-4">
            {activeReports.map((report, index) => {
              const reportFeatureKey = getAnalyticsReportFeatureKey(report.key);
              const allowed = reportIsAllowed(report.key);
              return (
                <AnalyticsReportCard
                  key={report.key}
                  title={report.title}
                  description={report.description}
                  defaultOpen={index === 0}
                  testId={`analytics-report-${report.key}`}
                >
                  {allowed ? (
                    renderChart(report.key)
                  ) : (
                    <AnalyticsLockedPanel
                      featureKey={reportFeatureKey}
                      actionLabel={`Open ${report.title}`}
                      supportingText={getAnalyticsFeatureSupportingText(reportFeatureKey)}
                      onRequest={onSubscriptionFeatureBlocked}
                    />
                  )}
                </AnalyticsReportCard>
              );
            })}
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );

}

function StatCard({ label, value, hint = "" }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-xs min-w-0">
      <div className="text-sm text-zinc-500 dark:text-zinc-400 break-words">{label}</div>
      <div className="text-2xl font-semibold mt-1 text-zinc-950 dark:text-white break-words">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 break-words">{hint}</div> : null}
    </div>
  );
}
