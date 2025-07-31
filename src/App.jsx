// src/App.jsx
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
import { saveData, loadData } from "./utils/storage";
import { app, db } from "./firebase";
import { collection, getDocs, setDoc, doc } from "firebase/firestore";

export default function App() {
  const [grows, setGrows] = useState([]);
  const [activeTab, setActiveTab] = useState("tracker");

  // Firebase Sync
  useEffect(() => {
    const fetchData = async () => {
      const snapshot = await getDocs(collection(db, "grows"));
      const data = snapshot.docs.map((doc) => doc.data());
      setGrows(data);
    };
    fetchData();
  }, []);

  useEffect(() => {
    const saveToFirebase = async () => {
      for (const grow of grows) {
        await setDoc(doc(db, "grows", grow.id), grow);
      }
    };
    if (grows.length) saveToFirebase();
  }, [grows]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <h1 className="text-3xl font-bold mb-4 flex items-center">
        <span className="mr-2">🍄</span> Chaotic Neutral Mushroom Tracker
      </h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {["tracker", "calendar", "analytics", "settings"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded ${
              activeTab === tab
                ? "bg-green-600 text-white"
                : "bg-gray-800 text-gray-300"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-gray-800 p-4 rounded shadow">
        {activeTab === "tracker" && (
          <>
            <GrowForm setGrows={setGrows} />
            <GrowFilters grows={grows} setGrows={setGrows} />
            <GrowList grows={grows} setGrows={setGrows} />
            <PhotoUpload grows={grows} setGrows={setGrows} />
            <TaskReminder grows={grows} />
            <ImportExportButtons grows={grows} setGrows={setGrows} />
          </>
        )}

        {activeTab === "calendar" && <CalendarView grows={grows} />}
        {activeTab === "analytics" && <Analytics grows={grows} />}
        {activeTab === "settings" && <Settings />}
      </div>
    </div>
  );
}
