// src/lib/subscriptionAnalyticsAccess.js

import { SUBSCRIPTION_FEATURE_KEYS } from "./subscriptionPlans.js";

export const ANALYTICS_SECTION_FEATURES = Object.freeze({
  overview: SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS,
  cultivation: SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS,
  supplies: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
  production: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  sales: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  quality: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
});

export const ANALYTICS_REPORT_FEATURES = Object.freeze({
  stageCounts: SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS,
  yieldData: SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS,
  throughput: SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS,
  stageTransitions: SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS,

  avgYieldPerStrain: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
  contamRate: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
  timeToStage: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
  sopWorkflow: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
  recipeUseCounts: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
  recipeUsage: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
  burnRate: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,

  growCosts: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS,
  yieldVsCost: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS,

  ppInventoryStatus: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppBatchPerformance: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppEfficiency: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppValuation: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppRework: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppFinancial: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppProductPerformance: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppSkuPerformance: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppPackageSizePerformance: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppMargins: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppSales: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppWorkflow: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppOverrides: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppExpiring: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppWaste: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppProcessWaste: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
  ppPackaging: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
});

export function getAnalyticsSectionFeatureKey(sectionId = "") {
  return ANALYTICS_SECTION_FEATURES[String(sectionId || "").trim()] || null;
}

export function getAnalyticsReportFeatureKey(reportKey = "") {
  return ANALYTICS_REPORT_FEATURES[String(reportKey || "").trim()] || null;
}

export function canUseAnalyticsFeature(hasFeature, featureKey) {
  return Boolean(
    featureKey &&
      typeof hasFeature === "function" &&
      hasFeature(featureKey)
  );
}

export function getAnalyticsExportScope(hasFeature) {
  const canExport = canUseAnalyticsFeature(
    hasFeature,
    SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS
  );

  return Object.freeze({
    canExport,
    includeBasic: canExport && canUseAnalyticsFeature(
      hasFeature,
      SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS
    ),
    includeAdvanced: canExport && canUseAnalyticsFeature(
      hasFeature,
      SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS
    ),
    includeAdvancedCost: canExport && canUseAnalyticsFeature(
      hasFeature,
      SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS
    ),
    includeLab: canExport && canUseAnalyticsFeature(
      hasFeature,
      SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS
    ),
  });
}
