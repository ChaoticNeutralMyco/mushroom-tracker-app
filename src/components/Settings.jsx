// src/components/Settings.jsx
import React from "react";

export default function Settings({ darkMode, setDarkMode }) {
  return (
    <button
      onClick={() => setDarkMode(!darkMode)}
      className="bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded text-sm"
    >
      {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
    </button>
  );
}
