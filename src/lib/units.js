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

// Convert to "base" units (g, ml, count, hour)
function toBase(amount, unit) {
  const n = Number(amount) || 0;
  const u = canonicalUnit(unit);

  switch (group(u)) {
    case "mass": {
      // base = grams
      if (u === "mg") return n / 1000;
      if (u === "g") return n;
      if (u === "kg") return n * 1000;
      if (u === "oz") return n * 28.349523125;
      if (u === "lbs") return n * 453.59237;
      return n;
    }
    case "volume": {
      // base = milliliters
      if (u === "ml") return n;
      if (u === "liter") return n * 1000;
      return n;
    }
    case "count": // fallthrough
    case "time":
      return n; // "count" and "hour" are their own base
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
    case "count": // fallthrough
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
    // incompatible: just return the number without converting
    return Number(amount) || 0;
  }
  if (from === to) return Number(amount) || 0;

  const base = toBase(amount, from);
  return fromBase(base, to);
}

export function formatAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  const abs = Math.abs(v);
  const fixed =
    abs >= 100 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : v.toFixed(2);
  // trim trailing zeros
  return fixed.replace(/\.?0+$/, "");
}
