// src/pages/CalendarView.jsx
import React, { useMemo } from "react";
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

export default function CalendarView({ grows = [], tasks = [] }) {
  const events = useMemo(() => {
    const gEvents = (grows || []).flatMap((g) => {
      const sd = g.stageDates || {};
      return Object.entries(sd)
        .filter(([, v]) => !!v)
        .map(([stage, date]) => ({
          id: `${g.id}-${stage}`,
          title: `${g.strain || "Grow"} – ${stage}`,
          start: new Date(date),
          end: new Date(date),
          allDay: true,
          type: "grow",
        }));
    });

    const tEvents = (tasks || []).map((t) => ({
      id: t.id,
      title: t.title,
      start: t.dueDate ? new Date(t.dueDate) : new Date(),
      end: t.dueDate ? new Date(t.dueDate) : new Date(),
      allDay: true,
      type: "task",
    }));

    return [...gEvents, ...tEvents];
  }, [grows, tasks]);

  const eventPropGetter = (event) => {
    const color = event.type === "task" ? "#3b82f6" : "#22c55e";
    return { style: { backgroundColor: color, color: "white", borderRadius: "6px", border: "none" } };
  };

  return (
    <div className="p-6 md:p-8 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow space-y-6 max-w-6xl mx-auto">
      <h2 className="text-xl font-semibold">Calendar</h2>
      <BigCalendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        eventPropGetter={eventPropGetter}
        style={{ height: 600 }}
      />
    </div>
  );
}
