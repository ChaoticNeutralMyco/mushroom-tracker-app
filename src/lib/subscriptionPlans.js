// src/lib/subscriptionPlans.js

export const SUBSCRIPTION_CONFIG_VERSION = "2026-07-27-environmental-access-v5";

export const SUBSCRIPTION_PLAN_IDS = Object.freeze({
  TRIAL: "trial",
  FREE: "free",
  HOBBY: "hobby",
  CULTIVATOR: "cultivator",
  LAB: "lab",
  ADMIN: "admin",
});

export const SUBSCRIPTION_PLAN_ALIASES = Object.freeze({
  pro: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
});

export const SUBSCRIPTION_PLAN_ORDER = Object.freeze([
  SUBSCRIPTION_PLAN_IDS.FREE,
  SUBSCRIPTION_PLAN_IDS.HOBBY,
  SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
  SUBSCRIPTION_PLAN_IDS.LAB,
]);

export const SUBSCRIPTION_FEATURE_KEYS = Object.freeze({
  GROW_LIFECYCLE: "growLifecycle",
  STRAIN_LIBRARY: "strainLibrary",
  GROW_PHOTOS: "growPhotos",
  RECIPES: "recipes",
  MANUAL_TASKS: "manualTasks",
  REMINDERS: "reminders",
  CALENDAR: "calendar",
  BACKUP_IMPORT: "backupImport",
  RAW_DATA_EXPORT: "rawDataExport",
  BASIC_ANALYTICS: "basicAnalytics",
  BASIC_COST_TRACKING: "basicCostTracking",
  ENVIRONMENTAL_TRACKING: "environmentalTracking",
  GROW_LABELS: "growLabels",
  SOP_WORKFLOWS: "sopWorkflows",
  SOP_GENERATED_TASKS: "sopGeneratedTasks",
  ADVANCED_ANALYTICS: "advancedAnalytics",
  ANALYTICS_EXPORTS: "analyticsExports",
  ADVANCED_COST_ANALYTICS: "advancedCostAnalytics",
  POST_PROCESSING: "postProcessing",
  FINISHED_INVENTORY: "finishedInventory",
  PACKAGE_RUNS: "packageRuns",
  POST_PROCESS_LABELS: "postProcessLabels",
  SALES_TRACKING: "salesTracking",
  FEFO_CONTROLS: "fefoControls",
  FINAL_DISPOSITION: "finalDisposition",
  INVENTORY_AUDIT_HISTORY: "inventoryAuditHistory",
  LAB_ANALYTICS: "labAnalytics",
});

export const SUBSCRIPTION_FEATURE_LIST = Object.freeze(
  Object.values(SUBSCRIPTION_FEATURE_KEYS)
);

export const SUBSCRIPTION_FEATURE_LABELS = Object.freeze({
  [SUBSCRIPTION_FEATURE_KEYS.GROW_LIFECYCLE]: "Grow lifecycle tracking",
  [SUBSCRIPTION_FEATURE_KEYS.STRAIN_LIBRARY]: "Strain library",
  [SUBSCRIPTION_FEATURE_KEYS.GROW_PHOTOS]: "Grow and stage photos",
  [SUBSCRIPTION_FEATURE_KEYS.RECIPES]: "Recipes",
  [SUBSCRIPTION_FEATURE_KEYS.MANUAL_TASKS]: "Manual tasks",
  [SUBSCRIPTION_FEATURE_KEYS.REMINDERS]: "Reminders",
  [SUBSCRIPTION_FEATURE_KEYS.CALENDAR]: "Calendar",
  [SUBSCRIPTION_FEATURE_KEYS.BACKUP_IMPORT]: "Backup and import",
  [SUBSCRIPTION_FEATURE_KEYS.RAW_DATA_EXPORT]: "Raw data export",
  [SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS]: "Basic analytics",
  [SUBSCRIPTION_FEATURE_KEYS.BASIC_COST_TRACKING]: "Basic cost tracking",
  [SUBSCRIPTION_FEATURE_KEYS.ENVIRONMENTAL_TRACKING]: "Environmental tracking",
  [SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS]: "Grow labels",
  [SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS]: "SOP workflows",
  [SUBSCRIPTION_FEATURE_KEYS.SOP_GENERATED_TASKS]: "SOP-generated tasks",
  [SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS]: "Advanced analytics",
  [SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS]: "Analytics exports",
  [SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS]: "Advanced cost analytics",
  [SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING]: "Post Processing",
  [SUBSCRIPTION_FEATURE_KEYS.FINISHED_INVENTORY]: "Finished Inventory",
  [SUBSCRIPTION_FEATURE_KEYS.PACKAGE_RUNS]: "Package runs and SKUs",
  [SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS]: "Post Processing labels",
  [SUBSCRIPTION_FEATURE_KEYS.SALES_TRACKING]: "Sales tracking",
  [SUBSCRIPTION_FEATURE_KEYS.FEFO_CONTROLS]: "FEFO controls",
  [SUBSCRIPTION_FEATURE_KEYS.FINAL_DISPOSITION]: "Final disposition",
  [SUBSCRIPTION_FEATURE_KEYS.INVENTORY_AUDIT_HISTORY]: "Inventory audit history",
  [SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS]: "Lab analytics",
});

export const SUBSCRIPTION_LIMIT_KEYS = Object.freeze({
  ACTIVE_GROWS: "activeGrows",
});

export const SUBSCRIPTION_LIMIT_LIST = Object.freeze(
  Object.values(SUBSCRIPTION_LIMIT_KEYS)
);

const BASE_FEATURES = Object.freeze([
  SUBSCRIPTION_FEATURE_KEYS.GROW_LIFECYCLE,
  SUBSCRIPTION_FEATURE_KEYS.STRAIN_LIBRARY,
  SUBSCRIPTION_FEATURE_KEYS.GROW_PHOTOS,
  SUBSCRIPTION_FEATURE_KEYS.RECIPES,
  SUBSCRIPTION_FEATURE_KEYS.MANUAL_TASKS,
  SUBSCRIPTION_FEATURE_KEYS.REMINDERS,
  SUBSCRIPTION_FEATURE_KEYS.CALENDAR,
  SUBSCRIPTION_FEATURE_KEYS.BACKUP_IMPORT,
  SUBSCRIPTION_FEATURE_KEYS.RAW_DATA_EXPORT,
  SUBSCRIPTION_FEATURE_KEYS.BASIC_ANALYTICS,
  SUBSCRIPTION_FEATURE_KEYS.BASIC_COST_TRACKING,
  SUBSCRIPTION_FEATURE_KEYS.ENVIRONMENTAL_TRACKING,
  SUBSCRIPTION_FEATURE_KEYS.GROW_LABELS,
]);

const CULTIVATOR_FEATURES = Object.freeze([
  ...BASE_FEATURES,
  SUBSCRIPTION_FEATURE_KEYS.SOP_WORKFLOWS,
  SUBSCRIPTION_FEATURE_KEYS.SOP_GENERATED_TASKS,
  SUBSCRIPTION_FEATURE_KEYS.ADVANCED_ANALYTICS,
  SUBSCRIPTION_FEATURE_KEYS.ANALYTICS_EXPORTS,
  SUBSCRIPTION_FEATURE_KEYS.ADVANCED_COST_ANALYTICS,
]);

const LAB_FEATURES = Object.freeze([
  ...CULTIVATOR_FEATURES,
  SUBSCRIPTION_FEATURE_KEYS.POST_PROCESSING,
  SUBSCRIPTION_FEATURE_KEYS.FINISHED_INVENTORY,
  SUBSCRIPTION_FEATURE_KEYS.PACKAGE_RUNS,
  SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS,
  SUBSCRIPTION_FEATURE_KEYS.SALES_TRACKING,
  SUBSCRIPTION_FEATURE_KEYS.FEFO_CONTROLS,
  SUBSCRIPTION_FEATURE_KEYS.FINAL_DISPOSITION,
  SUBSCRIPTION_FEATURE_KEYS.INVENTORY_AUDIT_HISTORY,
  SUBSCRIPTION_FEATURE_KEYS.LAB_ANALYTICS,
]);

function buildFeatureMap(includedFeatures) {
  const included = new Set(includedFeatures);

  return Object.freeze(
    Object.fromEntries(
      SUBSCRIPTION_FEATURE_LIST.map((featureKey) => [
        featureKey,
        included.has(featureKey),
      ])
    )
  );
}

function buildLimits(activeGrows) {
  return Object.freeze({
    [SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS]: activeGrows,
  });
}

export const SUBSCRIPTION_TRIAL_CONFIG = Object.freeze({
  enabled: true,
  durationDays: 14,
  existingAccountTrialStartsAt: "2026-07-26T00:00:00.000Z",
  grantsPlanId: SUBSCRIPTION_PLAN_IDS.LAB,
  expirationFallbackPlanId: SUBSCRIPTION_PLAN_IDS.FREE,
  reminderStartsDaysRemaining: 7,
  reminderCadenceDays: 1,
  requiresDailyDismissal: true,
  dismissalScope: "account-calendar-date",
  defaultDismissalTimeZone: "UTC",
  upgradeActionEnabled: true,
  adminFeaturesIncluded: false,
  deleteDataAtExpiration: false,
});

export const SUBSCRIPTION_BILLING_CONFIG = Object.freeze({
  inactiveFallbackPlanId: SUBSCRIPTION_PLAN_IDS.FREE,
  pastDueGraceDays: 3,
  pastDueGraceMilliseconds: 3 * 24 * 60 * 60 * 1000,
  pastDueRequiresTrustedStart: true,
  preserveRecordsOnDowngrade: true,
  deleteDataOnPlanEnd: false,
});

export const SUBSCRIPTION_PLANS = Object.freeze({
  [SUBSCRIPTION_PLAN_IDS.TRIAL]: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.TRIAL,
    label: "Trial",
    description: "Fourteen days of Lab access.",
    internalOnly: true,
    billingType: "internal",
    priceMonthlyUsd: null,
    pricingStatus: "internal",
    accessPlanId: SUBSCRIPTION_TRIAL_CONFIG.grantsPlanId,
    durationDays: SUBSCRIPTION_TRIAL_CONFIG.durationDays,
    limits: buildLimits(null),
    features: buildFeatureMap(LAB_FEATURES),
    adminTools: false,
  }),

  [SUBSCRIPTION_PLAN_IDS.FREE]: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.FREE,
    label: "Free",
    description: "The complete personal cultivation toolkit for up to six active grows.",
    internalOnly: false,
    billingType: "free",
    priceMonthlyUsd: 0,
    pricingStatus: "set",
    limits: buildLimits(6),
    features: buildFeatureMap(BASE_FEATURES),
    adminTools: false,
  }),

  [SUBSCRIPTION_PLAN_IDS.HOBBY]: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.HOBBY,
    label: "Hobby",
    description: "The same cultivation tools as Free with room for thirty active grows.",
    internalOnly: false,
    billingType: "paid",
    priceMonthlyUsd: null,
    pricingStatus: "tbd",
    limits: buildLimits(30),
    features: buildFeatureMap(BASE_FEATURES),
    adminTools: false,
  }),

  [SUBSCRIPTION_PLAN_IDS.CULTIVATOR]: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
    label: "Cultivator",
    description: "Unlimited cultivation plus SOP workflows and advanced analytics.",
    internalOnly: false,
    billingType: "paid",
    priceMonthlyUsd: null,
    pricingStatus: "tbd",
    limits: buildLimits(null),
    features: buildFeatureMap(CULTIVATOR_FEATURES),
    adminTools: false,
  }),

  [SUBSCRIPTION_PLAN_IDS.LAB]: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.LAB,
    label: "Lab",
    description: "Full operational access for processing, inventory, labels, and sales.",
    internalOnly: false,
    billingType: "paid",
    priceMonthlyUsd: null,
    pricingStatus: "tbd",
    limits: buildLimits(null),
    features: buildFeatureMap(LAB_FEATURES),
    adminTools: false,
  }),

  [SUBSCRIPTION_PLAN_IDS.ADMIN]: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.ADMIN,
    label: "Admin",
    description: "Internal administrative access.",
    internalOnly: true,
    billingType: "internal",
    priceMonthlyUsd: null,
    pricingStatus: "internal",
    accessPlanId: SUBSCRIPTION_PLAN_IDS.LAB,
    limits: buildLimits(null),
    features: buildFeatureMap(SUBSCRIPTION_FEATURE_LIST),
    adminTools: true,
  }),
});

export const SUBSCRIPTION_TESTER_CODE_POLICY = Object.freeze({
  enabled: true,
  publicExamplesExposed: false,
  redemptionRequiresTrustedBackend: true,
  clientMayGrantEntitlements: false,
  clientMayValidateCodes: false,
});

export const SUBSCRIPTION_DOWNGRADE_POLICY = Object.freeze({
  deleteDataOnDowngrade: false,
  allowFullDataExport: true,
  restrictedRecordsState: "read-only",
  blockNewRestrictedRecords: true,
  allowExistingWorkflowCompletion: true,
  allowSafetyAndDispositionActions: true,
  blockCreateOrReactivateAboveActiveGrowLimit: true,
  restoreMethod: "upgrade-or-valid-internal-entitlement",
  messagingTone: "your-data-is-safe",
});

export const SUBSCRIPTION_SECURITY_NOTES = Object.freeze({
  reactGatingIsUxOnly: true,
  futureEnforcement: Object.freeze([
    "Firebase Auth",
    "Firestore entitlement documents",
    "Firebase custom claims",
    "Firestore Security Rules",
    "Cloud Functions",
    "Stripe webhooks",
    "Admin-only tester-code functions",
  ]),
  doNotUseAsSecuritySource: Object.freeze([
    "localStorage",
    "React state",
    "front-end-only checks",
  ]),
});
