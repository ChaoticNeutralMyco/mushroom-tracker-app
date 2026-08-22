// tests/unit/subscriptionSopGateIntegration.test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativeUrl) =>
  readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");

const normalizeSourceText = (source) =>
  String(source || "").replace(/\s+/g, " ").trim();

const sourceBetween = (source, startMarker, endMarker) => {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

const appSource = readSource("../../src/App.jsx");
const recipeManagerSource = readSource(
  "../../src/components/recipes/RecipeManager.jsx"
);
const toolkitSource = readSource(
  "../../src/components/recipes/SopWorkflowToolkit.jsx"
);
const growFormSource = readSource("../../src/components/Grow/GrowForm.jsx");
const noticeSource = readSource(
  "../../src/components/ui/SubscriptionFeatureNotice.jsx"
);
const subscriptionPageSource = readSource("../../src/pages/SubscriptionPage.jsx");

describe("Cultivator SOP gate live integration", () => {
  it("reads both SOP feature keys through the subscription context", () => {
    expect(appSource).toContain("SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS");
    expect(appSource).toContain("SUBSCRIPTION_FEATURE_KEYS.SOP_GENERATED_TASKS");
    expect(appSource).toContain("subscription.hasFeature");
  });

  it("blocks the App SOP-start handler before opening a new GrowForm", () => {
    const startHandler = sourceBetween(
      appSource,
      "const onStartGrowFromSop = (template) =>",
      "const onCreateTask = async"
    );

    expect(startHandler).toContain("requestSubscriptionFeature");
    expect(startHandler.indexOf("requestSubscriptionFeature")).toBeLessThan(
      startHandler.indexOf("requestNewGrow")
    );
  });

  it("passes configuration-driven access into the recipe toolkit", () => {
    expect(recipeManagerSource).toContain("canUseSopWorkflows = true");
    expect(recipeManagerSource).toContain("canGenerateSopTasks = true");
    expect(recipeManagerSource).toContain(
      "onSubscriptionFeatureBlocked={onSubscriptionFeatureBlocked}"
    );
  });

  it("keeps templates visible while blocking only new SOP-derived records", () => {
    expect(toolkitSource).toContain('data-testid="sop-workflow-upgrade-hint"');
    expect(toolkitSource).toContain("Create a recipe from an SOP template");
    expect(toolkitSource).toContain("Start a new grow from an SOP template");
    expect(toolkitSource).toContain("printSelectedWorkflow");
    expect(toolkitSource).toContain("exportSelectedWorkflow");
  });

  it("defends the GrowForm submit path and separates task access", () => {
    const submitSource = sourceBetween(
      growFormSource,
      "const handleSubmit = async",
      "/* ==================== RENDER ==================== */"
    );

    expect(submitSource).toContain("isSopStart && !canUseSopWorkflows");
    expect(submitSource).toContain("canGenerateSopTasks &&");
    expect(growFormSource).toContain("disabled={!canGenerateSopTasks}");
    expect(growFormSource).toContain(
      "SUBSCRIPTION_FEATURE_KEYS.SOP_GENERATED_TASKS"
    );
  });

  it("keeps already-started SOP records available after downgrade", () => {
    expect(growFormSource).toContain(
      'const isSopStart = mode === "create" && Boolean(sopTemplate?.id)'
    );
    expect(noticeSource).toContain("Existing SOP-linked grows");
    expect(noticeSource).toContain("continue and complete work");
  });

  it("shows a plans action and documents the downgrade behavior", () => {
    expect(appSource).toContain("<SubscriptionFeatureNotice");
    expect(noticeSource).toContain("View plans");
    expect(normalizeSourceText(subscriptionPageSource)).toContain(
      "Existing SOP-linked grows, tasks, and checklists can still be completed"
    );
  });
});
