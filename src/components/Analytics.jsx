// src/components/Analytics.jsx
import React, { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";

const COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#facc15", "#a78bfa", "#fb923c"];

const Analytics = ({ grows = [], supplies = [] }) => {
  const stageCounts = useMemo(() => {
    const counts = {};
    grows.forEach((grow) => {
      const stage = grow.stage || "Unknown";
      counts[stage] = (counts[stage] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [grows]);

  const yieldData = useMemo(() => {
    return grows
      .filter((g) => g.yieldWet || g.yieldDry)
      .map((g) => ({
        name: g.strain,
        wet: g.yieldWet || 0,
        dry: g.yieldDry || 0,
      }));
  }, [grows]);

  const avgYieldPerStrain = useMemo(() => {
    const totals = {};
    const counts = {};
    grows.forEach((g) => {
      const strain = g.strain || "Unknown";
      if (!totals[strain]) {
        totals[strain] = { wet: 0, dry: 0 };
        counts[strain] = 0;
      }
      totals[strain].wet += g.yieldWet || 0;
      totals[strain].dry += g.yieldDry || 0;
      counts[strain] += 1;
    });
    return Object.keys(totals).map((strain) => ({
      name: strain,
      wet: (totals[strain].wet / counts[strain]).toFixed(2),
      dry: (totals[strain].dry / counts[strain]).toFixed(2),
    }));
  }, [grows]);

  const recipeUsage = useMemo(() => {
    const usage = {};
    grows.forEach((grow) => {
      if (grow.recipeItems) {
        grow.recipeItems.forEach((item) => {
          const name = item.name || "Unknown";
          usage[name] = (usage[name] || 0) + item.amount;
        });
      }
    });
    return Object.entries(usage).map(([name, value]) => ({ name, value }));
  }, [grows]);

  const growCosts = useMemo(() => {
    return grows.map((grow) => {
      let total = 0;
      if (grow.recipeItems) {
        grow.recipeItems.forEach((item) => {
          const cost = (item.cost || 0) * (item.amount || 0);
          total += cost;
        });
      }
      return { name: grow.strain, cost: parseFloat(total.toFixed(2)) };
    });
  }, [grows]);

  const stageTransitions = useMemo(() => {
    const data = {};
    grows.forEach((grow) => {
      if (grow.stageDates) {
        Object.entries(grow.stageDates).forEach(([stage, date]) => {
          const d = date?.substring(0, 10);
          if (!d) return;
          if (!data[d]) data[d] = {};
          data[d][stage] = (data[d][stage] || 0) + 1;
        });
      }
    });
    return Object.entries(data)
      .map(([date, stages]) => ({
        date,
        ...stages,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [grows]);

  const exportCSV = () => {
    const headers = ["Strain", "Stage", "WetYield", "DryYield"];
    const rows = grows.map((g) => [
      g.strain || "",
      g.stage || "",
      g.yieldWet || "",
      g.yieldDry || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "grow_analytics.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-4 space-y-8 bg-white dark:bg-gray-900 text-gray-900 dark:text-white rounded-xl shadow">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Analytics</h2>
        <button
          onClick={exportCSV}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Export CSV
        </button>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Grow Stage Distribution</h3>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={stageCounts}
              dataKey="value"
              nameKey="name"
              outerRadius={100}
              fill="#8884d8"
              label
            >
              {stageCounts.map((entry, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Wet vs Dry Yield</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={yieldData}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="wet" stackId="a" fill="#60a5fa" />
            <Bar dataKey="dry" stackId="a" fill="#4ade80" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Average Yield per Strain</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={avgYieldPerStrain}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="wet" fill="#60a5fa" />
            <Bar dataKey="dry" fill="#4ade80" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Cost per Grow</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={growCosts}>
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="cost" fill="#f472b6" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Most Used Supplies</h3>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={recipeUsage}
              dataKey="value"
              nameKey="name"
              outerRadius={100}
              fill="#facc15"
              label
            >
              {recipeUsage.map((entry, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Stage Transitions Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={stageTransitions}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            {["inoculated", "colonizing", "colonized", "fruiting", "harvested"].map(
              (stage, idx) => (
                <Line
                  key={stage}
                  type="monotone"
                  dataKey={stage}
                  stroke={COLORS[idx % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              )
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Analytics;
