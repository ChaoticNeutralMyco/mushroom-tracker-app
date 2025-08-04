// src/components/TaskReminder.jsx
import React, { useState } from "react";
import { db, auth } from "../firebase-config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { useAuthState } from "react-firebase-hooks/auth";

const TaskReminder = ({ grows }) => {
  const [user] = useAuthState(auth);
  const [task, setTask] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [selectedGrow, setSelectedGrow] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user || !task || !dueDate || !selectedGrow) return;

    const tasksRef = collection(db, "users", user.uid, "tasks");
    await addDoc(tasksRef, {
      task,
      dueDate,
      growId: selectedGrow,
      createdAt: serverTimestamp(),
      completed: false,
    });

    setTask("");
    setDueDate("");
    setSelectedGrow("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-4 bg-white dark:bg-gray-800 rounded-xl shadow space-y-2"
    >
      <h3 className="text-lg font-semibold dark:text-white">Add Reminder</h3>
      <select
        value={selectedGrow}
        onChange={(e) => setSelectedGrow(e.target.value)}
        className="w-full p-2 border rounded dark:bg-gray-700 dark:text-white"
      >
        <option value="">Select Grow</option>
        {grows.map((grow) => (
          <option key={grow.id} value={grow.id}>
            {grow.strain}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Task description"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        className="w-full p-2 border rounded dark:bg-gray-700 dark:text-white"
      />
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="w-full p-2 border rounded dark:bg-gray-700 dark:text-white"
      />
      <button
        type="submit"
        className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
      >
        Add Reminder
      </button>
    </form>
  );
};

export default TaskReminder;
