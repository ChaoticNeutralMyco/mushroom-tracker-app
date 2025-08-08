// src/pages/Analytics.jsx
import React, { useMemo, useState } from "react";
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";

/**
 * Analytics – prop-driven, no Firestore.
 * Props: grows, recipes, supplies
 */
const COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#facc15", "#a78bfa", "#fb923c"];

export default function Analytics({ grows = [], recipes = [], supplies = [] }) {
  const [chartKey, setChartKey] = useState("stageCounts");

  const {
    stageCounts,
    yieldData,
    avgYieldPerStrain,
    growCosts,
    recipeUsage,
    stageTransitions,
  } = useMemo(() => {
    const g = Array.isArray(grows) ? grows : [];

    const stageCounts = Object.entries(
      g.reduce((acc, x) => {
        const s = x.stage || "Unknown";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {})
    ).map(([name, value]) => ({ name, value }));

    const yieldData = g
      .filter((x) => x.stage === "Harvested" && (x.wetYield || x.dryYield))
      .map((x) => ({
        name: x.strain || x.abbreviation || x.id.slice(0, 6),
        Wet: Number(x.wetYield || 0),
        Dry: Number(x.dryYield || 0),
      }));

    const strainStats = {};
    g.forEach((x) => {
      if (!x.strain) return;
      const s = x.strain.trim();
      if (!strainStats[s]) strainStats[s] = { wet: 0, dry: 0, count: 0 };
      strainStats[s].wet += Number(x.wetYield || 0);
      strainStats[s].dry += Number(x.dryYield || 0);
      strainStats[s].count += 1;
    });
    const avgYieldPerStrain = Object.entries(strainStats).map(([name, v]) => ({
      name,
      Wet: v.count ? v.wet / v.count : 0,
      Dry: v.count ? v.dry / v.count : 0,
    }));

    const growCosts = g.map((x) => ({
      name: x.abbreviation || x.strain || x.id.slice(0, 6),
      Cost: Number(x.cost || 0),
    }));

    // Most-used supplies from recipeItems on grows, if present.
    const supplyCount = {};
    g.forEach((x) => {
      (x.recipeItems || []).forEach((it) => {
        const n = it?.name || it?.supplyName || "Unknown";
        supplyCount[n] = (supplyCount[n] || 0) + 1;
      });
    });
    const recipeUsage = Object.entries(supplyCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Stage transitions over time (count per month)
    const perMonth = {};
    g.forEach((x) => {
      const sd = x.stageDates || {};
      Object.entries(sd).forEach(([stage, date]) => {
        if (!date) return;
        const key = (date || "").slice(0, 7); // YYYY-MM
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
  }, [grows, recipes, supplies]);

  const exportCSV = () => {
    const lines = [
      "Type,Name,ValueA,ValueB",
      ...stageCounts.map((d) => ["StageCount", d.name, d.value, ""].join(",")),
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

  const renderChart = () => {
    switch (chartKey) {
      case "stageCounts":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={stageCounts} dataKey="value" nameKey="name" label />
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        );
      case "yieldData":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={yieldData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="Wet" />
              <Bar dataKey="Dry" />
            </BarChart>
          </ResponsiveContainer>
        );
      case "avgYieldPerStrain":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={avgYieldPerStrain}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="Wet" />
              <Bar dataKey="Dry" />
            </BarChart>
          </ResponsiveContainer>
        );
      case "growCosts":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={growCosts}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line dataKey="Cost" />
            </LineChart>
          </ResponsiveContainer>
        );
      case "recipeUsage":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={recipeUsage}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="count" />
            </BarChart>
          </ResponsiveContainer>
        );
      case "stageTransitions":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={stageTransitions}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line dataKey="count" />
            </LineChart>
          </ResponsiveContainer>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 p-4 bg-white dark:bg-zinc-900 rounded-2xl shadow">
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

        <button
          onClick={exportCSV}
          className="ml-auto px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
        >
          Export CSV
        </button>
      </div>

      {renderChart()}
    </div>
  );
}
