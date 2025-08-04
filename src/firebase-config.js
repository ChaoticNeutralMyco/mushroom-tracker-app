// src/firebase-config.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAk1paC3CBjU1RH2cXf_8m6xOnZkH_xYWg",
  authDomain: "chaotic-neutral-tracker.firebaseapp.com",
  projectId: "chaotic-neutral-tracker",
  storageBucket: "chaotic-neutral-tracker.appspot.com",
  messagingSenderId: "84127636935",
  appId: "1:84127636935:web:fba76e7b8574177e928de2",
  measurementId: "G-2XF59QB1M4",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
