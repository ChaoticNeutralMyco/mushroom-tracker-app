// src/components/TaskManager.jsx
import React, { useState, useEffect } from "react";
import { db, auth } from "../firebase-config";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
} from "firebase/firestore";

export default function TaskManager({ selectedGrowId }) {
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState({ title: "", due: "", growId: "" });
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchTasks();
  }, [selectedGrowId]);

  const fetchTasks = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const ref = collection(db, "users", user.uid, "tasks");
    const snap = await getDocs(ref);
    const allTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const sorted = allTasks.sort((a, b) =>
      (a.due || "").localeCompare(b.due || "")
    );
    setTasks(sorted);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user || !form.title.trim()) return;
    const payload = {
      ...form,
      createdAt: Timestamp.now(),
      completed: false,
    };

    if (editingId) {
      await updateDoc(doc(db, "users", user.uid, "tasks", editingId), payload);
    } else {
      await addDoc(collection(db, "users", user.uid, "tasks"), payload);
    }

    setForm({ title: "", due: "", growId: selectedGrowId || "" });
    setEditingId(null);
    fetchTasks();
  };

  const handleEdit = (task) => {
    setForm({
      title: task.title,
      due: task.due || "",
      growId: task.growId || "",
    });
    setEditingId(task.id);
  };

  const handleDelete = async (id) => {
    const user = auth.currentUser;
    if (!user) return;
    await deleteDoc(doc(db, "users", user.uid, "tasks", id));
    fetchTasks();
  };

  const toggleComplete = async (task) => {
    const user = auth.currentUser;
    if (!user) return;
    await updateDoc(doc(db, "users", user.uid, "tasks", task.id), {
      completed: !task.completed,
    });
    fetchTasks();
  };

  const filtered = tasks
    .filter((t) =>
      filter === "all"
        ? true
        : filter === "complete"
        ? t.completed
        : !t.completed
    )
    .filter((t) =>
      search ? t.title.toLowerCase().includes(search.toLowerCase()) : true
    )
    .filter((t) => (selectedGrowId ? t.growId === selectedGrowId : true));

  const isDueSoon = (dateStr) => {
    if (!dateStr) return false;
    const today = new Date();
    const due = new Date(dateStr);
    const diff = (due - today) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 1;
  };

  return (
    <div className="p-6 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white max-w-4xl mx-auto rounded-2xl shadow space-y-6">
      <h2 className="text-2xl font-bold">📅 Task Reminders</h2>

      <form onSubmit={handleSubmit} className="space-y-3 sm:grid sm:grid-cols-3 sm:gap-4">
        <input
          type="text"
          placeholder="Task title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full border p-2 rounded bg-white dark:bg-zinc-800 text-sm"
        />
        <input
          type="date"
          value={form.due}
          onChange={(e) => setForm({ ...form, due: e.target.value })}
          className="w-full border p-2 rounded bg-white dark:bg-zinc-800 text-sm"
        />
        <button
          type="submit"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded w-full sm:w-auto"
        >
          {editingId ? "✅ Update Task" : "➕ Add Task"}
        </button>
      </form>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Search tasks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="p-2 border rounded bg-white dark:bg-zinc-800 text-sm w-full sm:w-auto"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="p-2 border rounded bg-white dark:bg-zinc-800 text-sm"
        >
          <option value="all">All</option>
          <option value="complete">✅ Completed</option>
          <option value="incomplete">❗ Incomplete</option>
        </select>
        {selectedGrowId && (
          <div className="text-sm text-zinc-500">
            Filtering by grow: <strong>{selectedGrowId}</strong>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">No tasks to display.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((task) => (
            <li
              key={task.id}
              className="p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex justify-between items-center shadow"
            >
              <div>
                <h4 className="font-semibold text-base">
                  {task.completed ? <s>{task.title}</s> : task.title}
                </h4>
                <p className="text-sm text-zinc-500">
                  Due:{" "}
                  <span
                    className={
                      isDueSoon(task.due)
                        ? "text-red-500 font-semibold"
                        : "text-zinc-500"
                    }
                  >
                    {task.due || "No date"}
                  </span>
                </p>
                {task.growId && (
                  <p className="text-xs text-zinc-400">
                    Linked to grow: <code>{task.growId}</code>
                  </p>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 text-sm">
                <button
                  onClick={() => toggleComplete(task)}
                  className="text-green-600 hover:underline"
                >
                  {task.completed ? "Mark Incomplete" : "✅ Complete"}
                </button>
                <button
                  onClick={() => handleEdit(task)}
                  className="text-blue-500 hover:underline"
                >
                  ✏️ Edit
                </button>
                <button
                  onClick={() => handleDelete(task.id)}
                  className="text-red-500 hover:underline"
                >
                  🗑️ Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
