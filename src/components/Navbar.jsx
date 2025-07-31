// src/components/Navbar.jsx
import React from "react";

export default function Navbar({ currentTab, setCurrentTab }) {
  const tabs = ["Grows", "Tasks", "Analytics", "Settings"];

  return (
    <div className="flex gap-4 my-4">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => setCurrentTab(tab)}
          className={`px-4 py-2 rounded-full font-semibold transition ${
            currentTab === tab
              ? "bg-purple-700 text-white"
              : "bg-gray-200 dark:bg-gray-700"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
