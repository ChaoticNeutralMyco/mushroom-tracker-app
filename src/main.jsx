// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import QueryProvider from "./providers/QueryProvider.jsx";
import "./index.css";

const rootEl = document.getElementById("root");

if (!rootEl) {
  throw new Error("Missing <div id='root'> in index.html");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryProvider>
        <App />
      </QueryProvider>
    </BrowserRouter>
  </React.StrictMode>
);