// functions/test/unit/internalAdminFullAccess.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AdminServiceError,
  grantPromotionalAccess,
  hasInternalAdminFullAccess,
  parseAdminConfig,
  resolveEffectiveSubscriptionPlanId,
} from "../../src/adminService.js";
import { resolveEffectiveActiveGrowLimit } from "../../src/growService.js";
import { SUBSCRIPTION_PLAN_IDS } from "../../src/subscriptionConfig.js";

const adminConfig = parseAdminConfig({
  adminUids: ["primary-admin", "personal-admin"],
});

test("trusted admin UID allowlist also grants permanent internal full access", () => {
  assert.equal(
    hasInternalAdminFullAccess("primary-admin", adminConfig),
    true
  );
  assert.equal(
    hasInternalAdminFullAccess("personal-admin", adminConfig),
    true
  );
  assert.equal(
    hasInternalAdminFullAccess("ordinary-user", adminConfig),
    false
  );
});

test("internal full access always resolves to Admin with unlimited grows", () => {
  const entitlement = {
    planId: "free",
    status: "expired",
    source: "default",
  };

  assert.equal(
    resolveEffectiveSubscriptionPlanId({
      entitlement,
      promotionalGrant: null,
      internalFullAccess: true,
      now: "2026-08-22T12:00:00.000Z",
    }),
    SUBSCRIPTION_PLAN_IDS.ADMIN
  );

  const growAccess = resolveEffectiveActiveGrowLimit(
    entitlement,
    "2026-08-22T12:00:00.000Z",
    null,
    { internalFullAccess: true }
  );

  assert.equal(growAccess.planId, SUBSCRIPTION_PLAN_IDS.ADMIN);
  assert.equal(growAccess.limit, null);
  assert.equal(growAccess.resolution, "internal-admin-full-access");
  assert.equal(growAccess.source, "internal-admin");
});

test("promotional grants are rejected for permanent internal accounts", async () => {
  await assert.rejects(
    grantPromotionalAccess({
      db: {},
      actorUid: "primary-admin",
      targetUid: "personal-admin",
      planId: "lab",
      durationDays: 30,
      reason: "Not needed for internal access",
      eventId: "internal-admin-promo-rejected",
      adminConfig,
      now: "2026-08-22T12:00:00.000Z",
    }),
    (error) => {
      assert.equal(error instanceof AdminServiceError, true);
      assert.equal(error.code, "failed-precondition");
      assert.match(error.message, /permanent full access/i);
      return true;
    }
  );
});

test("trusted grow callables wire the secret-backed internal access decision into authoritative enforcement", () => {
  const indexSource = readFileSync(
    fileURLToPath(new URL("../../src/index.js", import.meta.url)),
    "utf8"
  );

  assert.match(
    indexSource,
    /export const createGrowBatch = onCall\([\s\S]*?secrets: adminSecretBindings[\s\S]*?internalFullAccessForUid\(request\.auth\.uid\)[\s\S]*?internalFullAccess,/
  );
  assert.match(
    indexSource,
    /export const reactivateGrowBatch = onCall\([\s\S]*?secrets: adminSecretBindings[\s\S]*?internalFullAccessForUid\(request\.auth\.uid\)[\s\S]*?internalFullAccess,/
  );
});
