// functions/test/unit/adminService.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  AdminServiceError,
  assertAuthorizedAdminUid,
  isAuthorizedAdminUid,
  isMarketingConsentEligible,
  isPromotionalGrantActive,
  parseAdminConfig,
  resolveEffectiveSubscriptionPlanId,
} from "../../src/adminService.js";

test("admin configuration accepts only an explicit small UID allowlist", () => {
  const config = parseAdminConfig(
    JSON.stringify({
      adminUids: [" admin-one ", "admin-two", "admin-one"],
    })
  );

  assert.deepEqual(config.adminUids, ["admin-one", "admin-two"]);
  assert.equal(isAuthorizedAdminUid("admin-one", config), true);
  assert.equal(isAuthorizedAdminUid("ordinary-user", config), false);
  assert.equal(assertAuthorizedAdminUid("admin-two", config), "admin-two");
});

test("admin configuration fails closed when missing, malformed, or too broad", () => {
  assert.throws(
    () => parseAdminConfig(""),
    (error) =>
      error instanceof AdminServiceError &&
      error.code === "failed-precondition"
  );

  assert.throws(
    () => parseAdminConfig("{not-json"),
    (error) =>
      error instanceof AdminServiceError &&
      error.code === "failed-precondition"
  );

  assert.throws(
    () =>
      parseAdminConfig({
        adminUids: ["admin-1", "admin-2", "admin-3"],
      }),
    (error) =>
      error instanceof AdminServiceError &&
      error.code === "failed-precondition"
  );
});

test("unauthorized UIDs cannot pass the trusted admin authorization guard", () => {
  const config = parseAdminConfig({
    adminUids: ["admin-only"],
  });

  assert.throws(
    () => assertAuthorizedAdminUid("not-admin", config),
    (error) =>
      error instanceof AdminServiceError &&
      error.code === "permission-denied"
  );
});

test("promotional grants are active only inside their trusted time window", () => {
  const grant = {
    planId: "cultivator",
    status: "active",
    startsAt: "2026-08-22T12:00:00.000Z",
    endsAt: "2026-09-21T12:00:00.000Z",
  };

  assert.equal(
    isPromotionalGrantActive(grant, "2026-08-22T12:00:00.000Z"),
    true
  );
  assert.equal(
    isPromotionalGrantActive(grant, "2026-09-21T12:00:00.000Z"),
    false
  );
  assert.equal(
    isPromotionalGrantActive(
      { ...grant, status: "revoked" },
      "2026-08-23T12:00:00.000Z"
    ),
    false
  );
});

test("effective access uses the higher of trusted base access and active promotion", () => {
  const now = "2026-08-22T12:00:00.000Z";

  assert.equal(
    resolveEffectiveSubscriptionPlanId({
      entitlement: {
        planId: "free",
        status: "active",
        source: "default",
      },
      promotionalGrant: {
        planId: "cultivator",
        status: "active",
        startsAt: "2026-08-22T00:00:00.000Z",
        endsAt: "2026-09-22T00:00:00.000Z",
      },
      now,
    }),
    "cultivator"
  );

  assert.equal(
    resolveEffectiveSubscriptionPlanId({
      entitlement: {
        planId: "lab",
        status: "active",
        source: "stripe",
      },
      promotionalGrant: {
        planId: "hobby",
        status: "active",
        startsAt: "2026-08-22T00:00:00.000Z",
        endsAt: "2026-09-22T00:00:00.000Z",
      },
      now,
    }),
    "lab"
  );
});


test("marketing eligibility requires explicit current-email consent", () => {
  const consent = {
    marketingEmailOptIn: true,
    email: "Grower@Example.com",
    consentVersion: 1,
  };

  assert.equal(
    isMarketingConsentEligible({
      consent,
      userEmail: "grower@example.com",
    }),
    true
  );

  assert.equal(
    isMarketingConsentEligible({
      consent: { ...consent, marketingEmailOptIn: false },
      userEmail: "grower@example.com",
    }),
    false
  );

  assert.equal(
    isMarketingConsentEligible({
      consent,
      userEmail: "new-address@example.com",
    }),
    false
  );

  assert.equal(
    isMarketingConsentEligible({
      consent: { ...consent, consentVersion: 0 },
      userEmail: "grower@example.com",
    }),
    false
  );
});
