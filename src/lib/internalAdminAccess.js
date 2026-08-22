// src/lib/internalAdminAccess.js

import {
  SUBSCRIPTION_ENTITLEMENT_SOURCES,
  SUBSCRIPTION_ENTITLEMENT_STATUSES,
  buildDefaultSubscriptionEntitlement,
} from "./subscriptionEntitlements.js";
import { SUBSCRIPTION_PLAN_IDS } from "./subscriptionPlans.js";

export const INTERNAL_ADMIN_ACCESS_RESOLUTION =
  "internal-admin-full-access";

export function buildInternalAdminEntitlement() {
  return buildDefaultSubscriptionEntitlement({
    planId: SUBSCRIPTION_PLAN_IDS.ADMIN,
    status: SUBSCRIPTION_ENTITLEMENT_STATUSES.ACTIVE,
    source: SUBSCRIPTION_ENTITLEMENT_SOURCES.ADMIN,
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    pastDueStartedAt: null,
    graceEndsAt: null,
    accessGrantedThroughGrace: false,
    testerCodeId: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    featureOverrides: {},
    limitOverrides: {},
  });
}

export function applyInternalAdminFullAccess(
  runtime,
  enabled = false
) {
  if (enabled !== true) {
    return {
      ...(runtime || {}),
      internalFullAccess: false,
    };
  }

  return {
    ...(runtime || {}),
    accessReady: true,
    entitlement: buildInternalAdminEntitlement(),
    resolution: INTERNAL_ADMIN_ACCESS_RESOLUTION,
    promotionApplied: false,
    internalFullAccess: true,
  };
}
