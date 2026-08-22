// tests/unit/reminderUtils.test.js
import { describe, expect, it } from "vitest";
import { getTaskReminderState, parseReminderTimeMs } from "../../src/lib/reminder-utils";

describe("task reminder state", () => {
  const dueAt = "2026-07-26T18:00:00.000Z";
  const dueMs = new Date(dueAt).getTime();

  it("does not notify before the configured lead window", () => {
    const state = getTaskReminderState(
      { id: "task-1", title: "Check grow", dueAt, remindLead: 30 },
      dueMs - 31 * 60_000
    );

    expect(state?.shouldNotify).toBe(false);
  });

  it("notifies once the lead window is reached", () => {
    const state = getTaskReminderState(
      { id: "task-1", title: "Check grow", dueAt, remindLead: 30 },
      dueMs - 30 * 60_000
    );

    expect(state?.shouldNotify).toBe(true);
    expect(state?.key).toContain("task:task-1:");
    expect(state?.leadMinutes).toBe(30);
  });

  it("does not repeat a reminder with the same notification key", () => {
    const first = getTaskReminderState(
      { id: "task-1", title: "Check grow", dueAt, remindLead: 30 },
      dueMs
    );
    const second = getTaskReminderState(
      {
        id: "task-1",
        title: "Check grow",
        dueAt,
        remindLead: 30,
        lastNotifiedKey: first?.key,
        lastNotifiedAt: new Date(dueMs).toISOString(),
      },
      dueMs + 60 * 60_000
    );

    expect(first?.shouldNotify).toBe(true);
    expect(second?.shouldNotify).toBe(false);
  });

  it("respects legacy lastNotifiedAt records", () => {
    const state = getTaskReminderState(
      {
        id: "task-1",
        dueAt,
        remindLead: 15,
        lastNotifiedAt: new Date(dueMs - 10 * 60_000).toISOString(),
      },
      dueMs + 60_000
    );

    expect(state?.shouldNotify).toBe(false);
  });

  it("allows a rescheduled task to receive a new reminder", () => {
    const oldState = getTaskReminderState(
      { id: "task-1", dueAt, remindLead: 0 },
      dueMs
    );
    const newDueAt = "2026-07-27T18:00:00.000Z";
    const newDueMs = new Date(newDueAt).getTime();
    const rescheduled = getTaskReminderState(
      {
        id: "task-1",
        dueAt: newDueAt,
        remindLead: 0,
        lastNotifiedKey: oldState?.key,
        lastNotifiedAt: dueAt,
      },
      newDueMs
    );

    expect(rescheduled?.key).not.toBe(oldState?.key);
    expect(rescheduled?.shouldNotify).toBe(true);
  });

  it("ignores completed tasks and invalid dates", () => {
    expect(getTaskReminderState({ id: "done", dueAt, completedAt: dueAt }, dueMs)).toBeNull();
    expect(getTaskReminderState({ id: "bad", dueAt: "not-a-date" }, dueMs)).toBeNull();
    expect(parseReminderTimeMs("not-a-date")).toBeNull();
  });
});
