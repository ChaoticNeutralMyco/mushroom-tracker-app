// src/utils/storage.js

export function loadData(key, defaultValue = []) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (e) {
    console.error("Failed to load data:", e);
    return defaultValue;
  }
}

export function saveData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save data:", e);
  }
}
