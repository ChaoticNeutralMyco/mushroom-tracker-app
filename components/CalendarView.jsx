// src/components/CalendarView.jsx

import React from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

// Import CSS via CDN in index.html (recommended) or here:
import "https://cdn.jsdelivr.net/npm/@fullcalendar/daygrid@6.1.10/main.min.css";

export default function CalendarView({ grows = [] }) {
  const events = grows.map((grow) => ({
    id: grow.id,
    title: `${grow.name} (${grow.stage})`,
    start: grow.startDate,
    end: grow.harvestDate || grow.endDate || grow.startDate,
    allDay: true,
  }));

  const handleEventClick = (info) => {
    alert(`Grow: ${info.event.title}`);
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Grow Calendar</h2>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        events={events}
        eventClick={handleEventClick}
        height="auto"
      />
    </div>
  );
}
