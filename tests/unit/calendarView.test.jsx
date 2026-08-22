// tests/unit/calendarView.test.jsx
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CALENDAR_FILTERS,
  buildTaskEvents,
  eventPropGetter,
  filterCalendarEvents,
  isSopGeneratedTask,
  normalizeCalendarFilters,
} from "../../src/pages/CalendarView.jsx";

describe("Calendar task integration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the canonical dueAt field before legacy task date fields", () => {
    const dueAt = "2026-08-15T09:30:00.000Z";
    const events = buildTaskEvents([
      {
        id: "task-1",
        title: "Check colonization",
        dueAt,
        dueDate: "2026-08-20T09:30:00.000Z",
        createdAt: "2026-08-01T09:30:00.000Z",
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].start.toISOString()).toBe(dueAt);
    expect(events[0].task.id).toBe("task-1");
  });

  it("keeps legacy dueDate support for older task records", () => {
    const dueDate = "2026-08-18T14:00:00.000Z";
    const events = buildTaskEvents([
      {
        id: "legacy-task",
        title: "Legacy task",
        dueDate,
      },
    ]);

    expect(events[0].start.toISOString()).toBe(dueDate);
  });

  it("omits undated tasks instead of placing them on createdAt or today", () => {
    const events = buildTaskEvents([
      {
        id: "undated-task",
        title: "No due date",
        createdAt: "2026-08-01T09:30:00.000Z",
      },
    ]);

    expect(events).toEqual([]);
  });

  it("styles completedAt tasks as completed instead of overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));

    const event = buildTaskEvents([
      {
        id: "completed-task",
        title: "Finished task",
        dueAt: "2026-08-10T09:00:00.000Z",
        completedAt: "2026-08-11T10:00:00.000Z",
      },
    ])[0];

    expect(eventPropGetter(event).style.backgroundColor).toBe("#64748b");
  });

  it("recognizes current SOP-generated task metadata", () => {
    expect(isSopGeneratedTask({ workflowTemplateId: "sop-1" })).toBe(true);
    expect(isSopGeneratedTask({ taskSource: "sop-template" })).toBe(true);
    expect(isSopGeneratedTask({ tags: ["workflow"] })).toBe(true);
    expect(isSopGeneratedTask({ source: "manual", tags: ["check"] })).toBe(false);
  });

  it("filters open and completed tasks independently", () => {
    const events = buildTaskEvents([
      { id: "open", title: "Open", dueAt: "2026-08-15T09:30:00.000Z" },
      {
        id: "done",
        title: "Done",
        dueAt: "2026-08-16T09:30:00.000Z",
        completedAt: "2026-08-16T10:00:00.000Z",
      },
    ]);

    const openOnly = filterCalendarEvents(events, {
      ...DEFAULT_CALENDAR_FILTERS,
      showCompletedTasks: false,
    });
    const completedOnly = filterCalendarEvents(events, {
      ...DEFAULT_CALENDAR_FILTERS,
      showOpenTasks: false,
    });

    expect(openOnly.map((event) => event.id)).toEqual(["open"]);
    expect(completedOnly.map((event) => event.id)).toEqual(["done"]);
  });

  it("filters manual and SOP-generated tasks without hiding grow milestones", () => {
    const taskEvents = buildTaskEvents([
      { id: "manual", title: "Manual", dueAt: "2026-08-15T09:30:00.000Z" },
      {
        id: "sop",
        title: "SOP",
        dueAt: "2026-08-16T09:30:00.000Z",
        workflowTemplateId: "workflow-1",
      },
    ]);
    const growEvent = {
      id: "grow-1-Inoculated",
      title: "Grow — Inoculated",
      kind: "grow",
      start: new Date("2026-08-14T00:00:00.000Z"),
      end: new Date("2026-08-14T00:00:00.000Z"),
    };

    const sopOnly = filterCalendarEvents([growEvent, ...taskEvents], {
      ...DEFAULT_CALENDAR_FILTERS,
      taskSource: "sop",
    });

    expect(sopOnly.map((event) => event.id)).toEqual(["grow-1-Inoculated", "sop"]);
  });

  it("normalizes invalid persisted filter values safely", () => {
    expect(
      normalizeCalendarFilters({
        showGrowMilestones: false,
        showOpenTasks: "no",
        taskSource: "unknown",
      })
    ).toEqual({
      showGrowMilestones: false,
      showOpenTasks: true,
      showCompletedTasks: true,
      taskSource: "all",
    });
  });
});
