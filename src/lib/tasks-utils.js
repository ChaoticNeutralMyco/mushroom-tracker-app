// src/lib/tasks-utils.js

// ---- Priorities (7)
export const PRIORITIES = ["low", "normal", "high"];

// ---- Guard: clamp repeat to positive ints, or return null (19)
export function clampRepeat(value, min = 1) {
  if (value === "" || value == null) return null;
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(min, n);
}

// ---- Date helpers (5)
export function combineDateAndTime(dateStr, timeStr) {
  if (!dateStr && !timeStr) return null;
  const d = dateStr ? new Date(dateStr) : new Date();
  if (timeStr) {
    const m24 = /^(\d{1,2}):(\d{2})$/;
    const m12 = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
    let h = 9, m = 0;

    if (m24.test(timeStr)) {
      const [, hh, mm] = timeStr.match(m24);
      h = Number(hh);
      m = Number(mm);
    } else if (m12.test(timeStr)) {
      let [, hh, mm, ap] = timeStr.match(m12);
      h = Number(hh);
      m = mm ? Number(mm) : 0;
      ap = ap.toLowerCase();
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
    }
    d.setHours(h, m, 0, 0);
  }
  return d;
}

export function defaultTimeIfMissing(d) {
  const out = new Date(d);
  if (out.getHours() === 0 && out.getMinutes() === 0 && out.getSeconds() === 0) {
    // Default to 09:00 local if no time provided
    out.setHours(9, 0, 0, 0);
  }
  return out;
}

// ---- Recurrence (2,3)
export function computeNextDue(base, interval, unit) {
  if (!interval || !unit) return null;
  const d = new Date(base);
  switch (unit) {
    case "days":
      d.setDate(d.getDate() + interval);
      break;
    case "weeks":
      d.setDate(d.getDate() + interval * 7);
      break;
    case "months":
      d.setMonth(d.getMonth() + interval);
      break;
    case "years":
      d.setFullYear(d.getFullYear() + interval);
      break;
    default:
      return null;
  }
  return d;
}

// ---- ICS export (14)
export function downloadICS(tasks) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Chaotic Neutral Myco Tracker//Tasks//EN",
  ];

  tasks.forEach((t) => {
    if (!t.dueAt) return;
    const dt = toICSDate(new Date(t.dueAt));
    const uid = (t.id || `${Math.random().toString(36).slice(2)}@myco`);
    const summary = escapeICS(t.title || "Task");
    const descParts = [];
    if (t.growName || t.growId) descParts.push(`Grow: ${t.growName || t.growId}`);
    if (t.notes) descParts.push(t.notes);
    const desc = escapeICS(descParts.join("\\n"));

    lines.push(
      "BEGIN:VTODO",
      `UID:${uid}`,
      `SUMMARY:${summary}`,
      `DUE:${dt}`,
      `STATUS:${t.completedAt ? "COMPLETED" : "NEEDS-ACTION"}`,
      `DESCRIPTION:${desc}`,
      "END:VTODO"
    );
  });

  lines.push("END:VCALENDAR");

  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "myco-tasks.ics";
  a.click();
  URL.revokeObjectURL(url);
}

function escapeICS(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
function toICSDate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

// ---- Quick add parser (8)
// Supported tokens (order-free):
//  - time: "@ 7pm", "@ 19:30"
//  - relative due: "in 3d|2w|4h|30m", "tomorrow", "today"
//  - repeat: "every 2d|3w|1m|1y"
//  - priority: "!high|!normal|!low"
//  - tags: "#Fruiting" "#Sterile"
//  - reminder: "remind 2h|30m|1d"
export function parseQuickAdd(input) {
  const out = {
    title: input.trim(),
    dueAt: null,
    time: null,
    repeatInterval: null,
    repeatUnit: null,
    priority: null,
    tags: [],
    remindLead: null,
  };
  let s = input;

  // Tags
  const tagRe = /#([\w-]+)/g;
  out.tags = Array.from(s.matchAll(tagRe)).map((m) => m[1]);
  s = s.replace(tagRe, "").trim();

  // Priority
  const prRe = /!(high|normal|low)\b/i;
  const pr = s.match(prRe);
  if (pr) {
    out.priority = pr[1].toLowerCase();
    s = s.replace(prRe, "").trim();
  }

  // Time
  const time12 = /@\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
  const time24 = /@\s*(\d{1,2}):(\d{2})\b/;
  let m;
  if ((m = s.match(time12))) {
    const h = m[1].padStart(2, "0");
    const mm = (m[2] || "00").padStart(2, "0");
    const ap = m[3].toLowerCase();
    let hh = parseInt(h, 10);
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
    out.time = `${String(hh).padStart(2, "0")}:${mm}`;
    s = s.replace(time12, "").trim();
  } else if ((m = s.match(time24))) {
    out.time = `${m[1].padStart(2, "0")}:${m[2].padStart(2, "0")}`;
    s = s.replace(time24, "").trim();
  }

  // Relative due
  const rel = /in\s+(\d+)\s*(m|h|d|w)\b/i;
  if ((m = s.match(rel))) {
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    const base = new Date();
    if (u === "m") base.setMinutes(base.getMinutes() + n);
    if (u === "h") base.setHours(base.getHours() + n);
    if (u === "d") base.setDate(base.getDate() + n);
    if (u === "w") base.setDate(base.getDate() + n * 7);
    out.dueAt = base;
    s = s.replace(rel, "").trim();
  } else if (/\btomorrow\b/i.test(s)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    out.dueAt = d;
    s = s.replace(/\btomorrow\b/i, "").trim();
  } else if (/\btoday\b/i.test(s)) {
    out.dueAt = new Date();
    s = s.replace(/\btoday\b/i, "").trim();
  }

  // Repeat
  const rep = /every\s+(\d+)\s*(d|w|m|y)\b/i;
  if ((m = s.match(rep))) {
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    out.repeatInterval = n;
    out.repeatUnit =
      u === "d" ? "days" :
      u === "w" ? "weeks" :
      u === "m" ? "months" :
      u === "y" ? "years" : null;
    s = s.replace(rep, "").trim();
  }

  // Reminder lead
  const remind = /remind\s+(\d+)\s*(m|h|d)\b/i;
  if ((m = s.match(remind))) {
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    out.remindLead =
      u === "m" ? n :
      u === "h" ? n * 60 :
      u === "d" ? n * 60 * 24 : null;
    s = s.replace(remind, "").trim();
  }

  // Title leftover
  out.title = s.trim() || out.title;

  // If we have both date and time, merge later in TaskManager
  return out;
}

// ---- Analytics (15)
export function analytics(tasks = []) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.completedAt).length;
  const completionRate = total ? Math.round((completed / total) * 100) : 0;

  // Avg delay between dueAt and completedAt (hours)
  const delays = tasks
    .filter((t) => t.dueAt && t.completedAt)
    .map((t) => (new Date(t.completedAt) - new Date(t.dueAt)) / (1000 * 60 * 60));
  const avgDelayHrs = delays.length
    ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10
    : 0;

  return { total, completed, completionRate, avgDelayHrs };
}
