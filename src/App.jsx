// src/App.jsx
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
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
  getDoc,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  FlaskConical,
  TestTube,
  Wheat,
  Package,
  Syringe,
  CheckCircle2,
  Sprout,
  Scissors,
  AlertTriangle,
  CircleDot,
  Utensils,
} from "lucide-react";

import "./index.css";

import Auth from "./pages/Auth";
// REMOVED wrapper usage: NewGrowModal/GrowModal
import GrowList from "./components/Grow/GrowList";
import GrowDetail from "./components/Grow/GrowDetail";
import EditStageStatusModal from "./components/Grow/EditStageStatusModal";
import DashboardStats from "./components/ui/DashboardStats";
import OnboardingModal from "./components/ui/OnboardingModal";
import SplashScreen from "./components/ui/SplashScreen";
import { isActiveGrow, isArchivedish } from "./lib/growFilters";
import CameraProbe from "./CameraProbe";
import FabQuickActions from "./components/ui/FabQuickActions";
import LocalReminders from "./components/ui/LocalReminders";
import OnboardingCoach from "./utils/OnboardingCoach";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";

// NEW: direct Modal + GrowForm
import Modal from "./components/ui/Modal";
import GrowForm from "./components/Grow/GrowForm";

const Analytics = React.lazy(() => import("./pages/Analytics"));
const CalendarView = React.lazy(() => import("./pages/CalendarView"));
const Settings = React.lazy(() => import("./pages/Settings"));
const StrainManager = React.lazy(() => import("./pages/StrainManager"));
const QuickEdit = React.lazy(() => import("./pages/QuickEdit"));
const Archive = React.lazy(() => import("./pages/Archive"));
const LabelPrintWrapper = React.lazy(() => import("./components/Grow/LabelPrintWrapper"));
const RecipeManager = React.lazy(() => import("./components/recipes/RecipeManager"));
const COGManager = React.lazy(() => import("./components/recipes/COGManager.jsx"));
const TaskManager = React.lazy(() => import("./components/Tasks/TaskManager"));
const GrowTimeline = React.lazy(() => import("./components/Grow/GrowTimeline"));
const ScanBarcodeModal = React.lazy(() => import("./components/ui/ScanBarcodeModal"));
const RecipeStepsPanel = React.lazy(() => import("./components/recipes/RecipeStepsPanel"));

const prefetchers = {
  analytics: () => import("./pages/Analytics"),
  calendar: () => import("./pages/CalendarView"),
  timeline: () => import("./components/Grow/GrowTimeline"),
  cog: () => import("./components/recipes/COGManager.jsx"),
  recipes: () => import("./components/recipes/RecipeManager"),
  strains: () => import("./pages/StrainManager"),
  labels: () => import("./components/Grow/LabelPrintWrapper"),
  archive: () => import("./pages/Archive"),
  settings: () => import("./pages/Settings"),
  tasks: () => import("./components/Tasks/TaskManager"),
};

const systemPrefersDark =
  () => window.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false;

function normalizePrefs(input = {}) {
  const accent = input.accent ?? input.theme ?? "chaotic";
  const mode =
    input.mode ??
    (typeof input.darkMode === "boolean" ? (input.darkMode ? "dark" : "light") : systemPrefersDark());
  const darkMode = mode === "dark" ? true : mode === "light" ? false : systemPrefersDark();
  return { accent, mode, theme: accent, darkMode };
}

function applyThemeToDOM(prefsLike) {
  const p = normalizePrefs(prefsLike);
  const root = document.documentElement;
  ["emerald", "violet", "amber", "rose", "slate", "chaotic", "teal", "indigo", "sky"].forEach((t) =>
    root.classList.remove(`theme-${t}`)
  );
  root.classList.add(`theme-${p.accent || "emerald"}`);
  root.classList.toggle("dark", !!p.darkMode);

  try {
    const style = (prefsLike && prefsLike.themeStyle) || localStorage.getItem("cn_theme_style") || "default";
    root.classList.toggle("bg-chaotic", style === "chaotic");
  } catch {}

  root.classList.toggle("compact", !!prefsLike.compactUI);
  root.classList.toggle("reduce-motion", !!prefsLike.reduceMotion);
  root.classList.toggle("font-dyslexia", !!prefsLike.dyslexiaFont);
  root.classList.toggle("high-contrast", !!prefsLike.highContrast);
  root.classList.toggle("large-taps", !!prefsLike.largeTaps);

  try {
    localStorage.setItem("theme", p.darkMode ? "dark" : "light");
    localStorage.setItem("__prefs__", JSON.stringify({ theme: p.accent, darkMode: p.darkMode }));
  } catch {}
}

(function applyInitialTheme() {
  try {
    const lsNew = JSON.parse(localStorage.getItem("preferences") || "null");
    if (lsNew && (lsNew.mode || lsNew.accent)) {
      applyThemeToDOM(lsNew);
    } else {
      const legacy = JSON.parse(localStorage.getItem("__prefs__") || "{}");
      if (legacy && (legacy.theme || typeof legacy.darkMode === "boolean")) {
        applyThemeToDOM(legacy);
      } else {
        applyThemeToDOM({ accent: "chaotic", mode: "system" });
      }
    }
    try {
      const sty = localStorage.getItem("cn_theme_style");
      document.documentElement.classList.toggle("bg-chaotic", sty === "chaotic");
    } catch {}
  } catch {
    document.documentElement.classList.add("theme-chaotic");
  }
})();

const DEFAULT_PREFS = {
  mode: "system",
  accent: "chaotic",
  theme: "chaotic",
  themeStyle: "chaotic",
  darkMode: systemPrefersDark(),
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
  temperatureUnit: "F",
  autoConvertEnvNotes: true,
  guideEnabled: true,
};

const Skel = ({ className = "" }) => (
  <div className={`animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800 ${className}`} />
);
const CardShell = ({ children }) => (
  <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4 border border-zinc-200/60 dark:border-zinc-800/60">
    {children}
  </div>
);

const DashboardSkeleton = () => (
  <div className="space-y-6">
    <Skel className="h-24 w-full rounded-xl" />
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <CardShell>
        <Skel className="h-6 w-40 mb-4" />
        <div className="space-y-2">
          <Skel className="h-4 w-full" />
          <Skel className="h-4 w-11/12" />
          <Skel className="h-4 w-10/12" />
        </div>
      </CardShell>
      <CardShell>
        <Skel className="h-6 w-32 mb-4" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skel key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </CardShell>
    </div>
  </div>
);
const AnalyticsSkeleton = () => (
  <CardShell>
    <Skel className="h-6 w-32 mb-4" />
    <div className="grid grid-cols-12 gap-2">
      {Array.from({ length: 12 }).map((_, i) => (
        <Skel key={i} className="h-40 w-full" />
      ))}
    </div>
  </CardShell>
);
const CalendarSkeleton = () => (
  <CardShell>
    <Skel className="h-6 w-28 mb-4" />
    <Skel className="h-[540px] w-full rounded-xl" />
  </CardShell>
);
const SettingsSkeleton = () => (
  <CardShell>
    <Skel className="h-6 w-24 mb-4" />
    <div className="space-y-3">
      <Skel className="h-10 w-full" />
      <Skel className="h-10 w-3/4" />
      <Skel className="h-10 w-2/3" />
    </div>
  </CardShell>
);

export default function App() {
  const [user, setUser] = useState(null);

  const [rawGrows, setRawGrows] = useState(undefined);
  const [recipes, setRecipes] = useState(undefined);
  const [supplies, setSupplies] = useState(undefined);
  const [tasks, setTasks] = useState(undefined);
  const [photos, setPhotos] = useState(undefined);
  const [notes, setNotes] = useState(undefined);
  const [strains, setStrains] = useState(undefined);

  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  const [activeTab, setActiveTab] = useState("dashboard");
  const [editingGrow, setEditingGrow] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const splashStartRef = useRef(Date.now());
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setShowSplash(false), 5000);
    return () => clearTimeout(id);
  }, []);

  const applyAppearance = (p) => {
    const n = normalizePrefs(p);
    const merged = { ...p, ...n };
    applyThemeToDOM(merged);
    try {
      localStorage.setItem(
        "preferences",
        JSON.stringify({
          mode: merged.mode,
          accent: merged.accent,
          temperatureUnit: merged.temperatureUnit,
          autoConvertEnvNotes: merged.autoConvertEnvNotes,
          guideEnabled: merged.guideEnabled,
        })
      );
    } catch {}
    document.documentElement.style.setProperty("--font-scale", merged.fontScale || "small");
  };

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

  const activeGrowsBase = useMemo(() => grows.filter(isActiveGrow), [grows]);
  const archivedGrowsBase = useMemo(() => grows.filter(isArchivedish), [grows]);

  const TYPE_META = [
    { id: "Agar", icon: FlaskConical },
    { id: "LC", icon: TestTube },
    { id: "Grain Jar", icon: Wheat },
    { id: "Bulk", icon: Package },
  ];
  const STAGE_META = [
    { id: "Inoculated", icon: Syringe },
    { id: "Colonizing", icon: CircleDot },
    { id: "Colonized", icon: CheckCircle2 },
    { id: "Fruiting", icon: Sprout },
    { id: "Harvested", icon: Scissors },
    { id: "Consumed", icon: Utensils },
    { id: "Contaminated", icon: AlertTriangle },
  ];

  const normalizeType = (t = "") => {
    const s = String(t).toLowerCase().replace(/\s+/g, "");
    if (s.includes("agar")) return "Agar";
    if (s.includes("lc") || s.includes("liquidculture")) return "LC";
    if (s.includes("grain") || s.includes("grainjar") || s.includes("gj")) return "Grain Jar";
    if (s.includes("bulk")) return "Bulk";
    return "Other";
  };

  const normalizeStage = (st = "") => {
    const s = String(st).toLowerCase();
    if (s.startsWith("inoc")) return "Inoculated";
    if (s.includes("colonizing")) return "Colonizing";
    if (s.includes("colonized")) return "Colonized";
    if (s.includes("fruit")) return "Fruiting";
    if (s.includes("harvest")) return "Harvested";
    if (s.includes("consum")) return "Consumed";
    if (s.includes("contam")) return "Contaminated";
    return "Other";
  };

  const typeCounts = useMemo(() => {
    const counts = { Agar: 0, LC: 0, "Grain Jar": 0, Bulk: 0, Other: 0 };
    for (const g of activeGrowsBase) {
      const status = String(g?.status || "").toLowerCase();
      if (status === "stored") continue;           // exclude Stored from "Active" counts
      const st = normalizeStage(g?.stage);
      if (st === "Harvested") continue;            // exclude finished-but-not-archived
      counts[normalizeType(g.type || g.growType)]++;
    }
    return counts;
  }, [activeGrowsBase]);

  const stageCounts = useMemo(() => {
    const counts = {
      Inoculated: 0,
      Colonizing: 0,
      Colonized: 0,
      Fruiting: 0,
      Harvested: 0,
      Consumed: 0,
      Contaminated: 0,
      Other: 0,
    };

    for (const g of activeGrowsBase) {
      const s = normalizeStage(g.stage);
      if (s === "Inoculated" || s === "Colonizing" || s === "Colonized" || s === "Fruiting") {
        counts[s]++;
      }
    }

    for (const g of archivedGrowsBase) {
      const stage = normalizeStage(g.stage);
      const status = String(g.status || "").toLowerCase();
      const remain = Number(g?.amountAvailable);
      const remaining =
        Number.isFinite(remain) ? remain : Number(g?.remaining) ?? Number.POSITIVE_INFINITY;

      if (remaining <= 0) {
        counts.Consumed++;
        continue;
      }
      if (status === "contaminated" || stage === "Contaminated") {
        counts.Contaminated++;
        continue;
      }
      if (stage === "Harvested") counts.Harvested++;
    }

    return counts;
  }, [activeGrowsBase, archivedGrowsBase]);

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

  useEffect(() => {
    let unsubs = [];
    const stopAll = () => {
      unsubs.forEach((fn) => fn && fn());
      unsubs = [];
    };

    const endSplashAfter = (minMs = 0) => {
      const elapsed = Date.now() - splashStartRef.current;
      const wait = Math.max(0, Number(minMs) - elapsed);
      setTimeout(() => setShowSplash(false), wait);
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
        endSplashAfter(400);
        return;
      }

      const prefRef = doc(db, "users", u.uid, "settings", "preferences");
      let minPref = 0;

      try {
        const snap = await getDoc(prefRef);
        const cloud = snap.exists() ? snap.data() || {} : {};

        let localNew = {};
        let legacy = {};
        try {
          localNew = JSON.parse(localStorage.getItem("preferences") || "{}");
        } catch {}
        try {
          legacy = JSON.parse(localStorage.getItem("__prefs__") || "{}");
        } catch {}

        const merged = {
          ...DEFAULT_PREFS,
          ...normalizePrefs(cloud),
          ...normalizePrefs(localNew),
          ...normalizePrefs(legacy),
          ...cloud,
        };

        setPrefs(merged);
        applyAppearance(merged);

        await setDoc(
          prefRef,
          {
            accent: merged.accent,
            mode: merged.mode,
            theme: merged.accent,
            darkMode: merged.darkMode,
            fontScale: merged.fontScale,
            dyslexiaFont: merged.dyslexiaFont,
            reduceMotion: merged.reduceMotion,
            compactUI: merged.compactUI,
            highContrast: merged.highContrast,
            largeTaps: merged.largeTaps,
            showSplashOnLoad: merged.showSplashOnLoad,
            splashMinMs: merged.splashMinMs,
            guideEnabled: merged.guideEnabled,
          },
          { merge: true }
        );

        minPref = merged.showSplashOnLoad ? Number(merged.splashMinMs || 1200) : 0;
      } catch {
        let localNew = {};
        try {
          localNew = JSON.parse(localStorage.getItem("preferences") || "{}");
        } catch {}
        const fallback = { ...DEFAULT_PREFS, ...normalizePrefs(localNew) };
        setPrefs(fallback);
        applyAppearance(fallback);
        minPref = fallback.showSplashOnLoad ? Number(fallback.splashMinMs || 1200) : 0;
      } finally {
        endSplashAfter(minPref);
      }

      const col = (name) => collection(db, "users", u.uid, name);
      unsubs.push(
        onSnapshot(col("supplies"), (s) =>
          setSupplies(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        ),
        onSnapshot(col("recipes"), (s) =>
          setRecipes(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        ),
        onSnapshot(col("grows"), (s) =>
          setRawGrows(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        ),
        onSnapshot(col("tasks"), (s) =>
          setTasks(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        ),
        onSnapshot(col("photos"), (s) =>
          setPhotos(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        ),
        onSnapshot(col("notes"), (s) =>
          setNotes(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        ),
        onSnapshot(col("strains"), (s) =>
          setStrains(s.docs.map((d) => ({ id: d.id, ...d.data() })))
        )
      );
    });

    return () => {
      unsubAuth();
      stopAll();
    };
  }, []);

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const onUpdateStage = async (growId, nextStage) => {
    if (!user) return;
    const ref = doc(db, "users", user.uid, "grows", growId);

    // Look at current state to respect manual locks and existing dates
    let currentGrow = undefined;
    try {
      const arr = Array.isArray(rawGrows) ? rawGrows : [];
      currentGrow = arr.find((x) => x.id === growId);
    } catch {}

    const isLocked = !!(currentGrow && currentGrow.stageLocks && currentGrow.stageLocks[nextStage]);
    const hasDate = !!(currentGrow && currentGrow.stageDates && currentGrow.stageDates[nextStage]);

    const todayLocal = new Date();
    const yyyy = todayLocal.getFullYear();
    const mm = String(todayLocal.getMonth() + 1).padStart(2, "0");
    const dd = String(todayLocal.getDate()).padStart(2, "0");
    const today = `${yyyy}-${mm}-${dd}`;

    const patch = { stage: nextStage };
    if (prefs.autoStampStageDates && !isLocked && !hasDate) {
      patch[`stageDates.${nextStage}`] = today;
    }

    await updateDoc(ref, patch);

    setRawGrows((prev) =>
      (Array.isArray(prev) ? prev : []).map((g) => {
        if (g.id !== growId) return g;
        const nextDates = {
          ...(g.stageDates || {}),
          ...(prefs.autoStampStageDates && !isLocked && !hasDate ? { [nextStage]: today } : {}),
        };
        return { ...g, stage: nextStage, stageDates: nextDates };
      })
    );
  };;

  const onUpdateStageDate = async (growId, stage, dateISO) => {
    if (!user) return;
    const ref = doc(db, "users", user.uid, "grows", growId);
    const patch = {
      [`stageDates.${stage}`]: dateISO || null,
      [`stageLocks.${stage}`]: !!dateISO, // manual edit lock (true when user sets a date)
    };
    await updateDoc(ref, patch);
    setRawGrows((prev) =>
      (Array.isArray(prev) ? prev : []).map((g) => {
        if (g.id !== growId) return g;
        const nextLocks = { ...(g.stageLocks || {}), [stage]: !!dateISO };
        const nextDates = { ...(g.stageDates || {}), [stage]: dateISO || "" };
        return { ...g, stageLocks: nextLocks, stageDates: nextDates };
      })
    );
  };;

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

  const onCreateTask = async (payload) => {
    if (user) await addDoc(collection(db, "users", user.uid, "tasks"), payload);
  };
  const onUpdateTask = async (id, patch) => {
    if (user) await updateDoc(doc(db, "users", user.uid, "tasks", id), patch);
  };
  const onDeleteTask = async (id) => {
    if (user) await deleteDoc(doc(db, "users", user.uid, "tasks", id));
  };

  const onAddNote = async (growId, stage, text, extras = {}) => {
    if (!user || !text) return;

    const autoConvert = !!prefs.autoConvertEnvNotes;

    let temperatureF;
    let temperatureC;

    const hasF = Number.isFinite(Number(extras.temperatureF));
    const hasC = Number.isFinite(Number(extras.temperatureC));

    if (hasF) {
      temperatureF = Number(extras.temperatureF);
      if (autoConvert) temperatureC = Math.round(((temperatureF - 32) * 5) / 9 * 10) / 10;
    } else if (hasC) {
      temperatureC = Number(extras.temperatureC);
      temperatureF = Math.round(((temperatureC * 9) / 5 + 32) * 10) / 10;
      if (!autoConvert) temperatureC = undefined;
    }

    const payload = {
      growId,
      stage: stage || "General",
      text,
      timestamp: new Date().toISOString(),
    };

    if (Number.isFinite(Number(extras.humidityPct))) {
      payload.humidityPct = Number(extras.humidityPct);
    }
    if (Number.isFinite(temperatureF)) {
      payload.temperatureF = temperatureF;
    }
    if (Number.isFinite(temperatureC)) {
      payload.temperatureC = temperatureC;
    }

    await addDoc(collection(db, "users", user.uid, "notes"), payload);
  };

  const onUploadPhoto = async (growId, file, caption) => {
    if (!user || !file) return;
    const path = `users/${user.uid}/photos/${growId}/${Date.now()}_${file.name}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file);
    const url = await getDownloadURL(r);
    await addDoc(collection(db, "users", user.uid, "photos"), {
      growId,
      url,
      caption: caption || "",
      stage: null,
      timestamp: new Date().toISOString(),
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
      growId,
      url,
      caption: caption || "",
      stage: safeStage,
      timestamp: new Date().toISOString(),
    });
  };

  const onAddNoteWithEnv = async (growId, stage, text, temperatureC, humidityPct) =>
    onAddNote(growId, stage, text, { temperatureC, humidityPct });

  const onCreateStrain = async (data) => {
    if (!user) return null;
    const ref = await addDoc(collection(db, "users", user.uid, "strains"), data);
    return ref.id;
  };
  const onUpdateStrain = async (id, patch) => {
    if (user) await updateDoc(doc(db, "users", user.uid, "strains", id), patch);
  };
  const onDeleteStrain = async (id) => {
    if (user) await deleteDoc(doc(db, "users", user.uid, "strains", id));
  };
  const onUploadStrainImage = async (file) => {
    if (!user || !file) return "";
    const path = `users/${user.uid}/strains/${Date.now()}_${file.name}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file);
    return await getDownloadURL(r);
  };

  const savePrefs = async (next) => {
    const merged = { ...prefs, ...next, ...normalizePrefs(next) };
    setPrefs(merged);
    applyAppearance(merged);

    try {
      const style = merged.themeStyle === "chaotic" ? "chaotic" : "default";
      localStorage.setItem("cn_theme_style", style);
      document.documentElement.classList.toggle("bg-chaotic", style === "chaotic");
    } catch {}

    try {
      localStorage.setItem(
        "preferences",
        JSON.stringify({
          mode: merged.mode,
          accent: merged.accent,
          temperatureUnit: merged.temperatureUnit,
          autoConvertEnvNotes: merged.autoConvertEnvNotes,
          guideEnabled: merged.guideEnabled,
        })
      );
      localStorage.setItem("__prefs__", JSON.stringify({ theme: merged.accent, darkMode: merged.darkMode }));
    } catch {}

    if (!user) return;
    await setDoc(
      doc(db, "users", user.uid, "settings", "preferences"),
      {
        mode: merged.mode,
        accent: merged.accent,
        theme: merged.accent,
        darkMode: merged.darkMode,
        fontScale: merged.fontScale,
        dyslexiaFont: merged.dyslexiaFont,
        reduceMotion: merged.reduceMotion,
        compactUI: merged.compactUI,
        highContrast: merged.highContrast,
        largeTaps: merged.largeTaps,
        showSplashOnLoad: merged.showSplashOnLoad,
        splashMinMs: merged.splashMinMs,
        temperatureUnit: merged.temperatureUnit,
        autoConvertEnvNotes: merged.autoConvertEnvNotes,
        guideEnabled: merged.guideEnabled,
      },
      { merge: true }
    );
  };

  const tabFallback = useMemo(() => {
    switch (activeTab) {
      case "analytics":
        return <AnalyticsSkeleton />;
      case "calendar":
        return <CalendarSkeleton />;
      case "settings":
        return <SettingsSkeleton />;
      default:
        return <DashboardSkeleton />;
    }
  }, [activeTab]);

  // EARLY RETURNS AFTER ALL HOOKS ABOVE (no hooks below).
  if (showSplash) return <SplashScreen />;
  if (!user) return <Auth setUser={setUser} />;

  const isEditingExisting = editingGrow && editingGrow.id;
  const isAddingNew = editingGrow && !editingGrow.id;

  return (
    <ConfirmProvider>
      {showScanner && (
        <Suspense fallback={<div className="fixed inset-0 bg-black/30" />}>
          <ScanBarcodeModal onClose={() => setShowScanner(false)} />
        </Suspense>
      )}

      {isEditingExisting && (
        <EditStageStatusModal
          grow={editingGrow}
          onUpdateStage={onUpdateStage}
          onUpdateStatus={onUpdateStatus}
          onClose={() => setEditingGrow(null)}
        />
      )}

      {/* New Grow modal: Modal handles page lock internally */}
      {isAddingNew && (
        <Modal open={true} onClose={() => setEditingGrow(null)} title="New Grow">
          <GrowForm
            editingGrow={editingGrow || {}}
            strains={Array.isArray(strains) ? strains : []}
            grows={grows}
            recipes={Array.isArray(recipes) ? recipes : []}
            supplies={Array.isArray(supplies) ? supplies : []}
            onCreateGrow={onCreateGrow}
            onUpdateGrow={onUpdateGrow}
            onClose={() => setEditingGrow(null)}
          />
        </Modal>
      )}

      <Routes>
        <Route
          path="/quick/:growId"
          element={
            <Suspense
              fallback={
                <div className="p-6">
                  <CardShell>
                    <Skel className="h-6 w-40 mb-4" />
                    <Skel className="h-10 w-full" />
                  </CardShell>
                </div>
              }
            >
              <QuickEdit
                grows={grows}
                notesByGrowStage={notesByGrowStage}
                photosByGrowStage={photosByGrowStage}
                onUpdateStage={onUpdateStage}
                onUpdateStatus={onUpdateStatus}
                onAddNote={onAddNote}
                onUploadStagePhoto={onUploadStagePhoto}
              />
            </Suspense>
          }
        />

        <Route
          path="/grow/:growId"
          element={
            <GrowDetail
              grows={grows}
              prefs={prefs}
              onUpdateGrow={onUpdateGrow}
              onAddNote={onAddNote}
              photosByGrow={photosByGrow}
              onUploadPhoto={onUploadPhoto}
              onUploadStagePhoto={onUploadStagePhoto}
            />
          }
        />

        <Route
          path="/"
          element={
            <div id="app-shell" className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-white">
              <header className="sticky top-0 z-30 bg-white/80 dark:bg-zinc-900/80 backdrop-blur border-b border-zinc-200 dark:border-zinc-800">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
                  <h1 className="text-xl font-bold">Chaotic Neutral Tracker</h1>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      data-tour="scan"
                      onClick={() => setShowScanner(true)}
                      className="chip chip--active text-sm"
                    >
                      Scan
                    </button>
                    <button
                      onClick={handleSignOut}
                      className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              </header>

              <div className="max-w-7xl mx-auto px-4 py-4">
                {/* Tabs */}
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
                  ].map(([key, label]) => {
                    const isActive = activeTab === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setActiveTab(key)}
                        onMouseEnter={() => prefetchers[key]?.()}
                        onFocus={() => prefetchers[key]?.()}
                        role="tab"
                        aria-selected={isActive}
                        className={`chip ${isActive ? "chip--active" : ""}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <Suspense fallback={tabFallback}>
                  {activeTab === "dashboard" && (
                    <>
                      {/* Type chips */}
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Types
                          </span>
                          {TYPE_META.map(({ id, icon: Icon }) => {
                            const count = typeCounts[id] || 0;
                            return (
                              <span key={id} className="chip">
                                <Icon className="h-4 w-4" />
                                <span>{id}</span>
                                <span className="opacity-80">({count})</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Stage chips */}
                      <div className="mb-4 flex flex-wrap items-center gap-2" data-tour="stage-filters">
                        <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Stages
                        </span>
                        {STAGE_META.map(({ id, icon: Icon }) => {
                          const count = stageCounts[id] || 0;
                          return (
                            <span key={id} className="chip">
                              <Icon className="h-4 w-4" />
                              <span>{id}</span>
                              <span className="opacity-80">({count})</span>
                            </span>
                          );
                        })}
                      </div>

                      <div className="space-y-6">
                        <DashboardStats
                          grows={grows}
                          recipes={recipes}
                          supplies={supplies}
                          loading={
                            grows === undefined || recipes === undefined || supplies === undefined
                          }
                        />

                        <div className="flex">
                          <button
                            data-tour="new-grow"
                            className="chip chip--active text-sm"
                            onClick={() => setEditingGrow({})}
                          >
                            + New Grow
                          </button>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                          <GrowList
                            growsActive={activeGrowsBase}
                            archivedGrows={archivedGrowsBase}
                            setEditingGrow={setEditingGrow}
                            showAddButton={false}
                            onUpdateStatus={onUpdateStatus}
                          />
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
                      growsActive={Array.isArray(grows) ? grows.filter(isActiveGrow) : []}
                      growsAll={Array.isArray(grows) ? grows : []}
                      grows={Array.isArray(grows) ? grows.filter(isActiveGrow) : []}
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
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4" data-tour="cog-root">
                      <COGManager />
                    </div>
                  )}

                  {activeTab === "recipes" && (
                    <>
                      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                        <RecipeManager />
                      </div>
                      <Suspense
                        fallback={
                          <CardShell>
                            <Skel className="h-6 w-56 mb-3" />
                            <Skel className="h-40 w-full" />
                          </CardShell>
                        }
                      >
                        <RecipeStepsPanel />
                      </Suspense>
                    </>
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
                      <Archive grows={grows} setEditingGrow={setEditingGrow} />
                    </div>
                  )}

                  {activeTab === "settings" && (
                    <Settings
                      preferences={{
                        mode: prefs.mode ?? (prefs.darkMode ? "dark" : "light"),
                        accent: prefs.accent ?? prefs.theme,
                        ...prefs,
                      }}
                      onSavePreferences={savePrefs}
                      applyAppearance={applyAppearance}
                    />
                  )}
                </Suspense>

                <OnboardingModal visible={showOnboarding} onClose={() => setShowOnboarding(false)} />
              </div>

              {/* Floating Quick Actions */}
              <FabQuickActions
                grows={activeGrowsBase}
                onNewGrow={() => setEditingGrow({})}
                onLogStatus={(id) => {
                  const g =
                    activeGrowsBase.find((x) => x.id === id) ||
                    grows.find((x) => x.id === id);
                  if (g) setEditingGrow(g);
                }}
                onUploadPhoto={onUploadPhoto}
              />

              {/* Local reminders (client-only) */}
              <LocalReminders grows={grows} prefs={prefs} />
            </div>
          }
        />

        <Route path="/camera-probe" element={<CameraProbe />} />
      </Routes>

      {/* First-run coach */}
      <OnboardingCoach pageKey={activeTab} enabled={prefs.guideEnabled !== false} />
    </ConfirmProvider>
  );
}
