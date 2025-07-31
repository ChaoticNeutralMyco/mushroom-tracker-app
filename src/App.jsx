import React, { useEffect, useState } from "react";
import GrowForm from "./components/GrowForm";
import GrowList from "./components/GrowList";
import GrowFilters from "./components/GrowFilters";
import PhotoUpload from "./components/PhotoUpload";
import TaskReminder from "./components/TaskReminder";
import ImportExportButtons from "./components/ImportExportButtons";
import CalendarView from "./components/CalendarView";
import Analytics from "./components/Analytics";
import Settings from "./components/Settings";
import { db } from "./firebase";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";

export default function App() {
  const [tab, setTab] = useState("tracker");
  const [grows, setGrows] = useState([]);

  const growsCollectionRef = collection(db, "grows");

  // 🔄 Fetch data from Firestore
  const fetchGrows = async () => {
    const data = await getDocs(growsCollectionRef);
    setGrows(data.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
  };

  useEffect(() => {
    fetchGrows();
  }, []);

  const addGrow = async (newGrow) => {
    const docRef = await addDoc(growsCollectionRef, newGrow);
    setGrows([...grows, { ...newGrow, id: docRef.id }]);
  };

  const updateGrow = async (id, updatedData) => {
    const growDoc = doc(db, "grows", id);
    await updateDoc(growDoc, updatedData);
    setGrows(
      grows.map((grow) => (grow.id === id ? { ...grow, ...updatedData } : grow))
    );
  };

  const deleteGrow = async (id) => {
    const growDoc = doc(db, "grows", id);
    await deleteDoc(growDoc);
    setGrows(grows.filter((grow) => grow.id !== id));
  };

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100 p-4">
      <h1 className="text-3xl font-bold text-center mb-6">
        🍄 Chaotic Neutral Mushroom Tracker
      </h1>

      {/* Tab Navigation */}
      <div className="flex justify-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setTab("tracker")}
          className={`px-4 py-2 rounded ${
            tab === "tracker"
              ? "bg-emerald-600 text-white"
              : "bg-zinc-800 text-zinc-300"
          }`}
        >
          Tracker
        </button>
        <button
          onClick={() => setTab("calendar")}
          className={`px-4 py-2 rounded ${
            tab === "calendar"
              ? "bg-blue-600 text-white"
              : "bg-zinc-800 text-zinc-300"
          }`}
        >
          Calendar
        </button>
        <button
          onClick={() => setTab("analytics")}
          className={`px-4 py-2 rounded ${
            tab === "analytics"
              ? "bg-purple-600 text-white"
              : "bg-zinc-800 text-zinc-300"
          }`}
        >
          Analytics
        </button>
        <button
          onClick={() => setTab("settings")}
          className={`px-4 py-2 rounded ${
            tab === "settings"
              ? "bg-orange-600 text-white"
              : "bg-zinc-800 text-zinc-300"
          }`}
        >
          Settings
        </button>
      </div>

      {/* Tab Views */}
      {tab === "tracker" && (
        <>
          <GrowForm onAdd={addGrow} />
          <GrowFilters grows={grows} setGrows={setGrows} />
          <GrowList
            grows={grows}
            onUpdate={updateGrow}
            onDelete={deleteGrow}
          />
          <PhotoUpload />
          <TaskReminder />
          <ImportExportButtons grows={grows} setGrows={setGrows} />
        </>
      )}
      {tab === "calendar" && <CalendarView grows={grows} />}
      {tab === "analytics" && <Analytics grows={grows} />}
      {tab === "settings" && <Settings />}
    </div>
  );
}
