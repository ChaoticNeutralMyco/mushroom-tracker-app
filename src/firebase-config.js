// src/firebase-config.js
<<<<<<< HEAD
import { initializeApp } from "firebase/app";
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

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
=======
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Your Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyAk1paC3CBjU1RH2cXf_8m6xOnZkH_xYWg',
  authDomain: 'chaotic-neutral-tracker.firebaseapp.com',
  projectId: 'chaotic-neutral-tracker',
  storageBucket: 'chaotic-neutral-tracker.firebasestorage.app',
  messagingSenderId: '84127636935',
  appId: '1:84127636935:web:fba76e7b8574177e928de2',
  measurementId: 'G-2XF59QB1M4',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ✅ New recommended Firestore setup with persistence
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const auth = getAuth(app);
const storage = getStorage(app);

export { db, auth, storage };
>>>>>>> be7d1a18 (Initial commit with final polished version)
