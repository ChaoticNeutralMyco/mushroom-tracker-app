// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { auth, db, storage } from "./firebase-config";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  addDoc,
  deleteDoc,
  setDoc,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import "./styles/theme.css";

// Pages
import Auth from "./pages/Auth";
import Analytics from "./pages/Analytics";
import CalendarView from "./pages/CalendarView";
import Settings from "./pages/Settings";
import StrainManager from "./pages/StrainManager";
import QuickEdit from "./pages/QuickEdit";
import Archive from "./pages/Archive";

// Grow components
import GrowForm from "./components/Grow/GrowForm";
import GrowList from "./components/Grow/GrowList";
import GrowDetail from "./components/Grow/GrowDetail";
import GrowTimeline from "./components/Grow/GrowTimeline";
import EditStageStatusModal from "./components/Grow/EditStageStatusModal";
import LabelPrintWrapper from "./components/Grow/LabelPrintWrapper";

// Recipes / COG
import RecipeManager from "./components/recipes/RecipeManager";
import COGManager from "./components/recipes/COGManager.jsx";

// UI
import TaskManager from "./components/Tasks/TaskManager";
import DashboardStats from "./components/ui/DashboardStats";
import OnboardingModal from "./components/ui/OnboardingModal";
import ScanBarcodeModal from "./components/ui/ScanBarcodeModal";
import SplashScreen from "./components/ui/SplashScreen";
import PhotoUpload from "./components/ui/PhotoUpload";

// ---- Prevent theme flash early ----
(function applyInitialTheme() {
  try {
    const stored = JSON.parse(localStorage.getItem("__prefs__") || "{}");
    const dark =
      typeof stored.darkMode === "boolean"
        ? stored.darkMode
        : (localStorage.getItem("theme") || "dark") === "dark";
    const theme = stored.theme || "emerald";
    const el = document.documentElement;
    const THEMES = ["emerald", "violet", "amber", "rose", "slate"];
    THEMES.forEach((t) => el.classList.remove(`theme-${t}`));
    el.classList.add(`theme-${theme}`);
    el.classList.toggle("dark", !!dark);
  } catch {
    document.documentElement.classList.add("theme-emerald");
    document.documentElement.classList.add("dark");
  }
})();

const DEFAULT_PREFS = {
  theme: "emerald",
  darkMode: true,
  fontScale: "small",
  dyslexiaFont: false,
  reduceMotion: false,
  compactUI: false,

  labelTemplate: "3x2",
  labelQR: true,
  labelFields: { abbr: true, type: true, inocDate: true, parent: true },

  qrMode: "quickEditUrl",
  scanAction: "openQuickEdit",
  barcodeType: "qr",

  autoStampStageDates: true,
  confirmStageRegression: true,
  defaultStatus: "Active",

  quickNoteStage: "current",
  photoQuality: "medium",
  autoCaptionPhotos: true,

  taskDigestTime: "09:00",
  taskOverdueHighlight: true,
  stageReminders: false,
  stageMaxDays: {},

  backup: { enabled: false, frequency: "weekly", destination: "local" },
  exportFormat: "csv",
  confirmDeletes: "bulkOnly",
  analytics: false,

  liveSnapshots: true,
  preloadPhotos: false,
  offlineCache: false,

  highContrast: false,
  largeTaps: false,

  showSplashOnLoad: true,
  splashMinMs: 1200,

  hasSeenOnboarding: true,
  devMode: false,
};

const THEMES = ["emerald", "violet", "amber", "rose", "slate"];

export default function App() {
  const [user, setUser] = useState(null);

  // live data
  const [rawGrows, setRawGrows] = useState(undefined);
  const [recipes, setRecipes] = useState(undefined);
  const [supplies, setSupplies] = useState(undefined);
  const [tasks, setTasks] = useState(undefined);
  const [photos, setPhotos] = useState(undefined);
  const [notes, setNotes] = useState(undefined);
  const [strains, setStrains] = useState(undefined);

  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  const [activeTab, setActiveTab] = useState("dashboard");
  const [filter, setFilter] = useState("");
  const [editingGrow, setEditingGrow] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const splashStartRef = useRef(Date.now());
  const [showSplash, setShowSplash] = useState(true);

  const applyAppearance = (p) => {
    const el = document.documentElement;
    THEMES.forEach((t) => el.classList.remove(`theme-${t}`));
    el.classList.add(`theme-${p.theme || "emerald"}`);
    el.classList.toggle("dark", !!p.darkMode);
    el.classList.toggle("compact", !!p.compactUI);
    el.classList.toggle("reduce-motion", !!p.reduceMotion);
    el.classList.toggle("font-dyslexia", !!p.dyslexiaFont);
    el.classList.toggle("high-contrast", !!p.highContrast);
    el.classList.toggle("large-taps", !!p.largeTaps);
    try {
      localStorage.setItem("theme", p.darkMode ? "dark" : "light");
      localStorage.setItem("__prefs__", JSON.stringify({ theme: p.theme, darkMode: p.darkMode }));
    } catch {}
    document.documentElement.style.setProperty("--font-scale", p.fontScale || "small");
  };

  // maps
  const suppliesMap = useMemo(() => {
    const arr = Array.isArray(supplies) ? supplies : [];
    const m = new Map();
    for (const s of arr) m.set(s.id, s);
    return m;
  }, [supplies]);

  const recipesMap = useMemo(() => {
    const arr = Array.isArray(recipes) ? recipes : [];
    const m = new Map();
    for (const r of arr) m.set(r.id, r);
    return m;
  }, [recipes]);

  // grows with computed cost
  const grows = useMemo(() => {
    const gs = Array.isArray(rawGrows) ? rawGrows : [];
    return gs.map((g) => {
      const r = g.recipeId ? recipesMap.get(g.recipeId) : null;
      let computedCost = 0;
      if (r && Array.isArray(r.items)) {
        for (const it of r.items) {
          const sup = suppliesMap.get(it.supplyId);
          computedCost += Number(sup?.cost || 0) * Number(it.amount || 0);
        }
      }
      const finalCost =
        typeof g.cost === "number" && !Number.isNaN(g.cost)
          ? g.cost
          : Number(computedCost.toFixed(2));
      return { ...g, recipeName: r?.name || g.recipeName || "", cost: finalCost };
    });
  }, [rawGrows, recipesMap, suppliesMap]);

  // derived: active vs archivedish
  const isArchivedish = (g) =>
    g.status === "Archived" ||
    g.status === "Contaminated" ||
    (Number(g.amountAvailable ?? Infinity) <= 0) ||
    g.stage === "Harvested";

  const activeGrowsBase = useMemo(() => grows.filter((g) => !isArchivedish(g)), [grows]);

  const filteredGrows = useMemo(() => {
    const f = (filter || "").trim().toLowerCase();
    const base = activeGrowsBase;
    if (!f) return base;
    return base.filter((g) => {
      const fields = [g.strain || "", g.subName || g.abbreviation || "", g.type || "", g.stage || ""]
        .join(" ")
        .toLowerCase();
      return fields.includes(f);
    });
  }, [activeGrowsBase, filter]);

  // groupings
  const photosByGrow = useMemo(() => {
    const arr = Array.isArray(photos) ? photos : [];
    const map = new Map();
    for (const p of arr) {
      const list = map.get(p.growId) || [];
      list.push(p);
      map.set(p.growId, list);
    }
    return map;
  }, [photos]);

  const photosByGrowStage = useMemo(() => {
    const arr = Array.isArray(photos) ? photos : [];
    const map = new Map();
    for (const p of arr) {
      const key = `${p.growId}::${p.stage || "General"}`;
      const list = map.get(key) || [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [photos]);

  const notesByGrowStage = useMemo(() => {
    const arr = Array.isArray(notes) ? notes : [];
    const map = new Map();
    for (const n of arr) {
      const key = `${n.growId}::${n.stage || "General"}`;
      const list = map.get(key) || [];
      list.push(n);
      map.set(key, list);
    }
    return map;
  }, [notes]);

  // auth + snapshots
  useEffect(() => {
    let unsubs = [];

    const stopAll = () => {
      unsubs.forEach((fn) => fn && fn());
      unsubs = [];
    };

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      stopAll();

      if (!u) {
        setRawGrows(undefined);
        setRecipes(undefined);
        setSupplies(undefined);
        setTasks(undefined);
        setPhotos(undefined);
        setNotes(undefined);
        setStrains(undefined);
        setShowOnboarding(false);
        const min = 400;
        const elapsed = Date.now() - splashStartRef.current;
        const wait = Math.max(0, min - elapsed);
        setTimeout(() => setShowSplash(false), wait);
        return;
      }

      // prefs
      const prefRef = doc(db, "users", u.uid, "settings", "preferences");
      await setDoc(prefRef, DEFAULT_PREFS, { merge: true });
      unsubs.push(
        onSnapshot(prefRef, (snap) => {
          const data = snap.exists() ? { ...DEFAULT_PREFS, ...snap.data() } : DEFAULT_PREFS;
          setPrefs(data);
          applyAppearance(data);
          setShowOnboarding(!data.hasSeenOnboarding);

          const min = data.showSplashOnLoad ? Number(data.splashMinMs || 1200) : 0;
          const elapsed = Date.now() - splashStartRef.current;
          const wait = Math.max(0, min - elapsed);
          setTimeout(() => setShowSplash(false), wait);
        })
      );

      const col = (name) => collection(db, "users", u.uid, name);
      unsubs.push(onSnapshot(col("supplies"), (s) => setSupplies(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
      unsubs.push(onSnapshot(col("recipes"), (s) => setRecipes(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
      unsubs.push(onSnapshot(col("grows"), (s) => setRawGrows(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
      unsubs.push(onSnapshot(col("tasks"), (s) => setTasks(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
      unsubs.push(onSnapshot(col("photos"), (s) => setPhotos(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
      unsubs.push(onSnapshot(col("notes"), (s) => setNotes(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
      unsubs.push(onSnapshot(col("strains"), (s) => setStrains(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
    });

    return () => {
      unsubAuth();
      stopAll();
    };
  }, []);

  // actions (same as before) ...
  const handleSignOut = async () => { await signOut(auth); };

  const onUpdateStage = async (growId, nextStage) => {
    if (!user) return;
    const ref = doc(db, "users", user.uid, "grows", growId);
    const today = new Date().toISOString().slice(0, 10);
    const patch = { stage: nextStage };
    if (prefs.autoStampStageDates) patch[`stageDates.${nextStage}`] = today;
    await updateDoc(ref, patch);
    setRawGrows((prev) =>
      (Array.isArray(prev) ? prev : []).map((g) =>
        g.id === growId
          ? {
              ...g,
              stage: nextStage,
              stageDates: {
                ...(g.stageDates || {}),
                ...(prefs.autoStampStageDates ? { [nextStage]: today } : {}),
              },
            }
          : g
      )
    );
  };

  const onUpdateStageDate = async (growId, stage, dateISO) => {
    if (!user) return;
    await updateDoc(doc(db, "users", user.uid, "grows", growId), {
      [`stageDates.${stage}`]: dateISO || null,
    });
    setRawGrows((prev) =>
      (Array.isArray(prev) ? prev : []).map((g) =>
        g.id === growId
          ? { ...g, stageDates: { ...(g.stageDates || {}), [stage]: dateISO || "" } }
          : g
      )
    );
  };

  const onUpdateStatus = async (growId, status) => {
    if (!user) return;
    await updateDoc(doc(db, "users", user.uid, "grows", growId), { status });
    setRawGrows((prev) =>
      (Array.isArray(prev) ? prev : []).map((g) => (g.id === growId ? { ...g, status } : g))
    );
  };

  const onUpdateGrow = async (growId, patch) => {
    if (!user || !growId || !patch) return;
    await updateDoc(doc(db, "users", user.uid, "grows", growId), patch);
    setRawGrows((prev) =>
      (Array.isArray(prev) ? prev : []).map((g) => (g.id === growId ? { ...g, ...patch } : g))
    );
  };

  const onCreateGrow = async (payload) => {
    if (!user) return null;
    const ref = await addDoc(collection(db, "users", user.uid, "grows"), payload);
    return ref.id;
  };

  const onCreateTask = async (payload) => { if (user) await addDoc(collection(db, "users", user.uid, "tasks"), payload); };
  const onUpdateTask = async (id, patch) => { if (user) await updateDoc(doc(db, "users", user.uid, "tasks", id), patch); };
  const onDeleteTask = async (id) => { if (user) await deleteDoc(doc(db, "users", user.uid, "tasks", id)); };

  const onUploadPhoto = async (growId, file, caption) => {
    if (!user || !file) return;
    const path = `users/${user.uid}/photos/${growId}/${Date.now()}_${file.name}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    await addDoc(collection(db, "users", user.uid, "photos"), {
      growId, url, caption: caption || "", stage: null, timestamp: new Date().toISOString(),
    });
  };

  const onUploadStagePhoto = async (growId, stage, file, caption) => {
    if (!user || !file) return;
    const safeStage = stage || "General";
    const path = `users/${user.uid}/photos/${growId}/${safeStage}/${Date.now()}_${file.name}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    await addDoc(collection(db, "users", user.uid, "photos"), {
      growId, url, caption: caption || "", stage: safeStage, timestamp: new Date().toISOString(),
    });
  };

  const onAddNote = async (growId, stage, text) => {
    if (!user || !text) return;
    await addDoc(collection(db, "users", user.uid, "notes"), {
      growId, stage: stage || "General", text, timestamp: new Date().toISOString(),
    });
  };

  const onCreateStrain = async (data) => { if (!user) return null; const ref = await addDoc(collection(db, "users", user.uid, "strains"), data); return ref.id; };
  const onUpdateStrain = async (id, patch) => { if (user) await updateDoc(doc(db, "users", user.uid, "strains", id), patch); };
  const onDeleteStrain = async (id) => { if (user) await deleteDoc(doc(db, "users", user.uid, "strains", id)); };
  const onUploadStrainImage = async (file) => {
    if (!user || !file) return "";
    const path = `users/${user.uid}/strains/${Date.now()}_${file.name}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file);
    return await getDownloadURL(r);
  };

  const savePrefs = async (data) => {
    if (!user) return;
    await setDoc(doc(db, "users", user.uid, "settings", "preferences"), data, { merge: true });
    applyAppearance(data);
  };

  if (showSplash) return <SplashScreen />;
  if (!user) return <Auth setUser={setUser} />;

  const isEditingExisting = editingGrow && editingGrow.id;
  const isAddingNew = editingGrow && !editingGrow.id;

  return (
    <>
      {showScanner && <ScanBarcodeModal onClose={() => setShowScanner(false)} />}

      {isEditingExisting && (
        <EditStageStatusModal
          grow={editingGrow}
          onUpdateStage={onUpdateStage}
          onUpdateStatus={onUpdateStatus}
          onClose={() => setEditingGrow(null)}
        />
      )}

      {isAddingNew && (
        <GrowForm
          editingGrow={editingGrow}
          onSaveComplete={() => setEditingGrow(null)}
          onClose={() => setEditingGrow(null)}
          strains={Array.isArray(strains) ? strains : []}
          grows={grows}
          recipes={Array.isArray(recipes) ? recipes : []}
          supplies={Array.isArray(supplies) ? supplies : []}
          onCreateGrow={onCreateGrow}
          onUpdateGrow={onUpdateGrow}
        />
      )}

      <Routes>
        <Route
          path="/quick/:growId"
          element={
            <QuickEdit
              grows={grows}
              notesByGrowStage={notesByGrowStage}
              photosByGrowStage={photosByGrowStage}
              onUpdateStage={onUpdateStage}
              onUpdateStatus={onUpdateStatus}
              onAddNote={onAddNote}
              onUploadStagePhoto={onUploadStagePhoto}
            />
          }
        />

        <Route
          path="/grow/:growId"
          element={
            <GrowDetail
              grows={grows}
              onUpdateGrow={onUpdateGrow}
              onAddNote={onAddNote}
            />
          }
        />

        <Route
          path="/"
          element={
            <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-white">
              <header className="sticky top-0 z-30 bg-white/80 dark:bg-zinc-900/80 backdrop-blur border-b border-zinc-200 dark:border-zinc-800">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
                  <h1 className="text-xl font-bold">Chaotic Neutral Tracker</h1>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={() => setShowScanner(true)} className="px-3 py-1.5 rounded-lg accent-bg text-sm" aria-label="Open scanner">Scan</button>
                    <button onClick={handleSignOut} className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm" aria-label="Sign out">Sign out</button>
                  </div>
                </div>
              </header>

              <div className="max-w-7xl mx-auto px-4 py-4">
                <div className="flex flex-wrap gap-2 mb-4">
                  {[
                    ["dashboard", "Dashboard"],
                    ["tasks", "Tasks"],
                    ["analytics", "Analytics"],
                    ["calendar", "Calendar"],
                    ["timeline", "Timeline"],
                    ["cog", "COG"],
                    ["recipes", "Recipes"],
                    ["strains", "Strains"],
                    ["labels", "Labels"],
                    ["archive", "Archive"],
                    ["settings", "Settings"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={`px-3 py-1.5 rounded-full text-sm border ${
                        activeTab === key
                          ? "accent-chip"
                          : "bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {activeTab === "dashboard" && (
                  <>
                    <div className="mb-4 flex items-center gap-2">
                      <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Search grows…"
                        className="w-full sm:w-72 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                      />
                      <button
                        className="px-3 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm"
                        onClick={() => setEditingGrow({})}
                      >
                        + New Grow
                      </button>
                    </div>

                    <div className="space-y-6">
                      <DashboardStats
                        grows={grows}
                        recipes={recipes}
                        supplies={supplies}
                        loading={
                          grows === undefined ||
                          recipes === undefined ||
                          supplies === undefined
                        }
                      />

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                          <GrowList
                            grows={filteredGrows}
                            setGrows={setRawGrows}
                            setEditingGrow={setEditingGrow}
                            showAddButton={false}
                          />
                        </div>
                        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                          <h2 className="text-lg font-semibold mb-3">Photos</h2>
                          <PhotoUpload
                            grows={activeGrowsBase}
                            photosByGrow={photosByGrow}
                            onUpload={onUploadPhoto}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeTab === "tasks" && (
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                    <TaskManager
                      tasks={Array.isArray(tasks) ? tasks : []}
                      onCreate={onCreateTask}
                      onUpdate={onUpdateTask}
                      onDelete={onDeleteTask}
                    />
                  </div>
                )}

                {activeTab === "analytics" && (
                  <Analytics
                    grows={grows}
                    recipes={Array.isArray(recipes) ? recipes : []}
                    supplies={Array.isArray(supplies) ? supplies : []}
                    tasks={Array.isArray(tasks) ? tasks : []}
                  />
                )}

                {activeTab === "calendar" && (
                  <CalendarView grows={grows} tasks={Array.isArray(tasks) ? tasks : []} />
                )}

                {activeTab === "timeline" && (
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                    <GrowTimeline
                      grows={grows}
                      onUpdateStage={onUpdateStage}
                      onUpdateStageDate={onUpdateStageDate}
                      notesByGrowStage={notesByGrowStage}
                      photosByGrowStage={photosByGrowStage}
                      onAddNote={onAddNote}
                      onUploadStagePhoto={onUploadStagePhoto}
                    />
                  </div>
                )}

                {activeTab === "cog" && (
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                    <COGManager />
                  </div>
                )}

                {activeTab === "recipes" && (
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                    <RecipeManager />
                  </div>
                )}

                {activeTab === "strains" && (
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                    <StrainManager
                      strains={Array.isArray(strains) ? strains : []}
                      grows={grows}
                      onCreateStrain={onCreateStrain}
                      onUpdateStrain={onUpdateStrain}
                      onDeleteStrain={onDeleteStrain}
                      onUploadStrainImage={onUploadStrainImage}
                    />
                  </div>
                )}

                {activeTab === "labels" && (
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                    <LabelPrintWrapper grows={grows} prefs={prefs} />
                  </div>
                )}

                {activeTab === "archive" && (
                  <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                    <Archive grows={grows} />
                  </div>
                )}

                {activeTab === "settings" && (
                  <Settings
                    /* compatibility with either Settings.jsx version */
                    preferences={prefs}
                    prefs={prefs}
                    onSaved={() => {}}
                    onSavePrefs={savePrefs}
                    applyAppearance={applyAppearance}
                  />
                )}
              </div>

              <OnboardingModal
                visible={showOnboarding}
                onClose={() => setShowOnboarding(false)}
              />
            </div>
          }
        />
      </Routes>
    </>
  );
}
