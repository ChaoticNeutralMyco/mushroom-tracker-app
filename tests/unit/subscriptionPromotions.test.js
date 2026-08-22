// tests/unit/subscriptionPromotions.test.js

import { describe, expect, it } from "vitest";

import {
  applyPromotionalGrantToRuntime,
  getPromotionalGrantState,
  normalizePromotionalGrant,
} from "../../src/lib/subscriptionPromotions.js";
import {
  buildDefaultSubscriptionEntitlement,
  isAdminEntitlement,
} from "../../src/lib/subscriptionEntitlements.js";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function runtimeFor(entitlement) {
  return {
    entitlement,
    sourceEntitlement: entitlement,
    trialEntitlement: null,
    entitlementExists: true,
    accessReady: true,
    grace: null,
    resolution: "stored-entitlement",
  };
}

describe("subscription promotional access", () => {
  it("normalizes Firestore-style timestamps and rejects unsupported promo plans", () => {
    const normalized = normalizePromotionalGrant({
      planId: " LAB ",
      status: "ACTIVE",
      startsAt: { seconds: 1787400000, nanoseconds: 0 },
      endsAt: { seconds: 1789992000, nanoseconds: 0 },
      reason: " Launch promo ",
    });

    expect(normalized.planId).toBe("lab");
    expect(normalized.status).toBe("active");
    expect(normalized.startsAt).toBeInstanceOf(Date);
    expect(normalized.endsAt).toBeInstanceOf(Date);
    expect(normalized.reason).toBe("Launch promo");

    expect(
      normalizePromotionalGrant({
        planId: "admin",
        status: "active",
      })
    ).toBeNull();
  });

  it("applies a stronger active promotion without changing the source entitlement", () => {
    const base = buildDefaultSubscriptionEntitlement({
      planId: "free",
      status: "active",
      source: "default",
    });
    const runtime = runtimeFor(base);

    const effective = applyPromotionalGrantToRuntime(
      runtime,
      {
        planId: "lab",
        status: "active",
        startsAt: "2026-08-22T00:00:00.000Z",
        endsAt: "2026-09-22T00:00:00.000Z",
        reason: "Giveaway",
      },
      NOW
    );

    expect(effective.entitlement.planId).toBe("lab");
    expect(effective.entitlement.source).toBe("admin_promotion");
    expect(isAdminEntitlement(effective.entitlement)).toBe(false);
    expect(effective.sourceEntitlement.planId).toBe("free");
    expect(effective.promotionActive).toBe(true);
    expect(effective.promotionApplied).toBe(true);
    expect(effective.resolution).toContain("admin-promotion");
  });

  it("does not let a lower promotion reduce active Trial or paid Lab access", () => {
    const trial = runtimeFor(
      buildDefaultSubscriptionEntitlement({
        planId: "trial",
        status: "trialing",
        source: "trial",
        trialStartedAt: "2026-08-20T00:00:00.000Z",
        trialEndsAt: "2026-09-03T00:00:00.000Z",
      })
    );

    const trialResult = applyPromotionalGrantToRuntime(
      trial,
      {
        planId: "cultivator",
        status: "active",
        startsAt: "2026-08-22T00:00:00.000Z",
        endsAt: "2026-09-22T00:00:00.000Z",
      },
      NOW
    );

    expect(trialResult.entitlement.planId).toBe("trial");
    expect(trialResult.promotionActive).toBe(true);
    expect(trialResult.promotionApplied).toBe(false);

    const paidLab = runtimeFor(
      buildDefaultSubscriptionEntitlement({
        planId: "lab",
        status: "active",
        source: "stripe",
        stripeCustomerId: "cus_test",
        stripeSubscriptionId: "sub_test",
      })
    );

    const paidResult = applyPromotionalGrantToRuntime(
      paidLab,
      {
        planId: "hobby",
        status: "active",
        startsAt: "2026-08-22T00:00:00.000Z",
        endsAt: "2026-09-22T00:00:00.000Z",
      },
      NOW
    );

    expect(paidResult.entitlement.planId).toBe("lab");
    expect(paidResult.entitlement.source).toBe("stripe");
    expect(paidResult.promotionApplied).toBe(false);
  });

  it("keeps future, expired, and revoked grants from changing current access", () => {
    const base = runtimeFor(
      buildDefaultSubscriptionEntitlement({
        planId: "free",
        status: "active",
        source: "default",
      })
    );

    const future = applyPromotionalGrantToRuntime(
      base,
      {
        planId: "lab",
        status: "active",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-10-01T00:00:00.000Z",
      },
      NOW
    );

    expect(future.entitlement.planId).toBe("free");
    expect(future.promotionScheduled).toBe(true);
    expect(future.promotionApplied).toBe(false);

    const expiredState = getPromotionalGrantState(
      {
        planId: "lab",
        status: "active",
        startsAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-08-01T00:00:00.000Z",
      },
      NOW
    );
    expect(expiredState.expired).toBe(true);
    expect(expiredState.active).toBe(false);

    const revoked = applyPromotionalGrantToRuntime(
      base,
      {
        planId: "lab",
        status: "revoked",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2026-09-01T00:00:00.000Z",
      },
      NOW
    );
    expect(revoked.entitlement.planId).toBe("free");
    expect(revoked.promotionActive).toBe(false);
  });
});
