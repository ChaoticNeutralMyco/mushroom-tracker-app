// src/lib/subscriptionEntitlementPaths.js

export const SUBSCRIPTION_BILLING_COLLECTION_ID = "billing";
export const SUBSCRIPTION_ENTITLEMENT_DOCUMENT_ID = "entitlement";
export const SUBSCRIPTION_TESTER_CODES_COLLECTION_ID = "testerCodes";

export function normalizeUserId(uid) {
  return typeof uid === "string" ? uid.trim() : "";
}

export function hasValidUserId(uid) {
  return normalizeUserId(uid).length > 0;
}

export function getUserBillingCollectionPath(uid) {
  const safeUid = normalizeUserId(uid);

  if (!safeUid) {
    return null;
  }

  return `users/${safeUid}/${SUBSCRIPTION_BILLING_COLLECTION_ID}`;
}

export function getUserEntitlementDocumentPath(uid) {
  const billingPath = getUserBillingCollectionPath(uid);

  if (!billingPath) {
    return null;
  }

  return `${billingPath}/${SUBSCRIPTION_ENTITLEMENT_DOCUMENT_ID}`;
}

export function getTesterCodesCollectionPath() {
  return SUBSCRIPTION_TESTER_CODES_COLLECTION_ID;
}

export function getTesterCodeDocumentPath(code) {
  const safeCode = typeof code === "string" ? code.trim().toUpperCase() : "";

  if (!safeCode) {
    return null;
  }

  return `${SUBSCRIPTION_TESTER_CODES_COLLECTION_ID}/${safeCode}`;
}
