// tests/unit/internalAdminAccess.test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyInternalAdminFullAccess,
  buildInternalAdminEntitlement,
  INTERNAL_ADMIN_ACCESS_RESOLUTION,
} from "../../src/lib/internalAdminAccess.js";
import {
  canEntitlementUseFeature,
  getEntitlementLimit,
  getEntitlementPlanId,
  getEntitlementSource,
} from "../../src/lib/subscriptionEntitlements.js";
import {
  SUBSCRIPTION_FEATURE_LIST,
  SUBSCRIPTION_LIMIT_KEYS,
  SUBSCRIPTION_PLAN_IDS,
} from "../../src/lib/subscriptionPlans.js";

const readSource = (relativeUrl) =>
  readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");

describe("permanent internal admin access", () => {
  it("grants the internal Admin plan, every registered feature, and unlimited grows", () => {
    const entitlement = buildInternalAdminEntitlement();

    expect(getEntitlementPlanId(entitlement)).toBe(SUBSCRIPTION_PLAN_IDS.ADMIN);
    expect(getEntitlementSource(entitlement)).toBe("admin");

    for (const featureKey of SUBSCRIPTION_FEATURE_LIST) {
      expect(canEntitlementUseFeature(entitlement, featureKey)).toBe(true);
    }

    expect(
      getEntitlementLimit(entitlement, SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS)
    ).toBeNull();
  });

  it("overrides loading, expired, or paid runtime state without rewriting the underlying source entitlement", () => {
    const sourceEntitlement = {
      planId: SUBSCRIPTION_PLAN_IDS.FREE,
      status: "expired",
      source: "default",
    };
    const runtime = {
      accessReady: false,
      entitlement: sourceEntitlement,
      sourceEntitlement,
      resolution: "loading",
      promotionApplied: true,
    };

    const resolved = applyInternalAdminFullAccess(runtime, true);

    expect(resolved.accessReady).toBe(true);
    expect(resolved.internalFullAccess).toBe(true);
    expect(resolved.resolution).toBe(INTERNAL_ADMIN_ACCESS_RESOLUTION);
    expect(getEntitlementPlanId(resolved.entitlement)).toBe(
      SUBSCRIPTION_PLAN_IDS.ADMIN
    );
    expect(resolved.sourceEntitlement).toBe(sourceEntitlement);
    expect(resolved.promotionApplied).toBe(false);
  });

  it("leaves ordinary accounts on their normal trusted runtime", () => {
    const runtime = {
      accessReady: true,
      entitlement: {
        planId: SUBSCRIPTION_PLAN_IDS.HOBBY,
        status: "active",
        source: "stripe",
      },
      resolution: "active-entitlement",
    };

    const resolved = applyInternalAdminFullAccess(runtime, false);

    expect(resolved.entitlement).toBe(runtime.entitlement);
    expect(resolved.resolution).toBe("active-entitlement");
    expect(resolved.internalFullAccess).toBe(false);
  });

  it("is wired through the trusted admin callable and removes subscription requirements from the UI", () => {
    const providerSource = readSource(
      "../../src/providers/SubscriptionProvider.jsx"
    );
    const pageSource = readSource("../../src/pages/SubscriptionPage.jsx");

    expect(providerSource).toContain("getMyAdminAccess()");
    expect(providerSource).toContain("applyInternalAdminFullAccess");
    expect(providerSource).toContain("internalFullAccess");
    expect(providerSource).toContain(
      "accessReady && canEntitlementUseFeature"
    );

    expect(pageSource).toContain("Internal Admin — Full Access");
    expect(pageSource).toContain("No paid subscription");
    expect(pageSource).toContain('label: "Included"');
  });
});
