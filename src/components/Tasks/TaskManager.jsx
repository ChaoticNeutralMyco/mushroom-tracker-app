// src/components/Tasks/TaskManager.jsx
import React, { useMemo, useState } from "react";

/**
 * TaskManager – prop-driven, no direct Firestore access.
 *
 * Props:
 *  - tasks: Array<{ id, title, dueDate (ISO), complete, growId?, repeatInterval?, repeatUnit? }>
 *  - selectedGrowId?: string – if provided, filters visible tasks
 *  - onCreate: (task) => void
 *  - onUpdate: (id, patch) => void
 *  - onDelete: (id) => void
 */
export default function TaskManager({
  tasks = [],
  selectedGrowId = "",
  onCreate,
  onUpdate,
  onDelete,
}) {
  const [form, setForm] = useState({
    title: "",
    dueDate: "",
    growId: selectedGrowId || "",
    repeatInterval: "",
    repeatUnit: "days",
  });

  const visible = useMemo(() => {
    return tasks
      .filter((t) => (selectedGrowId ? t.growId === selectedGrowId : true))
      .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  }, [tasks, selectedGrowId]);

  const reset = () =>
    setForm({
      title: "",
      dueDate: "",
      growId: selectedGrowId || "",
      repeatInterval: "",
      repeatUnit: "days",
    });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title) return;
    const payload = {
      title: form.title,
      dueDate: form.dueDate || null,
      growId: form.growId || null,
      complete: false,
      repeatInterval: form.repeatInterval ? Number(form.repeatInterval) : null,
      repeatUnit: form.repeatInterval ? form.repeatUnit : null,
      createdAt: new Date().toISOString(),
    };
    onCreate && onCreate(payload);
    reset();
  };

  const toggleComplete = (t) => {
    onUpdate && onUpdate(t.id, { complete: !t.complete });
  };

  const scheduleNext = (t) => {
    if (!t.repeatInterval || !t.repeatUnit) return;
    const d = t.dueDate ? new Date(t.dueDate) : new Date();
    const n = Number(t.repeatInterval);
    const next = new Date(d);
    switch (t.repeatUnit) {
      case "days":
        next.setDate(next.getDate() + n);
        break;
      case "weeks":
        next.setDate(next.getDate() + n * 7);
        break;
      case "months":
        next.setMonth(next.getMonth() + n);
        break;
      case "years":
        next.setFullYear(next.getFullYear() + n);
        break;
      default:
        break;
    }
    onCreate &&
      onCreate({
        title: t.title,
        dueDate: next.toISOString().slice(0, 10),
        growId: t.growId || null,
        complete: false,
        repeatInterval: t.repeatInterval,
        repeatUnit: t.repeatUnit,
        createdAt: new Date().toISOString(),
      });
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        <input
          className="sm:col-span-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          placeholder="Task title"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <input
          type="date"
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={(form.dueDate || "").slice(0, 10)}
          onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
        />
        <select
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          value={form.repeatUnit}
          onChange={(e) => setForm((f) => ({ ...f, repeatUnit: e.target.value }))}
        >
          <option value="days">Days</option>
          <option value="weeks">Weeks</option>
          <option value="months">Months</option>
          <option value="years">Years</option>
        </select>
        <input
          type="number"
          min=""
          className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          placeholder="Repeat every…"
          value={form.repeatInterval}
          onChange={(e) => setForm((f) => ({ ...f, repeatInterval: e.target.value }))}
        />
        <button
          type="submit"
          className="sm:col-span-5 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          Add Task
        </button>
      </form>

      <div className="divide-y divide-gray-200 dark:divide-zinc-800 rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
        {visible.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-zinc-900"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={!!t.complete}
                onChange={() => toggleComplete(t)}
              />
              <div className="text-sm">
                <div className={`font-medium ${t.complete ? "line-through" : ""}`}>
                  {t.title}
                </div>
                <div className="text-gray-500 dark:text-gray-400">
                  Due: {(t.dueDate || "").slice(0, 10) || "—"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!!t.repeatInterval && (
                <button
                  className="px-2 py-1 rounded bg-emerald-600 text-white text-xs"
                  onClick={() => scheduleNext(t)}
                  title="Schedule next occurrence"
                >
                  Schedule Next
                </button>
              )}
              <button
                className="px-2 py-1 rounded bg-red-600 text-white text-xs"
                onClick={() => onDelete && onDelete(t.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {visible.length === 0 && (
          <div className="p-4 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-zinc-900">
            No tasks yet.
          </div>
        )}
      </div>
    </div>
  );
}
