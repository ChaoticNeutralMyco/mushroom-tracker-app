// tests/unit/subscriptionLiveIntegration.test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativeUrl) =>
  readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");

const mainSource = readSource("../../src/main.jsx");
const appSource = readSource("../../src/App.jsx");
const settingsSource = readSource("../../src/pages/Settings.jsx");
const providerSource = readSource("../../src/providers/SubscriptionProvider.jsx");

describe("live subscription foundation wiring", () => {
  it("wraps the live application in the subscription provider", () => {
    expect(mainSource).toContain("<SubscriptionProvider>");
    expect(mainSource).toContain("<App />");
  });

  it("mounts the required trial notice without adding feature gates", () => {
    expect(appSource).toContain("<TrialExpirationNotice");
    expect(appSource).toContain("activeGrowCount={activeGrowsBase.length}");
    expect(appSource).not.toContain("canEntitlementUseFeature(");
  });

  it("adds a live Subscription control-center tab", () => {
    expect(settingsSource).toContain('{ id: "subscription", label: "Subscription" }');
    expect(settingsSource).toContain("<SubscriptionPage activeGrowCount={activeGrowCount} />");
    expect(settingsSource).toContain('window.addEventListener("cn:settings-tab"');
  });

  it("reads trusted entitlements and stores only UI dismissal state client-side", () => {
    expect(providerSource).toContain("getUserEntitlementDocumentPath");
    expect(providerSource).toContain('"subscriptionUi"');
    expect(providerSource).toContain("lastTrialNoticeDismissedDateKey");
    expect(providerSource).not.toContain('setDoc(entitlementRef');
  });

  it("fails closed while trusted entitlement access is loading", () => {
    expect(providerSource).toContain("buildLoadingSubscriptionRuntime");
    expect(providerSource).toContain("setRuntime(buildLoadingSubscriptionRuntime())");
    expect(providerSource).toContain("accessReady && canEntitlementUseFeature");
    expect(providerSource).toContain("if (!accessReady)");
  });

  it("exposes resolved grace and access-ready state to live consumers", () => {
    expect(providerSource).toContain("accessReady");
    expect(providerSource).toContain("grace: runtime.grace");
    expect(providerSource).toContain("grace: runtime.grace,");
  });

});
