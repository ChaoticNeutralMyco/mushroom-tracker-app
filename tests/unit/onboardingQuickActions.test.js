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
  new URL(
    "../../src/components/postprocess/PostProcessManager.jsx",
    import.meta.url
  ),
  new URL("../../src/pages/Analytics.jsx", import.meta.url),
  new URL("../../src/pages/CalendarView.jsx", import.meta.url),
  new URL("../../src/pages/Settings.jsx", import.meta.url),
];

const sourceByPath = Object.fromEntries(
  SOURCE_URLS.map((url) => [
    fileURLToPath(url),
    readFileSync(fileURLToPath(url), "utf8"),
  ])
);
const sourceText = Object.values(sourceByPath).join("\n");
const appSource = readFileSync(
  fileURLToPath(new URL("../../src/App.jsx", import.meta.url)),
  "utf8"
);
const quickActionsSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../src/components/ui/FabQuickActions.jsx",
      import.meta.url
    )
  ),
  "utf8"
);
const coachSource = readFileSync(
  fileURLToPath(
    new URL("../../src/utils/OnboardingCoach.jsx", import.meta.url)
  ),
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
  "admin",
  "settings",
];

describe("onboarding integration", () => {
  it("defines current tours for every live application tab", () => {
    expect(TOUR_VERSION).toBeGreaterThanOrEqual(4);
    expect(TOUR_CONTROL_EVENT).toBe("cnm:tour-control");

    APP_TABS.forEach((tab) => {
      expect(Array.isArray(stepsByRoute[tab])).toBe(true);
      expect(stepsByRoute[tab].length).toBeGreaterThan(0);
    });
  });

  it("keeps every guide step concise and usable", () => {
    Object.entries(stepsByRoute).forEach(([routeKey, routeSteps]) => {
      routeSteps.forEach((step, index) => {
        expect(
          String(step.title || "").trim(),
          `${routeKey} step ${index + 1} needs a title`
        ).not.toBe("");
        expect(
          String(step.body || "").trim(),
          `${routeKey} step ${index + 1} needs body copy`
        ).not.toBe("");
        expect(
          String(step.body || "").length,
          `${routeKey} step ${index + 1} is too verbose`
        ).toBeLessThanOrEqual(280);
      });
    });
  });

  it("only references spotlight targets that exist in the live source", () => {
    const selectors = Object.values(stepsByRoute)
      .flat()
      .map((step) => step.selector)
      .filter(Boolean);

    selectors.forEach((selector) => {
      const match = selector.match(/^\[data-tour="([^"]+)"\]$/);
      expect(
        match,
        `Unsupported tour selector: ${selector}`
      ).toBeTruthy();
      expect(sourceText).toContain(`data-tour="${match[1]}"`);
    });
  });

  it("uses per-version first-visit storage and keeps missing targets non-blocking", () => {
    expect(coachSource).toContain(
      "`${TOUR_SEEN_PREFIX}v${TOUR_VERSION}:"
    );
    expect(coachSource).toContain(
      "This control is not visible in the current view."
    );
    expect(coachSource).toContain("targetState.available");
    expect(coachSource).toContain("onb-overlay--centered");
    expect(coachSource).toContain("onb-overlay--spotlight");
  });

  it("keeps the guide accessible and restores the app shell state", () => {
    expect(coachSource).toContain('aria-labelledby={titleId}');
    expect(coachSource).toContain('aria-describedby={bodyId}');
    expect(coachSource).toContain('role="menuitem"');
    expect(coachSource).toContain('aria-haspopup="menu"');
    expect(coachSource).toContain("priorShellState.ariaHidden");
    expect(coachSource).toContain("priorShellState.hadInert");
    expect(coachSource).toContain(
      "@media (prefers-reduced-motion:reduce)"
    );
  });

  it("removes the disconnected welcome modal from the live application", () => {
    expect(appSource).not.toContain("OnboardingModal");
    expect(appSource).not.toContain("showOnboarding");
  });

  it("does not retain the known stale tour descriptions", () => {
    const allCopy = Object.values(stepsByRoute)
      .flat()
      .map(
        (step) =>
          `${step.title} ${step.body} ${step.selector || ""}`
      )
      .join(" ");

    expect(allCopy).not.toContain("analytics-dataset");
    expect(allCopy).not.toContain(
      "Click a day to add a reminder or note"
    );
    expect(allCopy).not.toContain("presets for jars and tubs");
    expect(allCopy).toContain("They are counts, not filters");
    expect(allCopy).toContain(
      "email verification, and explicit marketing consent"
    );
  });
});

describe("quick photo request", () => {
  it("selects a file first and submits it from a separate upload action", () => {
    expect(quickActionsSource).toContain("setSelectedFile(file)");
    expect(quickActionsSource).toContain(
      "onChange={handlePickFile}"
    );
    expect(quickActionsSource).toContain(
      "onClick={handleUploadPhoto}"
    );
    expect(quickActionsSource).toContain("Upload selected photo");
  });

  it("keeps the final caption with the selected file until explicit upload", () => {
    const file = {
      name: "fruiting-day-4.jpg",
      type: "image/jpeg",
    };
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
    expect(getQuickPhotoFileLabel(file)).toBe(
      "fruiting-day-4.jpg"
    );
  });

  it("blocks upload until both an active grow and photo are selected", () => {
    expect(
      buildQuickPhotoUploadRequest({ growId: "", file: {} })
    ).toMatchObject({
      ok: false,
    });
    expect(
      buildQuickPhotoUploadRequest({
        growId: "grow-123",
        file: null,
      })
    ).toMatchObject({
      ok: false,
    });
    expect(getQuickPhotoFileLabel(null)).toBe(
      "No photo selected"
    );
  });
});
