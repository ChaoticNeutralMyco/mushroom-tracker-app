// src/lib/environmentTargets.js
// environment-v54-global-stage-targets

export const ENVIRONMENT_TARGET_STAGES = [
  "General",
  "Inoculated",
  "Colonizing",
  "Colonized",
  "Fruiting",
  "Harvesting",
  "Harvested",
  "Consumed",
  "Contaminated",
];

export const DEFAULT_ENVIRONMENT_TARGETS = {
  General: {
    tempMinF: "68",
    tempMaxF: "76",
    humidityMin: "",
    humidityMax: "",
    notes: "Use this fallback when a stage-specific target has not been set.",
  },
  Inoculated: {
    tempMinF: "70",
    tempMaxF: "76",
    humidityMin: "",
    humidityMax: "",
    notes: "Stable incubation range after inoculation. Prioritize clean handling and avoid repeated disturbance.",
  },
  Colonizing: {
    tempMinF: "70",
    tempMaxF: "76",
    humidityMin: "",
    humidityMax: "",
    notes: "Keep conditions steady while culture expands. Watch for stalled growth, odor, excess moisture, or color change.",
  },
  Colonized: {
    tempMinF: "68",
    tempMaxF: "76",
    humidityMin: "",
    humidityMax: "",
    notes: "Ready-state target before transfer, spawn, or next workflow step. Confirm clean growth before moving forward.",
  },
  Fruiting: {
    tempMinF: "68",
    tempMaxF: "74",
    humidityMin: "85",
    humidityMax: "95",
    notes: "High humidity target for fruiting conditions. Balance moisture with air exchange and surface condition checks.",
  },
  Harvesting: {
    tempMinF: "65",
    tempMaxF: "74",
    humidityMin: "75",
    humidityMax: "95",
    notes: "Maintain stable conditions while harvesting and preparing for additional flushes if applicable.",
  },
  Harvested: {
    tempMinF: "60",
    tempMaxF: "72",
    humidityMin: "45",
    humidityMax: "60",
    notes: "Post-harvest handling target. Use your drying, storage, or post-process SOP as the source of truth.",
  },
  Consumed: {
    tempMinF: "",
    tempMaxF: "",
    humidityMin: "",
    humidityMax: "",
    notes: "Source material has been consumed by child grows or workflow steps. Environment tracking is usually informational only.",
  },
  Contaminated: {
    tempMinF: "",
    tempMaxF: "",
    humidityMin: "",
    humidityMax: "",
    notes: "Isolate, document suspected cause, and follow your cleanup SOP before reusing the area or tools.",
  },
};

export function normalizeStageName(stage = "") {
  const clean = String(stage || "").trim();
  if (!clean) return "General";
  const match = ENVIRONMENT_TARGET_STAGES.find(
    (item) => item.toLowerCase() === clean.toLowerCase()
  );
  return match || clean;
}

export function coerceTargetNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(n);
}

export function normalizeEnvironmentTarget(target = {}) {
  return {
    tempMinF: coerceTargetNumber(target.tempMinF),
    tempMaxF: coerceTargetNumber(target.tempMaxF),
    humidityMin: coerceTargetNumber(target.humidityMin),
    humidityMax: coerceTargetNumber(target.humidityMax),
    notes: String(target.notes || ""),
  };
}

export function normalizeEnvironmentTargets(targets = {}) {
  const source = targets && typeof targets === "object" ? targets : {};
  const next = {};

  ENVIRONMENT_TARGET_STAGES.forEach((stage) => {
    next[stage] = normalizeEnvironmentTarget({
      ...(DEFAULT_ENVIRONMENT_TARGETS[stage] || {}),
      ...(source[stage] || {}),
    });
  });

  Object.entries(source).forEach(([stage, value]) => {
    const key = normalizeStageName(stage);
    if (!next[key]) {
      next[key] = normalizeEnvironmentTarget(value || {});
    }
  });

  return next;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function roundTemperature(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 10) / 10;
}

export function fahrenheitToCelsius(value) {
  const n = numberOrNull(value);
  if (n === null) return null;
  return roundTemperature(((n - 32) * 5) / 9);
}

export function celsiusToFahrenheit(value) {
  const n = numberOrNull(value);
  if (n === null) return null;
  return roundTemperature((n * 9) / 5 + 32);
}

export function temperatureToFahrenheit(value, unit = "F") {
  const normalizedUnit = String(unit || "F").toUpperCase() === "C" ? "C" : "F";
  const n = numberOrNull(value);
  if (n === null) return null;
  return normalizedUnit === "C" ? celsiusToFahrenheit(n) : roundTemperature(n);
}

export function temperatureFromFahrenheit(value, unit = "F") {
  const normalizedUnit = String(unit || "F").toUpperCase() === "C" ? "C" : "F";
  const n = numberOrNull(value);
  if (n === null) return null;
  return normalizedUnit === "C" ? fahrenheitToCelsius(n) : roundTemperature(n);
}

export function formatTemperatureValue(valueF, unit = "F") {
  const converted = temperatureFromFahrenheit(valueF, unit);
  return converted === null ? "" : String(converted);
}

function pickStageFallback(stage = "") {
  const normalized = normalizeStageName(stage);
  if (
    normalized === "Fruiting" ||
    normalized === "Harvesting" ||
    normalized === "Harvested"
  ) {
    return "fruiting";
  }
  if (
    normalized === "Inoculated" ||
    normalized === "Colonizing" ||
    normalized === "Colonized"
  ) {
    return "colonization";
  }
  return "general";
}

export function getStageEnvironmentTarget({
  prefs = {},
  stage = "",
  cultivationProfile = null,
} = {}) {
  const normalizedStage = normalizeStageName(stage);
  const allTargets = normalizeEnvironmentTargets(prefs?.environmentTargets || {});
  const globalTarget =
    allTargets[normalizedStage] ||
    allTargets.General ||
    normalizeEnvironmentTarget({});
  const profile =
    cultivationProfile && typeof cultivationProfile === "object"
      ? cultivationProfile
      : {};
  const fallbackKind = pickStageFallback(normalizedStage);

  const profileTarget = normalizeEnvironmentTarget({
    tempMinF:
      fallbackKind === "fruiting"
        ? profile.fruitingTempMinF
        : fallbackKind === "colonization"
          ? profile.colonizationTempMinF
          : "",
    tempMaxF:
      fallbackKind === "fruiting"
        ? profile.fruitingTempMaxF
        : fallbackKind === "colonization"
          ? profile.colonizationTempMaxF
          : "",
    humidityMin:
      fallbackKind === "fruiting" ? profile.fruitingHumidityMin : "",
    humidityMax:
      fallbackKind === "fruiting" ? profile.fruitingHumidityMax : "",
    notes:
      fallbackKind === "fruiting"
        ? profile.bulkNotes || profile.contaminationNotes || ""
        : fallbackKind === "colonization"
          ? profile.grainNotes ||
            profile.agarNotes ||
            profile.lcNotes ||
            profile.cleanWorkNotes ||
            ""
          : "",
  });

  const merged = normalizeEnvironmentTarget({
    ...globalTarget,
    ...(hasValue(profileTarget.tempMinF)
      ? { tempMinF: profileTarget.tempMinF }
      : {}),
    ...(hasValue(profileTarget.tempMaxF)
      ? { tempMaxF: profileTarget.tempMaxF }
      : {}),
    ...(hasValue(profileTarget.humidityMin)
      ? { humidityMin: profileTarget.humidityMin }
      : {}),
    ...(hasValue(profileTarget.humidityMax)
      ? { humidityMax: profileTarget.humidityMax }
      : {}),
    notes: profileTarget.notes || globalTarget.notes || "",
  });

  const hasProfileOverride =
    hasValue(profileTarget.tempMinF) ||
    hasValue(profileTarget.tempMaxF) ||
    hasValue(profileTarget.humidityMin) ||
    hasValue(profileTarget.humidityMax) ||
    !!profileTarget.notes;

  return {
    stage: normalizedStage,
    source: hasProfileOverride ? "strain profile" : "global default",
    target: merged,
    globalTarget,
    profileTarget,
    hasProfileOverride,
  };
}

export function formatTargetRange(min, max, suffix = "") {
  const hasMin = hasValue(min);
  const hasMax = hasValue(max);
  if (hasMin && hasMax) return `${min}${suffix}–${max}${suffix}`;
  if (hasMin) return `≥ ${min}${suffix}`;
  if (hasMax) return `≤ ${max}${suffix}`;
  return "Not set";
}

export function formatTemperatureTargetRange(minF, maxF, unit = "F") {
  const normalizedUnit = String(unit || "F").toUpperCase() === "C" ? "C" : "F";
  const min = formatTemperatureValue(minF, normalizedUnit);
  const max = formatTemperatureValue(maxF, normalizedUnit);
  return formatTargetRange(min, max, `°${normalizedUnit}`);
}

export function compareToRange(value, min, max) {
  const n = numberOrNull(value);
  const lo = numberOrNull(min);
  const hi = numberOrNull(max);

  if (n === null || (lo === null && hi === null)) {
    return { status: "unknown", label: "No target", delta: null };
  }
  if (lo !== null && n < lo) {
    return {
      status: "low",
      label: `Low by ${(lo - n).toFixed(1).replace(/\.0$/, "")}`,
      delta: lo - n,
    };
  }
  if (hi !== null && n > hi) {
    return {
      status: "high",
      label: `High by ${(n - hi).toFixed(1).replace(/\.0$/, "")}`,
      delta: n - hi,
    };
  }
  return { status: "ok", label: "In range", delta: 0 };
}

export function targetStatusClass(status = "unknown") {
  if (status === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200";
  }
  if (status === "low" || status === "high") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300";
}
