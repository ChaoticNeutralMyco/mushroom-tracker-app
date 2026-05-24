<!-- docs/subscription-implementation-roadmap.md -->

# Subscription Implementation Roadmap

This roadmap keeps subscription work small, testable, and regression-safe.

This file is planning-only. It does not change runtime behavior.

## Current Completed Groundwork

- `docs/subscription-plan.md`
- `src/lib/subscriptionPlans.js`
- `src/lib/subscriptionAccess.js`
- `tests/unit/subscriptionPlans.test.js`
- `tests/unit/subscriptionAccess.test.js`
- `npm run test:subscription`

## Guardrails

Do not add these until explicitly planned and tested:

- Blocking trial modals
- Hidden tabs
- Feature lockouts in regression paths
- App-wide paywall overlays
- Stripe Checkout
- Stripe webhooks
- Firestore Rules changes
- Cloud Function enforcement
- React-only tester-code redemption

React gating is UX only. Real enforcement must eventually happen through Firebase-backed server-side logic.

## Phase 1: Planning, Config, and Tests

Status: complete.

Completed steps:

1. Subscription plan document
2. Static subscription config
3. Plan config unit tests
4. Pure access helpers
5. Access helper unit tests
6. Subscription test script
7. Roadmap document

## Phase 2: Passive Billing Page Shell

Goal: add a read-only Billing or Plan page without enforcing anything.

Rules:

- Display tier names, prices, limits, and trial copy.
- Do not block navigation.
- Do not hide existing tabs.
- Do not change grow, recipe, COG, SOP, analytics, or post-processing behavior.
- Do not add Stripe buttons yet.
- Do not read Firestore entitlements yet.

## Phase 3: Read-Only Entitlement Shape

Recommended future entitlement path:

`users/{uid}/billing/entitlement`

Recommended future fields:

- `planId`
- `status`
- `source`
- `trialStartedAt`
- `trialEndsAt`
- `currentPeriodEndsAt`
- `testerCodeId`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `updatedAt`

No enforcement in this phase.

## Phase 4: Non-Blocking Plan Display

Goal: show current plan passively.

Rules:

- Default to Free if no entitlement exists.
- Never block app usage.
- Never hide tabs.
- Never archive or mutate user data.

## Phase 5: Educational Upgrade Prompts

Goal: add soft, dismissible prompts later.

Rules:

- No full-screen blockers.
- No click interception during regression.
- No prompts in E2E mode if test mode exists.
- Messaging should explain value and reassure users that data is safe.

## Phase 6: Tester Codes

Tester codes should eventually be redeemed through a Cloud Function, not React-only logic.

Example codes:

- `CNM-JUNE-TESTER`
- `CNM-FOUNDER-2026`
- `CNM-VET-BETA`

## Phase 7: Stripe Test Mode

Future Stripe flow:

1. User selects a plan.
2. App calls a Cloud Function to create Checkout.
3. Stripe webhook updates Firebase entitlement data.
4. App reads entitlement data.
5. Customer Portal handles billing management.

Stripe secret keys must never be exposed to React.

## Phase 8: Real Enforcement

Rules:

- Never delete data on downgrade.
- User can export all data.
- Extra data becomes archived/read-only.
- User chooses what stays active.
- Resubscribe or tester code can restore access.

## Required Checks Before Every Subscription Commit

Run:

- `npm run test:subscription`
- `npm run build`
- `npm run test:e2e:regression`

Regression must keep passing before subscription work moves forward.
