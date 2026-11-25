// tests/e2e/ux-remaining-modules.spec.ts
// Emulator-only read-only UI audit. The grow lifecycle seeds the emulator before this suite.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { clickAppTab, gotoDashboard } from "./helpers/app";
import { captureNodeAuthSession, listFirestoreDocuments } from "./helpers/firestore";

test.use({ trace: "on", screenshot: "only-on-failure", video: "retain-on-failure" });
test.setTimeout(8 * 60 * 1000);

type Diagnostic = {
  kind: "console-error" | "console-warning" | "page-error" | "http-error" | "request-failed";
  detail: string;
  status?: number;
};
type ModuleName = "Tasks" | "Calendar" | "Timeline" | "Analytics" | "COG" | "Recipes" | "Strains";
type Checkpoint = {
  module: ModuleName;
  name: string;
  viewport: { width: number; height: number } | null;
  horizontalOverflowPx: number;
  controls: { name: string; left: number; right: number; outsideViewportPx: number }[];
  wideElements: { tag: string; testId: string | null; className: string; right: number; width: number }[];
};

const modules: ModuleName[] = ["Tasks", "Calendar", "Timeline", "Analytics", "COG", "Recipes", "Strains"];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
] as const;

function requireLocalEmulators() {
  const truthy = /^(1|true|yes)$/i;
  if (
    !truthy.test(String(process.env.E2E_REQUIRE_FIREBASE_EMULATORS || "")) ||
    !truthy.test(String(process.env.VITE_USE_FIREBASE_EMULATORS || "")) ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
    process.env.FUNCTIONS_EMULATOR_HOST !== "127.0.0.1:5001" ||
    process.env.GCLOUD_PROJECT !== "chaotic-neutral-tracker"
  ) {
    throw new Error("Remaining-modules audit requires the isolated local Firebase emulators.");
  }
}

function redact(value: unknown): string {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED JWT]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[REDACTED EMAIL]")
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]+/g, "$1?[REDACTED QUERY]")
    .slice(0, 650);
}

function safePath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid URL]";
  }
}

function attachDiagnostics(page: Page, diagnostics: Diagnostic[]) {
  const record = (kind: Diagnostic["kind"], detail: unknown, status?: number) => {
    if (diagnostics.length >= 250) return;
    diagnostics.push({ kind, detail: redact(detail), ...(status === undefined ? {} : { status }) });
  };
  page.on("console", (message) => {
    if (message.type() === "error") record("console-error", message.text());
    if (message.type() === "warning") record("console-warning", message.text());
  });
  page.on("pageerror", (error) => record("page-error", error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) record("http-error", safePath(response.url()), response.status());
  });
  page.on("requestfailed", (request) => {
    record("request-failed", `${safePath(request.url())} (${request.failure()?.errorText || "unknown"})`);
  });
}

async function capture(page: Page, info: TestInfo, checkpoints: Checkpoint[], module: ModuleName, name: string) {
  const screenshot = `${name}.png`;
  const outputPath = info.outputPath(screenshot);
  await page.screenshot({ path: outputPath, fullPage: false, animations: "disabled" });
  await info.attach(screenshot, { path: outputPath, contentType: "image/png" });
  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const isInsideHorizontalScroller = (node: Element) => {
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if ((overflow === "scroll" || overflow === "auto") && parent.scrollWidth > parent.clientWidth + 1) {
          return true;
        }
      }
      return false;
    };
    const wideElements = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ node, rect }) => rect.width > 1 && rect.right > viewportWidth + 8 && !isInsideHorizontalScroller(node))
      .sort((a, b) => b.rect.right - a.rect.right)
      .slice(0, 10)
      .map(({ node, rect }) => ({
        tag: node.tagName.toLowerCase(),
        testId: node.getAttribute("data-testid"),
        className: String(node.getAttribute("class") || "").slice(0, 140),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      }));
    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      'button[data-testid="cog-add-supply"], button[data-testid="strain-library-submit"], .rbc-toolbar button, button[title="Export .ics"]'
    ))
      .filter((node) => getComputedStyle(node).display !== "none")
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          name: node.getAttribute("data-testid") || node.getAttribute("title") || (node.textContent || "").trim().slice(0, 50),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          outsideViewportPx: Math.max(0, Math.ceil(-rect.left), Math.ceil(rect.right - viewportWidth)),
        };
      });
    return {
      horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth, (document.body?.scrollWidth || 0) - root.clientWidth),
      controls,
      wideElements,
    };
  });
  checkpoints.push({ module, name, viewport: page.viewportSize(), ...layout });
}

async function openModule(page: Page, module: ModuleName) {
  await clickAppTab(page, module);
  switch (module) {
    case "Tasks":
      await expect(page.getByPlaceholder(/Quick add \(e\.g\./i)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /^Show advanced$/i })).toBeVisible();
      break;
    case "Calendar":
      await expect(page.getByRole("heading", { name: /^Calendar$/i })).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".rbc-calendar")).toBeVisible({ timeout: 20_000 });
      break;
    case "Timeline":
      await expect(page.getByRole("button", { name: /^Archived$/i })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /^Active$/i })).toBeVisible();
      break;
    case "Analytics": {
      // The Command Center uses workspace tabs and expandable report cards,
      // not the former single-chart select control.
      await expect(page.getByRole("heading", { name: /^Analytics Command Center$/i })).toBeVisible({ timeout: 20_000 });
      const workspaces = page.getByRole("tablist", { name: "Analytics workspaces" });
      await expect(workspaces).toBeVisible();
      await workspaces.getByRole("tab", { name: /^Overview$/i }).click();
      await expect(workspaces.getByRole("tab", { name: /^Overview$/i })).toHaveAttribute("aria-selected", "true");
      await workspaces.getByRole("tab", { name: /^Cultivation/i }).click();
      await expect(workspaces.getByRole("tab", { name: /^Cultivation/i })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("analytics-report-stageCounts")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("analytics-report-yieldData")).toBeVisible({ timeout: 20_000 });
      break;
    }
    case "COG":
      await expect(page.getByRole("heading", { name: /Supplies \/ Cost of Goods/i })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("cog-add-supply")).toBeVisible();
      break;
    case "Recipes":
      await expect(page.getByRole("heading", { name: /Recipes$/i })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /^New Recipe$/i })).toBeVisible();
      break;
    case "Strains":
      await expect(page.getByRole("heading", { name: /Strain Library \/ Storage/i })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("strain-library-form")).toBeVisible({ timeout: 20_000 });
      break;
  }
}

async function safeInteractions(page: Page, module: ModuleName) {
  switch (module) {
    case "Tasks": {
      await page.getByRole("button", { name: /^Show advanced$/i }).click();
      await expect(page.getByPlaceholder("Task title")).toBeVisible();
      await page.getByRole("button", { name: /^Hide advanced$/i }).click();
      await expect(page.getByPlaceholder("Task title")).toHaveCount(0);
      break;
    }
    case "Calendar": {
      const next = page.locator(".rbc-toolbar").getByRole("button", { name: /^Next$/i });
      const today = page.locator(".rbc-toolbar").getByRole("button", { name: /^Today$/i });
      await expect(next).toBeVisible();
      await expect(today).toBeVisible();
      await next.click();
      await today.click();
      break;
    }
    case "Timeline": {
      await page.getByRole("button", { name: /^Archived$/i }).click();
      await page.getByRole("button", { name: /^All$/i }).click();
      await page.getByRole("button", { name: /^Active$/i }).click();
      // A page-level overflow check alone misses cramped or overlapping controls.
      // Inspect the first active grow card seeded by the lifecycle prerequisite.
      const card = page.getByTestId("timeline-grow-card").first();
      await expect(card).toBeVisible();
      const readability = await card.evaluate((root) => {
        const header = root.querySelector<HTMLElement>('[data-testid="timeline-grow-header"]');
        const stages = root.querySelector<HTMLElement>('[data-testid="timeline-grow-stages"]');
        const actions = root.querySelector<HTMLElement>('[data-testid="timeline-grow-actions"]');
        const badgeElements = Array.from(stages?.querySelectorAll<HTMLElement>("span") || []);
        const actionElements = Array.from(actions?.querySelectorAll<HTMLElement>("a,button") || []);
        const cardRect = root.getBoundingClientRect();
        const isPhone = document.documentElement.clientWidth < 640;
        const failures: string[] = [];

        if (!header || !stages || !actions || badgeElements.length === 0 || actionElements.length === 0) {
          failures.push("Expected timeline card header, stage badges, and actions");
        }
        for (const badge of badgeElements) {
          const rect = badge.getBoundingClientRect();
          const label = (badge.textContent || "").trim();
          if (badge.scrollWidth > badge.clientWidth + 2) failures.push(`Stage badge text clipped: ${label}`);
          if (rect.left < cardRect.left - 2 || rect.right > cardRect.right + 2) {
            failures.push(`Stage badge outside card: ${label}`);
          }
        }
        for (const control of actionElements) {
          const rect = control.getBoundingClientRect();
          const label = (control.textContent || "").trim();
          if (rect.left < cardRect.left - 2 || rect.right > cardRect.right + 2) {
            failures.push(`Action outside card: ${label}`);
          }
          if (control.scrollWidth > control.clientWidth + 2) {
            failures.push(`Action text clipped: ${label}`);
          }
          if (isPhone && (rect.height < 40 || rect.width < 80)) {
            failures.push(`Action touch target too small: ${label} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
          }
        }
        if (isPhone && stages && actions) {
          const badgesRect = stages.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          if (actionsRect.top < badgesRect.bottom - 1) {
            failures.push("Phone actions overlap the stage badges");
          }
        }
        return { isPhone, badgeCount: badgeElements.length, actionCount: actionElements.length, failures };
      });
      expect(readability.failures, `Timeline controls and badges at ${page.viewportSize()?.width}px: ${JSON.stringify(readability)}`).toEqual([]);
      break;
    }
    case "Analytics": {
      const stages = page.getByTestId("analytics-report-stageCounts").getByRole("button", { name: /Grow Stage Distribution/i });
      const yields = page.getByTestId("analytics-report-yieldData").getByRole("button", { name: /Wet vs Dry Yield/i });
      await expect(stages).toHaveAttribute("aria-expanded", "true");
      await stages.click();
      await expect(stages).toHaveAttribute("aria-expanded", "false");
      await yields.click();
      await expect(yields).toHaveAttribute("aria-expanded", "true");
      await yields.click();
      await expect(yields).toHaveAttribute("aria-expanded", "false");
      await stages.click();
      await expect(stages).toHaveAttribute("aria-expanded", "true");
      break;
    }
    case "COG": {
      await page.getByTestId("cog-add-supply").click();
      await expect(page.getByTestId("cog-new-panel")).toBeVisible();
      await expect(page.getByTestId("cog-new-name")).toBeVisible();
      await page.getByTestId("cog-new-cancel").click();
      await expect(page.getByTestId("cog-new-panel")).toHaveCount(0);
      break;
    }
    case "Recipes": {
      await page.getByRole("button", { name: /^New Recipe$/i }).click();
      const dialog = page.getByRole("dialog").last();
      await expect(dialog.getByRole("heading", { name: /^New Recipe$/i })).toBeVisible();
      await expect(dialog.getByPlaceholder("Recipe name")).toBeVisible();
      await dialog.getByRole("button", { name: /^Close$/i }).click();
      await expect(dialog).toHaveCount(0);
      break;
    }
    case "Strains": {
      const form = page.getByTestId("strain-library-form");
      // An input linked to a datalist has the native accessible role "combobox".
      const strainName = form.getByRole("combobox", { name: /^Strain name$/i });
      await expect(strainName).toBeVisible();
      await expect(strainName).toHaveAttribute("list", "strainNameOptions");
      await expect(page.getByTestId("strain-library-submit")).toBeVisible();
      break;
    }
  }
}

for (const viewport of viewports) {
  test(`Remaining modules: ${viewport.name} navigation, responsive layout and safe interactions`, async ({ page }, info) => {
    requireLocalEmulators();
    const checkpoints: Checkpoint[] = [];
    const diagnostics: Diagnostic[] = [];
    const evidence: Record<string, unknown> = {
      suite: "modules",
      viewport: viewport.name,
      prerequisite: "grow-lifecycle.spec.ts completed first on the same emulator",
      readOnlyUiAudit: true,
      modules,
    };
    attachDiagnostics(page, diagnostics);

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoDashboard(page);
      const session = await captureNodeAuthSession(page);
      const root = `users/${session.userId}`;
      const inspectCounts = async () => {
        const [grows, tasks, recipes, supplies, movements] = await Promise.all([
          listFirestoreDocuments(session, `${root}/grows`),
          listFirestoreDocuments(session, `${root}/tasks`),
          listFirestoreDocuments(session, `${root}/recipes`),
          listFirestoreDocuments(session, `${root}/supplies`),
          listFirestoreDocuments(session, `${root}/inventoryMovements`),
        ]);
        return {
          grows: grows.length,
          tasks: tasks.length,
          recipes: recipes.length,
          supplies: supplies.length,
          inventoryMovements: movements.length,
        };
      };
      const before = await inspectCounts();
      evidence.beforeCounts = before;
      expect(before.grows, "The prerequisite lifecycle should have created a grow").toBeGreaterThan(0);

      // Collect evidence from the remaining modules even if one module has
      // a broken selector or interaction. Report every failure at the end.
      const moduleFailures: { module: ModuleName; message: string }[] = [];
      for (const module of modules) {
        let moduleFailed = false;
        try {
          await openModule(page, module);
          await safeInteractions(page, module);
        } catch (error) {
          moduleFailed = true;
          moduleFailures.push({
            module,
            message: String(error instanceof Error ? error.message : error).slice(0, 2200),
          });
        }
        try {
          await capture(page, info, checkpoints, module, `${viewport.name}-${module.toLowerCase()}`);
        } catch (error) {
          moduleFailed = true;
          moduleFailures.push({
            module,
            message: `Screenshot/layout capture: ${String(error instanceof Error ? error.message : error).slice(0, 1800)}`,
          });
        }
        if (moduleFailed) {
          // A dialog or incomplete navigation in this module must not hide
          // failures in later workspaces.
          try {
            await gotoDashboard(page);
          } catch (error) {
            moduleFailures.push({
              module,
              message: `Recovery navigation: ${String(error instanceof Error ? error.message : error).slice(0, 1200)}`,
            });
          }
        }
      }
      evidence.moduleFailures = moduleFailures;

      const after = await inspectCounts();
      evidence.afterCounts = after;
      expect.soft(after, "Viewing and canceling forms must not mutate emulator records").toEqual(before);
      expect.soft(moduleFailures, "All seven modules must pass navigation and safe-interaction checks").toEqual([]);
      for (const check of checkpoints) {
        expect.soft(check.horizontalOverflowPx, `${check.name}: page horizontal overflow`).toBeLessThanOrEqual(16);
        for (const control of check.controls) {
          expect.soft(control.outsideViewportPx, `${check.name}: ${control.name} should not be clipped horizontally`).toBeLessThanOrEqual(8);
        }
      }
      expect.soft(
        diagnostics.filter((item) => item.kind === "page-error"),
        "Uncaught browser exceptions"
      ).toEqual([]);
      expect.soft(
        diagnostics.filter((item) => item.kind === "console-error" && /Maximum update depth exceeded/i.test(item.detail)),
        "React update-loop warnings"
      ).toEqual([]);
    } finally {
      await info.attach(`remaining-modules-${viewport.name}-diagnostics.json`, {
        body: Buffer.from(JSON.stringify({
          schema: "cnm-remaining-modules-ux-v1",
          timestampUtc: new Date().toISOString(),
          ...evidence,
          checkpoints,
          diagnostics,
          counts: {
            consoleErrors: diagnostics.filter((x) => x.kind === "console-error").length,
            consoleWarnings: diagnostics.filter((x) => x.kind === "console-warning").length,
            pageErrors: diagnostics.filter((x) => x.kind === "page-error").length,
            httpErrors: diagnostics.filter((x) => x.kind === "http-error").length,
            failedRequests: diagnostics.filter((x) => x.kind === "request-failed").length,
          },
        }, null, 2)),
        contentType: "application/json",
      });
    }
  });
}
