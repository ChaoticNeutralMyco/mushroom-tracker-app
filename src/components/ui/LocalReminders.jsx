// src/components/ui/LocalReminders.jsx
import React, { useEffect, useMemo, useRef } from "react";
import { deliverLocalReminder } from "../../lib/reminder-utils";

/**
 * LocalReminders — lightweight, client-only grow-stage reminders.
 *
 * Triggers a reminder at prefs.stageReminderTime when a grow reaches its
 * configured stage window in prefs.stageMaxDays. Notification permission is
 * managed explicitly from Settings. When browser notifications are not
 * available, reminders fall back to an in-app toast.
 */
export default function LocalReminders({ grows = [], prefs = {} }) {
  const enabled = !!prefs?.stageReminders;
  const reminderTime = String(prefs?.stageReminderTime || prefs?.taskDigestTime || "09:00");
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

  useEffect(() => {
    const handler = (event) => {
      const { title = "Test reminder", body = "If you see this, reminders can display." } =
        event?.detail || {};
      deliverLocalReminder(title, body);
    };

    window.addEventListener("cn-test-reminder", handler);
    return () => window.removeEventListener("cn-test-reminder", handler);
  }, []);

  const targets = useMemo(() => {
    if (!enabled) return [];
    const list = [];

    const parseDate = (value) => {
      if (!value) return null;
      try {
        const stringValue = String(value);
        const date =
          stringValue.length === 10
            ? new Date(`${stringValue}T00:00:00`)
            : new Date(stringValue);
        return Number.isNaN(date.getTime()) ? null : date;
      } catch {
        return null;
      }
    };

    const addDays = (date, days) => {
      const next = new Date(date);
      next.setDate(next.getDate() + Number(days || 0));
      return next;
    };

    const atTime = (date, hhmm) => {
      const [hours, minutes] = String(hhmm || "09:00")
        .split(":")
        .map((value) => Number(value || 0));
      const next = new Date(date);
      next.setHours(hours || 0, minutes || 0, 0, 0);
      return next;
    };

    const labelFor = (grow) =>
      grow.abbreviation ||
      grow.subName ||
      grow.strain ||
      grow.recipeName ||
      grow.id?.slice(0, 6) ||
      "Grow";

    const addTarget = (type, grow, when) => {
      const id = `${type}:${grow.id}:${when.toISOString().slice(0, 16)}`;
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

    for (const grow of Array.isArray(grows) ? grows : []) {
      const inoculationDate = parseDate(grow.inoc || grow.inoculationDate || grow.createdAt);
      const inoculatedDays = Number(maxDays?.Inoculated);
      if (inoculationDate && Number.isFinite(inoculatedDays) && inoculatedDays > 0) {
        addTarget("inoc", grow, atTime(addDays(inoculationDate, inoculatedDays), reminderTime));
      }

      const fruitingDate = parseDate(grow?.stageDates?.Fruiting || grow?.stageDates?.fruiting);
      const fruitingDays = Number(maxDays?.Fruiting);
      if (fruitingDate && Number.isFinite(fruitingDays) && fruitingDays > 0) {
        addTarget("harvest", grow, atTime(addDays(fruitingDate, fruitingDays), reminderTime));
      }
    }

    return list;
  }, [enabled, grows, reminderTime, JSON.stringify(maxDays)]);

  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => {
      const now = Date.now();
      const recentWindowMs = 24 * 60 * 60 * 1000;

      for (const target of targets) {
        const isRecentlyDue = target.timeMs <= now && now - target.timeMs <= recentWindowMs;
        if (!firedRef.current.has(target.id) && isRecentlyDue) {
          deliverLocalReminder(target.title, target.body);
          firedRef.current.add(target.id);
        }
      }

      persistFired();
    };

    tick();
    const intervalId = window.setInterval(tick, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, targets]);

  return null;
}
