import React, { useState, useEffect } from "react";
import GrowForm from "./components/GrowForm";
import GrowList from "./components/GrowList";
import GrowFilters from "./components/GrowFilters";
import ImportExportButtons from "./components/ImportExportButtons";
import PhotoUpload from "./components/PhotoUpload";
import TaskReminder from "./components/TaskReminder";
import Analytics from "./components/Analytics";
import CalendarView from "./components/CalendarView";
import Settings from "./components/Settings";

function App() {
  const [grows, setGrows] = useState([]);
  const [filter, setFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("Grow Tracker");

  useEffect(() => {
    const saved = localStorage.getItem("mushroom-grows");
    if (saved) {
      setGrows(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("mushroom-grows", JSON.stringify(grows));
  }, [grows]);

  const filteredGrows =
    filter === "all" ? grows : grows.filter((grow) => grow.stage === filter);

  return (
    <div className="min-h-screen bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100 p-4">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-4">
          🍄 Mushroom Grow Tracker
        </h1>

        <div className="flex justify-center space-x-2 mb-4 flex-wrap">
          {[
            "Grow Tracker",
            "Photos",
            "Tasks",
            "Analytics",
            "Calendar",
            "Settings",
          ].map((tab) => (
            <button
              key={tab}
              className={`px-3 py-1 rounded-md border ${
                activeTab === tab
                  ? "bg-blue-500 text-white"
                  : "bg-white dark:bg-gray-800"
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === "Grow Tracker" && (
          <>
            <GrowForm setGrows={setGrows} />
            <GrowFilters setFilter={setFilter} />
            <GrowList grows={filteredGrows} setGrows={setGrows} />
            <ImportExportButtons grows={grows} setGrows={setGrows} />
          </>
        )}

        {activeTab === "Photos" && <PhotoUpload grows={grows} setGrows={setGrows} />}
        {activeTab === "Tasks" && <TaskReminder grows={grows} setGrows={setGrows} />}
        {activeTab === "Analytics" && <Analytics grows={grows} />}
        {activeTab === "Calendar" && <CalendarView grows={grows} />}
        {activeTab === "Settings" && <Settings />}
      </div>
    </div>
  );
}

export default App;
