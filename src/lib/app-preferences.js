// src/lib/app-preferences.js
import { normalizeEnvironmentTargets } from "./environmentTargets.js";

export const APP_PREFERENCE_SCHEMA_VERSION = 2;
export const DEFAULT_ACCENT = "emerald";
export const DEFAULT_THEME_STYLE = "chaotic";

export const SUPPORTED_ACCENTS = Object.freeze([
  "emerald",
  "violet",
  "amber",
  "rose",
  "slate",
  "teal",
  "indigo",
  "sky",
]);

export const SUPPORTED_MODES = Object.freeze(["system", "light", "dark"]);
export const SUPPORTED_FONT_SCALES = Object.freeze(["small", "medium", "large"]);

export const OBSOLETE_PREFERENCE_KEYS = Object.freeze([
  "labelTemplate",
  "labelQR",
  "labelFields",
  "qrMode",
  "scanAction",
  "barcodeType",
  "confirmStageRegression",
  "defaultStatus",
  "quickNoteStage",
  "photoQuality",
  "autoCaptionPhotos",
  "taskDigestTime",
  "taskOverdueHighlight",
  "backup",
  "exportFormat",
  "confirmDeletes",
  "analytics",
  "liveSnapshots",
  "preloadPhotos",
  "offlineCache",
  "devMode",
]);

const DEFAULT_STAGE_MAX_DAYS = Object.freeze({
  Inoculated: 0,
  Fruiting: 0,
});

export const DEFAULT_APP_PREFERENCES = Object.freeze({
  preferenceSchemaVersion: APP_PREFERENCE_SCHEMA_VERSION,
  mode: "system",
  accent: DEFAULT_ACCENT,
  theme: DEFAULT_ACCENT,
  themeStyle: DEFAULT_THEME_STYLE,
  darkMode: false,
  fontScale: "small",
  dyslexiaFont: false,
  reduceMotion: false,
  compactUI: false,
  highContrast: false,
  largeTaps: false,
  showSplashOnLoad: true,
  splashMinMs: 1200,
  guideEnabled: true,
  temperatureUnit: "F",
  autoConvertEnvNotes: true,
  environmentTargets: normalizeEnvironmentTargets(),
  autoStampStageDates: true,
  taskReminders: true,
  stageReminders: false,
  stageReminderTime: "09:00",
  stageMaxDays: DEFAULT_STAGE_MAX_DAYS,
});

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMode(input = {}) {
  if (SUPPORTED_MODES.includes(input.mode)) return input.mode;
  if (typeof input.darkMode === "boolean") return input.darkMode ? "dark" : "light";
  return DEFAULT_APP_PREFERENCES.mode;
}

function normalizeAccent(input = {}) {
  const requested = input.accent ?? input.theme;
  return SUPPORTED_ACCENTS.includes(requested) ? requested : DEFAULT_ACCENT;
}

function normalizeThemeStyle(value) {
  return value === "default" ? "default" : DEFAULT_THEME_STYLE;
}

function normalizeFontScale(value) {
  return SUPPORTED_FONT_SCALES.includes(value) ? value : DEFAULT_APP_PREFERENCES.fontScale;
}

function normalizeTime(value, fallback = "09:00") {
  const text = String(value || "");
  const match = text.match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeSplashDuration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_APP_PREFERENCES.splashMinMs;
  return Math.min(5000, Math.max(0, Math.round(parsed)));
}

function normalizeStageMaxDays(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = { ...DEFAULT_STAGE_MAX_DAYS };

  Object.entries(source).forEach(([stage, rawDays]) => {
    const parsed = Number(rawDays);
    if (!stage || !Number.isFinite(parsed)) return;
    result[stage] = Math.max(0, Math.round(parsed));
  });

  return result;
}

function normalizeLabels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return { ...value };
}

export function normalizeAppPreferences(input = {}, options = {}) {
  const systemDark = !!options.systemDark;
  const mode = normalizeMode(input);
  const accent = normalizeAccent(input);
  const darkMode = mode === "dark" ? true : mode === "light" ? false : systemDark;
  const labels = normalizeLabels(input.labels);

  const normalized = {
    preferenceSchemaVersion: APP_PREFERENCE_SCHEMA_VERSION,
    mode,
    accent,
    theme: accent,
    themeStyle: normalizeThemeStyle(input.themeStyle),
    darkMode,
    fontScale: normalizeFontScale(input.fontScale),
    dyslexiaFont: normalizeBoolean(
      input.dyslexiaFont,
      DEFAULT_APP_PREFERENCES.dyslexiaFont
    ),
    reduceMotion: normalizeBoolean(
      input.reduceMotion,
      DEFAULT_APP_PREFERENCES.reduceMotion
    ),
    compactUI: normalizeBoolean(input.compactUI, DEFAULT_APP_PREFERENCES.compactUI),
    highContrast: normalizeBoolean(
      input.highContrast,
      DEFAULT_APP_PREFERENCES.highContrast
    ),
    largeTaps: normalizeBoolean(input.largeTaps, DEFAULT_APP_PREFERENCES.largeTaps),
    showSplashOnLoad: normalizeBoolean(
      input.showSplashOnLoad,
      DEFAULT_APP_PREFERENCES.showSplashOnLoad
    ),
    splashMinMs: normalizeSplashDuration(input.splashMinMs),
    guideEnabled: normalizeBoolean(
      input.guideEnabled,
      DEFAULT_APP_PREFERENCES.guideEnabled
    ),
    temperatureUnit: String(input.temperatureUnit || "F").toUpperCase() === "C" ? "C" : "F",
    autoConvertEnvNotes: normalizeBoolean(
      input.autoConvertEnvNotes,
      DEFAULT_APP_PREFERENCES.autoConvertEnvNotes
    ),
    environmentTargets: normalizeEnvironmentTargets(input.environmentTargets || {}),
    autoStampStageDates: normalizeBoolean(
      input.autoStampStageDates,
      DEFAULT_APP_PREFERENCES.autoStampStageDates
    ),
    taskReminders: normalizeBoolean(
      input.taskReminders,
      DEFAULT_APP_PREFERENCES.taskReminders
    ),
    stageReminders: normalizeBoolean(
      input.stageReminders,
      DEFAULT_APP_PREFERENCES.stageReminders
    ),
    stageReminderTime: normalizeTime(
      input.stageReminderTime ?? input.taskDigestTime,
      DEFAULT_APP_PREFERENCES.stageReminderTime
    ),
    stageMaxDays: normalizeStageMaxDays(input.stageMaxDays),
  };

  if (labels) normalized.labels = labels;
  return normalized;
}

export function buildPersistedAppPreferences(input = {}, options = {}) {
  const normalized = normalizeAppPreferences(input, options);
  return {
    preferenceSchemaVersion: normalized.preferenceSchemaVersion,
    mode: normalized.mode,
    accent: normalized.accent,
    theme: normalized.theme,
    themeStyle: normalized.themeStyle,
    darkMode: normalized.darkMode,
    fontScale: normalized.fontScale,
    dyslexiaFont: normalized.dyslexiaFont,
    reduceMotion: normalized.reduceMotion,
    compactUI: normalized.compactUI,
    highContrast: normalized.highContrast,
    largeTaps: normalized.largeTaps,
    showSplashOnLoad: normalized.showSplashOnLoad,
    splashMinMs: normalized.splashMinMs,
    guideEnabled: normalized.guideEnabled,
    temperatureUnit: normalized.temperatureUnit,
    autoConvertEnvNotes: normalized.autoConvertEnvNotes,
    environmentTargets: normalized.environmentTargets,
    autoStampStageDates: normalized.autoStampStageDates,
    taskReminders: normalized.taskReminders,
    stageReminders: normalized.stageReminders,
    stageReminderTime: normalized.stageReminderTime,
    stageMaxDays: normalized.stageMaxDays,
  };
}

export function persistedAppPreferencesChanged(current = {}, next = {}) {
  const keys = Object.keys(next);
  return keys.some(
    (key) => JSON.stringify(current?.[key]) !== JSON.stringify(next?.[key])
  );
}

export function getPreferenceDomClasses(input = {}, options = {}) {
  const prefs = normalizeAppPreferences(input, options);
  return {
    dark: prefs.darkMode,
    chaotic: prefs.themeStyle === "chaotic",
    compact: prefs.compactUI,
    reduceMotion: prefs.reduceMotion,
    dyslexiaFont: prefs.dyslexiaFont,
    highContrast: prefs.highContrast,
    largeTaps: prefs.largeTaps,
    fontScale: prefs.fontScale,
  };
}
