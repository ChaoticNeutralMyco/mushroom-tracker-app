// tests/unit/biometricUnlock.test.js
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Android biometric/device unlock wiring", () => {
  it("uses the official Tauri biometric plugin only for Android native code", () => {
    const cargo = read("src-tauri/Cargo.toml");
    const lib = read("src-tauri/src/lib.rs");
    const capability = read("src-tauri/capabilities/mobile-biometric.json");
    const pkg = JSON.parse(read("package.json"));

    expect(pkg.dependencies["@tauri-apps/plugin-biometric"]).toBe("2.3.0");
    expect(cargo).toContain("tauri-plugin-biometric = \"=2.3.0\"");
    expect(cargo).toContain("cfg(target_os = \"android\")");
    expect(lib).toContain("tauri_plugin_biometric::Builder::new().build()");
    expect(capability).toContain('"platforms": ["android"]');
    expect(capability).toContain('"biometric:default"');
  });

  it("keeps enablement device-local and scoped to the Firebase uid", () => {
    const helper = read("src/lib/biometricUnlock.js");

    expect(helper).toContain('const BIOMETRIC_KEY_PREFIX = "cn:biometric-unlock:v1:"');
    expect(helper).toContain("`${BIOMETRIC_KEY_PREFIX}${normalized}`");
    expect(helper).toContain("allowDeviceCredential: true");
    expect(helper).not.toMatch(/password\s*[:=]/i);
  });

  it("gates an already-restored session and provides a real sign-out fallback", () => {
    const app = read("src/App.jsx");

    expect(app).toContain("biometricUnlockRequired");
    expect(app).toContain("<BiometricUnlockScreen");
    expect(app).toContain("Date.now() - hiddenAt >= 30000");
    expect(app).toContain("setBiometricUnlockEnabled(user.uid, false)");
    expect(app).toContain("await signOut(auth)");
  });

  it("exposes opt-in, disable, status, and test controls in Settings", () => {
    const settings = read("src/pages/Settings.jsx");

    expect(settings).toContain('data-testid="settings-biometric-unlock"');
    expect(settings).toContain("Enable on this device");
    expect(settings).toContain("Disable on this device");
    expect(settings).toContain("Test device unlock");
    expect(settings).toContain("Your Firebase password is never saved");
  });
});
