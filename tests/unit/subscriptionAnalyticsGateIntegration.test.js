// tests/unit/subscriptionAnalyticsGateIntegration.test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativeUrl) =>
  readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");

const appSource = readSource("../../src/App.jsx");
const analyticsSource = readSource("../../src/pages/Analytics.jsx");
const accessSource = readSource("../../src/lib/subscriptionAnalyticsAccess.js");
const noticeSource = readSource(
  "../../src/components/ui/SubscriptionFeatureNotice.jsx"
);
const gateSource = readSource("../../src/lib/subscriptionFeatureGates.js");

describe("analytics subscription gate live integration", () => {
  it("passes configuration-driven analytics access from App", () => {
    for (const propName of [
      "canUseBasicAnalytics",
      "canUseAdvancedAnalytics",
      "canUseAdvancedCostAnalytics",
      "canExportAnalytics",
      "canUseLabAnalytics",
    ]) {
      expect(appSource).toContain(`${propName}={subscription.hasFeature(`);
    }
    expect(appSource).toContain(
      "onSubscriptionFeatureBlocked={requestSubscriptionFeature}"
    );
  });

  it("keeps basic grow, yield, task, and history analytics visible", () => {
    expect(analyticsSource).toContain("Task snapshot");
    expect(analyticsSource).toContain("Recorded dry yield");
    expect(accessSource).toContain(
      "stageCounts: SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS"
    );
    expect(accessSource).toContain(
      "stageTransitions: SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS"
    );
  });

  it("gates advanced filters and comparisons without hiding their upgrade path", () => {
    expect(analyticsSource).toContain(
      'activeSection === "cultivation" && canUseAdvancedAnalytics'
    );
    expect(analyticsSource).toContain(
      'actionLabel="Use advanced analytics filters"'
    );
    expect(analyticsSource).toContain("getAnalyticsReportFeatureKey(report.key)");
    expect(analyticsSource).toContain("<AnalyticsLockedPanel");
  });

  it("separates advanced cost analytics from basic cost tracking", () => {
    expect(accessSource).toContain(
      "growCosts: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS"
    );
    expect(accessSource).toContain(
      "yieldVsCost: SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS"
    );
    expect(analyticsSource).toContain("canUseAdvancedCostAnalytics = true");
  });

  it("keeps production, sales, quality, and Post Processing reports Lab-only", () => {
    for (const sectionId of ["production", "sales", "quality"]) {
      expect(accessSource).toContain(
        `${sectionId}: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS`
      );
    }
    expect(accessSource).toContain(
      "ppInventoryStatus: SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS"
    );
    expect(analyticsSource).toContain("View Post Processing analytics");
  });

  it("does not subscribe to Lab analytics collections without Lab access", () => {
    expect(analyticsSource).toContain("if (!canUseLabAnalytics)");
    expect(analyticsSource).toContain("setMaterialLots([])");
    expect(analyticsSource).toContain("setProcessBatches([])");
    expect(analyticsSource).toContain("setInventoryMoves([])");
    expect(analyticsSource).toContain("}, [canUseLabAnalytics]);");
  });

  it("guards exports and removes Lab data from non-Lab analytic exports", () => {
    expect(analyticsSource).toContain("if (!analyticsExportScope.canExport)");
    expect(analyticsSource).toContain("analyticsExportScope.includeLab");
    expect(analyticsSource).toContain(
      "Export analytic reports allowed by the current entitlement"
    );
    expect(analyticsSource).toContain("accessScope:");
    expect(analyticsSource).toContain("myco-analytics-");
  });

  it("uses generic supporting text in the shared upgrade notice", () => {
    expect(gateSource).toContain('supportingText = ""');
    expect(gateSource).toContain("supportingText: String(supportingText");
    expect(noticeSource).toContain('supportingText = ""');
    expect(noticeSource).toContain("{supportingText || (");
    expect(appSource).toContain(
      'supportingText={featureAccessNotice?.supportingText || ""}'
    );
  });
});
