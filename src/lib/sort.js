// src/lib/sort.js
// Locale-aware, case-insensitive helpers for consistent A→Z sorting.

/** Normalize a value to a string key for comparison. */
function keyOf(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return String(v);
}

/** Compare two strings A→Z, case-insensitive, with natural number order. */
export function alpha(a, b) {
  const A = keyOf(a);
  const B = keyOf(b);
  if (!A && B) return 1;   // blanks at end
  if (!B && A) return -1;
  return A.localeCompare(B, undefined, { sensitivity: "base", numeric: true });
}

/** Build a comparator using a key selector: byKey(x => x.name) */
export function byKey(select) {
  return (x, y) => alpha(select?.(x), select?.(y));
}

/** Convenience: returns a new array sorted by a key selector (default: identity). */
export function sortAlpha(arr, select = (x) => x) {
  return [...(arr || [])].sort(byKey(select));
}
