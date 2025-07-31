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
      </div>
    </div>
  );
}
