// src/App.jsx
// release-v57-hardening
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import {
  auth,
  db,
  functions as subscriptionFunctions,
  storage,
} from "./firebase-config";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
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
import { uploadStrainImageAsset } from "./lib/strain-image-storage";
import {
  deleteGrowPhoto,
  getPhotoTimeMs,
  normalizePhotoRecord,
  setGrowCoverPhoto,
  uploadGrowPhoto,
} from "./lib/photo-storage";
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
import GrowList from "./components/Grow/GrowList";
import GrowDetail from "./components/Grow/GrowDetail";
import EditStageStatusModal from "./components/Grow/EditStageStatusModal";
import DashboardStats from "./components/ui/DashboardStats";
import SplashScreen from "./components/ui/SplashScreen";
import { isActiveGrow, isArchivedish } from "./lib/growFilters";
import {
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_LIMIT_KEYS,
} from "./lib/subscriptionPlans.js";
import {
  ACTIVE_GROW_LIMIT_ERROR_CODE,
  ActiveGrowLimitError,
  assertActiveGrowCapacity,
  countRequestedActiveGrows,
  encodeGrowPatchForCallable,
  encodeGrowPayloadForCallable,
  getActiveGrowLimitState,
  getGrowActivityTransition,
} from "./lib/subscriptionGrowLimits.js";
import FabQuickActions from "./components/ui/FabQuickActions";
import LocalReminders from "./components/ui/LocalReminders";
import useTaskReminders from "./hooks/useTaskReminders";
import OnboardingCoach from "./utils/OnboardingCoach";
import TrialExpirationNotice from "./components/ui/TrialExpirationNotice.jsx";
import ActiveGrowLimitNotice from "./components/ui/ActiveGrowLimitNotice.jsx";
import SubscriptionFeatureNotice from "./components/ui/SubscriptionFeatureNotice.jsx";
import WhatsNewNotice from "./components/ui/WhatsNewNotice.jsx";
import { useSubscription } from "./providers/SubscriptionProvider.jsx";
import {
  getSubscriptionFeatureGateState,
} from "./lib/subscriptionFeatureGates.js";
import {
  getMyAdminAccess as fetchMyAdminAccess,
} from "./lib/adminApi.js";
import {
  authenticateBiometricUnlock,
  getBiometricErrorMessage,
  getBiometricStatus,
  isBiometricUnlockEnabled,
  isTauriMobileRuntime,
  setBiometricUnlockEnabled,
} from "./lib/biometricUnlock.js";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import {
  DEFAULT_ACCENT,
  DEFAULT_APP_PREFERENCES,
  SUPPORTED_ACCENTS,
  buildPersistedAppPreferences,
  getPreferenceDomClasses,
  normalizeAppPreferences,
  persistedAppPreferencesChanged,
} from "./lib/app-preferences";

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
const PostProcessManager = React.lazy(() => import("./components/postprocess/PostProcessManager"));
const GrowTimeline = React.lazy(() => import("./components/Grow/GrowTimeline"));
const ScanBarcodeModal = React.lazy(() => import("./components/ui/ScanBarcodeModal"));
const AdminDashboard = React.lazy(() => import("./pages/AdminDashboard.jsx"));

const prefetchers = {
  analytics: () => import("./pages/Analytics"),
  calendar: () => import("./pages/CalendarView"),
  timeline: () => import("./components/Grow/GrowTimeline"),
  postprocess: () => import("./components/postprocess/PostProcessManager"),
  cog: () => import("./components/recipes/COGManager.jsx"),
  recipes: () => import("./components/recipes/RecipeManager"),
  strains: () => import("./pages/StrainManager"),
  labels: () => import("./components/Grow/LabelPrintWrapper"),
  archive: () => import("./pages/Archive"),
  settings: () => import("./pages/Settings"),
  tasks: () => import("./components/Tasks/TaskManager"),
  admin: () => import("./pages/AdminDashboard.jsx"),
};

const useFunctionsEmulator =
  import.meta.env.DEV &&
  ["1", "true", "yes"].includes(
    String(import.meta.env.VITE_USE_FUNCTIONS_EMULATOR || "").toLowerCase()
  );

const createGrowBatchFunction = httpsCallable(
  subscriptionFunctions,
  "createGrowBatch"
);
const reactivateGrowBatchFunction = httpsCallable(
  subscriptionFunctions,
  "reactivateGrowBatch"
);

function isCallableUnavailableInDevelopment(error) {
  if (!import.meta.env.DEV || useFunctionsEmulator) return false;
  const code = String(error?.code || "").toLowerCase();
  return (
    code === "functions/not-found" ||
    code === "functions/unavailable" ||
    code === "not-found" ||
    code === "unavailable"
  );
}

const systemPrefersDark =
  () => window.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false;

function applyThemeToDOM(prefsLike = {}) {
  const p = normalizeAppPreferences(prefsLike, {
    systemDark: systemPrefersDark(),
  });
  const classes = getPreferenceDomClasses(p, {
    systemDark: systemPrefersDark(),
  });
  const root = document.documentElement;

  SUPPORTED_ACCENTS.forEach((accent) => root.classList.remove(`theme-${accent}`));
  root.classList.add(`theme-${p.accent || DEFAULT_ACCENT}`);
  root.classList.toggle("dark", classes.dark);
  root.classList.toggle("bg-chaotic", classes.chaotic);
  root.classList.toggle("compact", classes.compact);
  root.classList.toggle("reduce-motion", classes.reduceMotion);
  root.classList.toggle("font-dyslexia", classes.dyslexiaFont);
  root.classList.toggle("high-contrast", classes.highContrast);
  root.classList.toggle("large-taps", classes.largeTaps);

  ["small", "medium", "large"].forEach((scale) =>
    root.classList.remove(`font-scale-${scale}`)
  );
  root.classList.add(`font-scale-${classes.fontScale}`);

  try {
    localStorage.setItem("theme", p.darkMode ? "dark" : "light");
    localStorage.setItem("__prefs__", JSON.stringify({
      theme: p.accent,
      darkMode: p.darkMode,
    }));
    localStorage.setItem("cn_theme_style", p.themeStyle);
  } catch {}

  return p;
}

(function applyInitialTheme() {
  try {
    const localPrefs = JSON.parse(localStorage.getItem("preferences") || "{}");
    const legacy = JSON.parse(localStorage.getItem("__prefs__") || "{}");
    const localThemeStyle = localStorage.getItem("cn_theme_style");
    applyThemeToDOM({
      ...legacy,
      ...localPrefs,
      themeStyle:
        localPrefs.themeStyle ||
        localThemeStyle ||
        DEFAULT_APP_PREFERENCES.themeStyle,
    });
  } catch {
    applyThemeToDOM(DEFAULT_APP_PREFERENCES);
  }
})();

const DEFAULT_PREFS = normalizeAppPreferences(DEFAULT_APP_PREFERENCES, {
  systemDark: systemPrefersDark(),
});

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

function BiometricUnlockScreen({ email, prompting, error, onRetry, onUseAccountSignIn }) {
  return (
    <div className="min-h-screen grid place-items-center bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-white px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow">
        <h1 className="text-xl font-semibold">Device unlock required</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {email ? `Unlock ${email} with your device security.` : "Unlock your signed-in account with your device security."}
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Your Firebase password is not stored for this feature. Android handles the fingerprint, face, or device credential prompt.
        </p>

        {error ? (
          <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {error}
          </div>
        ) : null}

        <div className="mt-5 space-y-2">
          <button
            type="button"
            className="w-full rounded-lg px-4 py-2 accent-bg disabled:opacity-60"
            disabled={prompting}
            onClick={onRetry}
          >
            {prompting ? "Authenticating…" : "Unlock with device"}
          </button>
          <button
            type="button"
            className="w-full rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 px-4 py-2 text-sm disabled:opacity-60"
            disabled={prompting}
            onClick={onUseAccountSignIn}
          >
            Sign out and use account sign-in
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const subscription = useSubscription();
  const [user, setUser] = useState(null);
  const [adminAccess, setAdminAccess] = useState({
    ready: false,
    authorized: false,
  });

  const [biometricGate, setBiometricGate] = useState({
    unlockedUid: null,
    prompting: false,
    error: "",
  });
  const biometricPromptRef = useRef(false);
  const biometricHiddenAtRef = useRef(null);

  const [rawGrows, setRawGrows] = useState(undefined);
  const [recipes, setRecipes] = useState(undefined);
  const [supplies, setSupplies] = useState(undefined);
  const [tasks, setTasks] = useState(undefined);
  const [photos, setPhotos] = useState(undefined);
  const [notes, setNotes] = useState(undefined);
  const [strains, setStrains] = useState(undefined);

  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedCalendarTaskId, setSelectedCalendarTaskId] = useState("");
  const [editingGrow, setEditingGrow] = useState(null);
  const [growLimitNotice, setGrowLimitNotice] = useState(null);
  const [featureAccessNotice, setFeatureAccessNotice] = useState(null);
  const activeGrowUsageRef = useRef(0);
  const pendingActiveGrowCreatesRef = useRef(0);
  const [showScanner, setShowScanner] = useState(false);
  const location = useLocation();
  const scanParamRef = useRef({ tab: null, libKey: null });
  const [openLibraryItemId, setOpenLibraryItemId] = useState(null);

  const consumeOpenLibraryItem = () => {
    setOpenLibraryItemId(null);
    scanParamRef.current.libKey = null;
  };

  const runBiometricUnlock = React.useCallback(async (uid) => {
    if (!uid) return false;

    if (!isTauriMobileRuntime() || !isBiometricUnlockEnabled(uid)) {
      setBiometricGate({ unlockedUid: uid, prompting: false, error: "" });
      return true;
    }

    if (biometricPromptRef.current) return false;
    biometricPromptRef.current = true;
    setBiometricGate((current) => ({
      ...current,
      unlockedUid: current.unlockedUid === uid ? uid : null,
      prompting: true,
      error: "",
    }));

    try {
      const status = await getBiometricStatus();
      if (!status.available) {
        throw new Error(
          status.error || "Device authentication is not currently available."
        );
      }

      await authenticateBiometricUnlock();
      setBiometricGate({ unlockedUid: uid, prompting: false, error: "" });
      return true;
    } catch (error) {
      setBiometricGate({
        unlockedUid: null,
        prompting: false,
        error: getBiometricErrorMessage(error),
      });
      return false;
    } finally {
      biometricPromptRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setBiometricGate({ unlockedUid: null, prompting: false, error: "" });
      return;
    }

    if (!isTauriMobileRuntime() || !isBiometricUnlockEnabled(user.uid)) {
      setBiometricGate({ unlockedUid: user.uid, prompting: false, error: "" });
      return;
    }

    setBiometricGate({ unlockedUid: null, prompting: false, error: "" });
    runBiometricUnlock(user.uid);
  }, [runBiometricUnlock, user?.uid]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        biometricHiddenAtRef.current = Date.now();
        return;
      }

      const hiddenAt = biometricHiddenAtRef.current;
      biometricHiddenAtRef.current = null;

      if (
        document.visibilityState === "visible" &&
        user?.uid &&
        hiddenAt &&
        Date.now() - hiddenAt >= 30000 &&
        isTauriMobileRuntime() &&
        isBiometricUnlockEnabled(user.uid)
      ) {
        setBiometricGate({ unlockedUid: null, prompting: false, error: "" });
        runBiometricUnlock(user.uid);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [runBiometricUnlock, user?.uid]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search || "");
      const tab = params.get("tab");
      const lib = params.get("lib") || params.get("library") || params.get("storage");
      const nonce = params.get("_") || params.get("nonce") || "";
      const libKey = lib ? `${lib}::${nonce}` : null;

      const allowedTabs = new Set([
        "dashboard",
        "tasks",
        "analytics",
        "calendar",
        "timeline",
        "postprocess",
        "cog",
        "recipes",
        "strains",
        "labels",
        "archive",
        "settings",
      ]);

      if (adminAccess.authorized) {
        allowedTabs.add("admin");
      }

      if (tab && allowedTabs.has(tab) && tab !== scanParamRef.current.tab) {
        scanParamRef.current.tab = tab;
        setActiveTab(tab);
      }

      if (lib && libKey !== scanParamRef.current.libKey) {
        scanParamRef.current.libKey = libKey;
        setOpenLibraryItemId(lib);
        setActiveTab("strains");
      }
    } catch {
      // ignore bad query strings
    }
  }, [adminAccess.authorized, location.search]);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setAdminAccess({ ready: true, authorized: false });
      if (activeTab === "admin") setActiveTab("dashboard");
      return () => {
        cancelled = true;
      };
    }

    setAdminAccess({ ready: false, authorized: false });

    fetchMyAdminAccess()
      .then((result) => {
        if (cancelled) return;
        setAdminAccess({
          ready: true,
          authorized: result?.authorized === true,
        });
      })
      .catch((accessError) => {
        if (cancelled) return;
        console.warn("Administrator access check failed:", accessError);
        setAdminAccess({ ready: true, authorized: false });
      });

    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (
      activeTab === "admin" &&
      adminAccess.ready &&
      !adminAccess.authorized
    ) {
      setActiveTab("dashboard");
    }
  }, [activeTab, adminAccess.authorized, adminAccess.ready]);

  const splashStartRef = useRef(Date.now());
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setShowSplash(false), 5000);
    return () => clearTimeout(id);
  }, []);

  const applyAppearance = (nextPrefs) => {
    const merged = applyThemeToDOM(nextPrefs);
    try {
      localStorage.setItem("preferences", JSON.stringify(merged));
      localStorage.setItem("cn_last_accent", merged.accent || DEFAULT_ACCENT);
      localStorage.setItem("cn_theme_style", merged.themeStyle);
    } catch {}
    return merged;
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
  const activeGrowLimit = subscription.getLimit(SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS);
  const canUseSopWorkflows = subscription.hasFeature(
    SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS
  );
  const canGenerateSopTasks = subscription.hasFeature(
    SUBSCRIPTION_FEATURE_KEYS.SOP_GENERATED_TASKS
  );
  const activeGrowLimitState = useMemo(
    () =>
      getActiveGrowLimitState({
        activeGrowCount: activeGrowsBase.length,
        activeGrowLimit,
      }),
    [activeGrowsBase.length, activeGrowLimit]
  );

  useEffect(() => {
    activeGrowUsageRef.current = activeGrowsBase.length;
  }, [activeGrowsBase.length]);

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
      if (status === "stored") continue;
      const st = normalizeStage(g?.stage);
      if (st === "Harvested") continue;
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

        let localThemeStyle = "";
        try {
          localThemeStyle = localStorage.getItem("cn_theme_style") || "";
        } catch {}

        const merged = normalizeAppPreferences(
          {
            ...DEFAULT_PREFS,
            ...legacy,
            ...localNew,
            ...cloud,
            themeStyle:
              cloud.themeStyle ||
              localNew.themeStyle ||
              localThemeStyle ||
              DEFAULT_APP_PREFERENCES.themeStyle,
          },
          { systemDark: systemPrefersDark() }
        );

        setPrefs(merged);
        applyAppearance(merged);

        const persistedPrefs = buildPersistedAppPreferences(merged, {
          systemDark: systemPrefersDark(),
        });
        if (!snap.exists() || persistedAppPreferencesChanged(cloud, persistedPrefs)) {
          await setDoc(prefRef, persistedPrefs, { merge: true });
        }

        minPref = merged.showSplashOnLoad ? Number(merged.splashMinMs || 1200) : 0;
      } catch {
        let localNew = {};
        try {
          localNew = JSON.parse(localStorage.getItem("preferences") || "{}");
        } catch {}
        let localThemeStyle = "";
        try {
          localThemeStyle = localStorage.getItem("cn_theme_style") || "";
        } catch {}
        const fallback = normalizeAppPreferences(
          {
            ...DEFAULT_PREFS,
            ...localNew,
            themeStyle:
              localNew.themeStyle ||
              localThemeStyle ||
              DEFAULT_APP_PREFERENCES.themeStyle,
          },
          { systemDark: systemPrefersDark() }
        );
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
        onSnapshot(col("photos"), (s) => {
          const rows = s.docs.map((d) =>
            normalizePhotoRecord({ id: d.id, ...d.data() })
          );
          rows.sort((a, b) => getPhotoTimeMs(b) - getPhotoTimeMs(a));
          setPhotos(rows);
        }),
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

  const handleBiometricAccountFallback = async () => {
    if (user?.uid) {
      setBiometricUnlockEnabled(user.uid, false);
    }
    setBiometricGate({ unlockedUid: null, prompting: false, error: "" });
    await signOut(auth);
  };

  const showActiveGrowLimitNotice = (errorOrDetails = {}) => {
    const details = errorOrDetails?.details || errorOrDetails || {};
    const usage = Number.isFinite(Number(details.usage))
      ? Number(details.usage)
      : activeGrowUsageRef.current;
    const limit = details.limit === null
      ? null
      : Number.isFinite(Number(details.limit))
        ? Number(details.limit)
        : activeGrowLimit;
    const requested = Number.isFinite(Number(details.requested))
      ? Number(details.requested)
      : 1;
    const action = details.action || "create";

    if (limit === null) return;

    let message = errorOrDetails?.message || "";
    if (!message) {
      try {
        assertActiveGrowCapacity({
          activeGrowCount: usage,
          activeGrowLimit: limit,
          requestedCount: requested,
          action,
        });
      } catch (error) {
        message = error.message;
      }
    }

    setGrowLimitNotice({ usage, limit, requested, action, message });
  };

  const requestSubscriptionFeature = ({ featureKey, actionLabel, supportingText = "" }) => {
    const gate = getSubscriptionFeatureGateState({
      allowed: subscription.hasFeature(featureKey),
      featureKey,
      actionLabel,
      supportingText,
    });

    if (gate.allowed) return true;

    setFeatureAccessNotice(gate);
    return false;
  };

  const assertGrowCapacity = ({ requestedCount = 1, action = "create" } = {}) => {
    try {
      return assertActiveGrowCapacity({
        activeGrowCount:
          activeGrowUsageRef.current + pendingActiveGrowCreatesRef.current,
        activeGrowLimit,
        requestedCount,
        action,
      });
    } catch (error) {
      if (error?.code === ACTIVE_GROW_LIMIT_ERROR_CODE) {
        showActiveGrowLimitNotice(error);
      }
      throw error;
    }
  };

  const raiseTrustedGrowMutationError = (error) => {
    const details =
      error?.details && typeof error.details === "object"
        ? error.details
        : {};
    const errorCode = String(error?.code || "");
    const isCapacityError =
      details.code === ACTIVE_GROW_LIMIT_ERROR_CODE ||
      errorCode.endsWith("/resource-exhausted");

    if (isCapacityError) {
      const typedError = new ActiveGrowLimitError(
        error?.message || "Your active-grow limit has been reached.",
        {
          ...details,
          action: details.action || "create",
        }
      );
      showActiveGrowLimitNotice(typedError);
      throw typedError;
    }

    throw error;
  };

  const invokeTrustedGrowCreateBatch = async (payloads = []) => {
    try {
      const response = await createGrowBatchFunction({
        grows: payloads.map((payload) =>
          encodeGrowPayloadForCallable(payload || {})
        ),
      });
      const growIds = Array.isArray(response?.data?.growIds)
        ? response.data.growIds.map(String)
        : [];

      if (growIds.length !== payloads.length) {
        throw new Error("Trusted grow creation returned an incomplete result.");
      }

      return growIds;
    } catch (error) {
      if (isCallableUnavailableInDevelopment(error)) {
        console.warn(
          "[grow-security] Trusted create callable unavailable in development; using the legacy direct write until Functions are deployed."
        );
        return Promise.all(
          payloads.map(async (payload) => {
            const ref = await addDoc(
              collection(db, "users", user.uid, "grows"),
              payload
            );
            return ref.id;
          })
        );
      }

      return raiseTrustedGrowMutationError(error);
    }
  };

  const invokeTrustedGrowReactivationBatch = async (updates = []) => {
    try {
      const response = await reactivateGrowBatchFunction({
        updates: updates.map((update) => ({
          growId: update?.growId || update?.id,
          patch: encodeGrowPatchForCallable(update?.patch || {}),
        })),
      });

      return response?.data || {};
    } catch (error) {
      if (isCallableUnavailableInDevelopment(error)) {
        console.warn(
          "[grow-security] Trusted reactivation callable unavailable in development; using the legacy direct write until Functions are deployed."
        );
        await Promise.all(
          updates.map((update) =>
            updateDoc(
              doc(
                db,
                "users",
                user.uid,
                "grows",
                update?.growId || update?.id
              ),
              update?.patch || {}
            )
          )
        );
        return {
          growIds: updates.map((update) => update?.growId || update?.id),
        };
      }

      return raiseTrustedGrowMutationError(error);
    }
  };

  const assertGrowReactivationAllowed = (currentGrow, patch) => {
    const transition = getGrowActivityTransition(currentGrow || {}, patch || {});
    if (transition.reactivating) {
      assertGrowCapacity({ requestedCount: 1, action: "reactivate" });
    }
    return transition;
  };

  const getGrowReactivationTransitions = (updates = []) => {
    const currentGrows = Array.isArray(rawGrows) ? rawGrows : [];

    return (Array.isArray(updates) ? updates : []).map((update) => {
      const growId = update?.growId || update?.id;
      const currentGrow = currentGrows.find((grow) => grow.id === growId);
      const transition = getGrowActivityTransition(
        currentGrow || {},
        update?.patch || {}
      );

      return {
        growId,
        patch: update?.patch || {},
        transition,
      };
    });
  };

  const validateGrowReactivationBatch = (updates = []) => {
    const requestedCount = getGrowReactivationTransitions(updates).filter(
      ({ transition }) => transition.reactivating
    ).length;

    if (requestedCount > 0) {
      assertGrowCapacity({ requestedCount, action: "reactivate" });
    }

    return true;
  };

  const onReactivateGrowBatch = async (updates = []) => {
    if (!user) return null;

    const transitions = getGrowReactivationTransitions(updates);
    const requestedCount = transitions.filter(
      ({ transition }) => transition.reactivating
    ).length;

    if (requestedCount > 0) {
      assertGrowCapacity({ requestedCount, action: "reactivate" });
    }

    const result = await invokeTrustedGrowReactivationBatch(
      transitions.map(({ growId, patch }) => ({ growId, patch }))
    );

    const reactivated = transitions.filter(
      ({ transition }) => transition.reactivating
    ).length;
    const deactivated = transitions.filter(
      ({ transition }) => transition.deactivating
    ).length;

    activeGrowUsageRef.current = Math.max(
      0,
      activeGrowUsageRef.current + reactivated - deactivated
    );

    const nextById = new Map(
      transitions.map(({ growId, transition }) => [
        growId,
        transition.nextGrow,
      ])
    );

    setRawGrows((prev) =>
      (Array.isArray(prev) ? prev : []).map((grow) => {
        const nextGrow = nextById.get(grow.id);
        return nextGrow ? { ...nextGrow, id: grow.id } : grow;
      })
    );

    return result;
  };

  const writeGrowPatch = async (growId, patch, transition) => {
    if (transition?.reactivating) {
      return invokeTrustedGrowReactivationBatch([{ growId, patch }]);
    }

    return updateDoc(
      doc(db, "users", user.uid, "grows", growId),
      patch
    );
  };

  const onUpdateStage = async (growId, nextStage) => {
    if (!user) return;

    let currentGrow = undefined;
    try {
      const arr = Array.isArray(rawGrows) ? rawGrows : [];
      currentGrow = arr.find((x) => x.id === growId);
    } catch {}

    const isLocked = !!(
      currentGrow &&
      currentGrow.stageLocks &&
      currentGrow.stageLocks[nextStage]
    );
    const hasDate = !!(
      currentGrow &&
      currentGrow.stageDates &&
      currentGrow.stageDates[nextStage]
    );

    const todayLocal = new Date();
    const yyyy = todayLocal.getFullYear();
    const mm = String(todayLocal.getMonth() + 1).padStart(2, "0");
    const dd = String(todayLocal.getDate()).padStart(2, "0");
    const today = `${yyyy}-${mm}-${dd}`;

    const patch = { stage: nextStage };
    if (prefs.autoStampStageDates && !isLocked && !hasDate) {
      patch[`stageDates.${nextStage}`] = today;
    }

    const transition = assertGrowReactivationAllowed(currentGrow, patch);
    await writeGrowPatch(growId, patch, transition);

    if (transition.reactivating) activeGrowUsageRef.current += 1;
    if (transition.deactivating) {
      activeGrowUsageRef.current = Math.max(0, activeGrowUsageRef.current - 1);
    }

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
  };

  const onUpdateStageDate = async (growId, stage, dateISO) => {
    if (!user) return;
    const ref = doc(db, "users", user.uid, "grows", growId);
    const patch = {
      [`stageDates.${stage}`]: dateISO || null,
      [`stageLocks.${stage}`]: !!dateISO,
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
  };

  const onUpdateStatus = async (growId, status) => {
    if (!user) return;
    const currentGrow = (Array.isArray(rawGrows) ? rawGrows : []).find(
      (grow) => grow.id === growId
    );
    const patch = { status };
    const transition = assertGrowReactivationAllowed(currentGrow, patch);

    await writeGrowPatch(growId, patch, transition);

    if (transition.reactivating) activeGrowUsageRef.current += 1;
    if (transition.deactivating) {
      activeGrowUsageRef.current = Math.max(0, activeGrowUsageRef.current - 1);
    }

    setRawGrows((prev) =>
      (Array.isArray(prev) ? prev : []).map((g) => (g.id === growId ? { ...g, status } : g))
    );
  };

  const onUpdateGrow = async (growId, patch) => {
    if (!user || !growId || !patch) return;
    const currentGrow = (Array.isArray(rawGrows) ? rawGrows : []).find(
      (grow) => grow.id === growId
    );
    const transition = assertGrowReactivationAllowed(currentGrow, patch);

    await writeGrowPatch(growId, patch, transition);

    if (transition.reactivating) activeGrowUsageRef.current += 1;
    if (transition.deactivating) {
      activeGrowUsageRef.current = Math.max(0, activeGrowUsageRef.current - 1);
    }

    setRawGrows((prev) =>
      (Array.isArray(prev) ? prev : []).map((g) =>
        g.id === growId
          ? { ...g, ...transition.nextGrow, id: g.id }
          : g
      )
    );
  };

  const validateCreateGrowBatch = (payloads = []) => {
    const requestedCount = countRequestedActiveGrows(payloads);
    if (requestedCount <= 0) return true;
    assertGrowCapacity({ requestedCount, action: "create" });
    return true;
  };

  const onCreateGrowBatch = async (payloads = []) => {
    if (!user) return [];

    const list = Array.isArray(payloads) ? payloads : [payloads];
    const requestedCount = countRequestedActiveGrows(list);

    if (requestedCount > 0) {
      assertGrowCapacity({ requestedCount, action: "create" });
      pendingActiveGrowCreatesRef.current += requestedCount;
    }

    try {
      const growIds = await invokeTrustedGrowCreateBatch(list);

      if (requestedCount > 0) {
        activeGrowUsageRef.current += requestedCount;
      }

      setRawGrows((prev) => {
        const existing = Array.isArray(prev) ? prev : [];
        const next = [...existing];

        growIds.forEach((growId, index) => {
          if (!growId || next.some((grow) => grow.id === growId)) return;
          next.push({ id: growId, ...(list[index] || {}) });
        });

        return next;
      });

      return growIds;
    } finally {
      if (requestedCount > 0) {
        pendingActiveGrowCreatesRef.current = Math.max(
          0,
          pendingActiveGrowCreatesRef.current - requestedCount
        );
      }
    }
  };

  const onCreateGrow = async (payload) => {
    const growIds = await onCreateGrowBatch([payload]);
    return growIds[0] || null;
  };

  const requestNewGrow = (initialGrow = {}) => {
    setEditingGrow(initialGrow || {});
  };

  const onStartGrowFromSop = (template) => {
    if (!template) return false;
    if (
      !requestSubscriptionFeature({
        featureKey: SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS,
        actionLabel: "Start a new grow from an SOP template",
      })
    ) {
      return false;
    }

    const defaults = template.growDefaults || {};
    const type = defaults.type || template.category || "Agar";

    requestNewGrow({
      ...defaults,
      type,
      growType: type,
      stage: defaults.stage || "Inoculated",
      status: defaults.status || "Active",
      parentSource: "SOP",
      fromSopTemplate: true,
      sopTemplate: template,
      workflowTemplate: template,
    });
  };

  const onCreateTask = async (payload) => {
    if (user) await addDoc(collection(db, "users", user.uid, "tasks"), payload);
  };

  const onUpdateTask = async (id, patch) => {
    if (user) await updateDoc(doc(db, "users", user.uid, "tasks", id), patch);
  };

  useTaskReminders({
    tasks: Array.isArray(tasks) ? tasks : [],
    onUpdate: onUpdateTask,
    enabled: prefs.taskReminders !== false,
  });

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
      if (autoConvert) temperatureC = Math.round((((temperatureF - 32) * 5) / 9) * 10) / 10;
    } else if (hasC) {
      temperatureC = Number(extras.temperatureC);
      temperatureF = Math.round((((temperatureC * 9) / 5) + 32) * 10) / 10;
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
    await uploadGrowPhoto({
      db,
      storage,
      uid: user.uid,
      growId,
      file,
      caption,
      stage: null,
    });
  };

  const onUploadStagePhoto = async (growId, stage, file, caption) => {
    if (!user || !file) return;
    await uploadGrowPhoto({
      db,
      storage,
      uid: user.uid,
      growId,
      file,
      caption,
      stage: stage || "General",
    });
  };

  const onDeletePhoto = async (growId, photo) => {
    if (!user || !photo?.id) return null;
    return deleteGrowPhoto({
      db,
      storage,
      uid: user.uid,
      growId: growId || photo.growId || "",
      photo,
    });
  };

  const onSetCoverPhoto = async (growId, photo) => {
    if (!user || !growId || !photo?.id) return null;
    return setGrowCoverPhoto({
      db,
      uid: user.uid,
      growId,
      photo,
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

  const onUploadStrainImage = async (file, kind = "profile") => {
    if (!user || !file) return null;
    return await uploadStrainImageAsset({
      storage,
      uid: user.uid,
      file,
      kind,
    });
  };

  const savePrefs = async (next) => {
    const merged = normalizeAppPreferences(
      { ...prefs, ...next },
      { systemDark: systemPrefersDark() }
    );
    setPrefs(merged);
    applyAppearance(merged);

    if (!user) return merged;
    await setDoc(
      doc(db, "users", user.uid, "settings", "preferences"),
      buildPersistedAppPreferences(merged, {
        systemDark: systemPrefersDark(),
      }),
      { merge: true }
    );
    return merged;
  };

  const tabFallback = useMemo(() => {
    switch (activeTab) {
      case "analytics":
        return <AnalyticsSkeleton />;
      case "calendar":
        return <CalendarSkeleton />;
      case "settings":
        return <SettingsSkeleton />;
      case "admin":
        return <DashboardSkeleton />;
      default:
        return <DashboardSkeleton />;
    }
  }, [activeTab]);

  if (showSplash) return <SplashScreen />;
  if (!user) return <Auth setUser={setUser} />;

  const biometricUnlockRequired = Boolean(
    user?.uid &&
      isTauriMobileRuntime() &&
      isBiometricUnlockEnabled(user.uid) &&
      biometricGate.unlockedUid !== user.uid
  );

  if (biometricUnlockRequired) {
    return (
      <BiometricUnlockScreen
        email={user.email || ""}
        prompting={biometricGate.prompting}
        error={biometricGate.error}
        onRetry={() => runBiometricUnlock(user.uid)}
        onUseAccountSignIn={handleBiometricAccountFallback}
      />
    );
  }

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

      {isAddingNew && (
        <Modal open={true} onClose={() => setEditingGrow(null)} title="New Grow">
          <GrowForm
            editingGrow={editingGrow || {}}
            strains={Array.isArray(strains) ? strains : []}
            grows={grows}
            recipes={Array.isArray(recipes) ? recipes : []}
            supplies={Array.isArray(supplies) ? supplies : []}
            onCreateGrow={onCreateGrow}
            onCreateGrowBatch={onCreateGrowBatch}
            onValidateCreateBatch={validateCreateGrowBatch}
            onUpdateGrow={onUpdateGrow}
            canUseSopWorkflows={canUseSopWorkflows}
            canGenerateSopTasks={canGenerateSopTasks}
            onSubscriptionFeatureBlocked={requestSubscriptionFeature}
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
                onDeletePhoto={onDeletePhoto}
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
              onDeletePhoto={onDeletePhoto}
              onSetCoverPhoto={onSetCoverPhoto}
              canUsePostProcessing={subscription.hasFeature(
                SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING
              )}
              onSubscriptionFeatureBlocked={requestSubscriptionFeature}
            />
          }
        />

        <Route
          path="/"
          element={
            <div
              id="app-shell"
              className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-white"
            >
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
                <div className="flex flex-wrap gap-2 mb-4">
                  {[
                    ["dashboard", "Dashboard"],
                    ["tasks", "Tasks"],
                    ["analytics", "Analytics"],
                    ["calendar", "Calendar"],
                    ["timeline", "Timeline"],
                    ["postprocess", "Post Processing"],
                    ["cog", "COG"],
                    ["recipes", "Recipes"],
                    ["strains", "Strains"],
                    ["labels", "Labels"],
                    ["archive", "Archive"],
                    ...(adminAccess.authorized ? [["admin", "Admin"]] : []),
                    ["settings", "Settings"],
                  ].map(([key, label]) => {
                    const isActive = activeTab === key;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          if (key === "tasks") setSelectedCalendarTaskId("");
                          setActiveTab(key);
                        }}
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

                      <div
                        className="mb-4 flex flex-wrap items-center gap-2"
                        data-tour="stage-filters"
                      >
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

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            data-tour="new-grow"
                            className="chip chip--active text-sm"
                            onClick={() => requestNewGrow({})}
                          >
                            + New Grow
                          </button>
                          <span
                            className={`text-xs ${
                              activeGrowLimitState.reached
                                ? "font-semibold text-amber-700 dark:text-amber-300"
                                : "text-slate-500 dark:text-slate-400"
                            }`}
                            data-testid="active-grow-usage"
                          >
                            {activeGrowLimitState.usage} active grows · {activeGrowLimitState.unlimited
                              ? "Unlimited"
                              : `${activeGrowLimitState.limit} allowed`}
                          </span>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                          <GrowList
                            growsActive={activeGrowsBase}
                            archivedGrows={archivedGrowsBase}
                            recipes={Array.isArray(recipes) ? recipes : []}
                            supplies={Array.isArray(supplies) ? supplies : []}
                            setEditingGrow={(grow) =>
                              grow?.id ? setEditingGrow(grow) : requestNewGrow(grow || {})
                            }
                            showAddButton={false}
                            onUpdateStatus={onUpdateStatus}
                            onUpdateGrow={onUpdateGrow}
                            onValidateReactivationBatch={validateGrowReactivationBatch}
                            onReactivateGrowBatch={onReactivateGrowBatch}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {activeTab === "tasks" && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                      <TaskManager
                        tasks={Array.isArray(tasks) ? tasks : []}
                        grows={grows}
                        selectedTaskId={selectedCalendarTaskId}
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
                      canUseBasicAnalytics={subscription.hasFeature(
                        SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS
                      )}
                      canUseAdvancedAnalytics={subscription.hasFeature(
                        SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS
                      )}
                      canUseAdvancedCostAnalytics={subscription.hasFeature(
                        SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS
                      )}
                      canExportAnalytics={subscription.hasFeature(
                        SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS
                      )}
                      canUseLabAnalytics={subscription.hasFeature(
                        SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS
                      )}
                      onSubscriptionFeatureBlocked={requestSubscriptionFeature}
                    />
                  )}

                  {activeTab === "calendar" && (
                    <CalendarView
                      grows={grows}
                      tasks={Array.isArray(tasks) ? tasks : []}
                      onOpenTask={(task) => {
                        setSelectedCalendarTaskId(task?.id || "");
                        setActiveTab("tasks");
                      }}
                    />
                  )}

                  {activeTab === "timeline" && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                      <GrowTimeline
                        grows={grows}
                        onUpdateStage={onUpdateStage}
                        onUpdateStageDate={onUpdateStageDate}
                      />
                    </div>
                  )}

                  {activeTab === "postprocess" && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                      <PostProcessManager
                        grows={Array.isArray(grows) ? grows : []}
                        canUsePostProcessing={subscription.hasFeature(
                          SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING
                        )}
                        canUseFinishedInventory={subscription.hasFeature(
                          SUBSCRIPTION_FEATURE_KEYS.FINISHED_INVENTORY
                        )}
                        canCreatePackageRuns={subscription.hasFeature(
                          SUBSCRIPTION_FEATURE_KEYS.PACKAGE_RUNS
                        )}
                        canUsePostProcessLabels={subscription.hasFeature(
                          SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS
                        )}
                        canRecordSales={subscription.hasFeature(
                          SUBSCRIPTION_FEATURE_KEYS.SALES_TRACKING
                        )}
                        canUseFefoControls={subscription.hasFeature(
                          SUBSCRIPTION_FEATURE_KEYS.FEFO_CONTROLS
                        )}
                        canUseInventoryAuditHistory={subscription.hasFeature(
                          SUBSCRIPTION_FEATURE_KEYS.INVENTORY_AUDIT_HISTORY
                        )}
                        onSubscriptionFeatureBlocked={requestSubscriptionFeature}
                      />
                    </div>
                  )}

                  {activeTab === "cog" && (
                    <div
                      className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4"
                      data-tour="cog-root"
                    >
                      <COGManager />
                    </div>
                  )}

                  {activeTab === "recipes" && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                      <RecipeManager
                        onStartGrowFromTemplate={onStartGrowFromSop}
                        canUseSopWorkflows={canUseSopWorkflows}
                        canGenerateSopTasks={canGenerateSopTasks}
                        onSubscriptionFeatureBlocked={requestSubscriptionFeature}
                      />
                    </div>
                  )}

                  {activeTab === "strains" && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                      <StrainManager
                        strains={strains}
                        grows={grows}
                        onCreateStrain={onCreateStrain}
                        onUpdateStrain={onUpdateStrain}
                        onDeleteStrain={onDeleteStrain}
                        onUploadStrainImage={onUploadStrainImage}
                        setEditingGrow={(grow) =>
                          grow?.id ? setEditingGrow(grow) : requestNewGrow(grow || {})
                        }
                        openLibraryItemId={openLibraryItemId}
                        onConsumeOpenLibraryItem={consumeOpenLibraryItem}
                      />
                    </div>
                  )}

                  {activeTab === "labels" && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                      <LabelPrintWrapper
                        grows={grows}
                        prefs={prefs}
                        canUsePostProcessLabels={subscription.hasFeature(
                          SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS
                        )}
                        onSubscriptionFeatureBlocked={requestSubscriptionFeature}
                      />
                    </div>
                  )}

                  {activeTab === "archive" && (
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
                      <Archive grows={grows} onUpdateGrow={onUpdateGrow} />
                    </div>
                  )}

                  {activeTab === "admin" && adminAccess.authorized && (
                    <AdminDashboard />
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
                      activeGrowCount={activeGrowsBase.length}
                    />
                  )}
                </Suspense>

              </div>

              <FabQuickActions
                grows={activeGrowsBase}
                onNewGrow={() => requestNewGrow({})}
                onLogStatus={(id) => {
                  const g = activeGrowsBase.find((x) => x.id === id) || grows.find((x) => x.id === id);
                  if (g) setEditingGrow(g);
                }}
                onUploadPhoto={onUploadPhoto}
              />

              <LocalReminders grows={grows} prefs={prefs} />
            </div>
          }
        />

      </Routes>

      <ActiveGrowLimitNotice
        open={Boolean(growLimitNotice)}
        message={growLimitNotice?.message || ""}
        usage={growLimitNotice?.usage || 0}
        limit={growLimitNotice?.limit || 0}
        onClose={() => setGrowLimitNotice(null)}
        onViewPlans={() => {
          setGrowLimitNotice(null);
          setActiveTab("settings");
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("cn:settings-tab", {
                detail: { tab: "subscription" },
              })
            );
          }, 0);
        }}
      />

      <SubscriptionFeatureNotice
        open={Boolean(featureAccessNotice)}
        featureLabel={featureAccessNotice?.featureLabel || "Subscription feature"}
        minimumPlanLabel={featureAccessNotice?.minimumPlanLabel || "an eligible plan"}
        actionLabel={featureAccessNotice?.actionLabel || "Use this feature"}
        message={featureAccessNotice?.message || ""}
        supportingText={featureAccessNotice?.supportingText || ""}
        onClose={() => setFeatureAccessNotice(null)}
        onViewPlans={() => {
          setFeatureAccessNotice(null);
          setActiveTab("settings");
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("cn:settings-tab", {
                detail: { tab: "subscription" },
              })
            );
          }, 0);
        }}
      />

      <TrialExpirationNotice
        onViewPlans={() => {
          setActiveTab("settings");
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("cn:settings-tab", {
                detail: { tab: "subscription" },
              })
            );
          }, 0);
        }}
      />

      <WhatsNewNotice uid={user.uid} />

      <OnboardingCoach pageKey={activeTab} enabled={prefs.guideEnabled !== false} />
    </ConfirmProvider>
  );
}