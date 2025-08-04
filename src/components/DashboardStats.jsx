// src/components/DashboardStats.jsx
import React, { useEffect, useState } from "react";

export default function DashboardStats({ grows }) {
  const [stats, setStats] = useState({
    total: 0,
    byStage: {},
    avgWet: 0,
    avgDry: 0,
    totalCost: 0,
  });

  useEffect(() => {
    const total = grows.length;
    const byStage = {};
    let wetSum = 0;
    let drySum = 0;
    let wetCount = 0;
    let dryCount = 0;
    let costSum = 0;

    grows.forEach((g) => {
      if (g.stage) {
        byStage[g.stage] = (byStage[g.stage] || 0) + 1;
      }
      if (g.wetYield) {
        wetSum += parseFloat(g.wetYield);
        wetCount++;
      }
      if (g.dryYield) {
        drySum += parseFloat(g.dryYield);
        dryCount++;
      }
      if (g.cost) {
        costSum += parseFloat(g.cost);
      }
    });

    setStats({
      total,
      byStage,
      avgWet: wetCount ? (wetSum / wetCount).toFixed(2) : 0,
      avgDry: dryCount ? (drySum / dryCount).toFixed(2) : 0,
      totalCost: costSum.toFixed(2),
    });
  }, [grows]);

  return (
    <div className="p-4 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow space-y-4 mb-6">
      <h2 className="text-xl font-bold">📊 Dashboard Stats</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-xl shadow-sm space-y-1">
          <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Total Grows</h3>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>

        <div className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-xl shadow-sm space-y-1">
          <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Avg Wet Yield</h3>
          <p className="text-2xl font-bold">{stats.avgWet}</p>
        </div>

        <div className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-xl shadow-sm space-y-1">
          <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Avg Dry Yield</h3>
          <p className="text-2xl font-bold">{stats.avgDry}</p>
        </div>

        <div className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-xl shadow-sm space-y-1">
          <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Total Cost</h3>
          <p className="text-2xl font-bold">${stats.totalCost}</p>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-2">By Stage</h4>
        <ul className="text-sm space-y-1">
          {Object.entries(stats.byStage).map(([stage, count]) => (
            <li key={stage} className="flex justify-between">
              <span>{stage}</span>
              <span className="font-medium">{count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
