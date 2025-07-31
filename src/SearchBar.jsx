import React from "react";

export default function SearchBar({ searchTerm, setSearchTerm }) {
  return (
    <div className="mb-4">
      <input
        type="text"
        placeholder="Search grows by name, strain, notes..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-700"
      />
    </div>
  );
}
