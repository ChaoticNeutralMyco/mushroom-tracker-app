// src/components/Layout.jsx
import React from "react";

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <header className="bg-purple-700 text-white p-4 flex justify-between items-center shadow-md">
        <h1 className="text-2xl font-bold">Chaotic Neutral Tracker</h1>
      </header>
      <main className="flex-1 p-4">{children}</main>
      <footer className="text-sm text-center py-2 opacity-60">
        &copy; {new Date().getFullYear()} Chaotic Neutral Mycology
      </footer>
    </div>
  );
}
