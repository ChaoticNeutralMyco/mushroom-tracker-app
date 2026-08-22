// src/firebase-config.js
import { initializeApp, getApps } from "firebase/app";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
} from "firebase/firestore";
import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  connectAuthEmulator,
} from "firebase/auth";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import {
  connectFunctionsEmulator,
  getFunctions,
} from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// --- helpers
const bool = (v) => ["1", "true", "yes"].includes(String(v ?? "").toLowerCase());
const num = (v, d) => Number(v ?? d);

// --- env & defaults (prod project values are safe fallbacks)
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || "chaotic-neutral-tracker";
const storageBucket =
  import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "chaotic-neutral-tracker.firebasestorage.app";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAk1paC3CBjU1RH2cXf_8m6xOnZkH_xYWg",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:84127636935:web:fba76e7b8574177e928de2",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "84127636935",
};

// Initialize exactly once.
const app = getApps()[0] || initializeApp(firebaseConfig);

// Configure local persistence during Auth initialization so sign-in and reloads
// cannot race an unawaited setPersistence() call. Hot reload or another module
// may already have initialized Auth, so fall back to the existing instance.
let auth;
try {
  auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
  });
} catch {
  auth = getAuth(app);
}

// E2E helpers may await this before saving/restoring browser state. Runtime
// components can continue using auth normally.
const authReady =
  typeof auth.authStateReady === "function"
    ? auth.authStateReady().catch(() => undefined)
    : Promise.resolve();

// Firestore (offline-first) + optional emulator. A Vite source-module import
// used by browser tests can evaluate this file after the app bundle has already
// initialized Firestore. Reuse that existing instance instead of attempting to
// initialize the same Firebase app with a second set of options.
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });
} catch (error) {
  const message = String(error?.message || error || "");
  if (/initializeFirestore\(\) has already been called/i.test(message)) {
    db = getFirestore(app);
  } else {
    throw error;
  }
}

// Storage + Functions + optional emulators
const storage = getStorage(app);
const functions = getFunctions(app, "us-central1");

// App Check (optional; only if you provide a key)
const APP_CHECK_PUBLIC_KEY = import.meta.env.VITE_FIREBASE_APPCHECK_KEY;
if (APP_CHECK_PUBLIC_KEY) {
  if (import.meta.env.DEV && bool(import.meta.env.VITE_APPCHECK_DEBUG)) {
    // eslint-disable-next-line no-undef
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.log("[app-check] DEBUG token enabled");
  }

  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_PUBLIC_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

// Emulators (only when explicitly enabled)
const useEmu = bool(import.meta.env.VITE_USE_FIREBASE_EMULATORS);
const useAuthEmu = useEmu && bool(import.meta.env.VITE_USE_AUTH_EMULATOR);
const useFunctionsEmu =
  import.meta.env.DEV && bool(import.meta.env.VITE_USE_FUNCTIONS_EMULATOR);
const functionsEmulatorPort = num(
  import.meta.env.VITE_EMULATOR_FUNCTIONS_PORT,
  5001
);
const emulatorHost = "127.0.0.1";

if (useEmu) {
  const fsPort = num(import.meta.env.VITE_EMULATOR_FIRESTORE_PORT, 8080);
  const stPort = num(import.meta.env.VITE_EMULATOR_STORAGE_PORT, 9199);
  const authPort = num(import.meta.env.VITE_EMULATOR_AUTH_PORT, 9099);

  connectFirestoreEmulator(db, emulatorHost, fsPort);
  connectStorageEmulator(storage, emulatorHost, stPort);

  if (useAuthEmu) {
    connectAuthEmulator(auth, `http://${emulatorHost}:${authPort}`, {
      disableWarnings: true,
    });
  }
}

if (useFunctionsEmu) {
  try {
    connectFunctionsEmulator(
      functions,
      emulatorHost,
      functionsEmulatorPort
    );
  } catch {
    // HMR or another module may already have connected this shared instance.
  }
}


// Development-only bridge for Playwright helpers. It reads the already-running
// Firebase instances from this module, so tests never re-import this source file
// just to obtain an ID token and accidentally initialize Firestore twice.
async function waitForAuthenticatedUser(timeoutMs = 30_000) {
  await authReady;
  if (auth.currentUser) return auth.currentUser;

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};

    const finish = (user) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      resolve(user || null);
    };

    const timeout = setTimeout(() => finish(null), timeoutMs);
    const stopObserving = auth.onAuthStateChanged((user) => {
      if (user) finish(user);
    });

    unsubscribe = stopObserving;
    if (settled) unsubscribe();
  });
}

if (import.meta.env.DEV && typeof globalThis !== "undefined") {
  globalThis.__CNM_FUNCTIONS_E2E__ = Object.freeze({
    connected: useFunctionsEmu,
    host: useFunctionsEmu ? emulatorHost : "",
    port: useFunctionsEmu ? functionsEmulatorPort : null,
  });

  Object.defineProperty(globalThis, "__CNM_FIREBASE_E2E__", {
    configurable: true,
    value: Object.freeze({
      async getAuthSession() {
        const currentUser = await waitForAuthenticatedUser();
        if (!currentUser) return null;

        return {
          userId: currentUser.uid,
          idToken: await currentUser.getIdToken(),
          projectId: app.options?.projectId || projectId,
          apiKey: app.options?.apiKey || firebaseConfig.apiKey,
        };
      },
    }),
  });
}

if (import.meta.env.DEV) {
  console.log(
    `[firebase] FS=${useEmu ? "emu" : "prod"} ST=${useEmu ? "emu" : "prod"} AUTH=${useAuthEmu ? "emu" : "prod"} FN=${useFunctionsEmu ? "emu" : "prod"} bucket=${storageBucket}`
  );
}

export { app, auth, authReady, db, functions, storage };
