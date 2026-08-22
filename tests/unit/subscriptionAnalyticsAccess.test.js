// tests/unit/subscriptionAnalyticsAccess.test.js

import { describe, expect, it } from "vitest";
import {
  ANALYTICS_REPORT_FEATURES,
  ANALYTICS_SECTION_FEATURES,
  canUseAnalyticsFeature,
  getAnalyticsExportScope,
  getAnalyticsReportFeatureKey,
  getAnalyticsSectionFeatureKey,
} from "../../src/lib/subscriptionAnalyticsAccess.js";
import { SUBSCRIPTION_FEATURE_KEYS } from "../../src/lib/subscriptionPlans.js";

const makeHasFeature = (...enabled) => {
  const allowed = new Set(enabled);
  return (featureKey) => allowed.has(featureKey);
};

describe("subscription analytics access configuration", () => {
  it("keeps Overview and Cultivation on basic analytics", () => {
    expect(ANALYTICS_SECTION_FEATURES.overview).toBe(
      SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS
    );
    expect(ANALYTICS_SECTION_FEATURES.cultivation).toBe(
      SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS
    );
  });

  it("starts Supplies and Recipes analytics at Cultivator", () => {
    expect(getAnalyticsSectionFeatureKey("supplies")).toBe(
      SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS
    );
  });

  it("keeps production, sales, and quality workspaces Lab-only", () => {
    for (const sectionId of ["production", "sales", "quality"]) {
      expect(getAnalyticsSectionFeatureKey(sectionId)).toBe(
        SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS
      );
    }
  });

  it("keeps stage, yield, throughput, and history reports basic", () => {
    for (const reportKey of [
      "stageCounts",
      "yieldData",
      "throughput",
      "stageTransitions",
    ]) {
      expect(getAnalyticsReportFeatureKey(reportKey)).toBe(
        SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS
      );
    }
  });

  it("starts comparison, contamination, timing, SOP, and supply reports at Cultivator", () => {
    for (const reportKey of [
      "avgYieldPerStrain",
      "contamRate",
      "timeToStage",
      "sopWorkflow",
      "recipeUseCounts",
      "recipeUsage",
      "burnRate",
    ]) {
      expect(getAnalyticsReportFeatureKey(reportKey)).toBe(
        SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS
      );
    }
  });

  it("keeps cross-grow cost reports behind advanced cost analytics", () => {
    expect(ANALYTICS_REPORT_FEATURES.growCosts).toBe(
      SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS
    );
    expect(ANALYTICS_REPORT_FEATURES.yieldVsCost).toBe(
      SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS
    );
  });

  it("keeps every Post Processing report Lab-only", () => {
    const postProcessReports = Object.entries(ANALYTICS_REPORT_FEATURES)
      .filter(([reportKey]) => reportKey.startsWith("pp"));

    expect(postProcessReports.length).toBeGreaterThan(10);
    for (const [, featureKey] of postProcessReports) {
      expect(featureKey).toBe(SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS);
    }
  });

  it("fails closed for unknown sections, reports, and missing feature resolvers", () => {
    expect(getAnalyticsSectionFeatureKey("unknown")).toBeNull();
    expect(getAnalyticsReportFeatureKey("unknown")).toBeNull();
    expect(canUseAnalyticsFeature(null, SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS)).toBe(false);
  });

  it("builds export scope from feature access instead of plan names", () => {
    const cultivatorScope = getAnalyticsExportScope(
      makeHasFeature(
        SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS,
        SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
        SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS,
        SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS
      )
    );
    expect(cultivatorScope).toEqual({
      canExport: true,
      includeBasic: true,
      includeAdvanced: true,
      includeAdvancedCost: true,
      includeLab: false,
    });

    const labScope = getAnalyticsExportScope(
      makeHasFeature(
        SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS,
        SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
        SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS,
        SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS,
        SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS
      )
    );
    expect(labScope.includeLab).toBe(true);

    const freeScope = getAnalyticsExportScope(
      makeHasFeature(SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS)
    );
    expect(freeScope.canExport).toBe(false);
    expect(freeScope.includeBasic).toBe(false);
  });
});
