<!-- docs/subscription-implementation-roadmap.md -->

# Subscription Implementation Roadmap

This roadmap reflects the subscription work currently implemented and the remaining work required before paid launch.

This file is planning-only. It does not change runtime behavior.

## Current Status

The client-side subscription foundation is implemented and regression-tested.

Completed work includes:

- Four public plans: Free, Hobby, Cultivator, and Lab
- Internal Trial and Admin entitlement types
- Configuration-driven feature and limit access
- Free limit of 6 active grows
- Hobby limit of 30 active grows
- Unlimited Cultivator and Lab active grows
- Fourteen-day Lab trial
- Daily trial reminders beginning with seven days remaining
- Firestore entitlement reads from `users/{uid}/billing/entitlement`
- Safe entitlement-loading state
- Free fallback for expired, canceled, malformed, or unreadable entitlements
- Three-day trusted `past_due` grace period
- Active-grow creation and reactivation guards
- Cultivator SOP workflow and SOP-generated-task gates
- Basic, advanced, and Lab analytics boundaries
- Lab operational, inventory, sales, FEFO, and Post Processing label gates
- Grow labels available on every public plan
- Downgrade-safe completion and final-disposition behavior
- Feature and limit overrides
- Environmental tracking available to every tier
- Subscription unit and source-integration coverage

Paid billing and trusted server enforcement are not implemented.

## Guardrails

Continue using these rules:

- Preserve existing records and workflows.
- Never delete or automatically archive data because a plan ends.
- Keep safety and final-disposition actions available.
- Keep raw-data export available.
- Use configuration keys rather than plan-name comparisons inside components.
- Keep restricted actions visible with clear plan messaging when practical.
- Do not use React state, local storage, or device time as security authority.
- Do not expose Stripe secrets or tester-code logic in the client.
- Do not deploy or change Firebase rules without an explicit, separately verified step.

## Phase 1: Client Configuration and Runtime

Status: complete.

Implemented:

1. Static plan and feature configuration
2. Access and limit helpers
3. Fourteen-day Lab trial resolution
4. Entitlement provider and Settings plan display
5. Loading and error safety fallback
6. Inactive-plan fallback
7. Three-day past-due grace handling
8. Feature and limit overrides

## Phase 2: Client Feature Boundaries

Status: complete.

Implemented:

1. Active-grow creation limits
2. Single and batch reactivation protection
3. Cultivator SOP workflow gates
4. SOP-generated-task gates
5. Basic versus advanced analytics
6. Cultivator analytics exports
7. Lab analytics
8. Lab operational creation gates
9. Finished Inventory, package-run, SKU, sales, and FEFO gates
10. Post Processing label gates
11. Downgrade-safe workflow completion and safety actions
12. Environmental tracking retained across every tier

These controls protect the normal app experience but do not replace backend enforcement.

## Phase 3: Documentation and Lower-Tier Test Harness

Status: in progress.

Required work:

1. Keep plan and runtime documentation aligned with the current configuration.
2. Build a test-only trusted entitlement harness.
3. Add browser coverage for:
   - Free
   - Hobby
   - Cultivator
   - Lab
   - Trial
   - Admin
   - Expired trial
   - Canceled plan
   - Past-due grace
   - Feature overrides
   - Limit overrides
   - Restricted direct URLs
   - Downgrade-safe completion and disposition actions
4. Confirm all plan cards and upgrade messaging match the live configuration.

Do not use production entitlement documents for automated tests.

## Phase 4: Trusted Entitlement Backend

Status: not started.

Required work:

1. Provision trials using server timestamps.
2. Write and update entitlement documents only from trusted backend code.
3. Validate entitlement status and grace timing on the server.
4. Add webhook-event idempotency records.
5. Add audit history for entitlement changes.
6. Prevent clients from writing billing and entitlement authority fields.
7. Define account timezone handling for daily trial notices.

## Phase 5: Server Enforcement

Status: not started.

Required work:

1. Enforce active-grow limits atomically across devices.
2. Enforce Cultivator and Lab writes through Cloud Functions or Security Rules.
3. Preserve completion, recall, destruction, waste, and final-disposition safety paths.
4. Add custom claims only where they improve rule enforcement without creating stale-access problems.
5. Add emulator coverage for allowed and denied writes.
6. Verify direct API calls cannot bypass React gates.

React gating remains UX only until this phase is complete.

## Phase 6: Tester Codes

Status: not started.

Requirements:

- No public example codes in source or documentation.
- No React-only validation or entitlement grants.
- Codes must be created and managed by an admin-only backend.
- Redemption must be authenticated, rate-limited, auditable, and idempotent.
- Resulting access must use the normal entitlement document and expiration model.

Tester codes remain separate from Stripe promotion codes.

## Phase 7: Pricing and Stripe Test Mode

Status: not started.

Required decisions:

1. Approve monthly prices for Hobby, Cultivator, and Lab.
2. Decide whether annual billing will be offered.
3. Map Stripe products and prices to internal plan IDs.
4. Confirm upgrade, downgrade, cancellation, renewal, and refund policies.

Test-mode implementation:

1. Create Checkout sessions through a trusted Cloud Function.
2. Create Customer Portal sessions through a trusted Cloud Function.
3. Process Stripe webhooks.
4. Update entitlements idempotently.
5. Apply the three-day past-due grace policy.
6. Handle renewals, cancellations, plan changes, and payment recovery.
7. Keep Stripe secret keys outside the React build.
8. Add Stripe test-mode integration and browser regressions.

## Phase 8: Launch Hardening

Status: not started.

Before accepting payment:

- Complete lower-tier browser coverage.
- Complete Firebase emulator enforcement tests.
- Verify server-time trial behavior.
- Verify cross-device active-grow limits.
- Verify webhook replay and idempotency.
- Verify cancellation and past-due recovery.
- Verify Customer Portal return flows.
- Confirm pricing and plan copy.
- Confirm privacy, billing, cancellation, and refund disclosures.
- Run a complete backup and restore test.
- Run production build and regression suites from a clean checkout.
- Perform a final manual plan-by-plan audit.

## Required Checks Before Every Subscription Commit

Run:

- `npm run test:subscription`
- `npm run test:integration`
- `npm run build`
- `npm run test:e2e:regression`

All checks must pass before subscription work moves forward.
