// src/components/SplashScreen.jsx
import React from "react";

const SplashScreen = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="text-center animate-fade-in">
        <img
          src="/splash-logo.png"
          alt="Chaotic Mycology Logo"
          className="w-48 h-48 mx-auto mb-4 drop-shadow-lg"
        />
        <h1 className="text-2xl font-bold tracking-wide">Chaotic Mycology</h1>
        <p className="text-sm text-gray-300 mt-2">Loading your mushroom dashboard...</p>
      </div>
    </div>
  );
};

export default SplashScreen;
