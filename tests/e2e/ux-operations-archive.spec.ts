// tests/e2e/ux-operations-archive.spec.ts
// Read-only UI verification after the existing grow-lifecycle test seeds the Firebase emulators.
// No production access, inventory mutations, sale submissions, or print operations.
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { clickAppTab, gotoDashboard } from "./helpers/app";
import { captureNodeAuthSession, listFirestoreDocuments } from "./helpers/firestore";

test.use({ trace: "on", screenshot: "on", video: "on" });
test.setTimeout(8 * 60 * 1000);

type Diagnostic = {
  kind: "console-error" | "console-warning" | "page-error" | "http-error" | "request-failed";
  detail: string;
  status?: number;
};
type Checkpoint = {
  name: string;
  viewport: { width: number; height: number } | null;
  horizontalOverflowPx: number;
  screenshot: string;
};

const DATA_TAG = "E2E";

function requireLocalEmulators() {
  const enabled = /^(1|true|yes)$/i.test(String(process.env.E2E_REQUIRE_FIREBASE_EMULATORS || ""));
  if (
    !enabled ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
    process.env.FUNCTIONS_EMULATOR_HOST !== "127.0.0.1:5001" ||
    process.env.GCLOUD_PROJECT !== "chaotic-neutral-tracker"
  ) {
    throw new Error("Operations UX audit is restricted to the verified local Firebase emulators.");
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

function safePath(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid request URL]";
  }
}

async function capture(page: Page, info: TestInfo, checks: Checkpoint[], name: string, fullPage = false) {
  const screenshot = `${name}.png`;
  const output = info.outputPath(screenshot);
  await page.screenshot({ path: output, fullPage, animations: "disabled" });
  await info.attach(screenshot, { path: output, contentType: "image/png" });
  const width = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body?.scrollWidth || 0) - root.clientWidth;
  });
  checks.push({
    name,
    viewport: page.viewportSize(),
    horizontalOverflowPx: Math.max(0, width),
    screenshot,
  });
}

async function measurePackagingLabelLayout(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const bounds = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        outsideViewportPx: Math.max(0, Math.ceil(rect.right - viewportWidth), Math.ceil(-rect.left)),
      };
    };
    const sheet = document.querySelector<HTMLElement>('[data-testid="packaging-label-sheet-scroll"]');
    const insideHorizontalScroller = (node: Element) => {
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if ((overflowX === "auto" || overflowX === "scroll") && parent.scrollWidth > parent.clientWidth + 1) {
          return true;
        }
      }
      return false;
    };
    const uncontainedOverflow = Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ node, rect }) => rect.width > 1 && rect.right > viewportWidth + 8 && !insideHorizontalScroller(node))
      .sort((a, b) => b.rect.right - a.rect.right)
      .slice(0, 12)
      .map(({ node, rect }) => ({
        tag: node.tagName.toLowerCase(),
        testId: node.getAttribute("data-testid"),
        className: String(node.getAttribute("class") || "").slice(0, 160),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      }));
    return {
      viewportWidth,
      documentOverflowPx: Math.max(0, document.documentElement.scrollWidth - viewportWidth),
      uncontainedOverflow,
      selectorIntro: bounds('[data-testid="packaging-label-selector-intro"]'),
      previewIntro: bounds('[data-testid="packaging-label-preview-intro"]'),
      lotsPanel: bounds('[data-testid="packaging-label-lots-panel"]'),
      lotRow: bounds('[data-testid="packaging-label-lot-row"]'),
      quantityInput: bounds('[data-testid="packaging-label-lot-row"] input[type="number"]'),
      sheetScrollport: bounds('[data-testid="packaging-label-sheet-scroll"]'),
      sheetScrollWidth: sheet?.scrollWidth ?? null,
      sheetClientWidth: sheet?.clientWidth ?? null,
    };
  });
}

async function openPostProcessTab(page: Page, label: string) {
  await clickAppTab(page, "Post Processing");
  await expect(page.getByRole("heading", { name: /^Post Processing$/i })).toBeVisible({ timeout: 20_000 });
  const tab = page.locator('[data-tour="postprocess-tabs"]').getByRole("button", {
    name: new RegExp(`^${label}$`, "i"),
  });
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
}

function packagedRetail(lot: any) {
  return String(lot?.sourceType || "").toLowerCase() === "finished_package" &&
    String(lot?.skuType || lot?.packageSkuType || lot?.package?.skuType || "").toLowerCase() === "retail" &&
    String(lot?.name || lot?.batchName || "").includes(DATA_TAG);
}

test("Post Processing, Sales, Labels, and loaded Archive render from trusted lifecycle records", async ({ page }, info) => {
  requireLocalEmulators();
  const diagnostics: Diagnostic[] = [];
  const checkpoints: Checkpoint[] = [];
  const evidence: Record<string, unknown> = { prerequisite: "grow-lifecycle.spec.ts passed first" };
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

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoDashboard(page);
    const session = await captureNodeAuthSession(page);
    const base = `users/${session.userId}`;
    const readLots = () => listFirestoreDocuments(session, `${base}/materialLots`);
    const readMovements = () => listFirestoreDocuments(session, `${base}/inventoryMovements`);

    // This audit observes actual persisted entities produced by the existing
    // trusted-callable lifecycle; it never invents or changes sale/ledger records.
    await expect.poll(async () => {
      const lots = await readLots();
      return lots.some((lot) => packagedRetail(lot) &&
        Number(lot?.outboundSummary?.sold || 0) >= 3 &&
        Number(lot?.remainingQuantity || 0) === 7);
    }, { timeout: 30_000, intervals: [400, 800, 1500] }).toBe(true);

    const beforeLots = await readLots();
    const beforeMovements = await readMovements();
    const child = beforeLots.find((lot) => packagedRetail(lot) &&
      Number(lot?.outboundSummary?.sold || 0) >= 3);
    expect(child?.id, "The lifecycle must leave a packaged retail child for UI verification").toBeTruthy();
    const beforeRemaining = Number(child?.remainingQuantity || 0);
    expect(String(child?.qc?.status || child?.qcStatus || "")).toMatch(/^pass$/i);
    expect(String(child?.workflow?.releaseStatus || child?.releaseStatus || "")).toMatch(/^released$/i);
    expect(Number(child?.outboundSummary?.revenue || 0)).toBe(12);
    const parentId = String(child?.parentLotId || child?.sourceLotId || "");
    expect(beforeLots.some((lot) => lot.id === parentId), "Packaged SKU must retain parent lineage").toBe(true);
    const beforeMovementIds = beforeMovements.map((movement) => movement.id).sort();
    const saleMovements = beforeMovements.filter((move) =>
      move.lotId === child?.id && String(move.movementType).toLowerCase() === "sell");
    expect(saleMovements.length, "Trusted packaged sale should have ledger evidence").toBeGreaterThan(0);
    evidence.fixture = {
      retailLots: beforeLots.filter(packagedRetail).length,
      retailChildRemaining: beforeRemaining,
      retailChildSold: Number(child?.outboundSummary?.sold || 0),
      totalInventoryMovements: beforeMovements.length,
      trustedSaleMovements: saleMovements.length,
      qcStatus: child?.qc?.status || child?.qcStatus || null,
      releaseStatus: child?.workflow?.releaseStatus || child?.releaseStatus || null,
    };

    // Desktop: each manufacturing and inventory workspace with lifecycle data.
    for (const [tab, slug] of [
      ["Dry Material", "dry-material"],
      ["Extractions", "extractions"],
      ["Production", "production"],
      ["Finished Inventory", "finished-inventory"],
    ] as const) {
      await openPostProcessTab(page, tab);
      await capture(page, info, checkpoints, `01-desktop-${slug}`);
    }
    await expect(page.getByRole("heading", { name: /^Finished inventory$/i })).toBeVisible();
    const finishedLotCard = page.locator('button[id^="finished-lot-"]').first();
    if (await finishedLotCard.isVisible().catch(() => false)) {
      await finishedLotCard.click();
      const detail = page.getByRole("dialog").last();
      await expect(detail).toBeVisible();
      await capture(page, info, checkpoints, "02-desktop-finished-lot-detail");
      await detail.getByRole("button", { name: /^Close$/i }).click();
      await expect(detail).toBeHidden();
    } else {
      evidence.finishedLotDetail = "No active parent finished lot; packaged child was confirmed in Firestore";
    }

    await openPostProcessTab(page, "Sales");
    await expect(page.getByRole("heading", { name: /Sales and outbound tracking/i })).toBeVisible();
    const product = page.getByRole("button", { name: /packages available/i }).first();
    await expect(product, "Packaged sale should produce a selectable sales product card").toBeVisible({ timeout: 20_000 });
    await capture(page, info, checkpoints, "03-desktop-sales");
    await product.click();
    const saleDetail = page.getByRole("dialog").last();
    await expect(saleDetail).toBeVisible({ timeout: 15_000 });
    await expect(saleDetail.getByText(/FEFO applies inside/i).first()).toBeVisible();
    await capture(page, info, checkpoints, "04-desktop-sales-fefo-detail");
    await saleDetail.getByRole("button", { name: /^Close$/i }).click();
    await expect(saleDetail).toBeHidden();

    await openPostProcessTab(page, "History");
    await expect(page.getByRole("heading", { name: /Inventory movement ledger/i })).toBeVisible();
    await expect(page.getByText(/E2E Test Customer/i).first()).toBeVisible({ timeout: 20_000 });
    await capture(page, info, checkpoints, "05-desktop-inventory-ledger");

    await clickAppTab(page, "Labels");
    await expect(page.getByText(/Packaging labels — Avery 5659/i).first()).toBeVisible({ timeout: 20_000 });
    const packagedSelect = page.getByRole("combobox", { name: /Packaged SKU/i }).first();
    await expect(packagedSelect, "Packaged child SKU must be available for label preview").toBeVisible({ timeout: 20_000 });
    await expect.poll(() => packagedSelect.locator("option").count(), { timeout: 20_000 }).toBeGreaterThan(0);
    evidence.labelSkuOptions = await packagedSelect.locator("option").allTextContents();
    expect(evidence.labelSkuOptions).toEqual(expect.arrayContaining([expect.stringMatching(/E2E/i)]));
    await capture(page, info, checkpoints, "06-desktop-packaging-labels");

    await clickAppTab(page, "Archive");
    await expect(page.getByText(/^Archived Grows$/i).first()).toBeVisible({ timeout: 20_000 });
    // Crucial: never screenshot the lazy-loading skeleton as "loaded Archive".
    await expect(page.getByText(/E2E Golden Teacher/i).first()).toBeVisible({ timeout: 20_000 });
    await capture(page, info, checkpoints, "07-desktop-archive-loaded");

    // Tablet and phone: verify actual controls and content, not only app shell.
    for (const viewport of [
      { name: "tablet", width: 768, height: 1024 },
      { name: "phone", width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openPostProcessTab(page, "Finished Inventory");
      await expect(page.getByRole("heading", { name: /^Finished inventory$/i })).toBeVisible();
      await capture(page, info, checkpoints, `08-${viewport.name}-finished-inventory`);

      await openPostProcessTab(page, "Sales");
      await expect(page.getByRole("button", { name: /packages available/i }).first()).toBeVisible();
      await capture(page, info, checkpoints, `09-${viewport.name}-sales`);

      await clickAppTab(page, "Labels");
      await expect(page.getByRole("combobox", { name: /Packaged SKU/i }).first()).toBeVisible();
      await capture(page, info, checkpoints, `10-${viewport.name}-packaging-labels`);
      // Width checks must include actual lot controls, not just the document body.
      const lotRow = page.getByTestId("packaging-label-lot-row").first();
      const sheetScroll = page.getByTestId("packaging-label-sheet-scroll");
      await expect(lotRow).toBeVisible();
      await expect(lotRow.locator('input[type="number"]')).toBeVisible();
      await expect(sheetScroll).toBeVisible();
      const labelLayout = await measurePackagingLabelLayout(page);
      evidence[`${viewport.name}PackagingLabelLayout`] = labelLayout;
      for (const key of ["selectorIntro", "previewIntro", "lotsPanel", "lotRow", "quantityInput", "sheetScrollport"] as const) {
        const rect = labelLayout[key];
        expect.soft(rect, `${viewport.name}: ${key} must exist`).not.toBeNull();
        if (rect) {
          expect.soft(rect.outsideViewportPx, `${viewport.name}: ${key} must stay within the screen`).toBeLessThanOrEqual(8);
        }
      }

      // A zero-overflow page can still be unusable if flex layout crushes text.
      // Both intro panels must retain readable widths on phone and tablet.
      const minimumReadableWidth = Math.min(220, Math.floor(labelLayout.viewportWidth * 0.55));
      for (const key of ["selectorIntro", "previewIntro"] as const) {
        const rect = labelLayout[key];
        if (rect) {
          expect.soft(
            rect.width,
            `${viewport.name}: ${key} must remain wide enough to read`
          ).toBeGreaterThanOrEqual(minimumReadableWidth);
        }
      }

      await clickAppTab(page, "Archive");
      await expect(page.getByText(/^Archived Grows$/i).first()).toBeVisible();
      await expect(page.getByText(/E2E Golden Teacher/i).first()).toBeVisible();
      await capture(page, info, checkpoints, `11-${viewport.name}-archive-loaded`, true);
    }

    // The visual audit intentionally has not recorded sales or touched inventory.
    const afterLots = await readLots();
    const afterChild = afterLots.find((lot) => lot.id === child?.id);
    const afterMovements = await readMovements();
    expect(Number(afterChild?.remainingQuantity || 0), "UI audit must not change retail inventory").toBe(beforeRemaining);
    expect(afterMovements.map((move) => move.id).sort(), "UI audit must not write movements").toEqual(beforeMovementIds);

    for (const check of checkpoints) {
      expect.soft(check.horizontalOverflowPx, `${check.name}: page horizontal overflow`).toBeLessThanOrEqual(16);
    }
    const updateLoops = diagnostics.filter((d) => d.kind === "console-error" && /Maximum update depth exceeded/i.test(d.detail));
    expect.soft(updateLoops, "React update-loop warning must not return").toEqual([]);
    expect.soft(diagnostics.filter((d) => d.kind === "page-error"), "Uncaught browser errors").toEqual([]);
  } finally {
    await info.attach("operations-ux-diagnostics.json", {
      body: Buffer.from(JSON.stringify({
        schema: "cnm-operations-ux-v1",
        runUtc: new Date().toISOString(),
        suite: "operations",
        readOnlyUiAudit: true,
        checkpoints,
        evidence,
        diagnostics,
        diagnosticCounts: {
          consoleErrors: diagnostics.filter((d) => d.kind === "console-error").length,
          consoleWarnings: diagnostics.filter((d) => d.kind === "console-warning").length,
          pageErrors: diagnostics.filter((d) => d.kind === "page-error").length,
          httpErrors: diagnostics.filter((d) => d.kind === "http-error").length,
          failedRequests: diagnostics.filter((d) => d.kind === "request-failed").length,
        },
      }, null, 2)),
      contentType: "application/json",
    });
  }
});
