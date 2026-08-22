// src/components/ui/TrialExpirationNotice.jsx

import React, { useState } from "react";
import { useSubscription } from "../../providers/SubscriptionProvider.jsx";

export function getTrialNoticeCopy(trialNotice = {}) {
  if (trialNotice.phase === "expired") {
    return {
      title: "Your Lab trial has ended",
      body:
        "Your account is now on Free. Nothing was deleted, and your existing records remain available.",
      dismissLabel: "Continue with Free",
    };
  }

  if (trialNotice.phase === "ends_today") {
    return {
      title: "Your Lab trial ends today",
      body:
        "Upgrade to keep Lab access. If you do not upgrade, your account moves to Free without deleting your records.",
      dismissLabel: "Continue trial",
    };
  }

  const days = Number(trialNotice.daysRemaining) || 0;
  return {
    title: `${days} day${days === 1 ? "" : "s"} left in your Lab trial`,
    body:
      "Upgrade before the trial ends to keep Lab access. Your records will remain intact if the account returns to Free.",
    dismissLabel: "Continue trial",
  };
}

export default function TrialExpirationNotice({ onViewPlans }) {
  const { loading, trialNotice, dismissTrialNotice } = useSubscription();
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");

  if (loading || !trialNotice?.shouldShow) {
    return null;
  }

  const copy = getTrialNoticeCopy(trialNotice);

  const handleAction = async (action) => {
    setBusyAction(action);
    setError("");

    try {
      await dismissTrialNotice();
      if (action === "plans") {
        onViewPlans?.();
      }
    } catch (actionError) {
      console.warn("Trial notice dismissal failed:", actionError);
      setError("The notice could not be dismissed. Check your connection and try again.");
    } finally {
      setBusyAction("");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-expiration-title"
      data-testid="trial-expiration-notice"
    >
      <div className="w-full max-w-lg rounded-2xl border border-amber-300/70 bg-white p-6 shadow-2xl dark:border-amber-700 dark:bg-zinc-950">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          Subscription reminder
        </p>
        <h2 id="trial-expiration-title" className="mt-2 text-2xl font-bold">
          {copy.title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {copy.body}
        </p>

        {error ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="btn"
            disabled={Boolean(busyAction)}
            onClick={() => handleAction("dismiss")}
          >
            {busyAction === "dismiss" ? "Saving…" : copy.dismissLabel}
          </button>
          <button
            type="button"
            className="btn-accent"
            disabled={Boolean(busyAction)}
            onClick={() => handleAction("plans")}
          >
            {busyAction === "plans" ? "Opening…" : "View plans / Upgrade now"}
          </button>
        </div>
      </div>
    </div>
  );
}
