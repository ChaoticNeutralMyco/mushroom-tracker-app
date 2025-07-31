import React, { useState, useEffect } from "react";
import GrowForm from "./components/GrowForm";
import GrowList from "./components/GrowList";
import GrowFilters from "./components/GrowFilters";
import PhotoUpload from "./components/PhotoUpload";
import TaskReminder from "./components/TaskReminder";
import ImportExportButtons from "./components/ImportExportButtons";
import Analytics from "./components/Analytics";
import CalendarView from "./components/CalendarView";
import Settings from "./components/Settings";
import "./index.css";

export default function App() {
  const [grows, setGrows] = useState([]);
  const [filter, setFilter] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");

  const filteredGrows = filter
    ? grows.filter((grow) => grow.strain.toLowerCase().includes(filter.toLowerCase()))
    : grows;

  return (
    <div className="min-h-screen p-4 bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-white">
      <h1 className="text-4xl font-bold mb-6 text-center">Mushroom Tracker</h1>
      <div className="flex justify-center mb-6 space-x-4">
        {["dashboard", "analytics", "calendar", "settings"].map((tab) => (
          <button
            key={tab}
            className={`px-4 py-2 rounded-lg transition ${
              activeTab === tab
                ? "bg-blue-600 text-white"
                : "bg-white text-blue-600 border border-blue-600 dark:bg-gray-800 dark:border-gray-600"
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === "dashboard" && (
        <>
          <GrowForm grows={grows} setGrows={setGrows} />
          <GrowFilters filter={filter} setFilter={setFilter} />
          <GrowList grows={filteredGrows} setGrows={setGrows} />
          <PhotoUpload grows={grows} setGrows={setGrows} />
          <TaskReminder grows={grows} />
          <ImportExportButtons grows={grows} setGrows={setGrows} />
        </>
      )}
      {activeTab === "analytics" && <Analytics grows={grows} />}
      {activeTab === "calendar" && <CalendarView grows={grows} />}
      {activeTab === "settings" && <Settings />}
    </div>
  );
}