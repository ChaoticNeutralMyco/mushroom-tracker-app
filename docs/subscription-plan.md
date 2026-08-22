<!-- docs/subscription-plan.md -->

# Chaotic Neutral Myco Tracker Subscription Plan

This document records the subscription model currently implemented in the app and the trusted backend work that is still pending.

It does not change runtime behavior.

## Current Public Plans

The app has four public plans:

| Plan | Billing status | Active grows | Purpose |
|---|---|---:|---|
| Free | Available | 6 | Complete personal cultivation toolkit |
| Hobby | Pricing pending | 30 | Same features as Free with higher grow capacity |
| Cultivator | Pricing pending | Unlimited | SOP workflows, generated tasks, and advanced cultivation analytics |
| Lab | Pricing pending | Unlimited | Full operational workflow for processing, inventory, labels, and sales |

Trial and Admin are internal entitlement types, not public paid plans.

There is no public Pro tier. The legacy `pro` plan ID maps to Cultivator for compatibility.

## Fourteen-Day Trial

A new account without an entitlement record receives a fourteen-day trial with full Lab access.

During the trial:

- All Lab features are available.
- Active grows are unlimited.
- Admin-only tools are not included.
- Daily required trial reminders begin with seven days remaining.
- Trial access is resolved from the entitlement runtime before restricted actions are enabled.

When the trial expires:

- The account falls back to Free unless another active entitlement exists.
- Records are not deleted, hidden, or automatically archived.
- Existing downgrade-safe workflows and safety actions remain available.
- New restricted records and reactivations above the Free active-grow limit are blocked.

Trusted server timestamps are still required before production billing. The current client runtime is not the final authority for trial provisioning.

## Current Feature Boundaries

### Free

Free includes:

- Grow lifecycle and stage tracking
- Strain library
- Grow and stage photos
- Recipes
- Manual tasks and reminders
- Calendar
- Backup and import
- Raw-data export
- Basic analytics
- Basic cost tracking
- Environmental tracking and target editing
- Grow and cultivation labels
- Up to 6 active grows

### Hobby

Hobby includes the same feature set as Free with up to 30 active grows.

### Cultivator

Cultivator includes everything in Hobby plus:

- Unlimited active grows
- SOP workflows
- SOP-generated tasks and checklists
- Advanced cultivation analytics
- Analytics exports
- Advanced cost analytics

Environmental tracking remains available to every tier. There is no separate advanced-environmental-controls paywall.

### Lab

Lab includes everything in Cultivator plus:

- Post Processing
- Finished Inventory
- Package runs and SKUs
- Post Processing and packaged-SKU labels
- Sales and outbound inventory tracking
- FEFO controls
- Final disposition
- Inventory audit history
- Lab, production, inventory, and sales analytics

Grow and cultivation labels remain available on every public plan. Post Processing and packaged-SKU labels require Lab access.

## Downgrade and Plan-End Rules

Subscription changes must never delete user data.

When a trial or paid plan ends:

1. The account falls back to Free unless another valid entitlement exists.
2. Existing records remain visible.
3. Raw-data export remains available.
4. Existing SOP-linked grows, tasks, checklists, and workflow history can still be viewed and completed.
5. New restricted records are blocked.
6. Reactivating grows above the current plan limit is blocked.
7. Waste, destruction, recall, reservation release, and final-disposition safety actions remain available.
8. Upgrading or receiving a valid trusted entitlement restores the applicable features.

The app uses reassuring “your data is safe” messaging rather than destructive lockouts.

## Past-Due Grace Period

A paid plan with `past_due` status receives up to three days of existing paid access when a trusted billing timestamp is available.

Trusted timing uses:

- `graceEndsAt`, when supplied by the backend
- Otherwise `pastDueStartedAt`
- Otherwise `currentPeriodEndsAt`

After the grace period, or when no trusted timing anchor exists, the account safely falls back to Free without deleting records.

## Tester Codes

Tester and friend codes are planned but are not active.

Rules:

- No public example codes are stored in this document or exposed in the client.
- React must not validate codes or grant entitlements.
- Redemption must happen through an authenticated, admin-controlled backend function.
- Tester entitlements must be written to the same trusted entitlement model used by billing.

Tester codes are separate from Stripe promotion codes.

## Pricing and Billing Status

Paid-plan prices are not approved or configured.

The following are not connected yet:

- Stripe Checkout
- Stripe Customer Portal
- Stripe webhooks
- Production entitlement writes
- Billing management
- Tester-code redemption

Disabled plan buttons in Settings are informational only.

## Entitlement Model

The app reads the entitlement document at:

`users/{uid}/billing/entitlement`

The current model supports fields such as:

- `planId`
- `status`
- `source`
- `trialStartedAt`
- `trialEndsAt`
- `currentPeriodEndsAt`
- `pastDueStartedAt`
- `graceEndsAt`
- `featureOverrides`
- `limitOverrides`
- `testerCodeId`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `updatedAt`

Missing entitlements can resolve to the configured Lab trial. Existing malformed or unreadable entitlements fail safely to Free.

## Security Model

React gating is user-experience protection only. It is not sufficient security.

Production enforcement must use:

- Firebase Auth
- Firestore entitlement documents
- Firebase custom claims where appropriate
- Firestore Security Rules
- Cloud Functions
- Stripe webhooks
- Server timestamps
- Admin-only tester-code functions
- Atomic server-side limit enforcement

Do not use these as a paid-access authority:

- `localStorage`
- React state
- Device time
- Front-end-only checks

## Required Verification

Every subscription change must keep these checks green:

- `npm run test:subscription`
- `npm run test:integration`
- `npm run build`
- `npm run test:e2e:regression`
