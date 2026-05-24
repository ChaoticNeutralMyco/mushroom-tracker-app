export const SUBSCRIPTION_CONFIG_VERSION = "2026-05-23-planning-v1";

export const SUBSCRIPTION_PLAN_IDS = Object.freeze({
  TRIAL: "trial",
  FREE: "free",
  HOBBY: "hobby",
  CULTIVATOR: "cultivator",
  PRO: "pro",
  LAB: "lab",
  ADMIN: "admin",
});

export const SUBSCRIPTION_PLAN_ORDER = Object.freeze([
  SUBSCRIPTION_PLAN_IDS.FREE,
  SUBSCRIPTION_PLAN_IDS.HOBBY,
  SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
  SUBSCRIPTION_PLAN_IDS.PRO,
  SUBSCRIPTION_PLAN_IDS.LAB,
]);

export const SUBSCRIPTION_TRIAL_CONFIG = Object.freeze({
  enabled: true,
  durationDays: 7,
  fullAccess: true,
  adminFeaturesIncluded: false,
  showEducationalPrompts: true,
  blockingModalAllowed: false,
  notes:
    "Trial unlocks non-admin features without blocking core flows or intercepting regression clicks.",
});

export const SUBSCRIPTION_PLANS = Object.freeze({
  trial: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.TRIAL,
    label: "Trial",
    priceMonthlyUsd: 0,
    internalOnly: false,
    durationDays: 7,
    limits: Object.freeze({ activeGrows: null, recipes: null, supplies: null }),
    features: Object.freeze({
      fullAccess: true,
      adminTools: false,
      rawDataExport: true,
    }),
  }),

  free: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.FREE,
    label: "Free",
    priceMonthlyUsd: 0,
    internalOnly: false,
    limits: Object.freeze({ activeGrows: 5, recipes: 3, supplies: 10 }),
    features: Object.freeze({
      cogLite: true,
      basicNotes: true,
      basicStageTracking: true,
      basicTasks: true,
      basicStrainNotes: true,
      rawDataExport: true,
    }),
  }),

  hobby: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.HOBBY,
    label: "Hobby",
    priceMonthlyUsd: 4.99,
    internalOnly: false,
    limits: Object.freeze({ activeGrows: 15, recipes: 15, supplies: 50 }),
    features: Object.freeze({
      recipeBasics: true,
      costTracking: true,
      cogLite: true,
      rawDataExport: true,
    }),
  }),

  cultivator: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
    label: "Cultivator",
    priceMonthlyUsd: 9.99,
    internalOnly: false,
    limits: Object.freeze({ activeGrows: 50, recipes: null, supplies: null }),
    features: Object.freeze({
      fullCogBreakdown: true,
      inventoryDeduction: true,
      growCostRollups: true,
      labelPrinting: true,
      photos: true,
      fullSopToolkit: true,
      rawDataExport: true,
    }),
  }),

  pro: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.PRO,
    label: "Pro",
    priceMonthlyUsd: 19.99,
    internalOnly: false,
    limits: Object.freeze({ activeGrows: 150, recipes: null, supplies: null }),
    features: Object.freeze({
      advancedAnalytics: true,
      reports: true,
      environmentalLogs: true,
      sopTaskGeneration: true,
      contaminationAnalytics: true,
      rawDataExport: true,
    }),
  }),

  lab: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.LAB,
    label: "Lab",
    priceMonthlyUsd: 39.99,
    internalOnly: false,
    limits: Object.freeze({ activeGrows: 500, recipes: null, supplies: null }),
    features: Object.freeze({
      postProcessing: true,
      finishedInventory: true,
      batchAuditTools: true,
      advancedAnalytics: true,
      rawDataExport: true,
    }),
  }),

  admin: Object.freeze({
    id: SUBSCRIPTION_PLAN_IDS.ADMIN,
    label: "Admin",
    priceMonthlyUsd: null,
    internalOnly: true,
    limits: Object.freeze({ activeGrows: null, recipes: null, supplies: null }),
    features: Object.freeze({
      fullAccess: true,
      adminTools: true,
      rawDataExport: true,
    }),
  }),
});

export const TESTER_CODE_EXAMPLES = Object.freeze([
  Object.freeze({ code: "CNM-JUNE-TESTER", grantsPlanId: SUBSCRIPTION_PLAN_IDS.PRO, durationDays: 30 }),
  Object.freeze({ code: "CNM-FOUNDER-2026", grantsPlanId: SUBSCRIPTION_PLAN_IDS.LAB, durationDays: 365 }),
  Object.freeze({ code: "CNM-VET-BETA", grantsPlanId: SUBSCRIPTION_PLAN_IDS.CULTIVATOR, durationDays: 90 }),
]);

export const SUBSCRIPTION_DOWNGRADE_POLICY = Object.freeze({
  deleteDataOnDowngrade: false,
  allowFullDataExport: true,
  extraDataState: "archived-read-only",
  userChoosesActiveData: true,
  restoreMethod: "resubscribe-or-valid-tester-code",
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
