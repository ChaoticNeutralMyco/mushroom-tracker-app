import React, { useEffect, useState } from "react";
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
  const [filteredStage, setFilteredStage] = useState("All");
  const [activeTab, setActiveTab] = useState("Grow");

  // Load from localStorage on startup
  useEffect(() => {
    const stored = localStorage.getItem("grows");
    if (stored) setGrows(JSON.parse(stored));
  }, []);

  // Save to localStorage when grows change
  useEffect(() => {
    localStorage.setItem("grows", JSON.stringify(grows));
  }, [grows]);

  const filteredGrows =
    filteredStage === "All"
      ? grows
      : grows.filter((grow) => grow.stage === filteredStage);

  const tabs = [
    { id: "Grow", label: "Grow Tracker" },
    { id: "Photos", label: "Photos" },
    { id: "Tasks", label: "Reminders" },
    { id: "Analytics", label: "Analytics" },
    { id: "Calendar", label: "Calendar" },
    { id: "Settings", label: "Settings" },
  ];

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 p-4">
      <header className="text-3xl font-bold text-center mb-4">
        🍄 Chaotic Neutral Mushroom Tracker
      </header>

      <nav className="flex flex-wrap justify-center mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`m-2 px-4 py-2 rounded-lg shadow ${
              activeTab === tab.id
                ? "bg-blue-600 text-white"
                : "bg-white hover:bg-blue-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="max-w-5xl mx-auto space-y-4">
        {activeTab === "Grow" && (
          <>
            <GrowForm setGrows={setGrows} />
            <GrowFilters
              filteredStage={filteredStage}
              setFilteredStage={setFilteredStage}
            />
            <GrowList grows={filteredGrows} setGrows={setGrows} />
            <ImportExportButtons grows={grows} setGrows={setGrows} />
          </>
        )}

        {activeTab === "Photos" && (
          <PhotoUpload grows={grows} setGrows={setGrows} />
        )}

        {activeTab === "Tasks" && (
          <TaskReminder grows={grows} setGrows={setGrows} />
        )}

        {activeTab === "Analytics" && <Analytics grows={grows} />}

        {activeTab === "Calendar" && (
          <CalendarView grows={grows} setGrows={setGrows} />
        )}

        {activeTab === "Settings" && <Settings />}
      </main>
    </div>
  );
}
