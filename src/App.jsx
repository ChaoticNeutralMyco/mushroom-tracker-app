import React, { useState, useEffect } from "react";
import GrowForm from "./components/GrowForm";
import GrowFilters from "./components/GrowFilters";
import GrowList from "./components/GrowList";
import PhotoUpload from "./components/PhotoUpload";
import TaskReminder from "./components/TaskReminder";
import ImportExportButtons from "./components/ImportExportButtons";
import CalendarView from "./components/CalendarView";
import Analytics from "./components/Analytics";
import Settings from "./components/Settings";
import { onValue, ref, set } from "firebase/database";
import { db } from "./firebase";

export default function App() {
  const [grows, setGrows] = useState([]);
  const [tab, setTab] = useState("tracker");

  // Firebase sync
  useEffect(() => {
    const growsRef = ref(db, "grows");
    const unsubscribe = onValue(growsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setGrows(data);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    set(ref(db, "grows"), grows);
  }, [grows]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-3xl font-bold text-center mb-6">
        🍄 Chaotic Neutral Mushroom Tracker
      </h1>

      {/* Tabs */}
      <div className="flex justify-center mb-6 space-x-2">
        {["tracker", "calendar", "analytics", "settings"].map((t) => (
          <button
            key={t}
            className={`px-4 py-2 rounded ${
              tab === t ? "bg-green-600" : "bg-gray-700"
            }`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "tracker" && (
        <div className="space-y-4">
          <GrowForm setGrows={setGrows} />
          <GrowFilters grows={grows} setGrows={setGrows} />
          <GrowList grows={grows} setGrows={setGrows} />
          <PhotoUpload grows={grows} setGrows={setGrows} />
          <TaskReminder grows={grows} />
          <ImportExportButtons grows={grows} setGrows={setGrows} />
        </div>
      )}

      {tab === "calendar" && <CalendarView grows={grows} />}
      {tab === "analytics" && <Analytics grows={grows} />}
      {tab === "settings" && <Settings />}
    </div>
  );
}
