// src/components/CalendarView.jsx
<<<<<<< HEAD

import React from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

// Import CSS via CDN in index.html (recommended) or here:

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
=======
import React, { useEffect, useState } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { db, auth } from '../firebase-config';
import { collection, getDocs } from 'firebase/firestore';

const localizer = momentLocalizer(moment);

export default function CalendarView() {
  const [events, setEvents] = useState([]);
  const [showGrows, setShowGrows] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    const fetchEvents = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const growsSnap = await getDocs(collection(db, `users/${user.uid}/grows`));
      const tasksSnap = await getDocs(collection(db, `users/${user.uid}/tasks`));

      const growEvents = growsSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: `grow-${doc.id}`,
          title: `🍄 ${data.strain || 'Unnamed'}`,
          start: new Date(data.inoculation || data.startDate || new Date()),
          end: new Date(data.harvestDate || data.inoculation || data.startDate || new Date()),
          allDay: true,
          type: 'grow',
          notes: data.notes || [],
        };
      });

      const taskEvents = tasksSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: `task-${doc.id}`,
          title: `📌 ${data.task || 'Task'}`,
          start: new Date(data.dueDate),
          end: new Date(data.dueDate),
          allDay: true,
          type: 'task',
          details: data.details || '',
        };
      });

      setEvents([...growEvents, ...taskEvents]);
    };

    fetchEvents();
  }, []);

  const filteredEvents = events.filter(
    (e) => (showGrows && e.type === 'grow') || (showTasks && e.type === 'task')
  );

  const eventStyleGetter = (event) => {
    const backgroundColor = event.type === 'grow' ? '#C3E6CB' : '#FFECB3';
    return {
      style: {
        backgroundColor,
        borderRadius: '6px',
        color: '#222',
        border: '1px solid #aaa',
        padding: '2px 6px',
        fontWeight: 500,
        fontSize: '0.85rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
    };
  };

  const handleEventMouseOver = (event, e) => {
    setTooltip({
      content:
        event.type === 'grow'
          ? `Grow: ${event.title}\nDates: ${event.start.toDateString()} → ${event.end.toDateString()}`
          : `Task: ${event.title}\nDue: ${event.start.toDateString()}\n${event.details || ''}`,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleEventMouseOut = () => {
    setTooltip(null);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow space-y-6">
      <h2 className="text-2xl font-bold">🗓️ Calendar View</h2>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showGrows}
            onChange={() => setShowGrows(!showGrows)}
            className="form-checkbox h-4 w-4 text-blue-600"
          />
          <span className="text-sm">Show Grows</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showTasks}
            onChange={() => setShowTasks(!showTasks)}
            className="form-checkbox h-4 w-4 text-blue-600"
          />
          <span className="text-sm">Show Tasks</span>
        </label>
      </div>

      {/* Calendar */}
      <div className="bg-zinc-100 dark:bg-zinc-800 p-4 rounded-xl shadow-inner relative">
        <Calendar
          localizer={localizer}
          events={filteredEvents}
          startAccessor="start"
          endAccessor="end"
          style={{ height: 600 }}
          eventPropGetter={eventStyleGetter}
          onSelectEvent={(event) => alert(event.title)}
          onMouseOver={(e) => e.stopPropagation()}
          onNavigate={() => setTooltip(null)}
          onDrillDown={() => setTooltip(null)}
          onView={() => setTooltip(null)}
          components={{
            event: (props) => (
              <div
                onMouseOver={(e) => handleEventMouseOver(props.event, e)}
                onMouseOut={handleEventMouseOut}
              >
                {props.title}
              </div>
            ),
          }}
        />

        {tooltip && (
          <div
            className="absolute bg-black text-white text-xs rounded px-2 py-1 shadow-lg z-50"
            style={{
              top: tooltip.y + 10,
              left: tooltip.x + 10,
              pointerEvents: 'none',
              whiteSpace: 'pre-wrap',
              maxWidth: 300,
            }}
          >
            {tooltip.content}
          </div>
        )}
      </div>
>>>>>>> be7d1a18 (Initial commit with final polished version)
    </div>
  );
}
