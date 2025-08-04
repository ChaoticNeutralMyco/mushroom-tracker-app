<<<<<<< HEAD
import React, { useState } from "react";

export default function TaskReminder({ growId, tasks, onAddTask, onToggleTask }) {
  const [taskText, setTaskText] = useState("");

  const handleAdd = () => {
    if (!taskText.trim()) return;
    const newTask = {
      id: Date.now(),
      text: taskText.trim(),
      done: false,
    };
    onAddTask(growId, newTask);
    setTaskText("");
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow-md mt-4">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">
        Reminders & Tasks
      </h3>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text"
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          placeholder="Add a new task..."
          className="flex-1 px-3 py-2 border rounded shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
        <button
          onClick={handleAdd}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          Add
        </button>
      </div>

      <ul className="space-y-2">
        {tasks?.map((task) => (
          <li
            key={task.id}
            className="flex items-center justify-between px-3 py-2 border rounded dark:border-gray-700"
          >
            <label className="flex items-center gap-2 w-full cursor-pointer">
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => onToggleTask(growId, task.id)}
                className="form-checkbox h-5 w-5 text-blue-600"
              />
              <span
                className={`flex-1 ${
                  task.done ? "line-through text-gray-400" : "text-gray-800 dark:text-white"
                }`}
              >
                {task.text}
              </span>
            </label>
          </li>
        ))}
      </ul>
=======
// src/components/TaskReminder.jsx
import React, { useState } from "react";

export default function TaskReminder({ grows }) {
  const [reminderText, setReminderText] = useState("");
  const [reminders, setReminders] = useState([]);

  const handleAddReminder = () => {
    if (!reminderText.trim()) return;
    setReminders([
      ...reminders,
      {
        text: reminderText.trim(),
        created: new Date().toISOString(),
      },
    ]);
    setReminderText("");
  };

  return (
    <div className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white p-6 rounded-2xl shadow max-w-2xl mx-auto mt-6 space-y-4">
      <h2 className="text-2xl font-bold">📝 Quick Task Reminders</h2>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={reminderText}
          onChange={(e) => setReminderText(e.target.value)}
          placeholder="e.g., Shake jar on Aug 5"
          className="p-2 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 w-full text-sm"
        />
        <button
          onClick={handleAddReminder}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded w-full sm:w-auto text-sm font-semibold"
        >
          ➕ Add Reminder
        </button>
      </div>

      {reminders.length > 0 && (
        <ul className="space-y-2 list-disc list-inside mt-4">
          {reminders.map((r, i) => (
            <li key={i}>
              <div className="font-medium">{r.text}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Added: {new Date(r.created).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
>>>>>>> be7d1a18 (Initial commit with final polished version)
    </div>
  );
}
