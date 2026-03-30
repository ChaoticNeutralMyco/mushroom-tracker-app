// src/pages/Auth.jsx
import React, { useEffect, useMemo, useState } from "react";
import { auth } from "../firebase-config";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
} from "firebase/auth";
import { Eye, EyeOff, Mail, Lock, KeyRound } from "lucide-react";

function friendlyAuthError(error) {
  const code = String(error?.code || "").toLowerCase();
  if (!code) return error?.message || "Something went wrong.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("missing-password")) return "Enter your password.";
  if (code.includes("missing-email")) return "Enter your email address.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Email or password is incorrect.";
  }
  if (code.includes("email-already-in-use")) return "That email is already being used.";
  if (code.includes("weak-password")) return "Use a stronger password with at least 6 characters.";
  if (code.includes("too-many-requests")) {
    return "Too many attempts right now. Wait a bit and try again.";
  }
  return error?.message || "Something went wrong.";
}

function BrandLogo() {
  const [src, setSrc] = useState("/pwa-192.png");
  const [showImg, setShowImg] = useState(true);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setSrc("/pwa-192.png");
      setShowImg(true);
    };
    img.onerror = () => {
      const png = new Image();
      png.onload = () => {
        setSrc("/pwa-192.png");
        setShowImg(true);
      };
      png.onerror = () => setShowImg(false);
      png.src = "/pwa-192.png";
    };
    img.src = "/pwa-192.png";
  }, []);

  if (showImg) {
    return (
      <img
        src={src}
        alt="Chaotic Neutral Mycology"
        className="w-20 h-20 object-contain drop-shadow mx-auto rounded-full bg-zinc-900"
        draggable="false"
      />
    );
  }

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
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const emailTrimmed = useMemo(() => email.trim(), [email]);
  const passwordTrimmed = useMemo(() => String(password || ""), [password]);

  const clearState = () => {
    setErr("");
    setNotice("");
  };

  const setAndClearError = (error) => {
    setErr(friendlyAuthError(error));
    setNotice("");
  };

  const signIn = async () => {
    if (!emailTrimmed) {
      setErr("Enter your email address.");
      return;
    }
    if (!passwordTrimmed) {
      setErr("Enter your password.");
      return;
    }

    setBusy(true);
    clearState();
    try {
      await signInWithEmailAndPassword(auth, emailTrimmed, passwordTrimmed);
    } catch (error) {
      setAndClearError(error);
    } finally {
      setBusy(false);
    }
  };

  const signUp = async () => {
    if (!emailTrimmed) {
      setErr("Enter your email address.");
      return;
    }
    if (!passwordTrimmed) {
      setErr("Create a password.");
      return;
    }

    setBusy(true);
    clearState();
    try {
      await createUserWithEmailAndPassword(auth, emailTrimmed, passwordTrimmed);
    } catch (error) {
      setAndClearError(error);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!emailTrimmed) {
      setErr("Enter the email address for your account first.");
      return;
    }

    setBusy(true);
    clearState();
    try {
      await sendPasswordResetEmail(auth, emailTrimmed);
      setMode("signin");
      setNotice("Reset link sent. Check your email inbox and spam folder.");
    } catch (error) {
      setAndClearError(error);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    clearState();
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      setAndClearError(error);
    } finally {
      setBusy(false);
    }
  };

  const handlePrimarySubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (mode === "signin") {
      await signIn();
      return;
    }
    await signUp();
  };

  const handleResetSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    await reset();
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setErr("");
    setNotice("");
    if (nextMode !== "reset") setShowPassword(false);
  };

  return (
    <div className="min-h-screen grid place-items-center bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-white px-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow border border-zinc-200 dark:border-zinc-800 p-6">
          <div className="flex flex-col items-center gap-3 mb-4">
            <BrandLogo />
            <h1 className="text-xl font-semibold">Mushroom Tracker</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center">
              Sign in faster with Enter, preview your password when needed, and reset access without leaving the page.
            </p>
          </div>

          {err ? (
            <div className="mb-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          {notice ? (
            <div className="mb-3 rounded-lg border border-[rgba(var(--_accent-rgb),0.35)] bg-[rgba(var(--_accent-rgb),0.10)] px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100">
              {notice}
            </div>
          ) : null}

          {mode !== "reset" ? (
            <form onSubmit={handlePrimarySubmit} className="space-y-4">
              <label className="block text-sm">
                <div className="mb-1 opacity-80 flex items-center gap-2">
                  <Mail size={14} />
                  <span>Email</span>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
                  autoComplete="email"
                  autoFocus
                />
              </label>

              <label className="block text-sm">
                <div className="mb-1 opacity-80 flex items-center gap-2">
                  <Lock size={14} />
                  <span>Password</span>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 pr-12"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 px-3 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>

              <button
                type="submit"
                disabled={busy}
                className="w-full px-4 py-2 rounded-lg accent-bg disabled:opacity-60"
              >
                {mode === "signin"
                  ? busy
                    ? "Signing in…"
                    : "Sign in"
                  : busy
                    ? "Creating account…"
                    : "Create account"}
              </button>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
                  className="px-3 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm"
                  disabled={busy}
                >
                  {mode === "signin" ? "Need an account?" : "Have an account?"}
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("reset")}
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
                type="button"
                onClick={google}
                disabled={busy}
                className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm disabled:opacity-60"
              >
                Continue with Google
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 p-3 text-sm text-zinc-600 dark:text-zinc-300">
                Enter your email and press Enter or click the button below. We will send a reset link for that account.
              </div>

              <label className="block text-sm">
                <div className="mb-1 opacity-80 flex items-center gap-2">
                  <KeyRound size={14} />
                  <span>Email for reset</span>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2"
                  autoComplete="email"
                  autoFocus
                />
              </label>

              <button
                type="submit"
                disabled={busy}
                className="w-full px-4 py-2 rounded-lg accent-bg disabled:opacity-60"
              >
                {busy ? "Sending…" : "Send reset link"}
              </button>

              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="w-full px-4 py-2 rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-sm"
                disabled={busy}
              >
                Back to sign in
              </button>
            </form>
          )}
        </div>

        <div className="text-center text-xs opacity-60 mt-4">
          © {new Date().getFullYear()} Mushroom Tracker
        </div>
      </div>
    </div>
  );
}
