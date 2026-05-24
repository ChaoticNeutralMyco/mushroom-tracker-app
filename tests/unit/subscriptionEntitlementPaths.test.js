// tests/unit/subscriptionEntitlementPaths.test.js

import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_BILLING_COLLECTION_ID,
  SUBSCRIPTION_ENTITLEMENT_DOCUMENT_ID,
  SUBSCRIPTION_TESTER_CODES_COLLECTION_ID,
  getTesterCodeDocumentPath,
  getTesterCodesCollectionPath,
  getUserBillingCollectionPath,
  getUserEntitlementDocumentPath,
  hasValidUserId,
  normalizeUserId,
} from "../../src/lib/subscriptionEntitlementPaths.js";

describe("subscriptionEntitlementPaths pure helpers", () => {
  it("exports stable collection and document ids", () => {
    expect(SUBSCRIPTION_BILLING_COLLECTION_ID).toBe("billing");
    expect(SUBSCRIPTION_ENTITLEMENT_DOCUMENT_ID).toBe("entitlement");
    expect(SUBSCRIPTION_TESTER_CODES_COLLECTION_ID).toBe("testerCodes");
  });

  it("normalizes and validates user ids", () => {
    expect(normalizeUserId("  abc123  ")).toBe("abc123");
    expect(normalizeUserId(null)).toBe("");
    expect(normalizeUserId(undefined)).toBe("");
    expect(hasValidUserId("abc123")).toBe(true);
    expect(hasValidUserId("   ")).toBe(false);
  });

  it("builds user billing collection paths", () => {
    expect(getUserBillingCollectionPath("abc123")).toBe("users/abc123/billing");
    expect(getUserBillingCollectionPath("  abc123  ")).toBe("users/abc123/billing");
    expect(getUserBillingCollectionPath("")).toBeNull();
  });

  it("builds user entitlement document paths", () => {
    expect(getUserEntitlementDocumentPath("abc123")).toBe("users/abc123/billing/entitlement");
    expect(getUserEntitlementDocumentPath("  abc123  ")).toBe("users/abc123/billing/entitlement");
    expect(getUserEntitlementDocumentPath("")).toBeNull();
  });

  it("builds tester code paths without validating the code server-side", () => {
    expect(getTesterCodesCollectionPath()).toBe("testerCodes");
    expect(getTesterCodeDocumentPath("cnm-vet-beta")).toBe("testerCodes/CNM-VET-BETA");
    expect(getTesterCodeDocumentPath("  CNM-FOUNDER-2026  ")).toBe("testerCodes/CNM-FOUNDER-2026");
    expect(getTesterCodeDocumentPath("")).toBeNull();
  });
});
