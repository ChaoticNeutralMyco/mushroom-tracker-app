// src/hooks/useTaskReminders.js
import { useEffect, useRef } from "react";

/**
 * Periodically scans tasks and fires a browser notification when a task is
 * within its reminder window or overdue. It also writes back lastNotifiedAt
 * so we don't spam.
 *
 * Usage: useTaskReminders({ tasks, onUpdate })
 */
export default function useTaskReminders({ tasks = [], onUpdate, intervalMs = 30000 }) {
  const timerRef = useRef(null);

  useEffect(() => {
    // Ask once for permission (best-effort)
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        try {
          Notification.requestPermission().catch(() => {});
        } catch {}
      }
    }
  }, []);

  useEffect(() => {
    if (!onUpdate) return;

    const tick = () => {
      const now = Date.now();

      tasks.forEach((t) => {
        if (!t || t.completedAt || !t.dueAt) return;

        const due = new Date(t.dueAt).getTime();
        const leadMin = typeof t.remindLead === "number" ? Math.max(0, t.remindLead) : null;
        const triggerAt = leadMin != null ? due - leadMin * 60000 : due;

        const last = t.lastNotifiedAt ? new Date(t.lastNotifiedAt).getTime() : 0;

        // Fire when we pass triggerAt; throttle repeat notification for 5 minutes
        const shouldNotify = now >= triggerAt && now - last >= 5 * 60 * 1000;

        if (shouldNotify) {
          // Try Notification API
          let shown = false;
          try {
            if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
              const bodyParts = [];
              if (t.growName || t.growId) bodyParts.push(`Grow: ${t.growName || t.growId}`);
              if (t.dueAt) bodyParts.push(`Due: ${new Date(t.dueAt).toLocaleString()}`);
              const body = bodyParts.join("\n");

              new Notification(t.title || "Task reminder", { body });
              shown = true;
            }
          } catch {}

          // Fallback: attention via title blink
          if (!shown && typeof document !== "undefined") {
            const orig = document.title;
            document.title = `🔔 ${t.title || "Task reminder"} — ${orig}`;
            setTimeout(() => (document.title = orig), 2500);
          }

          // Mark as notified
          onUpdate(t.id, { lastNotifiedAt: new Date().toISOString() });
        }
      });
    };

    // immediate + interval
    tick();
    clearInterval(timerRef.current);
    timerRef.current = setInterval(tick, intervalMs);

    return () => {
      clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [tasks, onUpdate, intervalMs]);
}
