import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App.jsx";
import QueryProvider from "./providers/QueryProvider.jsx";
// If you have global styles, keep this import:
import "./index.css";

const Router = import.meta.env.DEV ? BrowserRouter : HashRouter;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing <div id='root'> in index.html");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Router>
      <QueryProvider>
        <App />
      </QueryProvider>
    </Router>
  </React.StrictMode>
);
