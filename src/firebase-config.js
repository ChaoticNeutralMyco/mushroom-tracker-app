// Single source of truth for Firebase initialization.
// Exports: app, auth, db, storage

import { initializeApp, getApps } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
} from "firebase/firestore";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  // connectAuthEmulator, // enable if you actually run auth emulator
} from "firebase/auth";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// --- helpers
const bool = (v) => ["1","true","yes"].includes(String(v ?? "").toLowerCase());
const num  = (v, d) => Number(v ?? d);

// --- env & defaults (prod project values are safe fallbacks)
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || "chaotic-neutral-tracker";
const storageBucket =
  import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "chaotic-neutral-tracker.firebasestorage.app";

const firebaseConfig = {
  apiKey:             import.meta.env.VITE_FIREBASE_API_KEY             || "AIzaSyAk1paC3CBjU1RH2cXf_8m6xOnZkH_xYWg",
  authDomain:         import.meta.env.VITE_FIREBASE_AUTH_DOMAIN         || `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket,
  appId:              import.meta.env.VITE_FIREBASE_APP_ID              || "1:84127636935:web:fba76e7b8574177e928de2",
  messagingSenderId:  import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "84127636935",
};

// Initialize exactly once
const app = getApps().length ? undefined : initializeApp(firebaseConfig);

// Auth (prod by default)
const auth = getAuth();
setPersistence(auth, browserLocalPersistence).catch(() =>
  setPersistence(auth, inMemoryPersistence)
);

// Firestore (offline-first) + optional emulator
const db = initializeFirestore(app || undefined, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});

// Storage + optional emulator
const storage = getStorage(app || undefined);

// App Check (optional; only if you provide a key)
const APP_CHECK_PUBLIC_KEY = import.meta.env.VITE_FIREBASE_APPCHECK_KEY;
if (APP_CHECK_PUBLIC_KEY) {
  if (import.meta.env.DEV && bool(import.meta.env.VITE_APPCHECK_DEBUG)) {
    // eslint-disable-next-line no-undef
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.log("[app-check] DEBUG token enabled");
  }
  initializeAppCheck(app || undefined, {
    provider: new ReCaptchaV3Provider(APP_CHECK_PUBLIC_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

// Emulators (only when explicitly enabled)
const useEmu = bool(import.meta.env.VITE_USE_FIREBASE_EMULATORS);
if (useEmu) {
  const host   = "127.0.0.1";
  const fsPort = num(import.meta.env.VITE_EMULATOR_FIRESTORE_PORT, 8080);
  const stPort = num(import.meta.env.VITE_EMULATOR_STORAGE_PORT, 9199);
  connectFirestoreEmulator(db, host, fsPort);
  connectStorageEmulator(storage, host, stPort);
  // connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
}

if (import.meta.env.DEV) {
  console.log(
    `[firebase] FS=${useEmu ? "emu" : "prod"} ST=${useEmu ? "emu" : "prod"} AUTH=prod bucket=${storageBucket}`
  );
}

export { app, auth, db, storage };
