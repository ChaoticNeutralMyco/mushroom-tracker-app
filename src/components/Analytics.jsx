import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";

export default function Analytics({ grows }) {
  const data = grows.map((grow) => ({
    name: grow.name || "Unnamed",
    cost: parseFloat(grow.cost) || 0,
    yield: parseFloat(grow.yield) || 0,
  }));

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 mb-8">
      <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
        Cost vs. Yield Analytics
      </h2>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ccc" />
          <XAxis dataKey="name" stroke="#8884d8" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Bar dataKey="cost" fill="#f87171" name="Cost ($)" />
          <Bar dataKey="yield" fill="#34d399" name="Yield (g)" />
        </BarChart>
      </ResponsiveContainer>

      <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
        Data is based on values entered for each grow.
      </p>
    </div>
  );
}
