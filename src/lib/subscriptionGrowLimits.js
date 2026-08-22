// src/lib/subscriptionGrowLimits.js

import { isActiveGrow } from "./growFilters.js";

const ARCHIVE_CLEAR_KEYS = Object.freeze([
  "archived",
  "archivedAt",
  "archivedOn",
  "archived_on",
  "isArchived",
  "inArchive",
  "deleted",
  "deletedAt",
]);

export const ACTIVE_GROW_LIMIT_ERROR_CODE = "active-grow-limit-reached";

export class ActiveGrowLimitError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ActiveGrowLimitError";
    this.code = ACTIVE_GROW_LIMIT_ERROR_CODE;
    this.details = details;
  }
}

export function normalizeActiveGrowLimit(value) {
  if (value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

export function getActiveGrowUsage(grows = []) {
  return (Array.isArray(grows) ? grows : []).filter(isActiveGrow).length;
}

export function countRequestedActiveGrows(payloads = []) {
  const list = Array.isArray(payloads) ? payloads : [payloads];
  return list.filter((payload) => isActiveGrow(payload || {})).length;
}

export function getActiveGrowLimitState({
  activeGrowCount = 0,
  activeGrowLimit = null,
  requestedCount = 0,
} = {}) {
  const usageNumber = Number(activeGrowCount);
  const requestNumber = Number(requestedCount);
  const usage = Number.isFinite(usageNumber) ? Math.max(0, Math.floor(usageNumber)) : 0;
  const requested = Number.isFinite(requestNumber) ? Math.max(0, Math.floor(requestNumber)) : 0;
  const limit = normalizeActiveGrowLimit(activeGrowLimit);
  const unlimited = limit === null;
  const remaining = unlimited ? null : Math.max(0, limit - usage);
  const projected = usage + requested;

  return {
    usage,
    limit,
    requested,
    projected,
    unlimited,
    remaining,
    reached: !unlimited && usage >= limit,
    exceeded: !unlimited && usage > limit,
    allowed: unlimited || projected <= limit,
  };
}

export function buildActiveGrowLimitMessage({
  activeGrowCount = 0,
  activeGrowLimit = null,
  requestedCount = 1,
  action = "create",
} = {}) {
  const state = getActiveGrowLimitState({
    activeGrowCount,
    activeGrowLimit,
    requestedCount,
  });

  if (state.unlimited) {
    return "Your plan includes unlimited active grows.";
  }

  const base = `You currently have ${state.usage} of ${state.limit} active grows.`;
  const guidance = " Archive or complete a grow, or upgrade your plan to add another.";

  if (action === "reactivate") {
    return `${base} Reactivating this grow would exceed your plan limit.${guidance}`;
  }

  if (state.requested > 1) {
    return `${base} This batch would create ${state.requested} active grows and exceed your plan limit.${guidance}`;
  }

  return `${base}${guidance}`;
}

export function assertActiveGrowCapacity({
  activeGrowCount = 0,
  activeGrowLimit = null,
  requestedCount = 1,
  action = "create",
} = {}) {
  const state = getActiveGrowLimitState({
    activeGrowCount,
    activeGrowLimit,
    requestedCount,
  });

  if (!state.allowed) {
    throw new ActiveGrowLimitError(
      buildActiveGrowLimitMessage({
        activeGrowCount: state.usage,
        activeGrowLimit: state.limit,
        requestedCount: state.requested,
        action,
      }),
      { ...state, action }
    );
  }

  return state;
}

export function applyGrowPatchForAccessCheck(currentGrow = {}, patch = {}) {
  const candidate = { ...(currentGrow || {}) };
  const nextPatch = patch && typeof patch === "object" ? patch : {};

  for (const key of ARCHIVE_CLEAR_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(nextPatch, key)) continue;
    const value = nextPatch[key];

    if (
      value === false ||
      value === null ||
      value === undefined ||
      (typeof value === "object" && value !== null)
    ) {
      delete candidate[key];
      continue;
    }

    candidate[key] = value;
  }

  for (const [key, value] of Object.entries(nextPatch)) {
    if (ARCHIVE_CLEAR_KEYS.includes(key)) continue;
    candidate[key] = value;
  }

  return candidate;
}

export function wouldReactivateGrow(currentGrow = {}, patch = {}) {
  if (isActiveGrow(currentGrow)) return false;
  return isActiveGrow(applyGrowPatchForAccessCheck(currentGrow, patch));
}

export function getGrowActivityTransition(currentGrow = {}, patch = {}) {
  const wasActive = isActiveGrow(currentGrow);
  const nextGrow = applyGrowPatchForAccessCheck(currentGrow, patch);
  const willBeActive = isActiveGrow(nextGrow);

  return {
    wasActive,
    willBeActive,
    reactivating: !wasActive && willBeActive,
    deactivating: wasActive && !willBeActive,
    nextGrow,
  };
}

export const GROW_MUTATION_MARKERS = Object.freeze({
  DELETE_FIELD: "__cnmDeleteField",
  SERVER_TIMESTAMP: "__cnmServerTimestamp",
  TIMESTAMP: "__cnmTimestamp",
});

function isDeleteFieldSentinel(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value._methodName === "deleteField"
  );
}

function isServerTimestampSentinel(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value._methodName === "serverTimestamp"
  );
}

export function encodeGrowMutationValue(value, depth = 0) {
  if (depth > 30) {
    throw new Error("Grow data is nested too deeply.");
  }

  if (value === undefined) return undefined;
  if (value === null) return null;

  if (isDeleteFieldSentinel(value)) {
    return { [GROW_MUTATION_MARKERS.DELETE_FIELD]: true };
  }

  if (isServerTimestampSentinel(value)) {
    return { [GROW_MUTATION_MARKERS.SERVER_TIMESTAMP]: true };
  }

  if (value instanceof Date) {
    return { [GROW_MUTATION_MARKERS.TIMESTAMP]: value.toISOString() };
  }

  if (value && typeof value.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && Number.isFinite(date.getTime())) {
      return { [GROW_MUTATION_MARKERS.TIMESTAMP]: date.toISOString() };
    }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const encoded = encodeGrowMutationValue(entry, depth + 1);
      return encoded === undefined ? null : encoded;
    });
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [
          key,
          encodeGrowMutationValue(entry, depth + 1),
        ])
        .filter(([, entry]) => entry !== undefined)
    );
  }

  return value;
}

export function encodeGrowPayloadForCallable(payload = {}) {
  return encodeGrowMutationValue(payload);
}

export function encodeGrowPatchForCallable(patch = {}) {
  return encodeGrowMutationValue(patch);
}
