// tests/unit/whatsNew.test.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  WHATS_NEW_EVENT,
  getLastSeenWhatsNewVersion,
  getWhatsNewRelease,
  getWhatsNewStorageKey,
  markWhatsNewSeen,
  shouldShowWhatsNew,
} from "../../src/lib/whatsNew.js";

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
  };
}

const appSource = readFileSync(
  fileURLToPath(new URL("../../src/App.jsx", import.meta.url)),
  "utf8"
);
const settingsSource = readFileSync(
  fileURLToPath(new URL("../../src/pages/Settings.jsx", import.meta.url)),
  "utf8"
);
const noticeSource = readFileSync(
  fileURLToPath(
    new URL("../../src/components/ui/WhatsNewNotice.jsx", import.meta.url)
  ),
  "utf8"
);

describe("what's new version behavior", () => {
  it("uses the package version and has current release notes", () => {
    expect(APP_VERSION).toBe("1.1.4");
    expect(WHATS_NEW_EVENT).toBe("cn:whats-new:open");

    const release = getWhatsNewRelease(APP_VERSION);
    expect(release.version).toBe(APP_VERSION);
    expect(release.title).toMatch(/what.?s new/i);
    expect(release.items.length).toBeGreaterThanOrEqual(3);
  });

  it("shows once per version for each signed-in account on the device", () => {
    const storage = createMemoryStorage();
    const uid = "user-123";

    expect(
      shouldShowWhatsNew({ uid, version: "1.1.4", storage })
    ).toBe(true);

    expect(
      markWhatsNewSeen({ uid, version: "1.1.4", storage })
    ).toBe(true);

    expect(getLastSeenWhatsNewVersion(uid, storage)).toBe("1.1.4");
    expect(
      shouldShowWhatsNew({ uid, version: "1.1.4", storage })
    ).toBe(false);

    expect(
      shouldShowWhatsNew({ uid, version: "1.1.5", storage })
    ).toBe(true);
  });

  it("keeps read state separate across accounts", () => {
    const storage = createMemoryStorage();

    markWhatsNewSeen({
      uid: "account-a",
      version: "1.1.4",
      storage,
    });

    expect(getWhatsNewStorageKey("account-a")).not.toBe(
      getWhatsNewStorageKey("account-b")
    );
    expect(
      shouldShowWhatsNew({
        uid: "account-a",
        version: "1.1.4",
        storage,
      })
    ).toBe(false);
    expect(
      shouldShowWhatsNew({
        uid: "account-b",
        version: "1.1.4",
        storage,
      })
    ).toBe(true);
  });

  it("falls back to a generic release message after a future version bump", () => {
    const release = getWhatsNewRelease("9.9.9");

    expect(release.version).toBe("9.9.9");
    expect(release.summary).toContain("9.9.9");
    expect(release.items.length).toBeGreaterThan(0);
  });
});

describe("what's new integration", () => {
  it("mounts after authentication and exposes a Settings replay control", () => {
    expect(appSource).toContain('import WhatsNewNotice from "./components/ui/WhatsNewNotice.jsx"');
    expect(appSource).toContain("<WhatsNewNotice uid={user.uid} />");

    expect(settingsSource).toContain('data-testid="settings-whats-new"');
    expect(settingsSource).toContain("View What’s New");
    expect(settingsSource).toContain("WHATS_NEW_EVENT");
  });

  it("does not stack its automatic dialog over the guided tour", () => {
    expect(noticeSource).toContain('document.querySelector(".onb-overlay")');
    expect(noticeSource).toContain("MutationObserver");
    expect(noticeSource).toContain("AUTO_OPEN_DELAY_MS");
  });

  it("keeps the release dialog keyboard-accessible and restores app-shell state", () => {
    expect(noticeSource).toContain('role="dialog"');
    expect(noticeSource).toContain('aria-modal="true"');
    expect(noticeSource).toContain('event.key === "Escape"');
    expect(noticeSource).toContain('event.key !== "Tab"');
    expect(noticeSource).toContain('appShell.setAttribute("inert", "")');
    expect(noticeSource).toContain('appShell.removeAttribute("inert")');
  });
});
