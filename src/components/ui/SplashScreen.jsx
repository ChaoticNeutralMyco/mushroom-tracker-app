// src/components/ui/SplashScreen.jsx
import React, { useEffect, useState } from "react";
import "../../styles/theme.css";

/**
 * SplashScreen
 * - Prefers the lightweight PWA icon (pwa-192.png) to keep first paint fast.
 * - Falls back to app-logo.svg or app-logo.png if present.
 * - If none are found, shows the built-in mushroom SVG.
 * - Theme-aware background.
 */
export default function SplashScreen() {
  const [logoUrl, setLogoUrl] = useState(null);

  useEffect(() => {
    const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
    const candidates = [
      `${base}pwa-192.png`,
      `${base}app-logo.svg`,
      `${base}app-logo.png`,
    ];

    const test = (url) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
      });

    (async () => {
      for (const u of candidates) {
        if (await test(u)) {
          setLogoUrl(u);
          return;
        }
      }
      setLogoUrl(null);
    })();
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-white text-black dark:bg-zinc-950 dark:text-white">
      <div className="flex flex-col items-center gap-5">
        <div className="rounded-3xl p-6 md:p-8 bg-white/70 dark:bg-black/30 shadow-lg ring-1 ring-black/5 dark:ring-white/10 backdrop-blur">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="App logo"
              width={96}
              height={96}
              className="block rounded-xl"
              decoding="async"
              loading="eager"
            />
          ) : (
            <MushroomMark />
          )}
        </div>

        <p className="text-sm opacity-70 select-none tracking-wide">
          Loading Myco Tracker…
        </p>
      </div>
    </div>
  );
}

function MushroomMark() {
  return (
    <svg
      width="96"
      height="96"
      viewBox="0 0 84 84"
      aria-hidden
      className="drop-shadow"
    >
      <defs>
        <linearGradient id="cap" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--accent-600)" />
          <stop offset="100%" stopColor="var(--accent-500)" />
        </linearGradient>
      </defs>
      <circle
        cx="42"
        cy="42"
        r="40"
        fill="none"
        stroke="rgba(0,0,0,.08)"
        strokeWidth="2"
      />
      <path
        d="M12 36c3-12 17-20 30-20s27 8 30 20c-7 2-16 3-30 3S19 38 12 36z"
        fill="url(#cap)"
      />
      <rect x="36" y="40" width="12" height="18" rx="5" fill="var(--accent-600)" />
      <circle cx="32" cy="34" r="3" fill="#fff" opacity="0.8" />
      <circle cx="50" cy="34" r="3" fill="#fff" opacity="0.8" />
    </svg>
  );
}
