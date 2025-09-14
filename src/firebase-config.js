// src/firebase-config.js
import { initializeApp } from "firebase/app";
import {
  getAuth, setPersistence, browserLocalPersistence, connectAuthEmulator,
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const env = import.meta.env;
const read = (primary, alt) => env[primary] ?? env[alt] ?? "";

const firebaseConfig = {
  apiKey:             read("VITE_FIREBASE_API_KEY",            "VITE_FB_API_KEY"),
  authDomain:         read("VITE_FIREBASE_AUTH_DOMAIN",        "VITE_FB_AUTH_DOMAIN"),
  projectId:          read("VITE_FIREBASE_PROJECT_ID",         "VITE_FB_PROJECT_ID"),
  storageBucket:      read("VITE_FIREBASE_STORAGE_BUCKET",     "VITE_FB_STORAGE_BUCKET"),
  messagingSenderId:  read("VITE_FIREBASE_MESSAGING_SENDER_ID","VITE_FB_MESSAGING_SENDER_ID"),
  appId:              read("VITE_FIREBASE_APP_ID",             "VITE_FB_APP_ID"),
  measurementId:      env.VITE_FIREBASE_MEASUREMENT_ID ?? env.VITE_FB_MEASUREMENT_ID,
};

if (import.meta.env.DEV) {
  const required = [
    ["VITE_FIREBASE_API_KEY","VITE_FB_API_KEY"],
    ["VITE_FIREBASE_AUTH_DOMAIN","VITE_FB_AUTH_DOMAIN"],
    ["VITE_FIREBASE_PROJECT_ID","VITE_FB_PROJECT_ID"],
    ["VITE_FIREBASE_STORAGE_BUCKET","VITE_FB_STORAGE_BUCKET"],
    ["VITE_FIREBASE_MESSAGING_SENDER_ID","VITE_FB_MESSAGING_SENDER_ID"],
    ["VITE_FIREBASE_APP_ID","VITE_FB_APP_ID"],
  ];
  const missing = required.filter(([a,b]) => !env[a] && !env[b]).map(([a,b]) => `${a} or ${b}`);
  if (missing.length) console.warn("[firebase-config] Missing env:", missing.join(", "));
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(app);

if (import.meta.env.DEV && env.VITE_USE_FIREBASE_EMULATORS === "true") {
  try {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  } catch {}
}
