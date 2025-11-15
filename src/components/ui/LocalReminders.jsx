import React, { useEffect, useMemo, useRef } from "react";

/**
 * LocalReminders — lightweight, client-only reminders (desktop + Android)
 *
 * Triggers a notification at the daily digest time (prefs.taskDigestTime, "HH:MM")
 * when a grow hits its stage window based on prefs.stageMaxDays:
 *   - Inoculation:   (inoculationDate) + stageMaxDays.Inoculated days
 *   - Harvest:       (stageDates.Fruiting) + stageMaxDays.Fruiting days
 *
 * Enable with prefs.stageReminders = true.
 * De-duplication: localStorage key "remindersFired_v1".
 *
 * Extra: listen for CustomEvent("cn-test-reminder", {detail:{title,body}}) to fire a test toast.
 */
export default function LocalReminders({ grows = [], prefs = {} }) {
  const enabled = !!prefs?.stageReminders;
  const digest = String(prefs?.taskDigestTime || "09:00");
  const maxDays = prefs?.stageMaxDays || {};
  const firedKey = "remindersFired_v1";

  const firedRef = useRef(new Set());
  useEffect(() => {
    try {
      const arr = JSON.parse(localStorage.getItem(firedKey) || "[]");
      if (Array.isArray(arr)) firedRef.current = new Set(arr);
    } catch {}
  }, []);
  const persistFired = () => {
    try {
      localStorage.setItem(firedKey, JSON.stringify([...firedRef.current]));
    } catch {}
  };

  const notify = (title, body) => {
    const canNotify =
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted";

    const toast = (t, b) => {
      try {
        const host = document.createElement("div");
        host.style.position = "fixed";
        host.style.right = "16px";
        host.style.bottom = "16px";
        host.style.zIndex = "99999";
        host.innerHTML = `
          <div style="max-width:320px;padding:10px 12px;border-radius:12px;
                      background:#111827;color:white;font-size:13px;
                      box-shadow:0 10px 30px rgba(0,0,0,.3);">
            <div style="font-weight:600;margin-bottom:4px">${escapeHtml(t)}</div>
            <div>${escapeHtml(b)}</div>
          </div>`;
        document.body.appendChild(host);
        setTimeout(() => host.remove(), 4200);
      } catch {}
    };
    const escapeHtml = (s = "") =>
      String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    if (canNotify) {
      try {
        new Notification(title, { body });
        return;
      } catch {}
    }
    toast(title, body);
  };

  // Test hook: allows Settings button to trigger a reminder immediately
  useEffect(() => {
    const handler = (e) => {
      const { title = "Test reminder", body = "If you see this, reminders can display." } =
        (e && e.detail) || {};
      notify(title, body);
    };
    window.addEventListener("cn-test-reminder", handler);
    return () => window.removeEventListener("cn-test-reminder", handler);
  }, []);

  const targets = useMemo(() => {
    if (!enabled) return [];
    const list = [];

    const parseDate = (val) => {
      if (!val) return null;
      try {
        const s = String(val);
        const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
      } catch {
        return null;
      }
    };

    const addDays = (d, days) => {
      const dd = new Date(d);
      dd.setDate(dd.getDate() + Number(days || 0));
      return dd;
    };

    const atTime = (d, hhmm) => {
      const [h, m] = String(hhmm || "09:00").split(":").map((x) => Number(x || 0));
      const t = new Date(d);
      t.setHours(h || 0, m || 0, 0, 0);
      return t;
    };

    const mk = (type, grow, when) => {
      const id = `${type}:${grow.id}:${when.toISOString().slice(0, 16)}`; // minute precision
      list.push({
        id,
        timeMs: when.getTime(),
        title: type === "inoc" ? "Inoculation check due" : "Harvest window reached",
        body:
          type === "inoc"
            ? `${labelFor(grow)} — inoculation window hit. Review and update stage if needed.`
            : `${labelFor(grow)} — harvest window hit. Consider harvesting and updating status.`,
      });
    };

    const labelFor = (g) =>
      g.abbreviation || g.subName || g.strain || g.recipeName || g.id?.slice(0, 6) || "Grow";

    for (const g of Array.isArray(grows) ? grows : []) {
      const inocRaw = g.inoc || g.inoculationDate || g.createdAt;
      const inocDate = parseDate(inocRaw);
      const inocMax = Number(maxDays?.Inoculated);
      if (inocDate && Number.isFinite(inocMax) && inocMax > 0) {
        mk("inoc", g, atTime(addDays(inocDate, inocMax), digest));
      }

      const fruitRaw = g?.stageDates?.Fruiting || g?.stageDates?.fruiting;
      const fruitDate = parseDate(fruitRaw);
      const fruitMax = Number(maxDays?.Fruiting);
      if (fruitDate && Number.isFinite(fruitMax) && fruitMax > 0) {
        mk("harvest", g, atTime(addDays(fruitDate, fruitMax), digest));
      }
    }
    return list;
  }, [enabled, grows, digest, JSON.stringify(maxDays)]);

  // Ask for notification permission once when enabled
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      try {
        Notification.requestPermission().catch(() => {});
      } catch {}
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const now = Date.now();
      const windowMs = 24 * 60 * 60 * 1000; // fire if due within last 24h
      for (const t of targets) {
        if (!firedRef.current.has(t.id) && t.timeMs <= now && now - t.timeMs <= windowMs) {
          notify(t.title, t.body);
          firedRef.current.add(t.id);
        }
      }
      persistFired();
    };
    tick();
    const iv = setInterval(tick, 60 * 1000);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, targets]);

  return null;
}
