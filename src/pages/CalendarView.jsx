// src/pages/CalendarView.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Calendar as BigCalendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";

/**
 * CalendarView – prop-driven.
 * Props:
 *  - grows: []
 *  - tasks: []
 *  - onOpenTask(task)
 */

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales,
});

export const CALENDAR_FILTER_STORAGE_KEY = "cnm.calendar.filters.v1";
export const DEFAULT_CALENDAR_FILTERS = Object.freeze({
  showGrowMilestones: true,
  showOpenTasks: true,
  showCompletedTasks: true,
  taskSource: "all",
});

const TASK_SOURCE_VALUES = new Set(["all", "manual", "sop"]);

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

export function isTaskCompleted(task) {
  return Boolean(
    task?.completedAt ||
      task?.completed === true ||
      task?.done === true ||
      task?.complete === true
  );
}

export function isSopGeneratedTask(task) {
  const source = String(task?.taskSource || task?.source || "").trim().toLowerCase();
  const tags = Array.isArray(task?.tags)
    ? task.tags.map((tag) => String(tag || "").trim().toLowerCase())
    : [];

  return Boolean(
    task?.workflowTemplateId ||
      task?.sopTemplateId ||
      source === "sop-template" ||
      source === "sop" ||
      tags.includes("sop") ||
      tags.includes("workflow")
  );
}

export function normalizeCalendarFilters(value) {
  const incoming = value && typeof value === "object" ? value : {};
  const taskSource = TASK_SOURCE_VALUES.has(incoming.taskSource)
    ? incoming.taskSource
    : DEFAULT_CALENDAR_FILTERS.taskSource;

  return {
    showGrowMilestones:
      typeof incoming.showGrowMilestones === "boolean"
        ? incoming.showGrowMilestones
        : DEFAULT_CALENDAR_FILTERS.showGrowMilestones,
    showOpenTasks:
      typeof incoming.showOpenTasks === "boolean"
        ? incoming.showOpenTasks
        : DEFAULT_CALENDAR_FILTERS.showOpenTasks,
    showCompletedTasks:
      typeof incoming.showCompletedTasks === "boolean"
        ? incoming.showCompletedTasks
        : DEFAULT_CALENDAR_FILTERS.showCompletedTasks,
    taskSource,
  };
}

function readStoredFilters() {
  if (typeof window === "undefined") return { ...DEFAULT_CALENDAR_FILTERS };
  try {
    const raw = window.localStorage.getItem(CALENDAR_FILTER_STORAGE_KEY);
    return raw ? normalizeCalendarFilters(JSON.parse(raw)) : { ...DEFAULT_CALENDAR_FILTERS };
  } catch {
    return { ...DEFAULT_CALENDAR_FILTERS };
  }
}

// --- Event builders ---
export function buildGrowEvents(grows) {
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

export function buildTaskEvents(tasks) {
  if (!Array.isArray(tasks)) return [];

  return tasks
    .filter(Boolean)
    .map((task) => {
      const when =
        toDateMaybe(task?.dueAt) ||
        toDateMaybe(task?.dueDate) ||
        toDateMaybe(task?.due) ||
        toDateMaybe(task?.date);

      // Calendar represents due dates. Undated tasks remain available in TaskManager.
      if (!when) return null;

      const title =
        task?.title ||
        task?.name ||
        (task?.text ? String(task.text).slice(0, 60) : "Task");
      const taskSource = isSopGeneratedTask(task) ? "sop" : "manual";

      return {
        id: task.id || `${title}-${+when}`,
        title: `${taskSource === "sop" ? "SOP Task" : "Task"}: ${title}`,
        start: when,
        end: when,
        allDay: true,
        kind: "task",
        task,
        taskSource,
        completed: isTaskCompleted(task),
      };
    })
    .filter(Boolean);
}

export function filterCalendarEvents(events, rawFilters) {
  const filters = normalizeCalendarFilters(rawFilters);
  if (!Array.isArray(events)) return [];

  return events.filter((event) => {
    if (event?.kind === "grow") return filters.showGrowMilestones;
    if (event?.kind !== "task") return true;

    const completed =
      typeof event.completed === "boolean" ? event.completed : isTaskCompleted(event.task);
    if (completed && !filters.showCompletedTasks) return false;
    if (!completed && !filters.showOpenTasks) return false;

    const source = event.taskSource || (isSopGeneratedTask(event.task) ? "sop" : "manual");
    if (filters.taskSource !== "all" && source !== filters.taskSource) return false;

    return true;
  });
}

// --- Styling for events ---
export function eventPropGetter(event) {
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
    const completed =
      typeof event.completed === "boolean" ? event.completed : isTaskCompleted(event.task);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const overdue = !completed && event.start < todayStart;
    const sopGenerated =
      event.taskSource === "sop" ||
      (!event.taskSource && isSopGeneratedTask(event.task));

    base.style.backgroundColor = completed
      ? "#64748b"
      : overdue
      ? "#f59e0b"
      : sopGenerated
      ? "#8b5cf6"
      : "#3b82f6";
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
.rbc-theme .rbc-btn-group > button { border-radius: 999px; border-color: rgba(148,163,184,.25); background: rgba(255,255,255,.92); }
.rbc-theme .rbc-btn-group > button.rbc-active { background: var(--_accent-600); color: var(--_accent-on); border-color: var(--_accent-600); }
.dark .rbc-theme .rbc-btn-group > button { color: #e5e7eb; background: rgba(255,255,255,.03); border-color: rgba(148,163,184,.25); }
.rbc-theme .rbc-month-view, .rbc-theme .rbc-time-view { background: #ffffff; }
.dark .rbc-theme .rbc-month-view, .dark .rbc-theme .rbc-time-view { background: #0b0b0c; }
.rbc-theme .rbc-header, .rbc-theme .rbc-time-header { border-color: rgba(148,163,184,.25); }
.rbc-theme .rbc-timeslot-group, .rbc-theme .rbc-day-bg { border-color: rgba(148,163,184,.15); }
.rbc-theme .rbc-event { border-radius: 8px; box-shadow: 0 1px 1px rgba(0,0,0,.08); }
.dark .rbc-theme .rbc-off-range-bg { background: rgba(255,255,255,.03); }
.rbc-theme .rbc-today { background: rgba(var(--_accent-rgb), .10); }
.dark .rbc-theme .rbc-today { background: rgba(var(--_accent-rgb), .18); }
`;

function FilterToggle({ checked, onChange, label, count }) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--_accent-600)]"
      />
      <span className="font-medium">{label}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{count}</span>
    </label>
  );
}

function LegendItem({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export default function CalendarView({ grows = [], tasks = [], onOpenTask }) {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(readStoredFilters);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        CALENDAR_FILTER_STORAGE_KEY,
        JSON.stringify(normalizeCalendarFilters(filters))
      );
    } catch {}
  }, [filters]);

  const handleSelectEvent = (event) => {
    try {
      if (event?.kind === "grow" && event?.grow?.id) {
        navigate(`/quick/${event.grow.id}`);
        return;
      }
      if (event?.kind === "task") {
        if (typeof onOpenTask === "function") {
          onOpenTask(event.task);
          return;
        }
        navigate(`/?tab=tasks`);
      }
    } catch {}
  };

  const growEvents = useMemo(() => buildGrowEvents(grows), [grows]);
  const taskEvents = useMemo(() => buildTaskEvents(tasks), [tasks]);
  const allEvents = useMemo(() => [...growEvents, ...taskEvents], [growEvents, taskEvents]);
  const events = useMemo(
    () => filterCalendarEvents(allEvents, filters),
    [allEvents, filters]
  );

  const counts = useMemo(() => {
    let openTasks = 0;
    let completedTasks = 0;
    let manualTasks = 0;
    let sopTasks = 0;

    taskEvents.forEach((event) => {
      if (event.completed) completedTasks += 1;
      else openTasks += 1;
      if (event.taskSource === "sop") sopTasks += 1;
      else manualTasks += 1;
    });

    return {
      growMilestones: growEvents.length,
      openTasks,
      completedTasks,
      manualTasks,
      sopTasks,
      undatedTasks: Math.max(0, (Array.isArray(tasks) ? tasks.length : 0) - taskEvents.length),
    };
  }, [growEvents.length, taskEvents, tasks]);

  const updateFilter = (key, value) => {
    setFilters((current) => normalizeCalendarFilters({ ...current, [key]: value }));
  };

  const resetFilters = () => setFilters({ ...DEFAULT_CALENDAR_FILTERS });

  return (
    <div className="p-6 md:p-8 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-4 max-w-6xl mx-auto">
      <style dangerouslySetInnerHTML={{ __html: RBC_DARK_CSS }} />

      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Calendar</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Grow milestones and real task due dates stay in one view. Select an event to open its source record.
        </p>
      </div>

      <section
        data-tour="calendar-filters"
        className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/50 p-4 space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Calendar filters</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Showing {events.length} of {allEvents.length} dated events.
            </p>
          </div>
          <button type="button" className="chip text-sm" onClick={resetFilters}>
            Show all
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <FilterToggle
            checked={filters.showGrowMilestones}
            onChange={(value) => updateFilter("showGrowMilestones", value)}
            label="Grow milestones"
            count={counts.growMilestones}
          />
          <FilterToggle
            checked={filters.showOpenTasks}
            onChange={(value) => updateFilter("showOpenTasks", value)}
            label="Open tasks"
            count={counts.openTasks}
          />
          <FilterToggle
            checked={filters.showCompletedTasks}
            onChange={(value) => updateFilter("showCompletedTasks", value)}
            label="Completed tasks"
            count={counts.completedTasks}
          />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] space-y-1 text-sm">
            <span className="font-medium">Task source</span>
            <select
              value={filters.taskSource}
              onChange={(event) => updateFilter("taskSource", event.target.value)}
              className="input w-full"
            >
              <option value="all">All tasks ({taskEvents.length})</option>
              <option value="manual">Manual tasks ({counts.manualTasks})</option>
              <option value="sop">SOP-generated tasks ({counts.sopTasks})</option>
            </select>
          </label>

          <div className="flex flex-wrap gap-x-4 gap-y-2 pb-1">
            <LegendItem color="#3b82f6" label="Open manual task" />
            <LegendItem color="#8b5cf6" label="Open SOP task" />
            <LegendItem color="#f59e0b" label="Overdue task" />
            <LegendItem color="#64748b" label="Completed task" />
          </div>
        </div>

        {counts.undatedTasks > 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {counts.undatedTasks} {counts.undatedTasks === 1 ? "task has" : "tasks have"} no due date and remains available in Tasks instead of being placed on an unrelated Calendar date.
          </p>
        ) : null}
      </section>

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
