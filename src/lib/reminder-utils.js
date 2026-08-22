// src/lib/reminder-utils.js

export function parseReminderTimeMs(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function getTaskReminderState(task, nowMs = Date.now()) {
  if (!task || task.completedAt || task.completed || task.done || !task.dueAt) return null;

  const dueMs = parseReminderTimeMs(task.dueAt);
  if (dueMs === null) return null;

  const rawLead = Number(task.remindLead);
  const leadMinutes = Number.isFinite(rawLead) ? Math.max(0, rawLead) : 0;
  const triggerAtMs = dueMs - leadMinutes * 60_000;
  const taskIdentity = String(task.id || task.title || "task");
  const key = `task:${taskIdentity}:${new Date(dueMs).toISOString()}:lead:${leadMinutes}`;

  const lastNotifiedKey = String(task.lastNotifiedKey || "");
  if (lastNotifiedKey === key) {
    return { key, dueMs, triggerAtMs, leadMinutes, shouldNotify: false };
  }

  // Legacy records only had lastNotifiedAt. Treat a notification written at or
  // after this trigger as already delivered, while still allowing a newly
  // rescheduled task with a modern key to notify again.
  if (!lastNotifiedKey) {
    const legacyLastMs = parseReminderTimeMs(task.lastNotifiedAt);
    if (legacyLastMs !== null && legacyLastMs >= triggerAtMs) {
      return { key, dueMs, triggerAtMs, leadMinutes, shouldNotify: false };
    }
  }

  return {
    key,
    dueMs,
    triggerAtMs,
    leadMinutes,
    shouldNotify: Number(nowMs) >= triggerAtMs,
  };
}

export function getNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission || "default";
}

export async function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (window.Notification.permission !== "default") return window.Notification.permission;

  try {
    return await window.Notification.requestPermission();
  } catch {
    return window.Notification.permission || "default";
  }
}

function showReminderToast(title, body) {
  if (typeof document === "undefined" || !document.body) return false;

  try {
    const host = document.createElement("div");
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.style.position = "fixed";
    host.style.right = "16px";
    host.style.bottom = "16px";
    host.style.zIndex = "99999";
    host.style.maxWidth = "340px";
    host.style.padding = "10px 12px";
    host.style.borderRadius = "12px";
    host.style.background = "#111827";
    host.style.color = "white";
    host.style.fontSize = "13px";
    host.style.boxShadow = "0 10px 30px rgba(0,0,0,.3)";

    const heading = document.createElement("div");
    heading.style.fontWeight = "600";
    heading.style.marginBottom = "4px";
    heading.textContent = String(title || "Reminder");

    const message = document.createElement("div");
    message.textContent = String(body || "");

    host.appendChild(heading);
    host.appendChild(message);
    document.body.appendChild(host);
    window.setTimeout(() => host.remove(), 4200);
    return true;
  } catch {
    return false;
  }
}

export function deliverLocalReminder(title, body) {
  const safeTitle = String(title || "Reminder");
  const safeBody = String(body || "");

  if (getNotificationPermission() === "granted") {
    try {
      new window.Notification(safeTitle, { body: safeBody });
      return "notification";
    } catch {
      // Fall through to the in-app reminder.
    }
  }

  return showReminderToast(safeTitle, safeBody) ? "toast" : "none";
}
