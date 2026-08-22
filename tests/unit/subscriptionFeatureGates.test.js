// tests/unit/subscriptionFeatureGates.test.js

import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_FEATURE_ACCESS_ERROR_CODE,
  SubscriptionFeatureAccessError,
  assertSubscriptionFeatureAccess,
  getSubscriptionFeatureGateState,
} from "../../src/lib/subscriptionFeatureGates.js";
import { SUBSCRIPTION_FEATURE_KEYS } from "../../src/lib/subscriptionPlans.js";


describe("subscription feature gate helpers", () => {
  it("identifies Cultivator as the minimum public plan for SOP workflows", () => {
    const state = getSubscriptionFeatureGateState({
      allowed: false,
      featureKey: SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS,
      actionLabel: "Start a new SOP workflow",
    });

    expect(state.minimumPlanId).toBe("cultivator");
    expect(state.minimumPlanLabel).toBe("Cultivator");
    expect(state.featureLabel).toBe("SOP workflows");
  });

  it("identifies Cultivator as the minimum plan for SOP-generated tasks", () => {
    const state = getSubscriptionFeatureGateState({
      allowed: false,
      featureKey: SUBSCRIPTION_FEATURE_KEYS.SOP_GENERATED_TASKS,
      actionLabel: "Generate suggested SOP tasks",
    });

    expect(state.minimumPlanId).toBe("cultivator");
    expect(state.message).toContain("Cultivator or a higher plan");
  });

  it("preserves an allowed feature state", () => {
    const state = getSubscriptionFeatureGateState({
      allowed: true,
      featureKey: SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS,
      actionLabel: "Start a new SOP workflow",
    });

    expect(state.allowed).toBe(true);
  });

  it("throws a typed error for blocked actions", () => {
    expect(() =>
      assertSubscriptionFeatureAccess({
        allowed: false,
        featureKey: SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS,
        actionLabel: "Start a new SOP workflow",
      })
    ).toThrow(SubscriptionFeatureAccessError);

    try {
      assertSubscriptionFeatureAccess({
        allowed: false,
        featureKey: SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS,
        actionLabel: "Start a new SOP workflow",
      });
    } catch (error) {
      expect(error.code).toBe(SUBSCRIPTION_FEATURE_ACCESS_ERROR_CODE);
      expect(error.details.minimumPlanId).toBe("cultivator");
    }
  });

  it("returns normally when access is allowed", () => {
    expect(
      assertSubscriptionFeatureAccess({
        allowed: true,
        featureKey: SUBSCRIPTION_FEATURE_KEYS.SOP_GENERATED_TASKS,
        actionLabel: "Generate suggested SOP tasks",
      }).allowed
    ).toBe(true);
  });

  it("fails closed for an unknown feature key", () => {
    const state = getSubscriptionFeatureGateState({
      allowed: false,
      featureKey: "unknownFeature",
    });

    expect(state.allowed).toBe(false);
    expect(state.minimumPlanId).toBeNull();
    expect(state.minimumPlanLabel).toBe("an eligible plan");
  });
  it("preserves feature-specific supporting text for shared notices", () => {
    const state = getSubscriptionFeatureGateState({
      allowed: false,
      featureKey: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
      actionLabel: "Open advanced analytics",
      supportingText: "Basic summaries remain available after a downgrade.",
    });

    expect(state.supportingText).toBe(
      "Basic summaries remain available after a downgrade."
    );
  });

});
