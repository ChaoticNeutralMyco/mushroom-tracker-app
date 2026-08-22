// functions/src/entitlementModel.js

import { createHash } from "node:crypto";
import {
  EXISTING_ACCOUNT_TRIAL_ROLLOUT_AT,
  PUBLIC_SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_DAY_MS,
  SUBSCRIPTION_PAST_DUE_GRACE_DAYS,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TRIAL_DURATION_DAYS,
} from "./subscriptionConfig.js";

const VALID_PLAN_IDS = new Set(Object.values(SUBSCRIPTION_PLAN_IDS));
const VALID_PUBLIC_PLAN_IDS = new Set(PUBLIC_SUBSCRIPTION_PLAN_IDS);
const VALID_STATUSES = new Set(Object.values(SUBSCRIPTION_STATUSES));
const VALID_SOURCES = new Set(Object.values(SUBSCRIPTION_SOURCES));

export class EntitlementValidationError extends Error {
  constructor(message, code = "invalid-argument") {
    super(message);
    this.name = "EntitlementValidationError";
    this.code = code;
  }
}

export function asValidDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  if (value && typeof value.toDate === "function") {
    return asValidDate(value.toDate());
  }

  if (value && typeof value.seconds === "number") {
    return asValidDate(
      value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000)
    );
  }

  return null;
}

export function requireUid(uid) {
  const normalized = typeof uid === "string" ? uid.trim() : "";
  if (!normalized) {
    throw new EntitlementValidationError("A Firebase user id is required.");
  }
  return normalized;
}

export function requireEventId(eventId) {
  const normalized = typeof eventId === "string" ? eventId.trim() : "";
  if (!normalized || normalized.length > 180 || normalized.includes("/")) {
    throw new EntitlementValidationError(
      "A non-empty event id without slashes is required."
    );
  }
  return normalized;
}

export function requirePlanId(planId, { publicOnly = false } = {}) {
  const normalized = typeof planId === "string" ? planId.trim().toLowerCase() : "";
  const valid = publicOnly
    ? VALID_PUBLIC_PLAN_IDS.has(normalized)
    : VALID_PLAN_IDS.has(normalized);

  if (!valid) {
    throw new EntitlementValidationError(`Unknown subscription plan: ${planId}`);
  }

  return normalized;
}

export function requireStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (!VALID_STATUSES.has(normalized)) {
    throw new EntitlementValidationError(`Unknown subscription status: ${status}`);
  }
  return normalized;
}

export function requireSource(source) {
  const normalized = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (!VALID_SOURCES.has(normalized)) {
    throw new EntitlementValidationError(`Unknown subscription source: ${source}`);
  }
  return normalized;
}

export function getTrialStartDate({
  accountCreatedAt = null,
  rolloutStartedAt = EXISTING_ACCOUNT_TRIAL_ROLLOUT_AT,
  now = new Date(),
} = {}) {
  const currentDate = asValidDate(now) || new Date();
  const createdAt = asValidDate(accountCreatedAt);
  const rolloutAt = asValidDate(rolloutStartedAt);

  if (createdAt && rolloutAt) {
    return new Date(Math.max(createdAt.getTime(), rolloutAt.getTime()));
  }

  return createdAt || rolloutAt || currentDate;
}

export function buildTrialWindow(options = {}) {
  const trialStartedAt = getTrialStartDate(options);
  const trialEndsAt = new Date(
    trialStartedAt.getTime() + SUBSCRIPTION_TRIAL_DURATION_DAYS * SUBSCRIPTION_DAY_MS
  );

  return { trialStartedAt, trialEndsAt };
}

export function getInitialTrialStatus({ trialEndsAt, now = new Date() }) {
  const end = asValidDate(trialEndsAt);
  const currentDate = asValidDate(now) || new Date();

  return end && end.getTime() <= currentDate.getTime()
    ? SUBSCRIPTION_STATUSES.EXPIRED
    : SUBSCRIPTION_STATUSES.TRIALING;
}

export function buildInitialTrialEntitlement({
  accountCreatedAt = null,
  now = new Date(),
  rolloutStartedAt = EXISTING_ACCOUNT_TRIAL_ROLLOUT_AT,
} = {}) {
  const window = buildTrialWindow({ accountCreatedAt, rolloutStartedAt, now });

  return {
    planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
    status: getInitialTrialStatus({ trialEndsAt: window.trialEndsAt, now }),
    source: SUBSCRIPTION_SOURCES.TRIAL,
    trialStartedAt: window.trialStartedAt,
    trialEndsAt: window.trialEndsAt,
    currentPeriodEndsAt: null,
    pastDueStartedAt: null,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    cancellationEffectiveAt: null,
    accessGrantedThroughGrace: false,
    testerCodeId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    featureOverrides: {},
    limitOverrides: {},
  };
}

export function getPastDueGraceWindow(startedAt) {
  const pastDueStartedAt = asValidDate(startedAt);
  if (!pastDueStartedAt) {
    throw new EntitlementValidationError(
      "A trusted past-due start time is required."
    );
  }

  return {
    pastDueStartedAt,
    graceEndsAt: new Date(
      pastDueStartedAt.getTime() +
        SUBSCRIPTION_PAST_DUE_GRACE_DAYS * SUBSCRIPTION_DAY_MS
    ),
  };
}

export function normalizeTesterCode(code) {
  return typeof code === "string"
    ? code.trim().replace(/\s+/g, "-").toUpperCase()
    : "";
}

export function hashTesterCode(code) {
  const normalized = normalizeTesterCode(code);
  if (normalized.length < 6 || normalized.length > 128) {
    throw new EntitlementValidationError(
      "Tester code must contain between 6 and 128 characters."
    );
  }

  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function sanitizeFeatureOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, access]) => typeof access === "boolean")
  );
}

export function sanitizeLimitOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, limit]) => {
      return (
        limit === null ||
        (typeof limit === "number" && Number.isFinite(limit) && limit >= 0)
      );
    })
  );
}

export function entitlementShouldExpire(entitlement, now = new Date()) {
  const currentDate = asValidDate(now) || new Date();
  const status = entitlement?.status;
  const source = entitlement?.source;

  if (status === SUBSCRIPTION_STATUSES.TRIALING) {
    const trialEndsAt = asValidDate(entitlement?.trialEndsAt);
    return Boolean(trialEndsAt && trialEndsAt.getTime() <= currentDate.getTime());
  }

  if (status === SUBSCRIPTION_STATUSES.PAST_DUE) {
    const graceEndsAt = asValidDate(entitlement?.graceEndsAt);
    if (!graceEndsAt) return true;
    return graceEndsAt.getTime() <= currentDate.getTime();
  }

  if (
    status === SUBSCRIPTION_STATUSES.ACTIVE &&
    source === SUBSCRIPTION_SOURCES.TESTER_CODE
  ) {
    const currentPeriodEndsAt = asValidDate(entitlement?.currentPeriodEndsAt);
    return Boolean(
      currentPeriodEndsAt && currentPeriodEndsAt.getTime() <= currentDate.getTime()
    );
  }

  if (
    status === SUBSCRIPTION_STATUSES.ACTIVE &&
    source === SUBSCRIPTION_SOURCES.STRIPE &&
    entitlement?.cancelAtPeriodEnd === true
  ) {
    const cancellationEffectiveAt =
      asValidDate(entitlement?.cancellationEffectiveAt) ||
      asValidDate(entitlement?.currentPeriodEndsAt);
    return Boolean(
      cancellationEffectiveAt &&
        cancellationEffectiveAt.getTime() <= currentDate.getTime()
    );
  }

  return false;
}

export function getExpirationReason(entitlement) {
  if (entitlement?.status === SUBSCRIPTION_STATUSES.TRIALING) {
    return "trial_expired";
  }
  if (entitlement?.status === SUBSCRIPTION_STATUSES.PAST_DUE) {
    return entitlement?.graceEndsAt
      ? "past_due_grace_expired"
      : "past_due_missing_trusted_grace_anchor";
  }
  if (
    entitlement?.status === SUBSCRIPTION_STATUSES.ACTIVE &&
    entitlement?.source === SUBSCRIPTION_SOURCES.STRIPE &&
    entitlement?.cancelAtPeriodEnd === true
  ) {
    return "stripe_cancellation_period_ended";
  }
  if (entitlement?.source === SUBSCRIPTION_SOURCES.TESTER_CODE) {
    return "tester_code_expired";
  }
  return "entitlement_expired";
}
