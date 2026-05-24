// tests/unit/subscriptionPage.test.jsx

import { describe, expect, it } from "vitest";

import SubscriptionPage from "../../src/pages/SubscriptionPage.jsx";

describe("SubscriptionPage passive shell", () => {
  it("exports a React component without wiring runtime navigation", () => {
    expect(typeof SubscriptionPage).toBe("function");
  });
});
