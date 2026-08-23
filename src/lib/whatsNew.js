// src/lib/whatsNew.js
import packageMetadata from "../../package.json";

export const APP_VERSION = String(packageMetadata?.version || "0.0.0").trim();
export const WHATS_NEW_EVENT = "cn:whats-new:open";

const STORAGE_PREFIX = "cn:whats-new:last-seen";

export const WHATS_NEW_RELEASES = Object.freeze({
  "1.1.4": Object.freeze({
    title: "What’s new in Myco Tracker",
    summary:
      "This release focuses on smoother sign-in, clearer privacy controls, stronger subscription behavior, and easier in-app guidance.",
    items: Object.freeze([
      "Sign-in is faster with Enter-to-submit, and the installed Android app can optionally use device security to unlock an already signed-in session.",
      "Paid subscriptions now keep access through a scheduled cancellation date instead of ending early.",
      "Email verification and optional marketing consent are separate. Marketing email stays off unless you explicitly opt in.",
      "Guided page tours were refreshed, including stronger mobile positioning, accessibility, and safer fallback behavior when a control is not visible.",
    ]),
  }),
});

function normalizeVersion(value) {
  return String(value || "").trim();
}

function normalizeUid(value) {
  return String(value || "").trim();
}

export function getWhatsNewRelease(version = APP_VERSION) {
  const normalizedVersion = normalizeVersion(version) || APP_VERSION;
  const configured = WHATS_NEW_RELEASES[normalizedVersion];

  if (configured) {
    return {
      version: normalizedVersion,
      title: configured.title,
      summary: configured.summary,
      items: [...configured.items],
    };
  }

  return {
    version: normalizedVersion,
    title: "What’s new in Myco Tracker",
    summary: `Myco Tracker has been updated to version ${normalizedVersion}.`,
    items: ["This release includes product improvements, fixes, and reliability updates."],
  };
}

export function getWhatsNewStorageKey(uid) {
  const safeUid = normalizeUid(uid) || "device";
  return `${STORAGE_PREFIX}:${safeUid}`;
}

export function getLastSeenWhatsNewVersion(
  uid,
  storage = globalThis?.localStorage
) {
  if (!storage?.getItem) return "";
  try {
    return normalizeVersion(storage.getItem(getWhatsNewStorageKey(uid)));
  } catch {
    return "";
  }
}

export function shouldShowWhatsNew({
  uid,
  version = APP_VERSION,
  storage = globalThis?.localStorage,
} = {}) {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) return false;

  return getLastSeenWhatsNewVersion(uid, storage) !== normalizedVersion;
}

export function markWhatsNewSeen({
  uid,
  version = APP_VERSION,
  storage = globalThis?.localStorage,
} = {}) {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion || !storage?.setItem) return false;

  try {
    storage.setItem(getWhatsNewStorageKey(uid), normalizedVersion);
    return true;
  } catch {
    return false;
  }
}
