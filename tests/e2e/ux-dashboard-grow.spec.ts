// tests/e2e/ux-dashboard-grow.spec.ts
// Dashboard + Grow Management browser observation (Firebase emulators only).
// Read-only within this test: the preceding smoke tests create emulator fixtures.
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { clickAppTab, gotoDashboard, openNewGrow } from "./helpers/app";

test.use({ trace: "on", video: "on", screenshot: "on" });
test.setTimeout(240_000);

type Diagnostic = {
  kind: "console-error" | "console-warning" | "page-error" | "http-error" | "request-failed";
  detail: string;
  status?: number;
};

type Checkpoint = {
  name: string;
  urlPath: string;
  viewport: { width: number; height: number } | null;
  scrollWidth: number;
  clientWidth: number;
  horizontalOverflowPx: number;
  growRows: number;
  screenshot: string;
};

function redact(value: unknown): string {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED JWT]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[REDACTED EMAIL]")
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]+/g, "$1?[REDACTED QUERY]")
    .slice(0, 700);
}

function requestPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[non-URL request]";
  }
}

async function snapshot(
  page: Page,
  info: TestInfo,
  checkpoints: Checkpoint[],
  name: string,
  fullPage = false
) {
  const screenshot = `${name}.png`;
  const location = info.outputPath(screenshot);
  await page.screenshot({ path: location, fullPage, animations: "disabled" });
  await info.attach(screenshot, { path: location, contentType: "image/png" });
  const measurement = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(root.scrollWidth, body?.scrollWidth ?? 0);
    return {
      scrollWidth,
      clientWidth: root.clientWidth,
      horizontalOverflowPx: Math.max(0, scrollWidth - root.clientWidth),
    };
  });
  checkpoints.push({
    name,
    urlPath: new URL(page.url()).pathname,
    viewport: page.viewportSize(),
    ...measurement,
    growRows: await page.getByTestId("grow-row").count(),
    screenshot,
  });
}

async function openGrowDetail(page: Page) {
  const row = page.getByTestId("grow-row").first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByTestId("grow-row-open").click();
  await expect(page).toHaveURL(/\/grow\/[^/?#]+/, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Back/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("h1")).toBeVisible({ timeout: 20_000 });
}

// The "ux" launcher runs create + stage smoke tests first, so the account
// ordinarily has one visible, colonized emulator grow when this audit starts.
test("Dashboard and Grow UI renders and navigates across screen sizes", async ({ page }, info) => {
  if (!/^(1|true|yes)$/i.test(process.env.E2E_REQUIRE_FIREBASE_EMULATORS || "")) {
    throw new Error("UX audit requires local Firebase emulators; production browsing is not permitted.");
  }
  const diagnostics: Diagnostic[] = [];
  const checkpoints: Checkpoint[] = [];
  const record = (kind: Diagnostic["kind"], detail: unknown, status?: number) => {
    if (diagnostics.length >= 250) return;
    diagnostics.push({ kind, detail: redact(detail), ...(status ? { status } : {}) });
  };

  page.on("console", (message) => {
    if (message.type() === "error") record("console-error", message.text());
    if (message.type() === "warning") record("console-warning", message.text());
  });
  page.on("pageerror", (error) => record("page-error", error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      record("http-error", requestPath(response.url()), response.status());
    }
  });
  page.on("requestfailed", (request) => {
    record("request-failed", `${requestPath(request.url())} (${request.failure()?.errorText || "unknown"})`);
  });

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDashboard(page);
    await expect(page.getByTestId("active-grow-usage")).toBeVisible();
    await snapshot(page, info, checkpoints, "01-dashboard-desktop", true);

    // Verify new-grow form can open and cancel without creating records.
    await openNewGrow(page);
    const form = page.locator("form.grow-form").first();
    await expect(form.getByRole("button", { name: /^Create$/i })).toBeVisible();
    await snapshot(page, info, checkpoints, "02-new-grow-desktop");
    await form.getByRole("button", { name: /^Cancel$/i }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });

    const search = page.getByRole("textbox", { name: "Search grows" });
    await expect(search).toBeVisible();
    // Non-destructive search interaction; also verify the filter clears.
    await search.fill("E2E Stage Advance Golden Teacher");
    await snapshot(page, info, checkpoints, "03-grow-search-desktop");
    await search.fill("");
    await expect(page.getByTestId("grow-row").first()).toBeVisible({ timeout: 20_000 });
    await openGrowDetail(page);
    await snapshot(page, info, checkpoints, "04-grow-detail-desktop", true);

    // Return to Dashboard and check the responsive navigation and new-grow modal.
    for (const device of [
      { name: "tablet", width: 768, height: 1024 },
      { name: "phone", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: device.width, height: device.height });
      await gotoDashboard(page);
      await expect(page.getByRole("tab", { name: /^Dashboard$/i })).toBeVisible();
      await snapshot(page, info, checkpoints, `05-dashboard-${device.name}`, true);
      // Page-level overflow checks alone can miss clipped controls inside a grow card.
      // Every per-grow action must fit horizontally within the viewport.
      const firstGrowRow = page.getByTestId("grow-row").first();
      await expect(firstGrowRow).toBeVisible();
      const clippedGrowActions = await firstGrowRow.locator("a, button").evaluateAll((elements) =>
        elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && (rect.left < -2 || rect.right > window.innerWidth + 2);
          })
          .map((element) => element.textContent?.trim() || element.getAttribute("aria-label") || "Unnamed action")
      );
      expect.soft(clippedGrowActions, `${device.name} grow row has horizontally clipped actions`).toEqual([]);
      await openNewGrow(page);
      const mobileForm = page.locator("form.grow-form").first();
      await snapshot(page, info, checkpoints, `06-new-grow-${device.name}`);
      const clippedFormControls = await mobileForm.locator("input.input, select.input, textarea.input").evaluateAll((elements) =>
        elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && (rect.left < -2 || rect.right > window.innerWidth + 2);
          })
          .map((element) => element.getAttribute("name") || element.getAttribute("aria-label") || element.tagName.toLowerCase())
      );
      expect.soft(clippedFormControls, `${device.name} grow form has horizontally clipped controls`).toEqual([]);
      await mobileForm.getByRole("button", { name: /^Cancel$/i }).click();
      await expect(mobileForm).toBeHidden();
      await openGrowDetail(page);
      await snapshot(page, info, checkpoints, `07-grow-detail-${device.name}`, true);
    }

    await gotoDashboard(page);
    await clickAppTab(page, "Archive");
    await expect(page.getByRole("tab", { name: /^Archive$/i })).toHaveAttribute("aria-selected", "true");
    await snapshot(page, info, checkpoints, "08-archive-phone");
    await clickAppTab(page, "Dashboard");

    // React can report an update loop through console.error without throwing a pageerror.
    // The empty-harvest-flush case must never trigger this warning again.
    const updateLoopWarnings = diagnostics.filter(
      (diagnostic) =>
        diagnostic.kind === "console-error" &&
        /Maximum update depth exceeded/i.test(diagnostic.detail)
    );
    expect.soft(updateLoopWarnings, "Grow Details must not trigger a React update loop").toEqual([]);

    // Uncaught browser exceptions constitute a functional audit failure.
    const exceptions = diagnostics.filter((diagnostic) => diagnostic.kind === "page-error");
    expect.soft(exceptions, "Uncaught JavaScript exceptions in the audited UI").toEqual([]);

    // Record any page-level horizontal overflow as a usability finding.
    for (const checkpoint of checkpoints) {
      expect.soft(
        checkpoint.horizontalOverflowPx,
        `${checkpoint.name} has ${checkpoint.horizontalOverflowPx}px of page-level horizontal overflow`
      ).toBeLessThanOrEqual(16);
    }
  } finally {
    // An attachment is created even on assertion failure, so diagnostics land
    // inside the existing single-ZIP report along with screenshots/video/trace.
    const report = {
      schema: "cnm-ux-audit-v1",
      runUtc: new Date().toISOString(),
      emulatorRequired: true,
      checkpoints,
      diagnosticCounts: {
        consoleErrors: diagnostics.filter((d) => d.kind === "console-error").length,
        consoleWarnings: diagnostics.filter((d) => d.kind === "console-warning").length,
        pageErrors: diagnostics.filter((d) => d.kind === "page-error").length,
        httpErrors: diagnostics.filter((d) => d.kind === "http-error").length,
        failedRequests: diagnostics.filter((d) => d.kind === "request-failed").length,
      },
      diagnostics,
    };
    await info.attach("ux-audit-diagnostics.json", {
      body: Buffer.from(JSON.stringify(report, null, 2), "utf8"),
      contentType: "application/json",
    });
  }
});
