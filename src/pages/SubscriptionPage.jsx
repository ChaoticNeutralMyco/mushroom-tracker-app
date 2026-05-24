// src/pages/SubscriptionPage.jsx

import React from "react";

import {
  SUBSCRIPTION_DOWNGRADE_POLICY,
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLAN_ORDER,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_TRIAL_CONFIG,
  TESTER_CODE_EXAMPLES,
} from "../lib/subscriptionPlans.js";

const formatLimit = (value) => {
  if (value === null) return "Unlimited";
  if (value === undefined) return "Not included";
  return String(value);
};

const formatPrice = (priceMonthlyUsd) => {
  if (priceMonthlyUsd === null) return "Internal";
  if (priceMonthlyUsd === 0) return "$0/mo";
  return `$${priceMonthlyUsd.toFixed(2)}/mo`;
};

const PLAN_DESCRIPTIONS = {
  [SUBSCRIPTION_PLAN_IDS.FREE]: "Basic grow tracking with lightweight cost previews.",
  [SUBSCRIPTION_PLAN_IDS.HOBBY]: "More room for active grows, recipes, supplies, and cost tracking.",
  [SUBSCRIPTION_PLAN_IDS.CULTIVATOR]: "Full cultivation tools for serious home workflows.",
  [SUBSCRIPTION_PLAN_IDS.PRO]: "Advanced analytics, reporting, environmental logs, and SOP task generation.",
  [SUBSCRIPTION_PLAN_IDS.LAB]: "Operational tools for post-processing, inventory, batches, and audits.",
};

export default function SubscriptionPage() {
  const publicPlans = SUBSCRIPTION_PLAN_ORDER.map((planId) => SUBSCRIPTION_PLANS[planId]);

  return (
    <main
      className="mx-auto max-w-7xl space-y-6 p-4 text-slate-900 dark:text-slate-100 sm:p-6"
      data-testid="subscription-page"
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          Billing Preview
        </p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
          Subscription Plans
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
          This page is a passive planning shell. It displays the intended subscription tiers, trial rules,
          tester-code notes, and downgrade policy without enforcing limits, hiding tabs, opening Stripe,
          or changing app behavior.
        </p>
      </section>

      <section
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"
        data-testid="subscription-plan-grid"
      >
        {publicPlans.map((plan) => (
          <article
            key={plan.id}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950"
            data-testid={`subscription-plan-card-${plan.id}`}
          >
            <div className="space-y-2">
              <h2 className="text-lg font-bold">{plan.label}</h2>
              <p className="text-2xl font-black">{formatPrice(plan.priceMonthlyUsd)}</p>
              <p className="min-h-12 text-sm text-slate-600 dark:text-slate-300">
                {PLAN_DESCRIPTIONS[plan.id]}
              </p>
            </div>

            <dl className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Active grows</dt>
                <dd className="font-semibold">{formatLimit(plan.limits.activeGrows)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Recipes</dt>
                <dd className="font-semibold">{formatLimit(plan.limits.recipes)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Supplies</dt>
                <dd className="font-semibold">{formatLimit(plan.limits.supplies)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <h2 className="text-lg font-bold">Trial Rules</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li>{SUBSCRIPTION_TRIAL_CONFIG.durationDays}-day full-access trial.</li>
            <li>Non-admin features only.</li>
            <li>No blocking trial modal.</li>
            <li>Educational prompts only when safe.</li>
          </ul>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <h2 className="text-lg font-bold">Tester Codes</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            {TESTER_CODE_EXAMPLES.map((example) => (
              <li key={example.code}>
                <span className="font-mono font-semibold">{example.code}</span>
                <span> grants {example.grantsPlanId} for {example.durationDays} days.</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <h2 className="text-lg font-bold">Downgrade Policy</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li>Never delete user data.</li>
            <li>Exports stay available.</li>
            <li>Extra data becomes {SUBSCRIPTION_DOWNGRADE_POLICY.extraDataState}.</li>
            <li>Messaging tone: {SUBSCRIPTION_DOWNGRADE_POLICY.messagingTone}.</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
