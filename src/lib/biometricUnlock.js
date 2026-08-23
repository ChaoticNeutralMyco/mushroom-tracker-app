// src/lib/biometricUnlock.js
const BIOMETRIC_KEY_PREFIX = "cn:biometric-unlock:v1:";

function normalizeUid(uid) {
  return String(uid || "").trim();
}

function storageKey(uid) {
  const normalized = normalizeUid(uid);
  return normalized ? `${BIOMETRIC_KEY_PREFIX}${normalized}` : "";
}

export function isTauriMobileRuntime() {
  if (typeof window === "undefined") return false;

  const hasTauriBridge = Boolean(
    window.__TAURI_INTERNALS__ || window.__TAURI__
  );
  const userAgent = String(window.navigator?.userAgent || "");

  return hasTauriBridge && /Android/i.test(userAgent);
}

export function isBiometricUnlockEnabled(uid) {
  const key = storageKey(uid);
  if (!key || typeof localStorage === "undefined") return false;

  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function setBiometricUnlockEnabled(uid, enabled) {
  const key = storageKey(uid);
  if (!key || typeof localStorage === "undefined") return false;

  try {
    if (enabled) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

async function loadBiometricPlugin() {
  if (!isTauriMobileRuntime()) {
    throw new Error("Biometric unlock is only available in the installed Android app.");
  }

  return import("@tauri-apps/plugin-biometric");
}

export async function getBiometricStatus() {
  if (!isTauriMobileRuntime()) {
    return {
      supported: false,
      available: false,
      error: "Available in the installed Android app only.",
    };
  }

  try {
    const { checkStatus } = await loadBiometricPlugin();
    const status = await checkStatus();

    return {
      supported: true,
      available: status?.isAvailable === true,
      biometryType: status?.biometryType || null,
      error: status?.error ? String(status.error) : "",
    };
  } catch (error) {
    return {
      supported: true,
      available: false,
      error: getBiometricErrorMessage(error),
    };
  }
}

export async function authenticateBiometricUnlock(
  reason = "Unlock Chaotic Neutral Myco Tracker"
) {
  const { authenticate } = await loadBiometricPlugin();

  await authenticate(reason, {
    allowDeviceCredential: true,
    cancelTitle: "Cancel",
    title: "Unlock Myco Tracker",
    subtitle: "Confirm your identity to continue",
    confirmationRequired: false,
  });

  return true;
}

export function getBiometricErrorMessage(error) {
  const message =
    error?.message ||
    error?.error ||
    (typeof error === "string" ? error : "");

  if (!message) return "Device authentication was not completed.";

  const normalized = String(message).trim();
  const lower = normalized.toLowerCase();

  if (lower.includes("cancel")) {
    return "Device authentication was canceled.";
  }
  if (lower.includes("not enrolled") || lower.includes("no biometrics")) {
    return "No fingerprint or face authentication is enrolled on this device.";
  }
  if (lower.includes("not available") || lower.includes("unavailable")) {
    return "Device authentication is not currently available.";
  }

  return normalized;
}
