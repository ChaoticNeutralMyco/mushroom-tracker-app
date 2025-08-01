import React from "react";

export default function GrowFilters({ filter, onFilterChange }) {
  return (
    <div className="mb-4">
      <input
        type="text"
        placeholder="Filter by strain"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        className="p-2 border rounded w-full"
      />
    </div>
  );
}
