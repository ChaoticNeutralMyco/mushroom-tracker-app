import React, { useMemo, useState, useEffect } from "react";
import useTaskReminders from "../../hooks/useTaskReminders";
import {
  PRIORITIES,
  clampRepeat,
  parseQuickAdd,
  combineDateAndTime,
  defaultTimeIfMissing,
  computeNextDue,
  downloadICS,
  analytics,
} from "../../lib/tasks-utils";

// Fallback grow loading (if parent doesn't pass grows)
import { db, auth } from "../../firebase-config";
import { collection, onSnapshot } from "firebase/firestore";

/** Safely determine if a grow is Active (not archived/consumed/contaminated). */
function isActiveGrow(g) {
  // We defensively check several common flags/fields and treat any truthy as not active.
  const archivedFlags = [
    g?.archived,
    g?.isArchived,
    g?.archivedAt,
    g?.autoArchived,
    g?.inArchive,
    g?.folder === "Archive",
    (g?.status || "").toLowerCase() === "archived",
    (g?.stage || "").toLowerCase() === "consumed",
    (g?.stage || "").toLowerCase() === "contaminated",
  ];
  return !archivedFlags.some(Boolean);
}

/**
 * TaskManager – enhanced tasks
 * (features list omitted for brevity; identical functionality to previous version)
 */
export default function TaskManager({
  tasks = [],
  grows = [],
  selectedGrowId = "",
  onCreate,
  onUpdate,
  onDelete,
}) {
  const MIN_INTERVAL = 1;

  // Reminder ticker (notifications, overdue, etc.)
  useTaskReminders({ tasks, onUpdate });

  // ---------- Fallback: auto-load grows if none provided ----------
  const [fallbackGrows, setFallbackGrows] = useState([]);
  useEffect(() => {
    if (grows && grows.length) return; // parent provided grows; skip fallback
    const uid = auth?.currentUser?.uid;
    if (!uid) return;

    const ref = collection(db, "users", uid, "grows");
    const unsub = onSnapshot(ref, (snap) => {
      const list = snap.docs.map((d) => {
        const g = d.data() || {};
        const name =
          g.abbreviation ||
          g.abbr ||
          g.subName ||
          g.strain ||
          g.name ||
          g.title ||
          d.id;
        return { id: d.id, name, ...g };
      });
      // Keep original order, we only filter here; sort happens where needed.
      setFallbackGrows(list);
    });
    return () => unsub();
  }, [grows]);

  const allGrows = grows && grows.length ? grows : fallbackGrows;

  // 👇 NEW: only active grows for the "Attach to grow" selector (task creation)
  const activeGrowOptions = useMemo(
    () =>
      (allGrows || [])
        .filter(isActiveGrow)
        .map((g) => ({ id: g.id, name: g.name || g.abbreviation || g.strain || g.title || g.id }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [allGrows]
  );

  // We still want a complete name map for display of existing tasks.
  const growNameById = useMemo(() => {
    const m = {};
    (allGrows || []).forEach((g) => (m[g.id] = g.name || g.abbreviation || g.strain || g.title || g.id));
    return m;
  }, [allGrows]);

  // ---------- Filters ----------
  const [filter, setFilter] = useState(selectedGrowId ? "grow" : "all");
  const [filterGrowId, setFilterGrowId] = useState(selectedGrowId || "");
  const [filterTags, setFilterTags] = useState([]);
  const [showCompleted, setShowCompleted] = useState(false);

  // Selection (bulk actions)
  const [selected, setSelected] = useState({}); // id -> true

  // Quick add
  const [quick, setQuick] = useState("");

  // Advanced form (manual entry)
  const initialForm = {
    title: "",
    date: "",
    time: "",
    growId: selectedGrowId || "",
    repeatInterval: "",
    repeatUnit: "days",
    remindLead: "",
    priority: "normal",
    tags: "",
    notes: "",
    subtasks: "",
  };
  const [form, setForm] = useState(initialForm);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Context defaulting
  useEffect(() => {
    if (selectedGrowId) {
      setForm((f) => ({ ...f, growId: selectedGrowId }));
      setFilter("grow");
      setFilterGrowId(selectedGrowId);
    }
  }, [selectedGrowId]);

  const tagSet = useMemo(() => {
    const s = new Set();
    tasks.forEach((t) => (t.tags || []).forEach((tg) => s.add(tg)));
    return Array.from(s).sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = tasks.slice();
    if (!showCompleted) list = list.filter((t) => !t.completedAt);
    if (filter === "general") list = list.filter((t) => !t.growId);
    if (filter === "grow" && filterGrowId) list = list.filter((t) => t.growId === filterGrowId);
    if (filterTags.length) list = list.filter((t) => (t.tags || []).some((tg) => filterTags.includes(tg)));
    list.sort((a, b) => {
      const pa = PRIORITIES.indexOf(a.priority || "normal");
      const pb = PRIORITIES.indexOf(b.priority || "normal");
      if (pa !== pb) return pb - pa; // high first
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      if (da !== db) return da - db;
      return (a.title || "").localeCompare(b.title || "");
    });
    return list;
  }, [tasks, showCompleted, filter, filterGrowId, filterTags]);

  const allChecked = filtered.length && filtered.every((t) => selected[t.id]);
  const someChecked = filtered.some((t) => selected[t.id]);

  const toggleAll = (val) => {
    const next = {};
    if (val) filtered.forEach((t) => (next[t.id] = true));
    setSelected(next);
  };

  // ----- Actions -----
  const submitQuick = (e) => {
    e.preventDefault();
    if (!quick.trim()) return;

    const parsed = parseQuickAdd(quick);
    const now = new Date();

    // Build payload from parsed + defaults
    let due = parsed.dueAt;
    if (form.growId && !parsed.dueAt && form.date) {
      due = new Date(form.date);
    }
    // Time-of-day
    if (!due && form.date) due = new Date(form.date);
    if (parsed.time) {
      const hhmm = parsed.time;
      if (due) {
        const [h, m] = hhmm.split(":");
        due.setHours(Number(h), Number(m), 0, 0);
      } else {
        due = combineDateAndTime(now.toISOString().slice(0, 10), hhmm);
      }
    } else if (due) {
      due = defaultTimeIfMissing(due);
    }

    const remindLead =
      parsed.remindLead != null
        ? parsed.remindLead
        : form.remindLead
        ? Math.max(0, parseInt(form.remindLead, 10))
        : null;

    const payload = {
      title: parsed.title || quick,
      dueAt: due ? due.toISOString() : null,
      growId: form.growId || null,
      repeatInterval: clampRepeat(parsed.repeatInterval ?? form.repeatInterval, MIN_INTERVAL),
      repeatUnit: parsed.repeatUnit || form.repeatUnit || null,
      priority: parsed.priority || form.priority || "normal",
      tags:
        parsed.tags && parsed.tags.length
          ? parsed.tags
          : form.tags
          ? form.tags.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      notes: form.notes || null,
      subtasks: form.subtasks
        ? form.subtasks.split("\n").map((s) => s.trim()).filter(Boolean).map((t) => ({ text: t, done: false }))
        : [],
      remindLead,
      complete: false,
      createdAt: new Date().toISOString(),
    };

    onCreate && onCreate(payload);
    setQuick("");
    setForm(initialForm);
  };

  const createManual = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    const due = combineDateAndTime(form.date, form.time) || null;

    const payload = {
      title: form.title.trim(),
      dueAt: due ? defaultTimeIfMissing(due).toISOString() : null,
      growId: form.growId || null,
      repeatInterval: clampRepeat(form.repeatInterval, MIN_INTERVAL),
      repeatUnit: form.repeatUnit || null,
      remindLead:
        form.remindLead !== "" && form.remindLead != null
          ? Math.max(0, parseInt(form.remindLead, 10))
          : null,
      priority: form.priority || "normal",
      tags: form.tags ? form.tags.split(",").map((s) => s.trim()).filter(Boolean) : [],
      notes: form.notes || null,
      subtasks: form.subtasks
        ? form.subtasks.split("\n").map((s) => s.trim()).filter(Boolean).map((t) => ({ text: t, done: false }))
        : [],
      complete: false,
      createdAt: new Date().toISOString(),
    };

    onCreate && onCreate(payload);
    setForm(initialForm);
  };

  // Check-off + auto-schedule next
  const toggleComplete = (t) => {
    const markingComplete = !t.completedAt;

    if (markingComplete && t.repeatInterval && t.repeatUnit) {
      const nextDue = computeNextDue(t.dueAt || new Date(), t.repeatInterval, t.repeatUnit);
      onCreate &&
        onCreate({
          title: t.title,
          dueAt: nextDue ? nextDue.toISOString() : null,
          growId: t.growId || null,
          repeatInterval: clampRepeat(t.repeatInterval, MIN_INTERVAL),
          repeatUnit: t.repeatUnit,
          remindLead: t.remindLead || null,
          priority: t.priority || "normal",
          tags: t.tags || [],
          notes: t.notes || null,
          subtasks: (t.subtasks || []).map((s) => ({ ...s, done: false })),
          complete: false,
          createdAt: new Date().toISOString(),
        });
    }

    const patch = { completedAt: markingComplete ? new Date().toISOString() : null };
    onUpdate && onUpdate(t.id, patch);
  };

  const scheduleNext = (t) => {
    if (!t.repeatInterval || !t.repeatUnit) return;
    const nextDue = computeNextDue(t.dueAt || new Date(), t.repeatInterval, t.repeatUnit);
    onCreate &&
      onCreate({
        title: t.title,
        dueAt: nextDue ? nextDue.toISOString() : null,
        growId: t.growId || null,
        repeatInterval: clampRepeat(t.repeatInterval, MIN_INTERVAL),
        repeatUnit: t.repeatUnit,
        remindLead: t.remindLead || null,
        priority: t.priority || "normal",
        tags: t.tags || [],
        notes: t.notes || null,
        subtasks: (t.subtasks || []).map((s) => ({ ...s, done: false })),
        complete: false,
        createdAt: new Date().toISOString(),
      });
  };

  // Snooze
  const snooze = (t, minutes) => {
    const base = t.dueAt ? new Date(t.dueAt) : new Date();
    const next = new Date(base.getTime() + minutes * 60000);
    onUpdate && onUpdate(t.id, { dueAt: next.toISOString(), lastNotifiedAt: null });
  };

  // Bulk actions
  const ids = Object.keys(selected).filter((k) => selected[k]);
  const bulkComplete = () => ids.forEach((id) => onUpdate && onUpdate(id, { completedAt: new Date().toISOString() }));
  const bulkDelete = () => ids.forEach((id) => onDelete && onDelete(id));
  const bulkSnooze = (m) =>
    ids.forEach((id) => {
      const t = tasks.find((x) => x.id === id);
      if (t) snooze(t, m);
    });

  // Analytics
  const stats = analytics(tasks);

  return (
    <div className="space-y-6">
      {/* Header: filters + export + analytics */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            title="Filter scope"
          >
            <option value="all">All</option>
            <option value="general">General</option>
            <option value="grow">By Grow</option>
          </select>

          {filter === "grow" && (
            <select
              className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
              value={filterGrowId}
              onChange={(e) => setFilterGrowId(e.target.value)}
            >
              <option value="">All grows</option>
              {(allGrows || [])
                .slice()
                .sort((a, b) =>
                  (a.name || a.abbreviation || a.strain || "").localeCompare(b.name || b.abbreviation || b.strain || "")
                )
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name || g.abbreviation || g.strain || g.id}
                  </option>
                ))}
            </select>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 ml-2">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />
            Show completed
          </label>

          {/* Quick tag filters */}
          {tagSet.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 ml-2">
              {tagSet.map((tg) => {
                const active = filterTags.includes(tg);
                return (
                  <button
                    key={tg}
                    onClick={() =>
                      setFilterTags((prev) =>
                        active ? prev.filter((x) => x !== tg) : [...prev, tg]
                      )
                    }
                    className={`px-2 py-1 rounded text-xs border ${
                      active
                        ? "bg-amber-600 text-white border-amber-600"
                        : "bg-white dark:bg-zinc-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-zinc-700"
                    }`}
                    title={`Filter tag: ${tg}`}
                  >
                    #{tg}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-600 dark:text-gray-300">
            <span className="font-semibold">{stats.total}</span> tasks •
            <span className="ml-1 font-semibold">{stats.completionRate}%</span> complete •
            <span className="ml-1">{stats.avgDelayHrs}h avg delay</span>
          </div>
          <button
            className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
            onClick={() => downloadICS(tasks)}
            title="Export .ics"
          >
            Export .ics
          </button>
        </div>
      </div>

      {/* Quick add */}
      <form onSubmit={submitQuick} className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
          placeholder={`Quick add (e.g. "Mist & fan in 3d @ 7pm every 2d !high #fruiting remind 2h")`}
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
        />
        <button className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700" type="submit">
          Add
        </button>
      </form>

      {/* Advanced form (toggle) */}
      <button className="text-sm text-blue-600 hover:underline" onClick={() => setAdvancedOpen((v) => !v)}>
        {advancedOpen ? "Hide advanced" : "Show advanced"}
      </button>

      {advancedOpen && (
        <form onSubmit={createManual} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="md:col-span-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            placeholder="Task title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />

          {/* 👇 Attach to Active grow only */}
          <select
            className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            value={form.growId}
            onChange={(e) => setForm((f) => ({ ...f, growId: e.target.value }))}
          >
            <option value="">General (no grow)</option>
            {activeGrowOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name || g.id}
              </option>
            ))}
          </select>

          <input
            type="date"
            className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <input
            type="time"
            className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            value={form.time}
            onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
          />

          <div className="grid grid-cols-2 gap-2">
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
              min={MIN_INTERVAL}
              step="1"
              className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
              placeholder="Repeat every…"
              value={form.repeatInterval}
              onChange={(e) =>
                setForm((f) => ({ ...f, repeatInterval: clampRepeat(e.target.value, MIN_INTERVAL) ?? "" }))
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={0}
              step="5"
              className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
              placeholder="Remind minutes before"
              value={form.remindLead}
              onChange={(e) => setForm((f) => ({ ...f, remindLead: e.target.value.replace(/[^\d]/g, "") }))}
            />
            <select
              className="rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <input
            className="md:col-span-3 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            placeholder="Comma-separated tags, e.g., Sterile,Fruiting,Harvest"
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
          />

          <textarea
            className="md:col-span-3 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            rows={3}
            placeholder="Notes / links"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />

          <textarea
            className="md:col-span-3 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-white px-3 py-2"
            rows={3}
            placeholder="Subtasks (one per line)"
            value={form.subtasks}
            onChange={(e) => setForm((f) => ({ ...f, subtasks: e.target.value }))}
          />

          <button type="submit" className="md:col-span-3 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            Add Task
          </button>
        </form>
      )}

      {/* Bulk actions */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!allChecked}
            ref={(el) => el && (el.indeterminate = !allChecked && someChecked)}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          Select all in view
        </label>
        {someChecked && (
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded bg-emerald-600 text-white text-xs" onClick={bulkComplete}>
              Complete
            </button>
            <button className="px-2 py-1 rounded bg-amber-600 text-white text-xs" onClick={() => bulkSnooze(60)}>
              Snooze +1h
            </button>
            <button className="px-2 py-1 rounded bg-amber-700 text-white text-xs" onClick={() => bulkSnooze(60 * 24)}>
              Snooze +1d
            </button>
            <button className="px-2 py-1 rounded bg-red-600 text-white text-xs" onClick={bulkDelete}>
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Task list */}
      <div className="divide-y divide-gray-200 dark:divide-zinc-800 rounded-xl border border-gray-200 dark:border-zinc-800 overflow-hidden">
        {filtered.map((t) => {
          const overdue = t.dueAt && new Date(t.dueAt) < new Date() && !t.completedAt;
          const pr = t.priority || "normal";
          const prClass = pr === "high" ? "ring-2 ring-red-500" : pr === "low" ? "opacity-80" : "";
          const growName = t.growName || (t.growId ? growNameById[t.growId] : null);

          return (
            <div
              key={t.id}
              className={`flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-3 bg-white dark:bg-zinc-900 ${prClass}`}
            >
              <div className="flex items-start gap-3 w-full md:w-auto">
                <input
                  type="checkbox"
                  checked={!!selected[t.id]}
                  onChange={(e) => setSelected((s) => ({ ...s, [t.id]: e.target.checked }))}
                />
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!t.completedAt}
                  onChange={() => toggleComplete(t)}
                  title="Mark complete"
                />
                <div className="text-sm">
                  <div className={`font-semibold ${t.completedAt ? "line-through" : ""}`}>{t.title}</div>
                  <div className="text-gray-500 dark:text-gray-400">
                    {t.growId ? (
                      <span className="mr-2">
                        Grow: <strong>{growName || t.growId}</strong>
                      </span>
                    ) : (
                      <span className="mr-2">General</span>
                    )}
                    Due: {t.dueAt ? new Date(t.dueAt).toLocaleString() : "—"}
                    {overdue && <span className="ml-2 text-red-600">Overdue</span>}
                  </div>
                  {!!(t.tags && t.tags.length) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.tags.map((tg) => (
                        <span key={tg} className="px-2 py-0.5 rounded text-xs bg-slate-200 dark:bg-zinc-800">
                          {tg}
                        </span>
                      ))}
                    </div>
                  )}
                  {!!t.notes && (
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words">
                      {t.notes}
                    </div>
                  )}
                  {!!(t.subtasks && t.subtasks.length) && (
                    <div className="mt-2 border border-gray-200 dark:border-zinc-800 rounded p-2">
                      {t.subtasks.map((s, idx) => (
                        <label key={idx} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={!!s.done}
                            onChange={() =>
                              onUpdate &&
                              onUpdate(t.id, {
                                subtasks: t.subtasks.map((ss, i) => (i === idx ? { ...ss, done: !ss.done } : ss)),
                              })
                            }
                          />
                          <span className={s.done ? "line-through" : ""}>{s.text}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!!t.repeatInterval && (
                  <button
                    className="px-2 py-1 rounded bg-emerald-600 text-white text-xs"
                    onClick={() => scheduleNext(t)}
                    title="Schedule next"
                  >
                    Next
                  </button>
                )}
                <button className="px-2 py-1 rounded bg-amber-600 text-white text-xs" onClick={() => snooze(t, 60)} title="Snooze +1h">
                  +1h
                </button>
                <button
                  className="px-2 py-1 rounded bg-amber-700 text-white text-xs"
                  onClick={() => snooze(t, 60 * 24)}
                  title="Snooze +1d"
                >
                  +1d
                </button>
                <button className="px-2 py-1 rounded bg-red-600 text-white text-xs" onClick={() => onDelete && onDelete(t.id)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && <div className="p-4 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-zinc-900">No tasks match the filters.</div>}
      </div>
    </div>
  );
}
