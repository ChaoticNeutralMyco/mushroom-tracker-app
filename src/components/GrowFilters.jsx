<<<<<<< HEAD
import React from "react";

export default function GrowFilters({ filterStage, setFilterStage, search, setSearch }) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 items-center justify-between mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <label htmlFor="stage" className="text-sm font-medium text-gray-700 dark:text-gray-200">
          Filter by Stage:
        </label>
        <select
          id="stage"
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="w-full sm:w-48 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All</option>
          <option value="Inoculation">Inoculation</option>
          <option value="Colonization">Colonization</option>
          <option value="Fruiting">Fruiting</option>
          <option value="Harvested">Harvested</option>
        </select>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center w-full sm:w-auto">
        <label htmlFor="search" className="text-sm font-medium text-gray-700 dark:text-gray-200">
          Search:
        </label>
        <input
          id="search"
          type="text"
          placeholder="Search by name or notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
=======
// src/components/GrowFilters.jsx
import React, { useEffect, useState } from "react";
import { auth, db } from "../firebase-config";
import { collection, getDocs } from "firebase/firestore";

const STAGES = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvested"];

export default function GrowFilters({
  filter,
  setFilter,
  stageFilter,
  setStageFilter,
  dateRange = { start: "", end: "" },
  setDateRange,
  sortBy,
  setSortBy,
}) {
  const [strains, setStrains] = useState([]);

  useEffect(() => {
    const fetchStrains = async () => {
      const user = auth.currentUser;
      if (!user) return;
      const snap = await getDocs(collection(db, "users", user.uid, "strains"));
      setStrains(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    };
    fetchStrains();
  }, []);

  return (
    <div className="mb-6 space-y-4 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white p-4 rounded-2xl shadow">
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-300 mb-1">
          🔍 Search by Strain
        </label>
        <input
          type="text"
          className="w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
          placeholder="e.g. Golden Teacher"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-300 mb-1">
          🍄 Select Strain from Library
        </label>
        <select
          className="w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All Strains</option>
          {strains.map((strain) => (
            <option key={strain.id} value={strain.name}>
              {strain.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-300 mb-1">
          🧪 Filter by Stage
        </label>
        <select
          className="w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="">All Stages</option>
          {STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {stage}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-300 mb-1">
          📅 Inoculation Date Range
        </label>
        <div className="flex space-x-2">
          <input
            type="date"
            value={dateRange?.start?.substring(0, 10) || ""}
            onChange={(e) =>
              setDateRange((prev) => ({ ...prev, start: e.target.value }))
            }
            className="w-1/2 px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
          />
          <input
            type="date"
            value={dateRange?.end?.substring(0, 10) || ""}
            onChange={(e) =>
              setDateRange((prev) => ({ ...prev, end: e.target.value }))
            }
            className="w-1/2 px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-300 mb-1">
          🔃 Sort By
        </label>
        <select
          className="w-full px-3 py-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="stage">Stage</option>
          <option value="cost">Cost (High to Low)</option>
        </select>
>>>>>>> be7d1a18 (Initial commit with final polished version)
      </div>
    </div>
  );
}
