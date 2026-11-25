// src/lib/appUpdates.js
export const RELEASE_REPO = "ChaoticNeutralMyco/mushroom-tracker-app";
export const ANDROID_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

export function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(?:v)?(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/.exec(String(value ?? ""));
    if (!match) throw new Error("Invalid release version.");
    return match.slice(1).map(Number);
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

export function androidReleaseUpdate(release, installed) {
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== "string") {
    throw new Error("No stable release metadata was returned.");
  }
  const version = release.tag_name.replace(/^v/, "");
  if (compareVersions(version, installed) <= 0) return null;
  const name = `MycoTracker-${version}-Android.apk`;
  const url = `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${name}`;
  const asset = release.assets?.find((item) => item.name === name && item.state === "uploaded" && item.browser_download_url === url && item.size > 0);
  if (!asset) throw new Error("A newer release exists, but its Android update is not published yet.");
  return { version, url, notes: String(release.body || "").slice(0, 2500) };
}

export function webReleaseUpdate(manifest, installed) {
  const version = manifest?.version;
  if (compareVersions(version, installed) <= 0) return null;
  return { version, notes: Array.isArray(manifest.notes) ? manifest.notes.filter((n) => typeof n === "string").slice(0, 20).join("\n") : "" };
}
