<!-- docs/subscription-plan.md -->

# Chaotic Neutral Myco Tracker Subscription Plan

Planning-only document for subscription tiers, trials, downgrade behavior, tester codes, and future Stripe/Firebase enforcement.

This file does not change runtime behavior.

## Current Rule

Every implementation step must be small enough that both checks stay green:

- `npm run build`
- `npm run test:e2e:regression`

No large paywall rewrites. No hidden tabs or blocking modals until the plan is implemented one step at a time.

## Trial Model

New users should receive a 7-day full-access trial.

During trial:

- No practical limits.
- All non-admin features are unlocked.
- First-time educational prompts explain which tier keeps a feature after trial.
- Trial should feel like guided onboarding.

After trial:

- User falls back to Free unless subscribed or given a tester code.
- User data is not deleted.
- User can choose which data stays active under Free limits.
- Extra data is archived/read-only and can be restored after upgrade.

## Planned Tiers

| Tier | Price Idea | Active Grows | Recipes | Supplies | Purpose |
|---|---:|---:|---:|---:|---|
| Trial | 7 days free | No practical limit | No practical limit | No practical limit | Full guided preview |
| Free | $0 | 5 | 3 | 10 | Basic tracker and COG preview |
| Hobby | $4.99/month | 15 | 15 | 50 | Recipes and cost tracking |
| Cultivator | $9.99/month | 50 | Unlimited | Unlimited | Serious home grower tools |
| Pro | $19.99/month | 150 | Unlimited | Unlimited | Advanced analytics and reports |
| Lab | $39.99/month | 500 | Unlimited | Unlimited | Operational/lab workflows |
| Admin | Internal | Unlimited | Unlimited | Unlimited | Owner/dev/support access |

## Feature Strategy

Free should not hide COG completely. It should provide enough of a preview to show value.

Free should include:

- 5 active grows
- 3 recipes
- 10 supplies
- COG Lite
- Basic notes
- Basic stage tracking
- Basic tasks
- Basic strain notes
- Export all raw data

Paid tiers should unlock:

- More active grows
- More recipes
- More supplies
- Full COG breakdown
- Inventory deduction
- Grow-level cost rollups
- Label printing
- Photos
- SOP task generation
- Advanced analytics
- Contamination analytics
- Environmental logs
- Reports
- Post-processing
- Finished inventory
- Batch/audit tools

## Downgrade Rules

Never delete user data because a trial ends or a subscription lapses.

When over plan limits:

1. User can still export all data.
2. User chooses what stays active.
3. Extra grows, recipes, and supplies are archived, not deleted.
4. Archived data can be restored after upgrade.
5. Expired users should see “your data is safe” messaging, not hostile lockout messaging.

## Tester Codes

Tester/friend codes should eventually be separate from Stripe promo codes.

Examples:

- `CNM-JUNE-TESTER` gives Pro for 30 days.
- `CNM-FOUNDER-2026` gives Lab for 12 months.
- `CNM-VET-BETA` gives Cultivator for 90 days.

Tester code redemption should eventually happen through a Cloud Function, not front-end-only logic.

## Future Stripe Model

Stripe should wait until the tier UX and enforcement model are stable.

Future flow:

1. User chooses a plan.
2. App starts Stripe Checkout.
3. Stripe webhook updates Firebase entitlement data.
4. App reads entitlement from Firestore.
5. Cloud Functions enforce limits.
6. Stripe Customer Portal handles billing management.

## Security Model

React gating is only for user experience.

Real enforcement should eventually use:

- Firebase Auth
- Firestore entitlement documents
- Firebase custom claims
- Firestore Security Rules
- Cloud Functions
- Stripe webhooks
- Admin-only tester-code functions

Do not rely on localStorage, React state, or front-end-only checks for paid access.

## Safe Implementation Order

1. Add this planning document.
2. Add static plan config without importing it.
3. Add Billing page shell without entitlement logic.
4. Add copy explaining the future trial.
5. Add passive “future paid feature” badges.
6. Add local entitlement preview behind a dev flag.
7. Add tester-code placeholder UI.
8. Add Firestore entitlement read.
9. Add Cloud Function enforcement.
10. Add Stripe test mode.
11. Harden public launch flow.
