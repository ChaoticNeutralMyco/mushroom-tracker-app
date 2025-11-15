// src/pages/CalendarView.jsx
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Calendar as BigCalendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";

/**
 * CalendarView – prop-driven.
 * Props:
 *  - grows: []
 *  - tasks: []
 */

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales,
});

// --- Utilities ---
function toDateMaybe(v) {
  if (v == null) return null;
  try {
    if (v?.toDate) return v.toDate(); // Firestore Timestamp
    if (typeof v === "object" && "seconds" in v) return new Date(v.seconds * 1000);
    if (v instanceof Date) return v;
    const d = new Date(v);
    return Number.isNaN(+d) ? null : d;
  } catch {
    return null;
  }
}

function isBulkGrow(g) {
  if (g?.isBulk === true) return true;
  const t = String(g?.type || g?.growType || g?.container || "").toLowerCase();
  return t.includes("bulk") || t.includes("tub") || t.includes("monotub");
}

function growLabel(g) {
  const abbr = g?.abbr || g?.sub || g?.subName;
  return abbr || g?.strain || "Grow";
}

function coalesce(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

// --- Event builders ---
function buildGrowEvents(grows) {
  if (!Array.isArray(grows)) return [];
  const out = [];
  for (const g of grows) {
    const name = growLabel(g);
    const sd = g?.stageDates || {};
    const inoc = toDateMaybe(coalesce(sd?.Inoculated, g?.inoc, g?.inoculatedAt, g?.createdAt));
    const colonized = toDateMaybe(sd?.Colonized);
    const fruiting = toDateMaybe(sd?.Fruiting);
    const harvested = toDateMaybe(sd?.Harvested);
    const contaminated = toDateMaybe(sd?.Contaminated);

    if (inoc) {
      out.push({
        id: `${g.id || name}-Inoculated`,
        title: `${name} — Inoculated`,
        start: inoc,
        end: inoc,
        allDay: true,
        kind: "grow",
        stage: "Inoculated",
        grow: g,
      });
    }
    if (colonized) {
      out.push({
        id: `${g.id || name}-Colonized`,
        title: `${name} — Colonized`,
        start: colonized,
        end: colonized,
        allDay: true,
        kind: "grow",
        stage: "Colonized",
        grow: g,
      });
    }
    if (isBulkGrow(g) && fruiting) {
      out.push({
        id: `${g.id || name}-Fruiting`,
        title: `${name} — Fruiting`,
        start: fruiting,
        end: fruiting,
        allDay: true,
        kind: "grow",
        stage: "Fruiting",
        grow: g,
      });
    }
    if (harvested) {
      out.push({
        id: `${g.id || name}-Harvested`,
        title: `${name} — Harvested`,
        start: harvested,
        end: harvested,
        allDay: true,
        kind: "grow",
        stage: "Harvested",
        grow: g,
      });
    }
    if (contaminated) {
      out.push({
        id: `${g.id || name}-Contaminated`,
        title: `${name} — Contaminated`,
        start: contaminated,
        end: contaminated,
        allDay: true,
        kind: "grow",
        stage: "Contaminated",
        grow: g,
      });
    }

    // Fallback marker if nothing else
    if (!inoc && !colonized && !fruiting && !harvested && !contaminated) {
      const created = toDateMaybe(g?.createdAt);
      if (created) {
        out.push({
          id: `${g.id || name}-Created`,
          title: `${name} — Created`,
          start: created,
          end: created,
          allDay: true,
          kind: "grow",
          stage: "Created",
          grow: g,
        });
      }
    }
  }
  return out;
}

function buildTaskEvents(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(Boolean)
    .map((t) => {
      const when =
        toDateMaybe(t?.dueDate) ||
        toDateMaybe(t?.due) ||
        toDateMaybe(t?.date) ||
        toDateMaybe(t?.createdAt) ||
        new Date();
      const title =
        t?.title || t?.name || (t?.text ? String(t.text).slice(0, 60) : "Task");
      return {
        id: t.id || `${title}-${+when}`,
        title: `Task: ${title}`,
        start: when,
        end: when,
        allDay: true,
        kind: "task",
        task: t,
      };
    });
}

// --- Styling for events ---
function eventPropGetter(event) {
  const base = {
    style: {
      borderRadius: "8px",
      border: "1px solid transparent",
      color: "white",
      fontWeight: 600,
      padding: "2px 6px",
      cursor: "pointer",
    },
    title: event?.title || "",
  };

  if (event.kind === "task") {
    const completed = !!(event.task?.completed || event.task?.done);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // midnight
    const overdue = !completed && event.start < todayStart;
    base.style.backgroundColor = completed ? "#64748b" : overdue ? "#f59e0b" : "#3b82f6";
    base.style.borderColor = "rgba(255,255,255,.25)";
    return base;
  }

  // Grow stages color map
  const stage = String(event.stage || "").toLowerCase();
  const color =
    stage.includes("contam") ? "#ef4444" :
    stage.includes("harvest") ? "#16a34a" :
    stage.includes("fruit") ? "#8b5cf6" :
    stage.includes("colonized") ? "#10b981" :
    stage.includes("coloniz") ? "#06b6d4" :
    stage.includes("inoc") ? "#3b82f6" :
    "#475569";

  base.style.backgroundColor = color;
  base.style.borderColor = "rgba(255,255,255,.25)";
  return base;
}

// Scoped CSS to polish dark mode for react-big-calendar
const RBC_DARK_CSS = `
.rbc-theme .rbc-toolbar { color: #0f172a; }
.dark .rbc-theme .rbc-toolbar { color: #e5e7eb; }
.rbc-theme .rbc-btn-group > button { border-radius: 8px; border-color: rgba(148,163,184,.25); }
.dark .rbc-theme .rbc-btn-group > button { color: #e5e7eb; background: rgba(255,255,255,.03); border-color: rgba(148,163,184,.25); }
.rbc-theme .rbc-month-view, .rbc-theme .rbc-time-view { background: #ffffff; }
.dark .rbc-theme .rbc-month-view, .dark .rbc-theme .rbc-time-view { background: #0b0b0c; }
.rbc-theme .rbc-header, .rbc-theme .rbc-time-header { border-color: rgba(148,163,184,.25); }
.rbc-theme .rbc-timeslot-group, .rbc-theme .rbc-day-bg { border-color: rgba(148,163,184,.15); }
.rbc-theme .rbc-event { border-radius: 8px; box-shadow: 0 1px 1px rgba(0,0,0,.08); }
.dark .rbc-theme .rbc-off-range-bg { background: rgba(255,255,255,.03); }
.rbc-theme .rbc-today { background: rgba(59,130,246,.08); }
.dark .rbc-theme .rbc-today { background: rgba(59,130,246,.16); }
`;

export default function CalendarView({ grows = [], tasks = [] }) {
  const navigate = useNavigate();

  const handleSelectEvent = (event) => {
    try {
      if (event?.kind === "grow" && event?.grow?.id) {
        navigate(`/quick/${event.grow.id}`);
        return;
      }
      if (event?.kind === "task") {
        const gid = event?.task?.growId || event?.task?.grow?.id || event?.task?.growID;
        if (gid) {
          navigate(`/quick/${gid}`);
          return;
        }
        // Fallback: navigate home and hint tasks tab via hash
        navigate(`/`);
        try { window.location.hash = "#tasks"; } catch (e) {}
        return;
      }
    } catch (e) {}
  };

  const events = useMemo(() => {
    const g = buildGrowEvents(grows);
    const t = buildTaskEvents(tasks);
    return [...g, ...t];
  }, [grows, tasks]);

  return (
    <div className="p-6 md:p-8 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow space-y-6 max-w-6xl mx-auto">
      {/* Scoped style for react-big-calendar dark mode polish */}
      <style dangerouslySetInnerHTML={{ __html: RBC_DARK_CSS }} />
      <h2 className="text-xl font-semibold">Calendar</h2>
      <div className="rbc-theme">
        <BigCalendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          eventPropGetter={eventPropGetter}
          onSelectEvent={handleSelectEvent}
          popup
          style={{ height: 600 }}
        />
      </div>
    </div>
  );
}
