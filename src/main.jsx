// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

// PWA: register service worker (works in Vercel; harmless in Tauri)
import { registerSW } from "virtual:pwa-register";

// auto-update SW and prompt to refresh when a new version is available
registerSW({
  immediate: true,
  onNeedRefresh() {
    const ok = window.confirm("An update is available. Refresh now?");
    if (ok) window.location.reload();
  },
  onOfflineReady() {
    console.log("[PWA] App ready to work offline");
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
