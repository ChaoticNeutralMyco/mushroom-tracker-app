// tests/unit/appPreferences.test.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_PREFERENCE_SCHEMA_VERSION,
  OBSOLETE_PREFERENCE_KEYS,
  buildPersistedAppPreferences,
  getPreferenceDomClasses,
  normalizeAppPreferences,
} from "../../src/lib/app-preferences.js";

const settingsSource = readFileSync(
  fileURLToPath(new URL("../../src/pages/Settings.jsx", import.meta.url)),
  "utf8"
);
const localRemindersSource = readFileSync(
  fileURLToPath(new URL("../../src/components/ui/LocalReminders.jsx", import.meta.url)),
  "utf8"
);
const firestoreRulesSource = readFileSync(
  fileURLToPath(new URL("../../firestore.rules", import.meta.url)),
  "utf8"
);

describe("app preference normalization", () => {
  it("migrates legacy appearance and stage reminder fields", () => {
    const result = normalizeAppPreferences(
      {
        theme: "violet",
        darkMode: true,
        taskDigestTime: "14:35",
      },
      { systemDark: false }
    );

    expect(result.accent).toBe("violet");
    expect(result.mode).toBe("dark");
    expect(result.darkMode).toBe(true);
    expect(result.stageReminderTime).toBe("14:35");
    expect(result.preferenceSchemaVersion).toBe(APP_PREFERENCE_SCHEMA_VERSION);
  });

  it("drops obsolete placeholders while preserving active settings and labels", () => {
    const result = normalizeAppPreferences({
      photoQuality: "high",
      backup: { enabled: true },
      devMode: true,
      fontScale: "large",
      autoStampStageDates: false,
      labels: { template: "5160" },
    });

    OBSOLETE_PREFERENCE_KEYS.forEach((key) => {
      expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(false);
    });
    expect(result.fontScale).toBe("large");
    expect(result.autoStampStageDates).toBe(false);
    expect(result.labels).toEqual({ template: "5160" });
  });

  it("persists every active control using the canonical stage reminder name", () => {
    const persisted = buildPersistedAppPreferences({
      themeStyle: "default",
      reduceMotion: true,
      compactUI: true,
      highContrast: true,
      largeTaps: true,
      showSplashOnLoad: false,
      autoStampStageDates: false,
      stageReminderTime: "06:45",
    });

    expect(persisted).toMatchObject({
      themeStyle: "default",
      reduceMotion: true,
      compactUI: true,
      highContrast: true,
      largeTaps: true,
      showSplashOnLoad: false,
      autoStampStageDates: false,
      stageReminderTime: "06:45",
    });
    expect(persisted).not.toHaveProperty("taskDigestTime");
    expect(persisted).not.toHaveProperty("labels");
  });

  it("returns the DOM class state used by the live app", () => {
    expect(
      getPreferenceDomClasses(
        {
          mode: "system",
          themeStyle: "chaotic",
          fontScale: "medium",
          dyslexiaFont: true,
          reduceMotion: true,
          compactUI: true,
          highContrast: true,
          largeTaps: true,
        },
        { systemDark: true }
      )
    ).toEqual({
      dark: true,
      chaotic: true,
      compact: true,
      reduceMotion: true,
      dyslexiaFont: true,
      highContrast: true,
      largeTaps: true,
      fontScale: "medium",
    });
  });
});

describe("Settings control-center integration", () => {
  it("exposes account, accessibility, startup, workflow, and storage controls", () => {
    expect(settingsSource).toContain('data-testid="settings-account-summary"');
    expect(settingsSource).toContain('data-testid="settings-accessibility-controls"');
    expect(settingsSource).toContain('data-testid="settings-startup-workflow"');
    expect(settingsSource).toContain('data-testid="settings-storage-overview"');
    expect(settingsSource).toContain("Automatically stamp stage dates");
    expect(settingsSource).toContain("Reset App Preferences");
  });

  it("keeps marketing consent explicit and separate from app preferences", () => {
    expect(settingsSource).toContain('data-testid="settings-marketing-consent"');
    expect(settingsSource).toContain('doc(db, "users", uid, "communications", "marketing")');
    expect(settingsSource).toContain("marketingEmailOptIn");
    expect(settingsSource).toContain("Email verification does not count as marketing consent");
    expect(settingsSource).not.toContain("savePrefs({ marketingEmailOptIn");

    expect(firestoreRulesSource).toContain("match /communications/{documentId}");
    expect(firestoreRulesSource).toContain("isValidMarketingConsent(request.resource.data)");
    expect(firestoreRulesSource).toContain("collectionId != 'communications'");
  });

  it("uses the corrected grow-stage reminder preference name", () => {
    expect(settingsSource).not.toContain("taskDigestTime");
    expect(settingsSource).toContain("stageReminderTime");
    expect(localRemindersSource).toContain("prefs?.stageReminderTime");
  });
});
