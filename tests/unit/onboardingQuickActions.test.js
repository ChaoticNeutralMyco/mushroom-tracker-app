// tests/unit/onboardingQuickActions.test.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildQuickPhotoUploadRequest,
  getQuickPhotoFileLabel,
} from "../../src/lib/quick-actions.js";
import stepsByRoute, {
  TOUR_CONTROL_EVENT,
  TOUR_VERSION,
} from "../../src/utils/tourSteps.js";

const SOURCE_URLS = [
  new URL("../../src/App.jsx", import.meta.url),
  new URL("../../src/components/ui/FabQuickActions.jsx", import.meta.url),
  new URL("../../src/components/Tasks/TaskManager.jsx", import.meta.url),
  new URL("../../src/components/postprocess/PostProcessManager.jsx", import.meta.url),
  new URL("../../src/pages/Analytics.jsx", import.meta.url),
  new URL("../../src/pages/CalendarView.jsx", import.meta.url),
  new URL("../../src/pages/Settings.jsx", import.meta.url),
];

const sourceByPath = Object.fromEntries(
  SOURCE_URLS.map((url) => [fileURLToPath(url), readFileSync(fileURLToPath(url), "utf8")])
);
const sourceText = Object.values(sourceByPath).join("\n");
const appSource = readFileSync(fileURLToPath(new URL("../../src/App.jsx", import.meta.url)), "utf8");
const quickActionsSource = readFileSync(
  fileURLToPath(new URL("../../src/components/ui/FabQuickActions.jsx", import.meta.url)),
  "utf8"
);

const APP_TABS = [
  "dashboard",
  "tasks",
  "analytics",
  "calendar",
  "timeline",
  "postprocess",
  "cog",
  "recipes",
  "strains",
  "labels",
  "archive",
  "settings",
];

describe("onboarding integration", () => {
  it("defines current tours for every live application tab", () => {
    expect(TOUR_VERSION).toBeGreaterThanOrEqual(3);
    expect(TOUR_CONTROL_EVENT).toBe("cnm:tour-control");

    APP_TABS.forEach((tab) => {
      expect(Array.isArray(stepsByRoute[tab])).toBe(true);
      expect(stepsByRoute[tab].length).toBeGreaterThan(0);
    });
  });

  it("only references spotlight targets that exist in the live source", () => {
    const selectors = Object.values(stepsByRoute)
      .flat()
      .map((step) => step.selector)
      .filter(Boolean);

    selectors.forEach((selector) => {
      const match = selector.match(/^\[data-tour="([^"]+)"\]$/);
      expect(match, `Unsupported tour selector: ${selector}`).toBeTruthy();
      expect(sourceText).toContain(`data-tour="${match[1]}"`);
    });
  });

  it("removes the disconnected welcome modal from the live application", () => {
    expect(appSource).not.toContain("OnboardingModal");
    expect(appSource).not.toContain("showOnboarding");
  });

  it("does not retain the known stale tour descriptions", () => {
    const allCopy = Object.values(stepsByRoute)
      .flat()
      .map((step) => `${step.title} ${step.body} ${step.selector || ""}`)
      .join(" ");

    expect(allCopy).not.toContain("analytics-dataset");
    expect(allCopy).not.toContain("Click a day to add a reminder or note");
    expect(allCopy).not.toContain("presets for jars and tubs");
    expect(allCopy).toContain("They are counts, not filters");
  });
});

describe("quick photo request", () => {
  it("selects a file first and submits it from a separate upload action", () => {
    expect(quickActionsSource).toContain("setSelectedFile(file)");
    expect(quickActionsSource).toContain("onChange={handlePickFile}");
    expect(quickActionsSource).toContain("onClick={handleUploadPhoto}");
    expect(quickActionsSource).toContain("Upload selected photo");
  });

  it("keeps the final caption with the selected file until explicit upload", () => {
    const file = { name: "fruiting-day-4.jpg", type: "image/jpeg" };
    const result = buildQuickPhotoUploadRequest({
      growId: "grow-123",
      file,
      caption: "  Fruiting day 4  ",
    });

    expect(result).toEqual({
      ok: true,
      growId: "grow-123",
      file,
      caption: "Fruiting day 4",
    });
    expect(getQuickPhotoFileLabel(file)).toBe("fruiting-day-4.jpg");
  });

  it("blocks upload until both an active grow and photo are selected", () => {
    expect(buildQuickPhotoUploadRequest({ growId: "", file: {} })).toMatchObject({
      ok: false,
    });
    expect(buildQuickPhotoUploadRequest({ growId: "grow-123", file: null })).toMatchObject({
      ok: false,
    });
    expect(getQuickPhotoFileLabel(null)).toBe("No photo selected");
  });
});
