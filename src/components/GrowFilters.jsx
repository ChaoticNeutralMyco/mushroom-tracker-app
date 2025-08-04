// src/components/GrowFilters.jsx
import React from "react";

const GrowFilters = ({ filter, setFilter, stageFilter, setStageFilter, dateRange, setDateRange }) => {
  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow space-y-4">
      <h3 className="text-lg font-semibold dark:text-white">Filter Grows</h3>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search by strain"
        className="w-full p-2 border rounded dark:bg-gray-700 dark:text-white"
      />

      <select
        value={stageFilter}
        onChange={(e) => setStageFilter(e.target.value)}
        className="w-full p-2 border rounded dark:bg-gray-700 dark:text-white"
      >
        <option value="">All Stages</option>
        <option value="Inoculation">Inoculation</option>
        <option value="Colonization">Colonization</option>
        <option value="Fruiting">Fruiting</option>
        <option value="Harvest">Harvest</option>
        <option value="Completed">Completed</option>
      </select>

      <div className="flex gap-2">
        <input
          type="date"
          value={dateRange?.start || ""}
          onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
          className="w-full p-2 border rounded dark:bg-gray-700 dark:text-white"
        />
        <input
          type="date"
          value={dateRange?.end || ""}
          onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
          className="w-full p-2 border rounded dark:bg-gray-700 dark:text-white"
        />
      </div>
    </div>
  );
};

export default GrowFilters;
