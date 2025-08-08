// firebase-config.js
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBMQ_YbOAhFwpcoiFSjYJ7-41V7kF2wQZE",
  authDomain: "mushroom-tracker-4e803.firebaseapp.com",
  projectId: "mushroom-tracker-4e803",
  storageBucket: "mushroom-tracker-4e803.firebasestorage.app",
  messagingSenderId: "488700332455",
  appId: "1:488700332455:web:822717d20f7211c9100e82"
};

// 🛡️ Prevent duplicate app initialization
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
