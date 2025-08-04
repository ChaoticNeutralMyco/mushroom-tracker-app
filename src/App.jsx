// src/App.jsx
import React, { useState, useEffect } from "react";
import { auth } from "./firebase-config";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase-config";

import Auth from "./components/Auth";
import GrowForm from "./components/GrowForm";
import GrowList from "./components/GrowList";
import GrowFilters from "./components/GrowFilters";
import PhotoUpload from "./components/PhotoUpload";
import TaskReminder from "./components/TaskReminder";
import ImportExportButtons from "./components/ImportExportButtons";
import Analytics from "./components/Analytics";
import CalendarView from "./components/CalendarView";
import Settings from "./components/Settings";
import TaskManager from "./components/TaskManager";
import GrowTimeline from "./components/GrowTimeline";
import COGManager from "./components/COGManager";
import RecipeManager from "./components/RecipeManager";
import DashboardStats from "./components/DashboardStats";
import StrainManager from "./components/StrainManager";

import "./index.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [grows, setGrows] = useState([]);
  const [editingGrow, setEditingGrow] = useState(null);
  const [filter, setFilter] = useState("");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const growsRef = collection(db, "users", currentUser.uid, "grows");
        const snapshot = await getDocs(growsRef);
        setGrows(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));

        const onboardRef = doc(db, "users", currentUser.uid, "settings", "onboarding");
        const onboardSnap = await getDoc(onboardRef);
        if (!onboardSnap.exists() || !onboardSnap.data().seen) {
          setShowOnboarding(true);
        }

        const prefRef = doc(db, "users", currentUser.uid, "settings", "preferences");
        const prefSnap = await getDoc(prefRef);
        if (prefSnap.exists()) {
          const prefs = prefSnap.data();
          const themeClass = `theme-${prefs.theme || "default"}`;
          document.body.classList.remove("theme-default", "theme-high-contrast", "theme-pastel");
          document.body.classList.add(themeClass);
          document.documentElement.style.fontSize =
            prefs.fontSize === "small" ? "14px" :
            prefs.fontSize === "large" ? "18px" : "16px";
          document.body.classList.toggle("dyslexia-font", prefs.dyslexicFont);
          document.body.classList.toggle("reduce-motion", prefs.reduceMotion);
        }
      } else {
        setGrows([]);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
  };

  const updateGrowStage = async (growId, newStage) => {
    const user = auth.currentUser;
    if (!user) return;
    const grow = grows.find((g) => g.id === growId);
    if (!grow) return;

    const updatedStageDates = {
      ...(grow.stageDates || {}),
      [newStage]: new Date().toISOString(),
    };

    const growRef = doc(db, `users/${user.uid}/grows`, growId);
    await updateDoc(growRef, {
      stage: newStage,
      stageDates: updatedStageDates,
      updatedAt: serverTimestamp(),
    });

    setGrows((prev) =>
      prev.map((g) =>
        g.id === growId ? { ...g, stage: newStage, stageDates: updatedStageDates } : g
      )
    );
  };

  const filteredGrows = filter
    ? grows.filter((grow) => grow.strain?.toLowerCase().includes(filter.toLowerCase()))
    : grows;

  const handleDismissOnboarding = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const onboardRef = doc(db, "users", user.uid, "settings", "onboarding");
    await setDoc(onboardRef, { seen: true }, { merge: true });
    setShowOnboarding(false);
  };

  if (!user) return <Auth setUser={setUser} />;

  return (
    <div className="min-h-screen p-4 bg-white text-gray-900 dark:bg-gray-900 dark:text-white transition-colors duration-300">
      {showOnboarding && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-6 rounded shadow-lg max-w-lg w-full space-y-4">
            <h2 className="text-2xl font-bold">👋 Welcome to Chaotic Mycology!</h2>
            <p>This app helps you track your mushroom grows from spore to harvest.</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>📋 Add and edit your grows</li>
              <li>📆 View stage progress and timelines</li>
              <li>📸 Upload photos and track yield</li>
              <li>🧪 Track cost of goods and recipes</li>
              <li>📊 Visualize analytics and export logbooks</li>
            </ul>
            <button
              onClick={handleDismissOnboarding}
              className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
            >
              Let's Get Started!
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4 w-full justify-center">
          <img src="/logo.png" alt="Logo" className="h-40 w-40 rounded-full shadow-md" />
          <h1 className="text-4xl font-bold">Chaotic Mycology</h1>
          <img src="/logo.png" alt="Logo" className="h-40 w-40 rounded-full shadow-md" />
        </div>
        <button onClick={handleLogout} className="absolute right-4 top-4 text-sm text-red-500 hover:underline">
          Logout
        </button>
      </div>

      <div className="flex justify-center mb-6 flex-wrap gap-2">
        {[
          { id: "dashboard", label: "Dashboard" },
          { id: "timeline", label: "Timeline" },
          { id: "analytics", label: "Analytics" },
          { id: "calendar", label: "Calendar" },
          { id: "tasks", label: "Tasks" },
          { id: "cog", label: "COG" },
          { id: "recipes", label: "Recipes" },
          { id: "strains", label: "Strains" },
          { id: "settings", label: "Settings" },
        ].map(({ id, label }) => (
          <button
            key={id}
            className={`px-4 py-2 rounded-lg transition-colors duration-200 ${
              activeTab === id
                ? "bg-blue-600 text-white shadow"
                : "bg-white text-blue-600 border border-blue-600 hover:bg-blue-100 dark:bg-gray-800 dark:text-blue-300 dark:border-blue-300"
            }`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "dashboard" && (
        <>
          <DashboardStats grows={grows} />
          <GrowForm grows={grows} setGrows={setGrows} editingGrow={editingGrow} setEditingGrow={setEditingGrow} />
          <GrowFilters filter={filter} setFilter={setFilter} />
          <GrowList grows={filteredGrows} setGrows={setGrows} setEditingGrow={setEditingGrow} />
          <PhotoUpload grows={grows} setGrows={setGrows} />
          <TaskReminder grows={grows} />
          <ImportExportButtons grows={grows} setGrows={setGrows} />
        </>
      )}
      {activeTab === "timeline" && <GrowTimeline grows={grows} setGrows={setGrows} updateGrowStage={updateGrowStage} />}
      {activeTab === "analytics" && <Analytics grows={grows} />}
      {activeTab === "calendar" && <CalendarView grows={grows} />}
      {activeTab === "tasks" && <TaskManager selectedGrowId={null} />}
      {activeTab === "cog" && <COGManager />}
      {activeTab === "recipes" && <RecipeManager />}
      {activeTab === "strains" && <StrainManager />}
      {activeTab === "settings" && <Settings />}
    </div>
  );
}
