// src/pages/Auth.jsx
import React, { useEffect, useState } from "react";
import { auth } from "../firebase-config";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from "firebase/auth";

function BrandLogo() {
  const [src, setSrc] = useState("/app-logo.svg");
  const [showImg, setShowImg] = useState(true);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setShowImg(true);
    img.onerror = () => {
      const png = new Image();
      png.onload = () => {
        setSrc("/app-logo.png");
        setShowImg(true);
      };
      png.onerror = () => setShowImg(false);
      png.src = "/app-logo.png";
    };
    img.src = "/app-logo.svg";
  }, []);

  if (showImg) {
    return (
      <img
        src={src}
        alt="App Logo"
        className="w-20 h-20 object-contain drop-shadow mx-auto"
        draggable="false"
      />
    );
  }
  // Fallback minimal SVG (theme-accent aware)
  return (
    <svg
      width="80"
      height="80"
      viewBox="0 0 84 84"
      aria-hidden
      className="drop-shadow mx-auto"
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
    </svg>
  );
}

export default function Auth() {
  const [mode, setMode] = useState("signin"); // signin | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const setAndClearError = (e) => {
    setErr(e?.message || String(e) || "Something went wrong.");
    setBusy(false);
  };

  const signIn = async () => {
    setBusy(true);
    setErr("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      setAndClearError(e);
    } finally {
      setBusy(false);
    }
  };

  const signUp = async () => {
    setBusy(true);
    setErr("");
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      setAndClearError(e);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setErr("");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMode("signin");
      alert("Password reset email sent (if the address exists).");
    } catch (e) {
      setAndClearError(e);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setErr("");
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      setAndClearError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-white px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow border border-zinc-200 dark:border-zinc-800 p-6">
          <div className="flex flex-col items-center gap-3 mb-4">
            <BrandLogo />
            <h1 className="text-xl font-semibold">Mushroom Tracker</h1>
          </div>

          {err && (
            <div className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</div>
          )}

          {mode !== "reset" && (
            <>
              <label className="block mb-3 text-sm">
                <div className="mb-1 opacity-80">Email</div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
                  autoComplete="email"
                />
              </label>
              <label className="block mb-4 text-sm">
                <div className="mb-1 opacity-80">Password</div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                />
              </label>

              {mode === "signin" ? (
                <button
                  onClick={signIn}
                  disabled={busy}
                  className="w-full px-4 py-2 rounded-lg accent-bg disabled:opacity-60"
                >
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              ) : (
                <button
                  onClick={signUp}
                  disabled={busy}
                  className="w-full px-4 py-2 rounded-lg accent-bg disabled:opacity-60"
                >
                  {busy ? "Creating account…" : "Create account"}
                </button>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                  className="px-3 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm"
                  disabled={busy}
                >
                  {mode === "signin" ? "Need an account?" : "Have an account?"}
                </button>
                <button
                  onClick={() => setMode("reset")}
                  className="px-3 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm"
                  disabled={busy}
                >
                  Forgot password
                </button>
              </div>

              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                <div className="text-xs opacity-60">or</div>
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>

              <button
                onClick={google}
                disabled={busy}
                className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm disabled:opacity-60"
              >
                Continue with Google
              </button>
            </>
          )}

          {mode === "reset" && (
            <>
              <label className="block mb-4 text-sm">
                <div className="mb-1 opacity-80">Email</div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
                  autoComplete="email"
                />
              </label>
              <button
                onClick={reset}
                disabled={busy}
                className="w-full px-4 py-2 rounded-lg accent-bg disabled:opacity-60"
              >
                {busy ? "Sending…" : "Send reset link"}
              </button>
              <button
                onClick={() => setMode("signin")}
                className="mt-3 w-full px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm"
                disabled={busy}
              >
                Back to sign in
              </button>
            </>
          )}
        </div>

        <div className="text-center text-xs opacity-60 mt-4">
          © {new Date().getFullYear()} Mushroom Tracker
        </div>
      </div>
    </div>
  );
}
