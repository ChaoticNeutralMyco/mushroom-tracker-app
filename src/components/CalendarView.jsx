// src/components/CalendarView.jsx
import React, { useMemo, useState } from "react";
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
} from "react-big-calendar";
import { parse, startOfWeek, format, getDay } from "date-fns";
import enUS from "date-fns/locale/en-US"; // ✅ FIX: ESM-compatible import
import { CalendarCheck2 } from "lucide-react";
import "react-big-calendar/lib/css/react-big-calendar.css";

const locales = {
  "en-US": enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales,
});

const CalendarView = ({ grows = [], tasks = [] }) => {
  const [showGrows, setShowGrows] = useState(true);
  const [showTasks, setShowTasks] = useState(true);

  const events = useMemo(() => {
    const growEvents = grows
      .filter((g) => g.stageDates)
      .flatMap((g) =>
        Object.entries(g.stageDates)
          .filter(([_, date]) => date && !isNaN(new Date(date)))
          .map(([stage, date]) => ({
            title: `${g.strain} - ${stage}`,
            start: new Date(date),
            end: new Date(date),
            allDay: true,
            type: "grow",
          }))
      );

    const taskEvents = tasks
      .filter((t) => t.dueDate && !isNaN(new Date(t.dueDate)))
      .map((t) => ({
        title: t.task,
        start: new Date(t.dueDate),
        end: new Date(t.dueDate),
        allDay: true,
        type: "task",
      }));

    return [
      ...(showGrows ? growEvents : []),
      ...(showTasks ? taskEvents : []),
    ];
  }, [grows, tasks, showGrows, showTasks]);

  const eventStyleGetter = (event) => {
    const color = event.type === "task" ? "#3b82f6" : "#22c55e";
    return {
      style: {
        backgroundColor: color,
        color: "white",
        borderRadius: "6px",
        border: "none",
        padding: "4px 6px",
      },
    };
  };

  return (
    <div className="p-6 md:p-8 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow space-y-6 max-w-6xl mx-auto">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <CalendarCheck2 className="w-6 h-6" />
        Calendar View
      </h2>

      <div className="flex gap-4 mb-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showGrows}
            onChange={() => setShowGrows(!showGrows)}
            className="accent-green-500"
          />
          Show Grows
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showTasks}
            onChange={() => setShowTasks(!showTasks)}
            className="accent-blue-500"
          />
          Show Tasks
        </label>
      </div>

      <div className="h-[600px] bg-white dark:bg-zinc-800 rounded shadow-inner">
        <BigCalendar
          localizer={localizer}
          events={events}
          defaultView="month"
          views={["month", "week", "day"]}
          startAccessor="start"
          endAccessor="end"
          style={{ height: "100%" }}
          eventPropGetter={eventStyleGetter}
        />
      </div>
    </div>
  );
};

export default CalendarView;
