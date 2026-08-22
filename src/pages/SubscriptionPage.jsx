// src/pages/SubscriptionPage.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_LIMIT_KEYS,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLAN_ORDER,
  SUBSCRIPTION_PLANS,
} from "../lib/subscriptionPlans.js";
import {
  getEntitlementAccessPlanId,
  getEntitlementPlan,
  getEntitlementPlanId,
} from "../lib/subscriptionEntitlements.js";
import {
  getBillingReturnNotice,
  getSubscriptionPlanBillingAction,
  hasManagedStripeSubscription,
  removeBillingReturnParameters,
} from "../lib/subscriptionBilling.js";
import { getPlanPriceLabel } from "../lib/subscriptionMessaging.js";
import { buildSubscriptionRuntimeSummary } from "../lib/subscriptionRuntime.js";
import { toSubscriptionDate } from "../lib/subscriptionTrial.js";
import { useSubscription } from "../providers/SubscriptionProvider.jsx";

const formatLimit = (value) => {
  if (value === null) return "Unlimited";
  if (value === undefined) return "Not configured";
  return String(value);
};

const formatDate = (value) => {
  const date = toSubscriptionDate(value);
  if (!date) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
};

const getDisplayedPrice = (plan) => {
  if (plan.billingType === "paid" && plan.pricingStatus === "tbd") {
    return "Price shown in secure Checkout";
  }
  return getPlanPriceLabel(plan.id);
};

const PLAN_HIGHLIGHTS = {
  free: [
    "Full cultivation toolkit",
    "Environmental tracking",
    "Grow labels",
    "6 active grows",
  ],
  hobby: [
    "Everything in Free",
    "Same cultivation features",
    "Grow labels",
    "30 active grows",
  ],
  cultivator: [
    "Unlimited active grows",
    "SOP workflows and generated tasks",
    "Advanced analytics and exports",
  ],
  lab: [
    "Post Processing and finished inventory",
    "Package runs, sales, and FEFO",
    "Post Processing labels and Lab analytics",
  ],
};

const returnNoticeToneClass = {
  success:
    "border-[rgba(var(--_accent-rgb),0.35)] bg-[rgba(var(--_accent-rgb),0.10)] text-zinc-900 dark:text-zinc-100",
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-100",
};

function readBillingReturnNotice() {
  if (typeof window === "undefined") return null;
  return getBillingReturnNotice(window.location.search || "");
}

export default function SubscriptionPage({ activeGrowCount = 0 }) {
  const {
    loading,
    accessReady,
    error,
    internalFullAccess,
    entitlement,
    sourceEntitlement,
    entitlementExists,
    resolution,
    grace,
    promotionalGrant,
    promotionActive,
    promotionScheduled,
    promotionApplied,
    billingBusy,
    billingAction,
    billingError,
    clearBillingError,
    startSubscriptionCheckout,
    openBillingPortal,
  } = useSubscription();
  const [billingReturnNotice, setBillingReturnNotice] = useState(
    readBillingReturnNotice
  );

  useEffect(() => {
    const syncReturnNotice = () => {
      setBillingReturnNotice(readBillingReturnNotice());
    };
    window.addEventListener("popstate", syncReturnNotice);
    syncReturnNotice();
    return () => window.removeEventListener("popstate", syncReturnNotice);
  }, []);

  const dismissBillingReturnNotice = useCallback(() => {
    setBillingReturnNotice(null);
    const nextUrl = removeBillingReturnParameters(window.location.href);
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  const summary = useMemo(
    () =>
      buildSubscriptionRuntimeSummary({
        entitlement,
        sourceEntitlement,
        activeGrowCount,
        now: new Date(),
        grace,
        accessReady,
      }),
    [accessReady, entitlement, sourceEntitlement, activeGrowCount, grace]
  );

  const publicPlans = SUBSCRIPTION_PLAN_ORDER.map(
    (planId) => SUBSCRIPTION_PLANS[planId]
  );
  const currentPlan = getEntitlementPlan(entitlement);
  const currentPlanId = getEntitlementPlanId(entitlement);
  const accessPlanId = getEntitlementAccessPlanId(entitlement);
  const accessPlan = SUBSCRIPTION_PLANS[accessPlanId];
  const trialEndsAt = sourceEntitlement?.trialEndsAt || null;
  const isCurrentPublicPlan =
    accessReady && SUBSCRIPTION_PLAN_ORDER.includes(currentPlanId);
  const canManageStripeBilling =
    accessReady && hasManagedStripeSubscription(sourceEntitlement);
  const isInternalAdmin =
    accessReady &&
    internalFullAccess === true &&
    currentPlanId === SUBSCRIPTION_PLAN_IDS.ADMIN;

  const handlePlanAction = useCallback(
    async (action, planId) => {
      clearBillingError();
      if (action.kind === "portal") {
        await openBillingPortal();
      } else if (action.kind === "checkout") {
        await startSubscriptionCheckout(planId);
      }
    },
    [clearBillingError, openBillingPortal, startSubscriptionCheckout]
  );

  return (
    <div className="space-y-6" data-testid="subscription-page">
      {billingReturnNotice ? (
        <section
          className={`rounded-2xl border p-4 text-sm ${
            returnNoticeToneClass[billingReturnNotice.tone] ||
            returnNoticeToneClass.info
          }`}
          data-testid="subscription-billing-return"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">{billingReturnNotice.title}</p>
              <p className="mt-1">{billingReturnNotice.message}</p>
            </div>
            <button
              type="button"
              className="chip !px-2 !py-0.5"
              onClick={dismissBillingReturnNotice}
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      {billingError ? (
        <section
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-100"
          data-testid="subscription-billing-error"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold">Billing request not completed</p>
              <p className="mt-1">{billingError}</p>
            </div>
            <button
              type="button"
              className="chip !px-2 !py-0.5"
              onClick={clearBillingError}
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}

      {!isInternalAdmin && promotionalGrant?.status === "active" ? (
        <section
          className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950 dark:border-violet-900/70 dark:bg-violet-950/30 dark:text-violet-100"
          data-testid="subscription-promotional-access"
        >
          <p className="font-semibold">
            {promotionScheduled
              ? "Promotional access scheduled"
              : promotionApplied
                ? `Promotional ${SUBSCRIPTION_PLANS[promotionalGrant.planId]?.label || "plan"} access active`
                : "Promotional access on file"}
          </p>
          <p className="mt-1 leading-6">
            {promotionScheduled
              ? `${SUBSCRIPTION_PLANS[promotionalGrant.planId]?.label || "Promotional"} access starts ${formatDate(promotionalGrant.startsAt)} and runs through ${formatDate(promotionalGrant.endsAt)}.`
              : promotionActive && promotionApplied
                ? `This temporary access runs through ${formatDate(promotionalGrant.endsAt)}. Your underlying ${sourceEntitlement?.source === "stripe" ? "Stripe subscription" : "account entitlement"} remains unchanged.`
                : promotionActive
                  ? `The promotion runs through ${formatDate(promotionalGrant.endsAt)}, but your existing access is already equal or higher.`
                  : `This promotional grant is not currently active.`}
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-5 dark:border-zinc-800 dark:bg-zinc-950/30">
        <p className="text-sm font-semibold uppercase tracking-wide text-[rgb(var(--_accent-rgb))]">
          Account plan
        </p>
        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold">
              {loading || !accessReady
                ? "Checking subscription access…"
                : isInternalAdmin
                  ? "Internal Admin — Full Access"
                  : currentPlanId === "trial"
                    ? `Trial with ${accessPlan?.label || "Lab"} access`
                    : currentPlan.label}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              {loading || !accessReady
                ? "Restricted actions stay safely unavailable while the app verifies the trusted entitlement record."
                : isInternalAdmin
                  ? "This trusted internal account has permanent full access to current and future subscription-gated features. No paid subscription, trial renewal, or promotional grant is required."
                  : currentPlanId === "trial"
                    ? "Your fourteen-day trial includes the complete Lab feature set and unlimited active grows. Restricted features are enabled only after the trusted entitlement record resolves."
                    : currentPlan.description}
            </p>
            {canManageStripeBilling ? (
              <button
                type="button"
                className="btn-accent mt-4"
                disabled={billingBusy}
                onClick={openBillingPortal}
                data-testid="subscription-manage-billing"
              >
                {billingBusy && billingAction?.kind === "portal"
                  ? "Opening secure billing…"
                  : isInternalAdmin
                    ? "Manage existing billing"
                    : "Manage billing"}
              </button>
            ) : null}
          </div>

          <dl className="grid min-w-64 grid-cols-2 gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Status</dt>
              <dd className="font-semibold capitalize">
                {isInternalAdmin ? "Active" : summary.status}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Source</dt>
              <dd className="font-semibold capitalize">
                {isInternalAdmin
                  ? "Internal admin"
                  : summary.source.replaceAll("_", " ")}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">Active grows</dt>
              <dd className="font-semibold">
                {summary.activeGrowCount} / {formatLimit(summary.activeGrowLimit)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 dark:text-slate-400">
                Entitlement record
              </dt>
              <dd className="font-semibold">
                {loading || !accessReady
                  ? "Checking"
                  : isInternalAdmin
                    ? "Permanent internal access"
                    : error
                      ? "Free safety fallback"
                      : entitlementExists
                        ? "Connected"
                        : "Trial default"}
              </dd>
            </div>
          </dl>
        </div>

        {isInternalAdmin ? (
          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950 dark:border-violet-900/70 dark:bg-violet-950/30 dark:text-violet-100">
            <p className="font-semibold">Permanent internal access</p>
            <p className="mt-1">
              Subscription purchases are not required for this account. The
              server-trusted internal Admin entitlement automatically includes
              every subscription feature and unlimited active grows.
            </p>
            {canManageStripeBilling ? (
              <p className="mt-1 text-xs opacity-80">
                A Stripe subscription is still attached to this account. It is
                not required for access and can be managed above.
              </p>
            ) : null}
          </div>
        ) : null}

        {loading || !accessReady ? (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-100">
            <p className="font-semibold">Verifying trusted access</p>
            <p className="mt-1">
              Free-tier safety limits are used until the entitlement snapshot
              finishes loading.
            </p>
          </div>
        ) : null}

        {accessReady && !isInternalAdmin && currentPlanId === "trial" ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-semibold">
              {summary.trialDaysRemaining} day
              {summary.trialDaysRemaining === 1 ? "" : "s"} remaining
            </p>
            <p className="mt-1">Trial ends {formatDate(trialEndsAt)}.</p>
            <p className="mt-1 text-xs opacity-80">
              Daily reminders begin with seven days remaining. Dismissals sync
              across devices.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {error}
          </p>
        ) : null}

        {accessReady && !isInternalAdmin && summary.inPastDueGrace ? (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-semibold">
              Payment past due — {summary.graceDaysRemaining} day
              {summary.graceDaysRemaining === 1 ? "" : "s"} of access remaining
            </p>
            <p className="mt-1">
              Existing paid access remains available through {formatDate(summary.graceEndsAt)}.
              If payment is still unresolved after that date, the account falls
              back to Free without deleting records.
            </p>
          </div>
        ) : null}

        {accessReady &&
        !isInternalAdmin &&
        !summary.inPastDueGrace &&
        ["past_due", "canceled", "expired"].includes(summary.sourceStatus) ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-100">
            <p className="font-semibold">Free access is active</p>
            <p className="mt-1">
              The previous {summary.sourcePlanId || "paid"} entitlement is{" "}
              {String(summary.sourceStatus).replaceAll("_", " ")}. Records remain
              intact and downgrade-safe completion and disposition actions remain
              available.
            </p>
          </div>
        ) : null}

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {isInternalAdmin
            ? `Runtime resolution: ${resolution}. Internal full access is authorized by the server-side UID allowlist and does not depend on Stripe, Trial, or promotional access.`
            : `Runtime resolution: ${resolution}. Checkout and billing management use authenticated Firebase callables; plan access changes only after trusted Stripe webhook processing.`}
        </p>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Compare plans</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {isInternalAdmin
              ? "All public-plan features below are already included with this permanent internal account. No purchase is required."
              : "Free, Hobby, Cultivator, and Lab use the current configuration below. Final paid pricing, taxes, and available payment methods are shown in secure Stripe Checkout before purchase."}
          </p>
        </div>

        <div
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
          data-testid="subscription-plan-grid"
        >
          {publicPlans.map((plan) => {
            const isCurrent = isCurrentPublicPlan && currentPlanId === plan.id;
            const isTrialAccess =
              currentPlanId === "trial" && accessPlanId === plan.id;
            const action = isInternalAdmin
              ? {
                  kind: "internal",
                  label: "Included",
                  disabled: true,
                }
              : getSubscriptionPlanBillingAction({
                  planId: plan.id,
                  currentPlanId,
                  sourceEntitlement,
                  accessReady,
                  billingBusy,
                });
            const actionIsBusy =
              billingBusy &&
              (billingAction?.kind === action.kind || action.disabled);

            return (
              <article
                key={plan.id}
                className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm dark:bg-zinc-950 ${
                  isCurrent || isTrialAccess
                    ? "border-[rgb(var(--_accent-rgb))] ring-1 ring-[rgb(var(--_accent-rgb))]"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
                data-testid={`subscription-plan-card-${plan.id}`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-bold">{plan.label}</h3>
                    {isCurrent ? (
                      <span className="chip chip--active">Current</span>
                    ) : isTrialAccess ? (
                      <span className="chip chip--active">Trial access</span>
                    ) : null}
                  </div>
                  <p className="text-xl font-black">{getDisplayedPrice(plan)}</p>
                  <p className="min-h-12 text-sm text-slate-600 dark:text-slate-300">
                    {plan.description}
                  </p>
                </div>

                <dl className="mt-5 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">
                      Active grows
                    </dt>
                    <dd className="font-semibold">
                      {formatLimit(
                        plan.limits[SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS]
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">
                      Grow labels
                    </dt>
                    <dd className="font-semibold">
                      {plan.features[SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS]
                        ? "Included"
                        : "Not included"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">
                      Post Processing labels
                    </dt>
                    <dd className="font-semibold">
                      {plan.features[
                        SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS
                      ]
                        ? "Included"
                        : "Not included"}
                    </dd>
                  </div>
                </dl>

                <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  {PLAN_HIGHLIGHTS[plan.id].map((highlight) => (
                    <li key={highlight}>• {highlight}</li>
                  ))}
                </ul>

                <button
                  type="button"
                  className={action.disabled ? "btn mt-5" : "btn-accent mt-5"}
                  disabled={action.disabled}
                  onClick={() => handlePlanAction(action, plan.id)}
                  data-testid={`subscription-plan-action-${plan.id}`}
                >
                  {actionIsBusy ? "Opening secure billing…" : action.label}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-bold">
          What happens when a trial or paid plan ends?
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <li>• Records are never deleted or automatically archived.</li>
          <li>
            • Existing records remain visible, and full raw-data export stays
            available.
          </li>
          <li>
            • The account falls back to Free unless another active entitlement
            exists.
          </li>
          <li>
            • New restricted records and reactivations above the active-grow limit
            are blocked.
          </li>
          <li>
            • Existing SOP-linked grows, tasks, and checklists can still be
            completed after a downgrade.
          </li>
          <li>
            • Waste, destruction, recall, reservation release, and final-disposition
            safety actions stay available.
          </li>
          <li>
            • A past-due paid plan receives a three-day grace period when trusted
            billing timestamps are available.
          </li>
        </ul>
      </section>
    </div>
  );
}
