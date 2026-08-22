// src/hooks/useTaskReminders.js
import { useEffect, useRef } from "react";
import { deliverLocalReminder, getTaskReminderState } from "../lib/reminder-utils";

/**
 * Runs task reminders while the app is open.
 *
 * Notification permission is intentionally managed from Settings so the app
 * does not prompt from multiple components. Each task reminder is written with
 * a stable lastNotifiedKey so an overdue task is not repeated every few minutes.
 */
export default function useTaskReminders({
  tasks = [],
  onUpdate,
  enabled = true,
  intervalMs = 60_000,
}) {
  const timerRef = useRef(null);
  const onUpdateRef = useRef(onUpdate);
  const deliveredThisSessionRef = useRef(new Set());

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!enabled || typeof onUpdateRef.current !== "function") return undefined;

    const tick = () => {
      const now = Date.now();

      for (const task of Array.isArray(tasks) ? tasks : []) {
        const state = getTaskReminderState(task, now);
        if (!state?.shouldNotify || deliveredThisSessionRef.current.has(state.key)) continue;
        if (!task?.id) continue;

        deliveredThisSessionRef.current.add(state.key);

        const bodyParts = [];
        if (task.growName || task.growId) {
          bodyParts.push(`Grow: ${task.growName || task.growId}`);
        }
        bodyParts.push(`Due: ${new Date(state.dueMs).toLocaleString()}`);

        deliverLocalReminder(task.title || "Task reminder", bodyParts.join("\n"));

        const patch = {
          lastNotifiedAt: new Date(now).toISOString(),
          lastNotifiedKey: state.key,
        };

        try {
          const result = onUpdateRef.current(task.id, patch);
          if (result && typeof result.catch === "function") {
            result.catch(() => {
              // Keep the session key so a failed write cannot spam repeatedly.
            });
          }
        } catch {
          // Keep the session key so a failed write cannot spam repeatedly.
        }
      }
    };

    tick();
    timerRef.current = window.setInterval(tick, Math.max(10_000, Number(intervalMs) || 60_000));

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs, tasks]);
}
