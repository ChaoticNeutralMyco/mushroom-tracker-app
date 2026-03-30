// src/lib/units.js

// Lightweight unit helpers used by RecipeManager (and elsewhere).

// Canonical unit lists
export const MASS_UNITS = ["mg", "g", "kg", "oz", "lbs"];
export const VOLUME_UNITS = ["ml", "liter"];
export const COUNT_UNITS = ["count", "hour"]; // "hour" kept for labor/time items

const SYN = {
  // mass
  lb: "lbs",
  lbs: "lbs",
  pound: "lbs",
  pounds: "lbs",
  ounce: "oz",
  ounces: "oz",
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",

  // volume
  l: "liter",
  litre: "liter",
  litres: "liter",
  milliliter: "ml",
  milliliters: "ml",

  // count/time
  ea: "count",
  unit: "count",
  units: "count",
  qty: "count",
};

export function canonicalUnit(u) {
  if (!u) return "";
  const key = String(u).trim().toLowerCase();
  return SYN[key] || key;
}

function group(u) {
  const cu = canonicalUnit(u);
  if (MASS_UNITS.includes(cu)) return "mass";
  if (VOLUME_UNITS.includes(cu)) return "volume";
  if (COUNT_UNITS.includes(cu)) return cu === "hour" ? "time" : "count";
  return "other";
}

export function areCompatible(a, b) {
  return group(a) === group(b);
}

// Convert to base units (g, ml, count, hour)
function toBase(amount, unit) {
  const n = Number(amount) || 0;
  const u = canonicalUnit(unit);

  switch (group(u)) {
    case "mass": {
      if (u === "mg") return n / 1000;
      if (u === "g") return n;
      if (u === "kg") return n * 1000;
      if (u === "oz") return n * 28.349523125;
      if (u === "lbs") return n * 453.59237;
      return n;
    }

    case "volume": {
      if (u === "ml") return n;
      if (u === "liter") return n * 1000;
      return n;
    }

    case "count":
    case "time":
      return n;

    default:
      return n;
  }
}

function fromBase(amountBase, unit) {
  const n = Number(amountBase) || 0;
  const u = canonicalUnit(unit);

  switch (group(u)) {
    case "mass": {
      if (u === "mg") return n * 1000;
      if (u === "g") return n;
      if (u === "kg") return n / 1000;
      if (u === "oz") return n / 28.349523125;
      if (u === "lbs") return n / 453.59237;
      return n;
    }

    case "volume": {
      if (u === "ml") return n;
      if (u === "liter") return n / 1000;
      return n;
    }

    case "count":
    case "time":
      return n;

    default:
      return n;
  }
}

export function convert(amount, fromUnit, toUnit) {
  const from = canonicalUnit(fromUnit);
  const to = canonicalUnit(toUnit);

  if (!from || !to) return Number(amount) || 0;
  if (!areCompatible(from, to)) {
    return Number(amount) || 0;
  }
  if (from === to) return Number(amount) || 0;

  const base = toBase(amount, from);
  return fromBase(base, to);
}

function trimDecimalZeros(value) {
  const str = String(value);
  if (!str.includes(".")) return str;
  return str.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function formatAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  if (v === 0) return "0";

  const abs = Math.abs(v);

  const decimals =
    abs >= 100
      ? 0
      : abs >= 10
        ? 1
        : abs >= 1
          ? 2
          : abs >= 0.1
            ? 3
            : abs >= 0.01
              ? 4
              : abs >= 0.001
                ? 5
                : 6;

  const fixed = v.toFixed(decimals);
  const trimmed = trimDecimalZeros(fixed);

  if (trimmed === "0" && abs > 0) {
    return trimDecimalZeros(v.toPrecision(2));
  }

  return trimmed;
}