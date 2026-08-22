// functions/src/subscriptionConfig.js

export const SUBSCRIPTION_BACKEND_SCHEMA_VERSION = 1;
export const SUBSCRIPTION_BACKEND_REGION = "us-central1";

export const ADMIN_CONFIG_SECRET_NAME = "CNM_ADMIN_CONFIG";

export const SUBSCRIPTION_PLAN_IDS = Object.freeze({
  TRIAL: "trial",
  FREE: "free",
  HOBBY: "hobby",
  CULTIVATOR: "cultivator",
  LAB: "lab",
  ADMIN: "admin",
});

export const PUBLIC_SUBSCRIPTION_PLAN_IDS = Object.freeze([
  SUBSCRIPTION_PLAN_IDS.FREE,
  SUBSCRIPTION_PLAN_IDS.HOBBY,
  SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
  SUBSCRIPTION_PLAN_IDS.LAB,
]);

export const SUBSCRIPTION_STATUSES = Object.freeze({
  ACTIVE: "active",
  TRIALING: "trialing",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
  EXPIRED: "expired",
});

export const SUBSCRIPTION_SOURCES = Object.freeze({
  DEFAULT: "default",
  TRIAL: "trial",
  TESTER_CODE: "tester_code",
  STRIPE: "stripe",
  ADMIN: "admin",
  MANUAL: "manual",
});

export const SUBSCRIPTION_TRIAL_DURATION_DAYS = 14;
export const SUBSCRIPTION_PAST_DUE_GRACE_DAYS = 3;
export const SUBSCRIPTION_DAY_MS = 24 * 60 * 60 * 1000;

// This matches the existing client rollout anchor. Newer accounts begin at
// their Firebase Auth creation time; older accounts begin at this rollout.
export const EXISTING_ACCOUNT_TRIAL_ROLLOUT_AT =
  "2026-07-26T00:00:00.000Z";

export const ENTITLEMENT_DOCUMENT_ID = "entitlement";
export const BILLING_COLLECTION_ID = "billing";
export const ENTITLEMENT_EVENTS_COLLECTION_ID = "events";
export const ADMIN_GRANT_DOCUMENT_ID = "adminGrant";
export const INTERNAL_ADMIN_AUDIT_COLLECTION_ID = "internalAdminAudit";
export const ADMIN_PROMOTIONAL_GRANT_SCHEMA_VERSION = 1;
export const ADMIN_PROMOTIONAL_GRANT_MAX_DAYS = 3650;
export const ADMIN_MAX_AUTHORIZED_UIDS = 2;
export const TESTER_CODES_COLLECTION_ID = "testerCodes";
export const TESTER_CODE_REDEMPTIONS_COLLECTION_ID = "redemptions";

export const ENTITLEMENT_RECONCILE_SCHEDULE = "every 60 minutes";

export const ACTIVE_GROW_LIMIT_KEY = "activeGrows";
export const GROW_CAPACITY_DOCUMENT_ID = "growCapacity";
export const MAX_TRUSTED_GROW_BATCH_SIZE = 50;

export const SUBSCRIPTION_ACTIVE_GROW_LIMITS = Object.freeze({
  [SUBSCRIPTION_PLAN_IDS.TRIAL]: null,
  [SUBSCRIPTION_PLAN_IDS.FREE]: 6,
  [SUBSCRIPTION_PLAN_IDS.HOBBY]: 30,
  [SUBSCRIPTION_PLAN_IDS.CULTIVATOR]: null,
  [SUBSCRIPTION_PLAN_IDS.LAB]: null,
  [SUBSCRIPTION_PLAN_IDS.ADMIN]: null,
});

export const SUBSCRIPTION_ACCESS_RANKS = Object.freeze({
  [SUBSCRIPTION_PLAN_IDS.FREE]: 0,
  [SUBSCRIPTION_PLAN_IDS.HOBBY]: 1,
  [SUBSCRIPTION_PLAN_IDS.CULTIVATOR]: 2,
  [SUBSCRIPTION_PLAN_IDS.TRIAL]: 3,
  [SUBSCRIPTION_PLAN_IDS.LAB]: 3,
  [SUBSCRIPTION_PLAN_IDS.ADMIN]: 4,
});

export const PROMOTIONAL_SUBSCRIPTION_PLAN_IDS = Object.freeze([
  SUBSCRIPTION_PLAN_IDS.HOBBY,
  SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
  SUBSCRIPTION_PLAN_IDS.LAB,
]);

export const STRIPE_CONFIG_SECRET_NAME = "CNM_STRIPE_CONFIG";
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
export const STRIPE_SUPPORTED_PAID_PLAN_IDS = Object.freeze([
  SUBSCRIPTION_PLAN_IDS.HOBBY,
  SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
  SUBSCRIPTION_PLAN_IDS.LAB,
]);
