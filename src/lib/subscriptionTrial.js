// src/lib/subscriptionTrial.js

import {
  SUBSCRIPTION_ENTITLEMENT_SOURCES,
  SUBSCRIPTION_ENTITLEMENT_STATUSES,
  buildDefaultSubscriptionEntitlement,
  isTrialEntitlement,
  normalizeSubscriptionEntitlement,
} from "./subscriptionEntitlements.js";

import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_TRIAL_CONFIG,
} from "./subscriptionPlans.js";

export const SUBSCRIPTION_TRIAL_DAY_MS = 24 * 60 * 60 * 1000;

export function toSubscriptionDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (value && typeof value.toDate === "function") {
    return toSubscriptionDate(value.toDate());
  }

  if (value && typeof value.seconds === "number") {
    const milliseconds =
      value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
    return toSubscriptionDate(milliseconds);
  }

  return null;
}

export function buildTrialWindow(startedAt = new Date()) {
  const start = toSubscriptionDate(startedAt);

  if (!start) {
    throw new TypeError("A valid trial start date is required.");
  }

  const end = new Date(
    start.getTime() +
      SUBSCRIPTION_TRIAL_CONFIG.durationDays * SUBSCRIPTION_TRIAL_DAY_MS
  );

  return {
    trialStartedAt: start.toISOString(),
    trialEndsAt: end.toISOString(),
  };
}

export function buildTrialEntitlement(startedAt = new Date(), overrides = {}) {
  return buildDefaultSubscriptionEntitlement({
    planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
    status: SUBSCRIPTION_ENTITLEMENT_STATUSES.TRIALING,
    source: SUBSCRIPTION_ENTITLEMENT_SOURCES.TRIAL,
    ...buildTrialWindow(startedAt),
    ...overrides,
  });
}

export function getTrialMillisecondsRemaining(entitlement, now = new Date()) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);
  const end = toSubscriptionDate(normalized.trialEndsAt);
  const current = toSubscriptionDate(now);

  if (!isTrialEntitlement(normalized) || !end || !current) {
    return null;
  }

  return end.getTime() - current.getTime();
}

export function getTrialDaysRemaining(entitlement, now = new Date()) {
  const milliseconds = getTrialMillisecondsRemaining(entitlement, now);

  if (milliseconds === null) {
    return null;
  }

  return Math.max(0, Math.ceil(milliseconds / SUBSCRIPTION_TRIAL_DAY_MS));
}

export function isTrialExpired(entitlement, now = new Date()) {
  const milliseconds = getTrialMillisecondsRemaining(entitlement, now);
  return milliseconds !== null && milliseconds <= 0;
}

export function getTrialNoticeDateKey(
  value = new Date(),
  timeZone = SUBSCRIPTION_TRIAL_CONFIG.defaultDismissalTimeZone
) {
  const date = toSubscriptionDate(value);

  if (!date) {
    return null;
  }

  let parts;

  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: SUBSCRIPTION_TRIAL_CONFIG.defaultDismissalTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  }

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export function getTrialNoticeState({
  entitlement,
  now = new Date(),
  lastDismissedDateKey = null,
  expirationAcknowledged = false,
  timeZone = SUBSCRIPTION_TRIAL_CONFIG.defaultDismissalTimeZone,
} = {}) {
  const normalized = normalizeSubscriptionEntitlement(entitlement);
  const millisecondsRemaining = getTrialMillisecondsRemaining(normalized, now);
  const daysRemaining = getTrialDaysRemaining(normalized, now);
  const dateKey = getTrialNoticeDateKey(now, timeZone);
  const dismissedToday = Boolean(
    dateKey && lastDismissedDateKey && dateKey === lastDismissedDateKey
  );

  if (millisecondsRemaining === null || daysRemaining === null) {
    return {
      shouldShow: false,
      phase: "none",
      daysRemaining: null,
      dateKey,
      dismissedToday,
      upgradeAvailable: false,
    };
  }

  const expired = millisecondsRemaining <= 0;
  const endsToday = !expired && millisecondsRemaining <= SUBSCRIPTION_TRIAL_DAY_MS;
  const warningWindow =
    !expired &&
    daysRemaining <= SUBSCRIPTION_TRIAL_CONFIG.reminderStartsDaysRemaining;

  let phase = "none";

  if (expired) {
    phase = "expired";
  } else if (endsToday) {
    phase = "ends_today";
  } else if (warningWindow) {
    phase = "warning";
  }

  return {
    shouldShow:
      phase !== "none" &&
      !dismissedToday &&
      !(phase === "expired" && expirationAcknowledged),
    phase,
    daysRemaining,
    dateKey,
    dismissedToday,
    upgradeAvailable: SUBSCRIPTION_TRIAL_CONFIG.upgradeActionEnabled,
  };
}

export function buildTrialExpirationFallbackEntitlement() {
  return buildDefaultSubscriptionEntitlement({
    planId: SUBSCRIPTION_TRIAL_CONFIG.expirationFallbackPlanId,
    status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
    source: SUBSCRIPTION_ENTITLEMENT_SOURCES.DEFAULT,
  });
}
