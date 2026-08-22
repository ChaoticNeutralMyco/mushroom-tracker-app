<!-- docs/subscription-backend-foundation.md -->

# Trusted Subscription Backend Foundation

This backend is intentionally separate from Stripe checkout. It establishes the trusted entitlement data model and transition services first.

## Runtime

- Firebase Cloud Functions using Node.js 22.
- `provisionSubscriptionEntitlementOnCreate` uses the Firebase Auth user-created trigger.
- `ensureMySubscriptionEntitlement` is an authenticated, idempotent callable for existing or delayed accounts.
- `reconcileSubscriptionEntitlements` runs hourly and expires ended trials, ended tester grants, and past-due grace periods.
- `redeemTesterCode` validates private tester codes through trusted server code.

Nothing in this step deploys functions or connects billing.

## Entitlement Path

`users/{uid}/billing/entitlement`

Important fields:

- `schemaVersion`
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
- `revision`
- `lastTransitionId`
- `createdAt`
- `updatedAt`

Client Firestore rules already permit the owner to read this path and deny all client writes.

## Audit Events

Trusted transition records live at:

`users/{uid}/billing/entitlement/events/{eventId}`

The deterministic `eventId` is also the idempotency key. Retried backend events do not apply the same transition twice.

## Trial Policy

- Duration: 14 days.
- New accounts start at their Firebase Auth creation time.
- Existing accounts use the configured rollout anchor when it is later than their Auth creation time.
- Deleting or missing an entitlement cannot create a fresh trial window because the backend recomputes the window from trusted account metadata and the rollout anchor.
- When the trusted trial end has passed, the entitlement becomes `expired`; the client then falls back to Free without deleting records.

## Past-Due Policy

- A trusted `pastDueStartedAt` creates a three-day `graceEndsAt` timestamp.
- Paid access remains available during that grace window.
- The scheduled reconciler changes the entitlement to `expired` after grace.
- A past-due record without a trusted grace anchor is treated as expired by reconciliation.

## Tester-Code Data Model

Raw tester codes are never document IDs and are never stored in Firestore.

The server normalizes the submitted value and uses SHA-256. The admin-created configuration document is:

`testerCodes/{sha256Hash}`

Supported fields:

- `active: true`
- `planId: "hobby" | "cultivator" | "lab"`
- `durationDays`
- `startsAt` (optional trusted timestamp)
- `expiresAt` (optional trusted timestamp)
- `maxRedemptions` (`null` for unlimited)
- `redemptionCount`
- `featureOverrides`
- `limitOverrides`
- `createdAt`
- `updatedAt`

Per-user redemption records live at:

`testerCodes/{sha256Hash}/redemptions/{uid}`

Browser clients cannot read, enumerate, create, or update tester-code documents under the existing Firestore rules.

## Future Stripe Integration

A future webhook should call the existing trusted transition services:

- `activatePaidEntitlement`
- `markEntitlementPastDue`
- `cancelEntitlement`
- `expireEntitlement`

Stripe event IDs should be passed as transition `eventId` values, making webhook retries idempotent.

## Local Verification

Run from the project root:

```powershell
npm run test:subscription:backend:emulator
```

The script installs isolated `functions/` dependencies, runs syntax and unit checks, starts Auth/Firestore/Functions emulators, runs transition tests, and shuts the emulators down. It does not deploy or connect to production data.
