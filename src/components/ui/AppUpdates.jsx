// src/components/ui/AppUpdates.jsx
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { APP_VERSION } from "../../lib/whatsNew.js";
import { ANDROID_RELEASE_API, androidReleaseUpdate, webReleaseUpdate } from "../../lib/appUpdates.js";

const NativeUpdater = registerPlugin("MycoUpdater");
const UpdateContext = createContext(null);
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const platform = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
  ? "android" : typeof window !== "undefined" && window.__TAURI__?.core?.invoke ? "desktop" : "web";
const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "omit", signal: controller.signal });
    if (!response.ok) throw new Error(`Update service returned HTTP ${response.status}.`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export function AppUpdateProvider({ children }) {
  const [status, setStatus] = useState("idle");
  const [update, setUpdate] = useState(null);
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState("");
  const busy = useRef(false);
  const lastCheck = useRef(0);
  const check = useCallback(async () => {
    if (busy.current) return;
    if (import.meta.env.DEV) { setStatus("disabled"); setMessage("Update checks are disabled in development builds."); return; }
    busy.current = true;
    lastCheck.current = Date.now();
    setStatus("checking"); setMessage(""); setUpdate(null);
    try {
      let result;
      if (platform === "desktop") result = await invoke("myco_check_update");
      else if (platform === "android") result = androidReleaseUpdate(await getJson(ANDROID_RELEASE_API), APP_VERSION);
      else result = webReleaseUpdate(await getJson(`/app-version.json?t=${Date.now()}`), APP_VERSION);
      setUpdate(result || null);
      setStatus(result ? "available" : "current");
    } catch (error) {
      setStatus("error"); setMessage(typeof error === "string" ? error : error?.message || "Could not check for updates.");
    } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const timer = setTimeout(check, 1500);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheck.current >= CHECK_INTERVAL) check();
    };
    const interval = setInterval(onVisible, CHECK_INTERVAL);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => { clearTimeout(timer); clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", onVisible); };
  }, [check]);

  const install = useCallback(async () => {
    if (!update || busy.current) return;
    if (!window.confirm("Save any unfinished work before updating. Continue?")) return;
    busy.current = true; setStatus("installing"); setMessage("");
    try {
      if (platform === "web") { window.location.reload(); return; }
      if (platform === "android") {
        await NativeUpdater.openDownload({ url: update.url });
        setStatus("available"); setMessage("Open the downloaded APK and choose Update. Do not uninstall the existing app.");
      } else {
        await invoke("myco_install_update", { expectedVersion: update.version });
        setStatus("available"); setMessage("Follow the Windows installer prompts.");
      }
    } catch (error) { setStatus("error"); setMessage(typeof error === "string" ? error : error?.message || "Update could not be started."); }
    finally { busy.current = false; }
  }, [update]);
  const action = platform === "web" ? "Refresh to update" : platform === "android" ? "Download update" : "Download and install";
  return <UpdateContext.Provider value={{ status, update, message, check, install, action }}>
    {children}
    {status === "available" && update && dismissed !== update.version && (
      <aside role="status" className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-md rounded-xl border border-zinc-600 bg-zinc-900 p-3 text-white shadow-xl">
        <div className="flex flex-wrap items-center gap-2"><strong className="flex-1 text-sm">Myco Tracker {update.version} available</strong>
          <button type="button" className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-zinc-900" onClick={install}>{action}</button>
          <button type="button" className="rounded-lg border border-zinc-500 px-3 py-2 text-sm" onClick={() => setDismissed(update.version)}>Later</button>
        </div><p className="mt-1 text-xs text-zinc-300">Save your work before updating.</p>
      </aside>
    )}
  </UpdateContext.Provider>;
}

export function AppUpdatesPanel() {
  const state = useContext(UpdateContext);
  const { status, update, message, check, install, action } = state || { status: "idle" };
  const working = status === "checking" || status === "installing";
  return <section className="space-y-3" aria-label="Application updates">
    <h2 className="text-lg font-medium">Application Updates</h2>
    <p className="text-sm text-slate-500 dark:text-slate-400">Installed version: <strong>{APP_VERSION}</strong> · Automatic checks enabled in release builds.</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn" onClick={check} disabled={!state || working}>{status === "checking" ? "Checking…" : "Check for Updates"}</button>
      {update && <button type="button" className="btn" onClick={install} disabled={working}>{status === "installing" ? "Preparing update…" : action}</button>}
    </div>
    {status === "current" && <p role="status" className="text-sm">You’re on the latest published version.</p>}
    {update && <div className="rounded-lg border p-3 text-sm"><strong>Version {update.version} available</strong>{update.notes && <p className="mt-2 whitespace-pre-wrap break-words">{update.notes}</p>}<p className="mt-2">Save unfinished work before updating.{platform === "android" && " Android will ask you to confirm the in-place installation."}</p></div>}
    {message && <p role={status === "error" ? "alert" : "status"} className="text-sm break-words">{message}</p>}
  </section>;
}
