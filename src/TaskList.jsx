import React, { useState } from "react";

export default function TaskList({ tasks, setTasks }) {
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskDate, setNewTaskDate] = useState("");

  function addTask() {
    if (!newTaskText || !newTaskDate) return;
    setTasks([...tasks, { id: Date.now(), text: newTaskText, date: newTaskDate, done: false }]);
    setNewTaskText("");
    setNewTaskDate("");
  }

  function toggleDone(id) {
    setTasks(tasks.map(t => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  function removeTask(id) {
    setTasks(tasks.filter(t => t.id !== id));
  }

  return (
    <div className="mt-4">
      <h3 className="font-semibold mb-2">Tasks / Reminders</h3>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="Task description"
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          className="flex-1 p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          type="date"
          value={newTaskDate}
          onChange={(e) => setNewTaskDate(e.target.value)}
          className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
        />
        <button onClick={addTask} className="bg-blue-600 text-white px-3 rounded">Add</button>
      </div>

      <ul>
        {tasks.map(task => (
          <li key={task.id} className="flex items-center justify-between p-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => toggleDone(task.id)}
              />
              <span className={task.done ? "line-through text-gray-500" : ""}>
                {task.text} ({task.date})
              </span>
            </label>
            <button onClick={() => removeTask(task.id)} className="text-red-600 font-bold">×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
