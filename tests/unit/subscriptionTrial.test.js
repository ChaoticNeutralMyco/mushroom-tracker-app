// tests/unit/subscriptionTrial.test.js

import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_TRIAL_DAY_MS,
  buildTrialEntitlement,
  buildTrialExpirationFallbackEntitlement,
  buildTrialWindow,
  getTrialDaysRemaining,
  getTrialMillisecondsRemaining,
  getTrialNoticeDateKey,
  getTrialNoticeState,
  isTrialExpired,
  toSubscriptionDate,
} from "../../src/lib/subscriptionTrial.js";

import {
  SUBSCRIPTION_ENTITLEMENT_STATUSES,
} from "../../src/lib/subscriptionEntitlements.js";

import { SUBSCRIPTION_PLAN_IDS } from "../../src/lib/subscriptionPlans.js";

describe("subscriptionTrial pure helpers", () => {
  const startedAt = new Date("2026-07-01T12:00:00.000Z");

  it("builds an exact fourteen-day trial window", () => {
    expect(buildTrialWindow(startedAt)).toEqual({
      trialStartedAt: "2026-07-01T12:00:00.000Z",
      trialEndsAt: "2026-07-15T12:00:00.000Z",
    });

    const entitlement = buildTrialEntitlement(startedAt);
    expect(entitlement).toMatchObject({
      planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING,
      trialEndsAt: "2026-07-15T12:00:00.000Z",
    });
  });

  it("accepts Date, ISO, numeric, and Firestore-like timestamp values", () => {
    expect(toSubscriptionDate(startedAt)?.toISOString()).toBe(startedAt.toISOString());
    expect(toSubscriptionDate(startedAt.toISOString())?.toISOString()).toBe(startedAt.toISOString());
    expect(toSubscriptionDate(startedAt.getTime())?.toISOString()).toBe(startedAt.toISOString());
    expect(
      toSubscriptionDate({ seconds: startedAt.getTime() / 1000, nanoseconds: 0 })?.toISOString()
    ).toBe(startedAt.toISOString());
    expect(toSubscriptionDate({ toDate: () => startedAt })?.toISOString()).toBe(startedAt.toISOString());
    expect(toSubscriptionDate("not-a-date")).toBeNull();
  });

  it("calculates remaining time and days", () => {
    const entitlement = buildTrialEntitlement(startedAt);
    const now = new Date("2026-07-08T12:00:00.000Z");

    expect(getTrialMillisecondsRemaining(entitlement, now)).toBe(7 * SUBSCRIPTION_TRIAL_DAY_MS);
    expect(getTrialDaysRemaining(entitlement, now)).toBe(7);
    expect(isTrialExpired(entitlement, now)).toBe(false);
  });

  it("does not show the notice before the seven-day warning window", () => {
    const entitlement = buildTrialEntitlement(startedAt);
    const state = getTrialNoticeState({
      entitlement,
      now: new Date("2026-07-08T11:59:59.000Z"),
    });

    expect(state).toMatchObject({
      shouldShow: false,
      phase: "none",
      daysRemaining: 8,
    });
  });

  it("shows a required daily warning with seven days remaining", () => {
    const entitlement = buildTrialEntitlement(startedAt);
    const state = getTrialNoticeState({
      entitlement,
      now: new Date("2026-07-08T12:00:00.000Z"),
      timeZone: "America/Denver",
    });

    expect(state).toMatchObject({
      shouldShow: true,
      phase: "warning",
      daysRemaining: 7,
      dismissedToday: false,
      upgradeAvailable: true,
    });
    expect(state.dateKey).toBe("2026-07-08");
  });

  it("suppresses the notice after the account date has been dismissed", () => {
    const entitlement = buildTrialEntitlement(startedAt);
    const now = new Date("2026-07-10T18:00:00.000Z");
    const dateKey = getTrialNoticeDateKey(now, "America/Denver");

    expect(
      getTrialNoticeState({
        entitlement,
        now,
        timeZone: "America/Denver",
        lastDismissedDateKey: dateKey,
      })
    ).toMatchObject({
      shouldShow: false,
      dismissedToday: true,
      phase: "warning",
    });
  });

  it("uses an ends-today phase during the final twenty-four hours", () => {
    const entitlement = buildTrialEntitlement(startedAt);
    const state = getTrialNoticeState({
      entitlement,
      now: new Date("2026-07-15T00:00:00.000Z"),
    });

    expect(state).toMatchObject({
      shouldShow: true,
      phase: "ends_today",
      daysRemaining: 1,
    });
  });

  it("reports expiration and builds a non-destructive Free fallback", () => {
    const entitlement = buildTrialEntitlement(startedAt);
    const now = new Date("2026-07-15T12:00:00.000Z");

    expect(isTrialExpired(entitlement, now)).toBe(true);
    expect(getTrialNoticeState({ entitlement, now })).toMatchObject({
      shouldShow: true,
      phase: "expired",
      daysRemaining: 0,
    });
    expect(
      getTrialNoticeState({
        entitlement,
        now,
        expirationAcknowledged: true,
      })
    ).toMatchObject({
      shouldShow: false,
      phase: "expired",
      daysRemaining: 0,
    });
    expect(buildTrialExpirationFallbackEntitlement()).toMatchObject({
      planId: SUBSCRIPTION_PLAN_IDS.FREE,
      status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
    });
  });
});
