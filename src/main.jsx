// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App.jsx";
import QueryProvider from "./providers/QueryProvider.jsx";
import { SubscriptionProvider } from "./providers/SubscriptionProvider.jsx";
import "./index.css";

const rootEl = document.getElementById("root");

if (!rootEl) {
  throw new Error("Missing <div id='root'> in index.html");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryProvider>
        <SubscriptionProvider>
          <App />
        </SubscriptionProvider>
      </QueryProvider>
    </BrowserRouter>
  </React.StrictMode>
);