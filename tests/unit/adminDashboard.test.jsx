// tests/unit/adminDashboard.test.jsx

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativeUrl) =>
  readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");

const appSource = readSource("../../src/App.jsx");
const dashboardSource = readSource("../../src/pages/AdminDashboard.jsx");
const apiSource = readSource("../../src/lib/adminApi.js");
const providerSource = readSource(
  "../../src/providers/SubscriptionProvider.jsx"
);
const backendIndexSource = readSource("../../functions/src/index.js");
const backendAdminSource = readSource("../../functions/src/adminService.js");

describe("private admin dashboard wiring", () => {
  it("renders the Admin tab and dashboard only after trusted authorization", () => {
    expect(appSource).toContain(
      '...(adminAccess.authorized ? [["admin", "Admin"]] : [])'
    );
    expect(appSource).toContain(
      'activeTab === "admin" && adminAccess.authorized'
    );
    expect(appSource).toContain("fetchMyAdminAccess()");
  });

  it("uses trusted callables instead of direct cross-account Firestore access", () => {
    expect(apiSource).toContain('"getMyAdminAccess"');
    expect(apiSource).toContain('"adminListAccounts"');
    expect(apiSource).toContain('"adminExportMarketingSubscribers"');
    expect(apiSource).toContain('"adminGrantPromotionalAccess"');
    expect(apiSource).toContain('"adminRevokePromotionalAccess"');
    expect(backendIndexSource).toContain("adminExportMarketingSubscribers");
    expect(backendAdminSource).toContain("exportMarketingSubscribers");
    expect(backendAdminSource).toContain("isMarketingConsentEligible");
    expect(dashboardSource).not.toContain('collection(db, "users"');
  });

  it("shows email verification separately from explicit marketing consent", () => {
    expect(dashboardSource).toContain("Email verified");
    expect(dashboardSource).toContain("Email not verified");
    expect(dashboardSource).toContain("Marketing opt-in");
    expect(dashboardSource).toContain("No marketing opt-in");
    expect(dashboardSource).toContain('data-testid="admin-marketing-export"');
    expect(dashboardSource).toContain("Download opted-in CSV");
    expect(dashboardSource).toContain(
      "Email verification is reported separately and never counts as consent."
    );
  });

  it("neutralizes spreadsheet formulas in exported marketing CSV cells", () => {
    expect(dashboardSource).toContain(
      "function neutralizeSpreadsheetFormula(value)"
    );
    expect(dashboardSource).toContain(
      "/^[\\s\\uFEFF]*[=+\\-@]/u.test(text)"
    );
    expect(dashboardSource).toContain(
      "const text = neutralizeSpreadsheetFormula(value);"
    );
    expect(dashboardSource).toContain("return `'${text}`;");
  });

  it("does not hardcode administrator email identities in client source", () => {
    const combined = `${appSource}\n${dashboardSource}\n${apiSource}`;
    expect(combined).not.toContain("admin@chaoticmyco.com");
    expect(combined).not.toContain("vmoney91@gmail.com");
  });

  it("keeps purchased billing actions outside the dashboard", () => {
    expect(dashboardSource).toContain(
      "Purchased subscriptions remain controlled by Stripe"
    );
    expect(dashboardSource).toContain(
      "paid cancellation, refund, and downgrade"
    );
    expect(dashboardSource).toContain(
      "Revoke promotional grant"
    );
  });

  it("subscribes the signed-in user to their backend-only promotional grant", () => {
    expect(providerSource).toContain('"adminGrant"');
    expect(providerSource).toContain("applyPromotionalGrantToRuntime");
    expect(providerSource).toContain("promotionApplied");
  });
});
