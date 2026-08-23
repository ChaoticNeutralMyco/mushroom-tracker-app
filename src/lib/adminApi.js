// src/lib/adminApi.js

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase-config.js";

const getMyAdminAccessCallable = httpsCallable(functions, "getMyAdminAccess");
const adminListAccountsCallable = httpsCallable(functions, "adminListAccounts");
const adminExportMarketingSubscribersCallable = httpsCallable(
  functions,
  "adminExportMarketingSubscribers"
);
const adminGrantPromotionalAccessCallable = httpsCallable(
  functions,
  "adminGrantPromotionalAccess"
);
const adminRevokePromotionalAccessCallable = httpsCallable(
  functions,
  "adminRevokePromotionalAccess"
);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function buildAdminRequestId(prefix = "admin") {
  const safePrefix =
    normalizeText(prefix)
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .slice(0, 40) || "admin";
  const uuid = globalThis.crypto?.randomUUID?.();
  const suffix =
    uuid || `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;

  return `${safePrefix}-${suffix}`.slice(0, 120);
}

export function normalizeAdminRequestError(error, fallbackMessage = "") {
  const code = normalizeText(error?.code)
    .toLowerCase()
    .replace(/^functions\//, "");
  const message = normalizeText(error?.message);

  if (code === "unauthenticated") {
    return "Sign in again before using administrator controls.";
  }

  if (code === "permission-denied") {
    return "This account is not authorized for administrator controls.";
  }

  if (
    [
      "invalid-argument",
      "failed-precondition",
      "already-exists",
      "not-found",
      "resource-exhausted",
      "unavailable",
    ].includes(code) &&
    message
  ) {
    return message;
  }

  return (
    message ||
    fallbackMessage ||
    "The administrator request could not be completed."
  );
}

export async function getMyAdminAccess() {
  const response = await getMyAdminAccessCallable({});
  const data = response?.data || {};

  return {
    authorized: data.authorized === true,
    internalFullAccess: data.internalFullAccess === true,
    accessPlanId: normalizeText(data.accessPlanId).toLowerCase() || null,
  };
}

export async function listAdminAccounts({
  pageSize = 50,
  pageToken = null,
} = {}) {
  const response = await adminListAccountsCallable({
    pageSize,
    pageToken: pageToken || null,
  });
  const data = response?.data || {};

  return {
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    nextPageToken: normalizeText(data.nextPageToken) || null,
    pageSize: Number(data.pageSize || pageSize),
  };
}

export async function exportAdminMarketingSubscribers() {
  const response = await adminExportMarketingSubscribersCallable({});
  const data = response?.data || {};

  return {
    subscribers: Array.isArray(data.subscribers) ? data.subscribers : [],
    generatedAt: normalizeText(data.generatedAt) || null,
    count: Number(data.count || 0),
  };
}

export async function grantAdminPromotionalAccess({
  targetUid,
  planId,
  durationDays,
  reason,
  campaign = null,
} = {}) {
  const response = await adminGrantPromotionalAccessCallable({
    targetUid: normalizeText(targetUid),
    planId: normalizeText(planId).toLowerCase(),
    durationDays: Number(durationDays),
    reason: normalizeText(reason),
    campaign: normalizeText(campaign) || null,
    requestId: buildAdminRequestId("admin-promo-grant"),
  });

  return response?.data || null;
}

export async function revokeAdminPromotionalAccess({
  targetUid,
  reason,
} = {}) {
  const response = await adminRevokePromotionalAccessCallable({
    targetUid: normalizeText(targetUid),
    reason: normalizeText(reason),
    requestId: buildAdminRequestId("admin-promo-revoke"),
  });

  return response?.data || null;
}
