// functions/src/growService.js

import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import {
  ACTIVE_GROW_LIMIT_KEY,
  ADMIN_GRANT_DOCUMENT_ID,
  BILLING_COLLECTION_ID,
  ENTITLEMENT_DOCUMENT_ID,
  GROW_CAPACITY_DOCUMENT_ID,
  MAX_TRUSTED_GROW_BATCH_SIZE,
  SUBSCRIPTION_ACCESS_RANKS,
  SUBSCRIPTION_ACTIVE_GROW_LIMITS,
  SUBSCRIPTION_DAY_MS,
  SUBSCRIPTION_PAST_DUE_GRACE_DAYS,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "./subscriptionConfig.js";
import { asValidDate, requireUid } from "./entitlementModel.js";

export const ACTIVE_GROW_LIMIT_ERROR_CODE = "active-grow-limit-reached";

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

const FORBIDDEN_OBJECT_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

export class GrowServiceError extends Error {
  constructor(message, code = "failed-precondition", details = null) {
    super(message);
    this.name = "GrowServiceError";
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStage(stage = "") {
  const value = normalizeText(stage);
  if (value.startsWith("inoc")) return "Inoculated";
  if (value.includes("colonizing")) return "Colonizing";
  if (value.includes("colonised") || value.includes("colonized")) {
    return "Colonized";
  }
  if (value.includes("fruit")) return "Fruiting";
  if (value.includes("harvesting")) return "Harvesting";
  if (value.includes("harvested")) return "Harvested";
  if (value.includes("consum")) return "Consumed";
  if (value.includes("contam")) return "Contaminated";
  return "Other";
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== false && value !== "";
}

export function isArchivedGrowDocument(grow = {}) {
  const status = normalizeText(grow.status);
  const stage = normalizeStage(grow.stage);

  const archivedFlags =
    grow.archived === true ||
    grow.isArchived === true ||
    hasValue(grow.archivedAt) ||
    hasValue(grow.archivedOn) ||
    hasValue(grow.archived_on) ||
    hasValue(grow.inArchive);

  const deleted =
    grow.deleted === true ||
    hasValue(grow.deletedAt);

  if (
    archivedFlags ||
    deleted ||
    status === "archived" ||
    status === "contaminated" ||
    stage === "Harvested" ||
    stage === "Consumed" ||
    stage === "Contaminated"
  ) {
    return true;
  }

  const total = Number(grow.amountTotal);
  const used = Number(grow.amountUsed);
  if (
    Number.isFinite(total) &&
    total > 0 &&
    Number.isFinite(used) &&
    used >= total
  ) {
    return true;
  }

  return false;
}

export function isActiveGrowDocument(grow = {}) {
  if (!grow || isArchivedGrowDocument(grow)) return false;

  const status = normalizeText(grow.status);
  const stage = normalizeStage(grow.stage);

  if (status === "stored" || stage === "Harvested") return false;

  return (
    status === "active" ||
    ["Inoculated", "Colonizing", "Colonized", "Fruiting"].includes(stage)
  );
}

function entitlementRef(db, uid) {
  return db
    .collection("users")
    .doc(requireUid(uid))
    .collection(BILLING_COLLECTION_ID)
    .doc(ENTITLEMENT_DOCUMENT_ID);
}

function adminGrantRef(db, uid) {
  return db
    .collection("users")
    .doc(requireUid(uid))
    .collection(BILLING_COLLECTION_ID)
    .doc(ADMIN_GRANT_DOCUMENT_ID);
}

function capacityRef(db, uid) {
  return db
    .collection("users")
    .doc(requireUid(uid))
    .collection(BILLING_COLLECTION_ID)
    .doc(GROW_CAPACITY_DOCUMENT_ID);
}

function growsRef(db, uid) {
  return db
    .collection("users")
    .doc(requireUid(uid))
    .collection("grows");
}

function normalizeLimit(value) {
  if (value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function isPastDueWithinGrace(entitlement, now) {
  if (entitlement?.status !== SUBSCRIPTION_STATUSES.PAST_DUE) return false;

  const explicitGraceEnd = asValidDate(entitlement?.graceEndsAt);
  const graceStart =
    asValidDate(entitlement?.pastDueStartedAt) ||
    asValidDate(entitlement?.currentPeriodEndsAt);

  const graceEnd =
    explicitGraceEnd ||
    (graceStart
      ? new Date(
          graceStart.getTime() +
            SUBSCRIPTION_PAST_DUE_GRACE_DAYS * SUBSCRIPTION_DAY_MS
        )
      : null);

  return Boolean(graceEnd && graceEnd.getTime() > now.getTime());
}

function testerGrantExpired(entitlement, now) {
  if (
    entitlement?.status !== SUBSCRIPTION_STATUSES.ACTIVE ||
    entitlement?.source !== SUBSCRIPTION_SOURCES.TESTER_CODE
  ) {
    return false;
  }

  const end = asValidDate(entitlement?.currentPeriodEndsAt);
  return Boolean(end && end.getTime() <= now.getTime());
}

export function resolveEffectiveGrowAccessPlan(
  entitlement = null,
  now = new Date()
) {
  const currentDate = asValidDate(now) || new Date();
  const planId = normalizeText(entitlement?.planId);
  const status = normalizeText(entitlement?.status);

  if (planId === SUBSCRIPTION_PLAN_IDS.ADMIN) {
    return {
      planId: SUBSCRIPTION_PLAN_IDS.ADMIN,
      useOverrides: true,
      resolution: "admin",
    };
  }

  if (planId === SUBSCRIPTION_PLAN_IDS.TRIAL) {
    const trialEnd = asValidDate(entitlement?.trialEndsAt);
    const activeTrial =
      status === SUBSCRIPTION_STATUSES.TRIALING &&
      trialEnd &&
      trialEnd.getTime() > currentDate.getTime();

    return activeTrial
      ? {
          planId: SUBSCRIPTION_PLAN_IDS.TRIAL,
          useOverrides: true,
          resolution: "trial",
        }
      : {
          planId: SUBSCRIPTION_PLAN_IDS.FREE,
          useOverrides: false,
          resolution: "trial-expired-free-fallback",
        };
  }

  if (status === SUBSCRIPTION_STATUSES.PAST_DUE) {
    return isPastDueWithinGrace(entitlement, currentDate)
      ? {
          planId: Object.prototype.hasOwnProperty.call(
            SUBSCRIPTION_ACTIVE_GROW_LIMITS,
            planId
          )
            ? planId
            : SUBSCRIPTION_PLAN_IDS.FREE,
          useOverrides: true,
          resolution: "past-due-grace",
        }
      : {
          planId: SUBSCRIPTION_PLAN_IDS.FREE,
          useOverrides: false,
          resolution: "past-due-free-fallback",
        };
  }

  if (
    status === SUBSCRIPTION_STATUSES.CANCELED ||
    status === SUBSCRIPTION_STATUSES.EXPIRED ||
    testerGrantExpired(entitlement, currentDate)
  ) {
    return {
      planId: SUBSCRIPTION_PLAN_IDS.FREE,
      useOverrides: false,
      resolution: "inactive-free-fallback",
    };
  }

  if (status === SUBSCRIPTION_STATUSES.ACTIVE) {
    return {
      planId: Object.prototype.hasOwnProperty.call(
        SUBSCRIPTION_ACTIVE_GROW_LIMITS,
        planId
      )
        ? planId
        : SUBSCRIPTION_PLAN_IDS.FREE,
      useOverrides: true,
      resolution: "active-entitlement",
    };
  }

  return {
    planId: SUBSCRIPTION_PLAN_IDS.FREE,
    useOverrides: false,
    resolution: "missing-or-malformed-free-fallback",
  };
}

function accessRank(planId) {
  return Number(SUBSCRIPTION_ACCESS_RANKS[planId] ?? -1);
}

function isPromotionalGrowGrantActive(grant, now) {
  if (!grant || normalizeText(grant.status) !== "active") return false;

  const startsAt = asValidDate(grant.startsAt);
  const endsAt = asValidDate(grant.endsAt);
  const planId = normalizeText(grant.planId);

  if (
    !startsAt ||
    !endsAt ||
    !Object.prototype.hasOwnProperty.call(
      SUBSCRIPTION_ACTIVE_GROW_LIMITS,
      planId
    )
  ) {
    return false;
  }

  return (
    startsAt.getTime() <= now.getTime() &&
    endsAt.getTime() > now.getTime()
  );
}

export function resolveEffectiveActiveGrowLimit(
  entitlement = null,
  now = new Date(),
  promotionalGrant = null
) {
  const currentDate = asValidDate(now) || new Date();
  const access = resolveEffectiveGrowAccessPlan(entitlement, currentDate);

  if (isPromotionalGrowGrantActive(promotionalGrant, currentDate)) {
    const promoPlanId = normalizeText(promotionalGrant.planId);

    if (accessRank(promoPlanId) > accessRank(access.planId)) {
      return {
        planId: promoPlanId,
        useOverrides: false,
        resolution: "admin-promotion",
        limit: normalizeLimit(
          SUBSCRIPTION_ACTIVE_GROW_LIMITS[promoPlanId]
        ),
        source: "admin-promotion",
      };
    }
  }
  const overrideMap =
    entitlement?.limitOverrides &&
    typeof entitlement.limitOverrides === "object" &&
    !Array.isArray(entitlement.limitOverrides)
      ? entitlement.limitOverrides
      : {};

  if (
    access.useOverrides &&
    Object.prototype.hasOwnProperty.call(overrideMap, ACTIVE_GROW_LIMIT_KEY)
  ) {
    return {
      ...access,
      limit: normalizeLimit(overrideMap[ACTIVE_GROW_LIMIT_KEY]),
      source: "override",
    };
  }

  return {
    ...access,
    limit: normalizeLimit(
      SUBSCRIPTION_ACTIVE_GROW_LIMITS[access.planId]
    ),
    source: "plan",
  };
}

function buildCapacityMessage({
  usage,
  limit,
  requested,
  action,
}) {
  const base = `You currently have ${usage} of ${limit} active grows.`;
  const guidance =
    " Archive or complete a grow, or upgrade your plan to add another.";

  if (action === "reactivate") {
    return `${base} Reactivating this grow would exceed your plan limit.${guidance}`;
  }

  if (requested > 1) {
    return `${base} This batch would create ${requested} active grows and exceed your plan limit.${guidance}`;
  }

  return `${base}${guidance}`;
}

function assertCapacity({
  usage,
  limit,
  requested,
  nextUsage,
  action,
}) {
  if (limit === null || nextUsage <= limit) return;

  throw new GrowServiceError(
    buildCapacityMessage({ usage, limit, requested, action }),
    "resource-exhausted",
    {
      code: ACTIVE_GROW_LIMIT_ERROR_CODE,
      usage,
      limit,
      requested,
      projected: nextUsage,
      action,
    }
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDeleteMarker(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value.__cnmDeleteField === true ||
        value._methodName === "deleteField")
  );
}

function isServerTimestampMarker(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value.__cnmServerTimestamp === true ||
        value._methodName === "serverTimestamp")
  );
}

function decodeMutationValue(value, { allowDelete = false, depth = 0 } = {}) {
  if (depth > 30) {
    throw new GrowServiceError(
      "Grow data is nested too deeply.",
      "invalid-argument"
    );
  }

  if (value === undefined) return undefined;
  if (value === null) return null;

  if (isDeleteMarker(value)) {
    if (!allowDelete) {
      throw new GrowServiceError(
        "Delete-field markers are not valid in a new grow.",
        "invalid-argument"
      );
    }
    return FieldValue.delete();
  }

  if (isServerTimestampMarker(value)) {
    return FieldValue.serverTimestamp();
  }

  if (
    value &&
    typeof value === "object" &&
    typeof value.__cnmTimestamp === "string"
  ) {
    const date = asValidDate(value.__cnmTimestamp);
    if (!date) {
      throw new GrowServiceError(
        "Grow timestamp marker is invalid.",
        "invalid-argument"
      );
    }
    return Timestamp.fromDate(date);
  }

  if (value instanceof Date) {
    const date = asValidDate(value);
    if (!date) {
      throw new GrowServiceError(
        "Grow date is invalid.",
        "invalid-argument"
      );
    }
    return Timestamp.fromDate(date);
  }

  if (value && typeof value.toDate === "function") {
    const date = asValidDate(value);
    if (date) return Timestamp.fromDate(date);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const decoded = decodeMutationValue(entry, {
        allowDelete: false,
        depth: depth + 1,
      });
      return decoded === undefined ? null : decoded;
    });
  }

  if (isPlainObject(value)) {
    const output = {};

    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) {
        throw new GrowServiceError(
          "Grow data contains an unsupported object key.",
          "invalid-argument"
        );
      }

      const decoded = decodeMutationValue(entry, {
        allowDelete,
        depth: depth + 1,
      });

      if (decoded !== undefined) output[key] = decoded;
    }

    return output;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }

  throw new GrowServiceError(
    "Grow data contains an unsupported value.",
    "invalid-argument"
  );
}

function normalizeCreatePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new GrowServiceError(
      "Each grow payload must be an object.",
      "invalid-argument"
    );
  }

  const decoded = decodeMutationValue(payload, { allowDelete: false });
  delete decoded.id;
  return decoded;
}

function normalizeUpdate(update) {
  if (!isPlainObject(update)) {
    throw new GrowServiceError(
      "Each grow update must be an object.",
      "invalid-argument"
    );
  }

  const growId =
    typeof update.growId === "string"
      ? update.growId.trim()
      : typeof update.id === "string"
        ? update.id.trim()
        : "";

  if (!growId || growId.includes("/") || growId.length > 180) {
    throw new GrowServiceError(
      "Each grow update requires a valid grow id.",
      "invalid-argument"
    );
  }

  if (!isPlainObject(update.patch) || Object.keys(update.patch).length === 0) {
    throw new GrowServiceError(
      "Each grow update requires a non-empty patch.",
      "invalid-argument"
    );
  }

  return {
    growId,
    rawPatch: update.patch,
    patch: decodeMutationValue(update.patch, { allowDelete: true }),
  };
}

function applyPatchForActivity(currentGrow, rawPatch) {
  const candidate = { ...(currentGrow || {}) };

  for (const [key, value] of Object.entries(rawPatch || {})) {
    if (key.includes(".")) continue;

    if (isDeleteMarker(value)) {
      delete candidate[key];
      continue;
    }

    if (ARCHIVE_CLEAR_KEYS.includes(key)) {
      if (
        value === false ||
        value === null ||
        value === undefined
      ) {
        delete candidate[key];
      } else {
        candidate[key] = value;
      }
      continue;
    }

    if (isServerTimestampMarker(value)) {
      candidate[key] = true;
      continue;
    }

    if (
      value &&
      typeof value === "object" &&
      typeof value.__cnmTimestamp === "string"
    ) {
      candidate[key] = value.__cnmTimestamp;
      continue;
    }

    candidate[key] = value;
  }

  return candidate;
}

function normalizeBatch(value, label) {
  const list = Array.isArray(value) ? value : [];

  if (list.length < 1) {
    throw new GrowServiceError(
      `${label} requires at least one item.`,
      "invalid-argument"
    );
  }

  if (list.length > MAX_TRUSTED_GROW_BATCH_SIZE) {
    throw new GrowServiceError(
      `${label} supports at most ${MAX_TRUSTED_GROW_BATCH_SIZE} items at once.`,
      "invalid-argument"
    );
  }

  return list;
}

function countActiveGrows(snapshot) {
  return snapshot.docs.reduce(
    (count, doc) => count + (isActiveGrowDocument(doc.data()) ? 1 : 0),
    0
  );
}

function capacityLockWrite({
  previous,
  activeCountAfter,
  limit,
  action,
}) {
  return {
    schemaVersion: 1,
    revision: Number(previous?.revision || 0) + 1,
    activeCountAfter,
    activeGrowLimit: limit,
    lastAction: action,
    lastMutationAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function createGrowBatchWithEntitlement({
  db = getFirestore(),
  uid,
  grows,
  now = new Date(),
} = {}) {
  const safeUid = requireUid(uid);
  const payloads = normalizeBatch(grows, "Grow creation").map(
    normalizeCreatePayload
  );
  const rawPayloads = normalizeBatch(grows, "Grow creation");
  const collectionRef = growsRef(db, safeUid);
  const newRefs = payloads.map(() => collectionRef.doc());
  const entRef = entitlementRef(db, safeUid);
  const grantRef = adminGrantRef(db, safeUid);
  const lockRef = capacityRef(db, safeUid);
  const currentDate = asValidDate(now) || new Date();

  return db.runTransaction(async (transaction) => {
    const entitlementSnapshot = await transaction.get(entRef);
    const grantSnapshot = await transaction.get(grantRef);
    const lockSnapshot = await transaction.get(lockRef);
    const existingGrows = await transaction.get(collectionRef);

    const entitlement = entitlementSnapshot.exists
      ? entitlementSnapshot.data()
      : null;
    const promotionalGrant = grantSnapshot.exists
      ? grantSnapshot.data()
      : null;
    const access = resolveEffectiveActiveGrowLimit(
      entitlement,
      currentDate,
      promotionalGrant
    );
    const usage = countActiveGrows(existingGrows);
    const requested = rawPayloads.reduce(
      (count, payload) =>
        count + (isActiveGrowDocument(payload || {}) ? 1 : 0),
      0
    );
    const nextUsage = usage + requested;

    assertCapacity({
      usage,
      limit: access.limit,
      requested,
      nextUsage,
      action: "create",
    });

    payloads.forEach((payload, index) => {
      transaction.create(newRefs[index], payload);
    });

    transaction.set(
      lockRef,
      capacityLockWrite({
        previous: lockSnapshot.exists ? lockSnapshot.data() : null,
        activeCountAfter: nextUsage,
        limit: access.limit,
        action: "create",
      }),
      { merge: true }
    );

    return {
      growIds: newRefs.map((ref) => ref.id),
      usageBefore: usage,
      usageAfter: nextUsage,
      limit: access.limit,
      unlimited: access.limit === null,
      planId: access.planId,
      resolution: access.resolution,
    };
  });
}

export async function reactivateGrowBatchWithEntitlement({
  db = getFirestore(),
  uid,
  updates,
  now = new Date(),
} = {}) {
  const safeUid = requireUid(uid);
  const normalizedUpdates = normalizeBatch(
    updates,
    "Grow reactivation"
  ).map(normalizeUpdate);

  const duplicateIds = new Set();
  for (const update of normalizedUpdates) {
    if (duplicateIds.has(update.growId)) {
      throw new GrowServiceError(
        "A grow may only appear once in a reactivation batch.",
        "invalid-argument"
      );
    }
    duplicateIds.add(update.growId);
  }

  const collectionRef = growsRef(db, safeUid);
  const entRef = entitlementRef(db, safeUid);
  const grantRef = adminGrantRef(db, safeUid);
  const lockRef = capacityRef(db, safeUid);
  const currentDate = asValidDate(now) || new Date();

  return db.runTransaction(async (transaction) => {
    const entitlementSnapshot = await transaction.get(entRef);
    const grantSnapshot = await transaction.get(grantRef);
    const lockSnapshot = await transaction.get(lockRef);
    const existingGrows = await transaction.get(collectionRef);

    const byId = new Map(
      existingGrows.docs.map((doc) => [doc.id, doc])
    );

    const entitlement = entitlementSnapshot.exists
      ? entitlementSnapshot.data()
      : null;
    const promotionalGrant = grantSnapshot.exists
      ? grantSnapshot.data()
      : null;
    const access = resolveEffectiveActiveGrowLimit(
      entitlement,
      currentDate,
      promotionalGrant
    );
    const usage = countActiveGrows(existingGrows);

    let nextUsage = usage;
    let reactivating = 0;

    const transitions = normalizedUpdates.map((update) => {
      const snapshot = byId.get(update.growId);
      if (!snapshot) {
        throw new GrowServiceError(
          `Grow ${update.growId} was not found.`,
          "not-found"
        );
      }

      const currentGrow = snapshot.data() || {};
      const nextGrow = applyPatchForActivity(
        currentGrow,
        update.rawPatch
      );
      const wasActive = isActiveGrowDocument(currentGrow);
      const willBeActive = isActiveGrowDocument(nextGrow);

      if (!wasActive && willBeActive) {
        reactivating += 1;
        nextUsage += 1;
      } else if (wasActive && !willBeActive) {
        nextUsage = Math.max(0, nextUsage - 1);
      }

      return {
        ...update,
        ref: snapshot.ref,
        wasActive,
        willBeActive,
      };
    });

    assertCapacity({
      usage,
      limit: access.limit,
      requested: reactivating,
      nextUsage,
      action: "reactivate",
    });

    for (const transition of transitions) {
      transaction.update(transition.ref, transition.patch);
    }

    transaction.set(
      lockRef,
      capacityLockWrite({
        previous: lockSnapshot.exists ? lockSnapshot.data() : null,
        activeCountAfter: nextUsage,
        limit: access.limit,
        action: "reactivate",
      }),
      { merge: true }
    );

    return {
      growIds: transitions.map((transition) => transition.growId),
      usageBefore: usage,
      usageAfter: nextUsage,
      reactivated: reactivating,
      limit: access.limit,
      unlimited: access.limit === null,
      planId: access.planId,
      resolution: access.resolution,
    };
  });
}
