<<<<<<< HEAD
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
=======
// src/components/Analytics.jsx
import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase-config";
import {
  collection,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { FileDown } from "lucide-react";

const COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff7f50", "#8dd1e1"];
const STAGES = ["Inoculated", "Colonizing", "Fruiting", "Harvested"];

export default function Analytics() {
  const [grows, setGrows] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [supplies, setSupplies] = useState([]);
  const [unit, setUnit] = useState("g");
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const user = auth.currentUser;
      if (!user) return;

      const growsSnap = await getDocs(collection(db, `users/${user.uid}/grows`));
      setGrows(growsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

      const recipesSnap = await getDocs(collection(db, `users/${user.uid}/recipes`));
      setRecipes(recipesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

      const suppliesSnap = await getDocs(collection(db, `users/${user.uid}/supplies`));
      setSupplies(suppliesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

      const settingsSnap = await getDoc(doc(db, "users", user.uid, "settings", "preferences"));
      if (settingsSnap.exists()) {
        const prefs = settingsSnap.data();
        if (prefs.unit) setUnit(prefs.unit);
      }

      setLoading(false);
    };

    fetchData();
  }, []);

  const convertYield = (grams) => {
    const value = parseFloat(grams) || 0;
    return unit === "oz" ? value / 28.35 : value;
  };

  const yieldLabel = unit === "oz" ? "oz" : "g";

  const filteredGrows = grows.filter((grow) => {
    const inStage = stageFilter === "all" || grow.stage === stageFilter;
    const date = grow.inoculation;
    const inDateRange = (!startDate || date >= startDate) && (!endDate || date <= endDate);
    return inStage && inDateRange;
  });

  const getRecipeCost = (recipeId) => {
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return 0;
    return recipe.items.reduce((sum, item) => {
      const supply = supplies.find((s) => s.id === item.supplyId);
      return sum + (supply?.cost || 0) * (item.amount || 0);
    }, 0);
  };

  const totalCost = filteredGrows.reduce((sum, grow) => {
    return sum + (grow.recipeId ? getRecipeCost(grow.recipeId) : 0);
  }, 0);

  const totalYield = filteredGrows.reduce(
    (sum, grow) => sum + convertYield(grow.yield),
    0
  );

  const averageCost =
    filteredGrows.length > 0 ? totalCost / filteredGrows.length : 0;

  const barData = filteredGrows.map((grow) => ({
    name: grow.strain || "Unnamed",
    cost: grow.recipeId ? getRecipeCost(grow.recipeId) : 0,
    yield: convertYield(grow.yield),
  }));

  const getStageTimelineData = () => {
    const map = {};
    filteredGrows.forEach((grow) => {
      const stages = grow.stageDates || {};
      STAGES.forEach((stage) => {
        const date = stages[stage];
        if (!date) return;
        const month = date.slice(0, 7);
        if (!map[month]) {
          map[month] = { month };
          STAGES.forEach((s) => (map[month][s] = 0));
        }
        map[month][stage] += 1;
      });
    });
    return Object.keys(map)
      .sort()
      .map((month) => map[month]);
  };

  const getMostUsedSuppliesData = () => {
    const usage = {};
    filteredGrows.forEach((grow) => {
      const recipe = recipes.find((r) => r.id === grow.recipeId);
      if (!recipe) return;
      recipe.items.forEach((item) => {
        usage[item.supplyId] = (usage[item.supplyId] || 0) + (item.amount || 0);
      });
    });
    return Object.entries(usage).map(([id, value]) => {
      const supply = supplies.find((s) => s.id === id);
      return { name: supply?.name || "Unknown", value };
    });
  };

  const exportToCSV = () => {
    const rows = [
      ["Strain", "Inoculation", "Cost", `Yield (${yieldLabel})`, "Stage", "Stage Dates"],
      ...filteredGrows.map((g) => [
        g.strain,
        g.inoculation,
        getRecipeCost(g.recipeId),
        convertYield(g.yield),
        g.stage,
        Object.entries(g.stageDates || {})
          .map(([k, v]) => `${k}: ${v}`)
          .join("; "),
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "grow_analytics.csv";
    a.click();
  };

  if (loading) return <p className="text-center p-4">Loading analytics...</p>;

  return (
    <div className="p-4 md:p-6 space-y-6 text-zinc-900 dark:text-white">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">📊 Analytics</h2>
        <button
          onClick={exportToCSV}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white font-medium px-4 py-2 rounded"
        >
          <FileDown className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="text-sm font-medium">Filter by Stage</label>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="w-full mt-1 p-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
          >
            <option value="all">All</option>
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>{stage}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full mt-1 p-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full mt-1 p-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-xl shadow p-4 space-y-2">
        <h3 className="text-xl font-bold">📋 Summary</h3>
        <p>Total Grows: <strong>{filteredGrows.length}</strong></p>
        <p>Total Cost: <strong>${totalCost.toFixed(2)}</strong></p>
        <p>Total Yield: <strong>{totalYield.toFixed(2)} {yieldLabel}</strong></p>
        <p>Average Cost per Grow: <strong>${averageCost.toFixed(2)}</strong></p>
      </div>

      {/* Cost vs Yield */}
      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-xl shadow p-4">
        <h3 className="text-xl font-bold mb-4">💰 Cost vs Yield</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="cost" fill="#8884d8" name="Cost" />
            <Bar dataKey="yield" fill="#82ca9d" name={`Yield (${yieldLabel})`} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Most Used Supplies */}
      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-xl shadow p-4">
        <h3 className="text-xl font-bold mb-4">🧪 Most Used Supplies</h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={getMostUsedSuppliesData()}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label
            >
              {getMostUsedSuppliesData().map((entry, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Stage Timeline */}
      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-xl shadow p-4">
        <h3 className="text-xl font-bold mb-4">📈 Stage History Timeline</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={getStageTimelineData()}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            {STAGES.map((stage, index) => (
              <Bar
                key={stage}
                dataKey={stage}
                stackId="a"
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
>>>>>>> be7d1a18 (Initial commit with final polished version)
    </div>
  );
}
