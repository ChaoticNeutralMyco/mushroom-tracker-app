// src/lib/subscriptionPromotions.js

import {
  compareSubscriptionPlans,
} from "./subscriptionAccess.js";
import {
  SUBSCRIPTION_ENTITLEMENT_SOURCES,
  SUBSCRIPTION_ENTITLEMENT_STATUSES,
  getEntitlementAccessPlanId,
  normalizeSubscriptionEntitlement,
} from "./subscriptionEntitlements.js";
import {
  SUBSCRIPTION_PLAN_IDS,
} from "./subscriptionPlans.js";
import { toSubscriptionDate } from "./subscriptionTrial.js";

const PROMOTIONAL_PLAN_IDS = new Set([
  SUBSCRIPTION_PLAN_IDS.HOBBY,
  SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
  SUBSCRIPTION_PLAN_IDS.LAB,
]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePromotionalGrant(grant = null) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) {
    return null;
  }

  const planId = normalizeText(grant.planId).toLowerCase();
  const status = normalizeText(grant.status).toLowerCase();
  const startsAt = toSubscriptionDate(grant.startsAt);
  const endsAt = toSubscriptionDate(grant.endsAt);

  if (!PROMOTIONAL_PLAN_IDS.has(planId)) {
    return null;
  }

  return {
    ...grant,
    planId,
    status: status || "unknown",
    startsAt,
    endsAt,
    reason: normalizeText(grant.reason) || null,
    campaign: normalizeText(grant.campaign) || null,
    revision: Number(grant.revision || 0),
  };
}

export function getPromotionalGrantState(grant = null, now = new Date()) {
  const normalized = normalizePromotionalGrant(grant);
  const currentDate = toSubscriptionDate(now) || new Date();

  if (!normalized) {
    return {
      grant: null,
      active: false,
      scheduled: false,
      expired: false,
    };
  }

  const hasWindow = Boolean(normalized.startsAt && normalized.endsAt);
  const active = Boolean(
    normalized.status === "active" &&
      hasWindow &&
      normalized.startsAt.getTime() <= currentDate.getTime() &&
      normalized.endsAt.getTime() > currentDate.getTime()
  );
  const scheduled = Boolean(
    normalized.status === "active" &&
      hasWindow &&
      normalized.startsAt.getTime() > currentDate.getTime()
  );
  const expired = Boolean(
    hasWindow && normalized.endsAt.getTime() <= currentDate.getTime()
  );

  return {
    grant: normalized,
    active,
    scheduled,
    expired,
  };
}

export function applyPromotionalGrantToRuntime(
  runtime,
  grant = null,
  now = new Date()
) {
  const safeRuntime =
    runtime && typeof runtime === "object"
      ? runtime
      : {
          entitlement: null,
          sourceEntitlement: null,
          trialEntitlement: null,
          entitlementExists: false,
          accessReady: false,
          grace: null,
          resolution: "missing-runtime",
        };
  const promotion = getPromotionalGrantState(grant, now);

  if (!safeRuntime.accessReady || !promotion.active || !promotion.grant) {
    return {
      ...safeRuntime,
      promotionalGrant: promotion.grant,
      promotionActive: promotion.active,
      promotionScheduled: promotion.scheduled,
      promotionApplied: false,
    };
  }

  const baseEntitlement = normalizeSubscriptionEntitlement(
    safeRuntime.entitlement
  );
  const baseAccessPlanId = getEntitlementAccessPlanId(baseEntitlement);
  const promoPlanId = promotion.grant.planId;
  const promoIsStronger =
    compareSubscriptionPlans(promoPlanId, baseAccessPlanId) > 0;

  if (!promoIsStronger) {
    return {
      ...safeRuntime,
      promotionalGrant: promotion.grant,
      promotionActive: true,
      promotionScheduled: false,
      promotionApplied: false,
    };
  }

  const effectiveEntitlement = normalizeSubscriptionEntitlement({
    ...baseEntitlement,
    planId: promoPlanId,
    status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
    source: SUBSCRIPTION_ENTITLEMENT_SOURCES.ADMIN_PROMOTION,
    currentPeriodEndsAt: promotion.grant.endsAt,
    pastDueStartedAt: null,
    graceEndsAt: null,
    accessGrantedThroughGrace: false,
    featureOverrides: {},
    limitOverrides: {},
    adminGrantPlanId: promoPlanId,
    adminGrantStartsAt: promotion.grant.startsAt,
    adminGrantEndsAt: promotion.grant.endsAt,
    adminGrantReason: promotion.grant.reason,
    adminGrantCampaign: promotion.grant.campaign,
  });

  return {
    ...safeRuntime,
    entitlement: effectiveEntitlement,
    promotionalGrant: promotion.grant,
    promotionActive: true,
    promotionScheduled: false,
    promotionApplied: true,
    resolution: `${safeRuntime.resolution || "stored-entitlement"}+admin-promotion`,
  };
}
