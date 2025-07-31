import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAfp9ikhNVQr0veqN_p6URU43-CI8c9mzA",
  authDomain: "mushroomtracker-934e2.firebaseapp.com",
  projectId: "mushroomtracker-934e2",
  storageBucket: "mushroomtracker-934e2.firebasestorage.app",
  messagingSenderId: "503879598464",
  appId: "1:503879598464:web:3964b728ca5e970adb8165"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
