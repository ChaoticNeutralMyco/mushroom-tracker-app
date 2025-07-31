import React, { useEffect, useState } from "react";
import GrowForm from "./components/GrowForm";
import GrowList from "./components/GrowList";
import GrowFilters from "./components/GrowFilters";
import CalendarView from "./components/CalendarView";
import Analytics from "./components/Analytics";
import Settings from "./components/Settings";
import ImportExportButtons from "./components/ImportExportButtons";
import TaskReminder from "./components/TaskReminder";
import PhotoUpload from "./components/PhotoUpload";
import { db } from "./firebase";
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";

export default function App() {
  const [grows, setGrows] = useState([]);
  const [activeTab, setActiveTab] = useState("Tracker");

  const growCollection = collection(db, "grows");

  useEffect(() => {
    const fetchData = async () => {
      const data = await getDocs(growCollection);
      setGrows(data.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    };
    fetchData();
  }, []);

  const addGrow = async (grow) => {
    const docRef = await addDoc(growCollection, grow);
    setGrows([...grows, { ...grow, id: docRef.id }]);
  };

  const updateGrow = async (id, updated) => {
    const growDoc = doc(db, "grows", id);
    await updateDoc(growDoc, updated);
    setGrows(grows.map(g => (g.id === id ? { ...g, ...updated } : g)));
  };

  const deleteGrow = async (id) => {
    const growDoc = doc(db, "grows", id);
    await deleteDoc(growDoc);
    setGrows(grows.filter(g => g.id !== id));
  };

  return (
    <div className="min-h-screen p-4 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Chaotic Neutral Mushroom Tracker</h1>
      <div className="flex gap-2 mb-4">
        {["Tracker", "Calendar", "Analytics", "Settings"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded ${
              activeTab === tab ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Tracker" && (
        <>
          <GrowForm onAdd={addGrow} />
          <GrowFilters setGrows={setGrows} grows={grows} />
          <GrowList grows={grows} onUpdate={updateGrow} onDelete={deleteGrow} />
          <PhotoUpload grows={grows} />
          <TaskReminder grows={grows} />
          <ImportExportButtons grows={grows} setGrows={setGrows} />
        </>
      )}
      {activeTab === "Calendar" && <CalendarView grows={grows} />}
      {activeTab === "Analytics" && <Analytics grows={grows} />}
      {activeTab === "Settings" && <Settings />}
    </div>
  );
}
