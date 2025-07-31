import React from "react";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import format from "date-fns/format";
import parse from "date-fns/parse";
import startOfWeek from "date-fns/startOfWeek";
import getDay from "date-fns/getDay";
import "react-big-calendar/lib/css/react-big-calendar.css";

const locales = {
  "en-US": require("date-fns/locale/en-US"),
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

export default function CalendarView({ grows }) {
  const events = grows.map((grow) => ({
    title: grow.strain,
    start: new Date(grow.startDate),
    end: new Date(grow.endDate || grow.startDate),
  }));

  return (
    <div className="p-4 bg-white dark:bg-gray-900 rounded shadow">
      <h2 className="text-xl font-semibold mb-4">Grow Calendar</h2>
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        style={{ height: 500 }}
      />
    </div>
  );
}
