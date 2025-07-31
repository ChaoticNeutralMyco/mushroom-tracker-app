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
    </div>
  );
}
