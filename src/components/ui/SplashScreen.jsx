// src/components/ui/SplashScreen.jsx
import React, { useEffect, useState } from "react";
import "../../styles/theme.css";

/**
 * SplashScreen
 * - Looks for /app-logo.svg (or /app-logo.png) in /public.
 * - If not found, falls back to the built-in mushroom SVG.
 * - Theme-aware background and spinner.
 *
 * To customize: drop your logo in:
 *   public/app-logo.svg   (preferred)
 *   or public/app-logo.png
 * No code changes needed after that.
 */
export default function SplashScreen() {
  const [logoSrc, setLogoSrc] = useState("/app-logo.svg");
  const [showImg, setShowImg] = useState(true);

  // If the SVG 404s, try PNG; if that fails, use fallback SVG.
  useEffect(() => {
    const img = new Image();
    img.onload = () => setShowImg(true);
    img.onerror = () => {
      // try png
      const png = new Image();
      png.onload = () => {
        setLogoSrc("/app-logo.png");
        setShowImg(true);
      };
      png.onerror = () => setShowImg(false);
      png.src = "/app-logo.png";
    };
    img.src = "/app-logo.svg";
  }, []);

  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-white">
      <div className="flex flex-col items-center gap-5">
        {showImg ? (
          <img
            src={logoSrc}
            alt="App Logo"
            className="w-24 h-24 object-contain drop-shadow"
            draggable="false"
          />
        ) : (
          <FallbackMushroom />
        )}
        <div className="text-lg font-semibold tracking-tight">Mushroom Tracker</div>
        <div className="splash-spinner" />
      </div>
    </div>
  );
}

function FallbackMushroom() {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden className="drop-shadow">
      <defs>
        <linearGradient id="cap" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--accent-600)" />
          <stop offset="100%" stopColor="var(--accent-500)" />
        </linearGradient>
      </defs>
      <circle cx="42" cy="42" r="40" fill="none" stroke="rgba(0,0,0,.08)" strokeWidth="2"/>
      <path d="M12 36c3-12 17-20 30-20s27 8 30 20c-7 2-16 3-30 3S19 38 12 36z" fill="url(#cap)"/>
      <rect x="36" y="40" width="12" height="18" rx="5" fill="var(--accent-600)"/>
      <circle cx="32" cy="34" r="3" fill="#fff" opacity="0.8"/>
      <circle cx="50" cy="34" r="3" fill="#fff" opacity="0.8"/>
    </svg>
  );
}
