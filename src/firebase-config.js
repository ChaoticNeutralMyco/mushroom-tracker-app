// src/firebase-config.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  connectAuthEmulator,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

/**
 * Your Firebase project config (kept exactly as provided).
 * If you ever rotate keys or switch projects, update only this object.
 */
const firebaseConfig = {
  apiKey: "AIzaSyAk1paC3CBjU1RH2cXf_8m6xOnZkH_xYWg",
  authDomain: "chaotic-neutral-tracker.firebaseapp.com",
  projectId: "chaotic-neutral-tracker",
  storageBucket: "chaotic-neutral-tracker.appspot.com",
  messagingSenderId: "84127636935",
  appId: "1:84127636935:web:fba76e7b8574177e928de2",
  measurementId: "G-2XF59QB1M4",
};

// ---- Initialize core SDKs ----
export const app = initializeApp(firebaseConfig);

// Persist login across refreshes
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {
  // Non-fatal (incognito or browser restrictions)
});

// Firestore with the modern persistent cache + multi-tab coordination
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Storage
export const storage = getStorage(app);

// ---- Optional: Local emulators for dev ----
// To use, set VITE_USE_FIREBASE_EMULATORS=true in your .env.local (dev only).
if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
  try {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    // console.info("[Firebase] Connected to local emulators.");
  } catch {
    // Safe to ignore if emulators aren't running
  }
}
