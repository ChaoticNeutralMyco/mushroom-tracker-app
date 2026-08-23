// functions/src/index.js

import * as functionsV1 from "firebase-functions/v1";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onInit } from "firebase-functions/v2/core";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  ADMIN_CONFIG_SECRET_NAME,
  ENTITLEMENT_RECONCILE_SCHEDULE,
  STRIPE_CONFIG_SECRET_NAME,
  SUBSCRIPTION_BACKEND_REGION,
  SUBSCRIPTION_PLAN_IDS,
} from "./subscriptionConfig.js";
import {
  EntitlementServiceError,
  provisionInitialTrialEntitlement,
  reconcileExpiredEntitlements,
} from "./entitlementService.js";
import { EntitlementValidationError } from "./entitlementModel.js";
import { redeemTesterCode as redeemTesterCodeService } from "./testerCodeService.js";
import {
  GrowServiceError,
  createGrowBatchWithEntitlement,
  reactivateGrowBatchWithEntitlement,
} from "./growService.js";
import {
  BillingServiceError,
  createCustomerPortalSession,
  createStripeRestClient,
  createSubscriptionCheckoutSession as createSubscriptionCheckoutSessionService,
  parseStripeConfig,
  processStripeBillingEvent,
  verifyStripeWebhookSignature,
} from "./billingService.js";
import {
  AdminServiceError,
  exportMarketingSubscribers,
  grantPromotionalAccess,
  hasInternalAdminFullAccess,
  isAuthorizedAdminUid,
  listAdminAccounts,
  parseAdminConfig,
  revokePromotionalAccess,
} from "./adminService.js";

const stripeSecretBindings =
  String(process.env.FUNCTIONS_EMULATOR || "").toLowerCase() === "true"
    ? []
    : [STRIPE_CONFIG_SECRET_NAME];

const adminSecretBindings =
  String(process.env.FUNCTIONS_EMULATOR || "").toLowerCase() === "true"
    ? []
    : [ADMIN_CONFIG_SECRET_NAME];

let db = null;

function initializeBackend() {
  if (getApps().length === 0) {
    initializeApp();
  }

  if (!db) {
    db = getFirestore();
  }

  return db;
}

// Keep Firebase Admin initialization out of the CLI discovery pass. The
// runtime executes this once before the first invocation, while the fallback
// in initializeBackend() also keeps first-generation Auth triggers safe.
onInit(() => {
  initializeBackend();
});

function callableError(error) {
  if (error instanceof HttpsError) return error;

  const code =
    error instanceof EntitlementServiceError ||
    error instanceof EntitlementValidationError ||
    error instanceof GrowServiceError ||
    error instanceof BillingServiceError ||
    error instanceof AdminServiceError
      ? error.code
      : "internal";

  const supportedCodes = new Set([
    "invalid-argument",
    "not-found",
    "failed-precondition",
    "resource-exhausted",
    "permission-denied",
    "already-exists",
    "unavailable",
  ]);

  return new HttpsError(
    supportedCodes.has(code) ? code : "internal",
    code === "internal" ? "Subscription backend request failed." : error.message,
    error?.details || undefined
  );
}

function serializeEntitlement(entitlement) {
  if (!entitlement || typeof entitlement !== "object") return null;

  return Object.fromEntries(
    Object.entries(entitlement).map(([key, value]) => {
      if (value && typeof value.toDate === "function") {
        return [key, value.toDate().toISOString()];
      }
      return [key, value];
    })
  );
}

async function ensureTrustedEntitlement(uid, now = new Date()) {
  initializeBackend();
  const user = await getAuth().getUser(uid);

  return provisionInitialTrialEntitlement({
    db: initializeBackend(),
    uid,
    accountCreatedAt: user.metadata?.creationTime || null,
    now,
    eventId: "ensure-entitlement-v1",
    eventSource: "trusted_grow_callable",
  });
}


function stripeConfigFromEnvironment() {
  return parseStripeConfig(process.env[STRIPE_CONFIG_SECRET_NAME]);
}

function stripeClientFromConfig(config) {
  return createStripeRestClient({
    secretKey: config.secretKey,
    apiVersion: config.apiVersion,
  });
}

function adminConfigFromEnvironment() {
  return parseAdminConfig(process.env[ADMIN_CONFIG_SECRET_NAME]);
}

function internalFullAccessForUid(uid) {
  try {
    return hasInternalAdminFullAccess(uid, adminConfigFromEnvironment());
  } catch (error) {
    // Fail closed. A missing or malformed secret must never create internal
    // access; the account simply falls back to its normal trusted entitlement.
    logger.error("Internal admin full-access check failed closed.", {
      uid,
      code: error?.code || "unknown",
      message: error?.message || "Unknown internal-access configuration error",
    });
    return false;
  }
}

export const provisionSubscriptionEntitlementOnCreate = functionsV1
  .region(SUBSCRIPTION_BACKEND_REGION)
  .auth.user()
  .onCreate(async (user, context) => {
    const result = await provisionInitialTrialEntitlement({
      db: initializeBackend(),
      uid: user.uid,
      accountCreatedAt: user.metadata?.creationTime || null,
      now: new Date(),
      eventId: `auth-created-${context.eventId || user.uid}`.replace(
        /[^A-Za-z0-9._-]/g,
        "-"
      ),
      eventSource: "firebase_auth_on_create",
    });

    logger.info("Subscription entitlement provisioned after Auth create.", {
      uid: user.uid,
      created: result.created,
      idempotent: result.idempotent,
    });
  });

export const ensureMySubscriptionEntitlement = onCall(
  { region: SUBSCRIPTION_BACKEND_REGION },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    try {
      const user = await getAuth().getUser(request.auth.uid);
      const result = await provisionInitialTrialEntitlement({
        db: initializeBackend(),
        uid: request.auth.uid,
        accountCreatedAt: user.metadata?.creationTime || null,
        now: new Date(),
        eventId: "ensure-entitlement-v1",
        eventSource: "authenticated_callable",
      });

      return {
        created: result.created,
        idempotent: result.idempotent,
        entitlement: serializeEntitlement(result.entitlement),
      };
    } catch (error) {
      logger.error("ensureMySubscriptionEntitlement failed", error);
      throw callableError(error);
    }
  }
);

export const redeemTesterCode = onCall(
  { region: SUBSCRIPTION_BACKEND_REGION },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    try {
      const result = await redeemTesterCodeService({
        db: initializeBackend(),
        uid: request.auth.uid,
        code: request.data?.code,
        now: new Date(),
      });

      return {
        redeemed: result.redeemed,
        idempotent: result.idempotent,
        entitlement: serializeEntitlement(result.entitlement),
      };
    } catch (error) {
      logger.warn("redeemTesterCode rejected", {
        uid: request.auth.uid,
        code: error?.code || "unknown",
        message: error?.message || "Unknown tester-code error",
      });
      throw callableError(error);
    }
  }
);

export const createGrowBatch = onCall(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: adminSecretBindings,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    const now = new Date();

    try {
      await ensureTrustedEntitlement(request.auth.uid, now);
      const internalFullAccess = internalFullAccessForUid(request.auth.uid);
      const result = await createGrowBatchWithEntitlement({
        db: initializeBackend(),
        uid: request.auth.uid,
        grows: request.data?.grows,
        now,
        internalFullAccess,
      });

      logger.info("Trusted grow batch created.", {
        uid: request.auth.uid,
        count: result.growIds.length,
        usageBefore: result.usageBefore,
        usageAfter: result.usageAfter,
        limit: result.limit,
      });

      return result;
    } catch (error) {
      logger.warn("createGrowBatch rejected", {
        uid: request.auth.uid,
        code: error?.code || "unknown",
        message: error?.message || "Unknown trusted grow creation error",
      });
      throw callableError(error);
    }
  }
);

export const reactivateGrowBatch = onCall(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: adminSecretBindings,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    const now = new Date();

    try {
      await ensureTrustedEntitlement(request.auth.uid, now);
      const internalFullAccess = internalFullAccessForUid(request.auth.uid);
      const result = await reactivateGrowBatchWithEntitlement({
        db: initializeBackend(),
        uid: request.auth.uid,
        updates: request.data?.updates,
        now,
        internalFullAccess,
      });

      logger.info("Trusted grow batch reactivated.", {
        uid: request.auth.uid,
        count: result.growIds.length,
        reactivated: result.reactivated,
        usageBefore: result.usageBefore,
        usageAfter: result.usageAfter,
        limit: result.limit,
      });

      return result;
    } catch (error) {
      logger.warn("reactivateGrowBatch rejected", {
        uid: request.auth.uid,
        code: error?.code || "unknown",
        message: error?.message || "Unknown trusted grow reactivation error",
      });
      throw callableError(error);
    }
  }
);


export const getMyAdminAccess = onCall(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: adminSecretBindings,
  },
  async (request) => {
    if (!request.auth?.uid) {
      return {
        authorized: false,
        internalFullAccess: false,
        accessPlanId: null,
      };
    }

    try {
      const config = adminConfigFromEnvironment();
      const authorized = isAuthorizedAdminUid(request.auth.uid, config);
      const internalFullAccess = hasInternalAdminFullAccess(
        request.auth.uid,
        config
      );

      return {
        authorized,
        internalFullAccess,
        accessPlanId: internalFullAccess ? SUBSCRIPTION_PLAN_IDS.ADMIN : null,
      };
    } catch (error) {
      logger.error("getMyAdminAccess failed", {
        uid: request.auth.uid,
        code: error?.code || "unknown",
        message: error?.message || "Unknown admin-access error",
      });
      throw callableError(error);
    }
  }
);

export const adminListAccounts = onCall(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: adminSecretBindings,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    try {
      const result = await listAdminAccounts({
        db: initializeBackend(),
        auth: getAuth(),
        actorUid: request.auth.uid,
        adminConfig: adminConfigFromEnvironment(),
        pageSize: request.data?.pageSize,
        pageToken: request.data?.pageToken,
        now: new Date(),
      });

      logger.info("Admin account directory loaded.", {
        actorUid: request.auth.uid,
        count: result.accounts.length,
        hasNextPage: Boolean(result.nextPageToken),
      });

      return {
        accounts: result.accounts,
        nextPageToken: result.nextPageToken,
        pageSize: result.pageSize,
      };
    } catch (error) {
      logger.warn("adminListAccounts rejected", {
        actorUid: request.auth.uid,
        code: error?.code || "unknown",
        message: error?.message || "Unknown admin account-list error",
      });
      throw callableError(error);
    }
  }
);


export const adminExportMarketingSubscribers = onCall(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: adminSecretBindings,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    try {
      const result = await exportMarketingSubscribers({
        db: initializeBackend(),
        auth: getAuth(),
        actorUid: request.auth.uid,
        adminConfig: adminConfigFromEnvironment(),
        now: new Date(),
      });

      logger.info("Admin marketing subscriber export prepared.", {
        actorUid: request.auth.uid,
        count: result.count,
      });

      return {
        subscribers: result.subscribers,
        generatedAt: result.generatedAt,
        count: result.count,
      };
    } catch (error) {
      logger.warn("adminExportMarketingSubscribers rejected", {
        actorUid: request.auth.uid,
        code: error?.code || "unknown",
        message: error?.message || "Unknown admin marketing export error",
      });
      throw callableError(error);
    }
  }
);


export const adminGrantPromotionalAccess = onCall(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: adminSecretBindings,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    try {
      const result = await grantPromotionalAccess({
        db: initializeBackend(),
        actorUid: request.auth.uid,
        targetUid: request.data?.targetUid,
        planId: request.data?.planId,
        durationDays: request.data?.durationDays,
        reason: request.data?.reason,
        campaign: request.data?.campaign,
        eventId: request.data?.requestId,
        adminConfig: adminConfigFromEnvironment(),
        now: new Date(),
      });

      logger.info("Promotional subscription access granted.", {
        actorUid: request.auth.uid,
        targetUid: request.data?.targetUid || null,
        planId: result.grant?.planId || null,
        endsAt: result.grant?.endsAt || null,
        applied: result.applied,
        idempotent: result.idempotent,
      });

      return result;
    } catch (error) {
      logger.warn("adminGrantPromotionalAccess rejected", {
        actorUid: request.auth.uid,
        targetUid: request.data?.targetUid || null,
        code: error?.code || "unknown",
        message: error?.message || "Unknown admin promotion error",
      });
      throw callableError(error);
    }
  }
);

export const adminRevokePromotionalAccess = onCall(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: adminSecretBindings,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    try {
      const result = await revokePromotionalAccess({
        db: initializeBackend(),
        actorUid: request.auth.uid,
        targetUid: request.data?.targetUid,
        reason: request.data?.reason,
        eventId: request.data?.requestId,
        adminConfig: adminConfigFromEnvironment(),
        now: new Date(),
      });

      logger.info("Promotional subscription access revoked.", {
        actorUid: request.auth.uid,
        targetUid: request.data?.targetUid || null,
        applied: result.applied,
        idempotent: result.idempotent,
      });

      return result;
    } catch (error) {
      logger.warn("adminRevokePromotionalAccess rejected", {
        actorUid: request.auth.uid,
        targetUid: request.data?.targetUid || null,
        code: error?.code || "unknown",
        message: error?.message || "Unknown admin promotion revocation error",
      });
      throw callableError(error);
    }
  }
);


export const createSubscriptionCheckoutSession = onCall(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: stripeSecretBindings,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    try {
      const now = new Date();
      await ensureTrustedEntitlement(request.auth.uid, now);
      const user = await getAuth().getUser(request.auth.uid);
      const config = stripeConfigFromEnvironment();
      return await createSubscriptionCheckoutSessionService({
        db: initializeBackend(),
        uid: request.auth.uid,
        email: user.email || request.auth.token?.email || null,
        planId: request.data?.planId,
        requestId: request.data?.requestId,
        config,
        stripeClient: stripeClientFromConfig(config),
      });
    } catch (error) {
      logger.warn("createSubscriptionCheckoutSession rejected", {
        uid: request.auth.uid,
        code: error?.code || "unknown",
        message: error?.message || "Unknown Stripe Checkout error",
      });
      throw callableError(error);
    }
  }
);

export const createBillingPortalSession = onCall(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: stripeSecretBindings,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in is required.");
    }

    try {
      await ensureTrustedEntitlement(request.auth.uid, new Date());
      const config = stripeConfigFromEnvironment();
      return await createCustomerPortalSession({
        db: initializeBackend(),
        uid: request.auth.uid,
        requestId: request.data?.requestId,
        config,
        stripeClient: stripeClientFromConfig(config),
      });
    } catch (error) {
      logger.warn("createBillingPortalSession rejected", {
        uid: request.auth.uid,
        code: error?.code || "unknown",
        message: error?.message || "Unknown Stripe portal error",
      });
      throw callableError(error);
    }
  }
);

export const stripeSubscriptionWebhook = onRequest(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    secrets: stripeSecretBindings,
    cors: false,
    timeoutSeconds: 60,
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.set("Allow", "POST");
      response.status(405).send("Method Not Allowed");
      return;
    }

    try {
      const config = stripeConfigFromEnvironment();
      const event = verifyStripeWebhookSignature({
        rawBody: request.rawBody,
        signatureHeader: request.get("stripe-signature"),
        webhookSecret: config.webhookSecret,
        now: new Date(),
      });
      const result = await processStripeBillingEvent({
        db: initializeBackend(),
        event,
        config,
        stripeClient: stripeClientFromConfig(config),
        now: new Date(),
      });

      logger.info("Stripe subscription webhook processed.", {
        eventId: result.eventId,
        eventType: result.eventType,
        uid: result.uid || null,
        action: result.action || null,
        handled: result.handled,
        applied: result.applied || false,
        idempotent: result.idempotent || false,
        stale: result.stale || false,
      });

      response.status(200).json({ received: true, handled: result.handled });
    } catch (error) {
      const webhookClientError =
        error instanceof BillingServiceError &&
        error?.details?.webhook === true;
      logger.error("stripeSubscriptionWebhook failed", {
        code: error?.code || "unknown",
        message: error?.message || "Unknown Stripe webhook error",
      });
      response
        .status(webhookClientError ? 400 : 500)
        .json({ received: false });
    }
  }
);

export const reconcileSubscriptionEntitlements = onSchedule(
  {
    region: SUBSCRIPTION_BACKEND_REGION,
    schedule: ENTITLEMENT_RECONCILE_SCHEDULE,
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const result = await reconcileExpiredEntitlements({
      db: initializeBackend(),
      now: new Date(),
    });
    logger.info("Subscription entitlement reconciliation complete.", result);
  }
);
