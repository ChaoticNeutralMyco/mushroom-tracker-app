// tests/unit/trialExpirationNotice.test.jsx

import { describe, expect, it } from "vitest";
import { getTrialNoticeCopy } from "../../src/components/ui/TrialExpirationNotice.jsx";

describe("trial expiration notice copy", () => {
  it("shows the exact remaining-day count during the warning window", () => {
    expect(
      getTrialNoticeCopy({ phase: "warning", daysRemaining: 7 })
    ).toMatchObject({
      title: "7 days left in your Lab trial",
      dismissLabel: "Continue trial",
    });
  });

  it("uses a clear final-day message", () => {
    expect(getTrialNoticeCopy({ phase: "ends_today", daysRemaining: 1 })).toMatchObject({
      title: "Your Lab trial ends today",
      dismissLabel: "Continue trial",
    });
  });

  it("explains the non-destructive Free fallback after expiration", () => {
    const copy = getTrialNoticeCopy({ phase: "expired", daysRemaining: 0 });
    expect(copy.title).toBe("Your Lab trial has ended");
    expect(copy.body).toContain("Nothing was deleted");
    expect(copy.dismissLabel).toBe("Continue with Free");
  });
});
