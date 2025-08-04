import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext"; // ✅ import your auth context
>>>>>>> be7d1a18 (Initial commit with final polished version)
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider> {/* ✅ wrap App in AuthProvider */}
        <App />
      </AuthProvider>
    </BrowserRouter>
    <App />
>>>>>>> be7d1a18 (Initial commit with final polished version)
  </React.StrictMode>
);
