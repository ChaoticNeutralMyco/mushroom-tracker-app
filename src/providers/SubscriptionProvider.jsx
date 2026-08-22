// src/providers/SubscriptionProvider.jsx

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db, functions } from "../firebase-config.js";
import {
  buildBillingRequestId,
  buildEmulatorBillingReturnUrl,
  normalizeBillingError,
  requireSafeBillingRedirectUrl,
} from "../lib/subscriptionBilling.js";
import {
  canEntitlementUseFeature,
  getEntitlementLimit,
} from "../lib/subscriptionEntitlements.js";
import { getMyAdminAccess } from "../lib/adminApi.js";
import { applyInternalAdminFullAccess } from "../lib/internalAdminAccess.js";
import { getUserEntitlementDocumentPath } from "../lib/subscriptionEntitlementPaths.js";
import {
  buildLoadingSubscriptionRuntime,
  buildSubscriptionRuntimeSummary,
  buildUnavailableSubscriptionRuntime,
  resolveSubscriptionRuntime,
} from "../lib/subscriptionRuntime.js";
import {
  getTrialNoticeDateKey,
  getTrialNoticeState,
} from "../lib/subscriptionTrial.js";
import {
  applyPromotionalGrantToRuntime,
} from "../lib/subscriptionPromotions.js";
import {
  SUBSCRIPTION_LIMIT_KEYS,
  SUBSCRIPTION_TRIAL_CONFIG,
} from "../lib/subscriptionPlans.js";

const SubscriptionContext = createContext(null);

const createSubscriptionCheckoutSessionCallable = httpsCallable(
  functions,
  "createSubscriptionCheckoutSession"
);
const createBillingPortalSessionCallable = httpsCallable(
  functions,
  "createBillingPortalSession"
);

const FAKE_BILLING_TRANSPORT_ENABLED =
  import.meta.env.DEV &&
  /^(1|true|yes)$/i.test(
    String(import.meta.env.VITE_E2E_FAKE_BILLING || "")
  ) &&
  /^(1|true|yes)$/i.test(
    String(import.meta.env.VITE_USE_FUNCTIONS_EMULATOR || "")
  );

const EMPTY_UI_STATE = Object.freeze({
  lastTrialNoticeDismissedDateKey: null,
  trialExpirationAcknowledgedAt: null,
});

function getAccountCreatedAt(user) {
  return user?.metadata?.creationTime || user?.metadata?.createdAt || null;
}

export function SubscriptionProvider({ children }) {
  const [user, setUser] = useState(() => auth.currentUser || null);
  const [runtime, setRuntime] = useState(() =>
    auth.currentUser
      ? buildLoadingSubscriptionRuntime()
      : buildUnavailableSubscriptionRuntime()
  );
  const [uiState, setUiState] = useState(EMPTY_UI_STATE);
  const [uiReady, setUiReady] = useState(false);
  const [loading, setLoading] = useState(Boolean(auth.currentUser));
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingAction, setBillingAction] = useState(null);
  const [billingError, setBillingError] = useState("");
  const [promotionalGrant, setPromotionalGrant] = useState(null);
  const [promotionReady, setPromotionReady] = useState(!auth.currentUser);
  const [internalAdminAccess, setInternalAdminAccess] = useState(() => ({
    ready: !auth.currentUser,
    fullAccess: false,
  }));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let unsubEntitlement = null;
    let unsubPromotion = null;
    let unsubUi = null;
    let disposed = false;
    let authGeneration = 0;

    const stopUserListeners = () => {
      if (unsubEntitlement) unsubEntitlement();
      if (unsubPromotion) unsubPromotion();
      if (unsubUi) unsubUi();
      unsubEntitlement = null;
      unsubPromotion = null;
      unsubUi = null;
    };

    const unsubAuth = onAuthStateChanged(auth, (nextUser) => {
      stopUserListeners();
      const generation = ++authGeneration;

      setUser(nextUser || null);
      setError(null);
      setBillingBusy(false);
      setBillingAction(null);
      setBillingError("");
      setUiState(EMPTY_UI_STATE);
      setUiReady(false);
      setPromotionalGrant(null);
      setPromotionReady(false);
      setInternalAdminAccess({
        ready: false,
        fullAccess: false,
      });

      if (!nextUser) {
        setRuntime(buildUnavailableSubscriptionRuntime());
        setUiReady(true);
        setPromotionReady(true);
        setInternalAdminAccess({
          ready: true,
          fullAccess: false,
        });
        setLoading(false);
        return;
      }

      setRuntime(buildLoadingSubscriptionRuntime());
      setLoading(true);

      getMyAdminAccess()
        .then((result) => {
          if (disposed || generation !== authGeneration) return;
          setInternalAdminAccess({
            ready: true,
            fullAccess: result?.internalFullAccess === true,
          });
        })
        .catch((accessError) => {
          if (disposed || generation !== authGeneration) return;
          console.warn("Internal admin access check failed:", accessError);
          setInternalAdminAccess({
            ready: true,
            fullAccess: false,
          });
        });

      const entitlementPath = getUserEntitlementDocumentPath(nextUser.uid);
      const entitlementRef = doc(db, entitlementPath);
      const promotionRef = doc(
        db,
        "users",
        nextUser.uid,
        "billing",
        "adminGrant"
      );
      const uiRef = doc(
        db,
        "users",
        nextUser.uid,
        "settings",
        "subscriptionUi"
      );

      unsubEntitlement = onSnapshot(
        entitlementRef,
        (snapshot) => {
          const nextRuntime = resolveSubscriptionRuntime({
            storedEntitlement: snapshot.exists() ? snapshot.data() : null,
            entitlementExists: snapshot.exists(),
            accountCreatedAt: getAccountCreatedAt(nextUser),
            now: new Date(),
          });

          setRuntime(nextRuntime);
          setLoading(false);
          setError(
            nextRuntime.resolution === "malformed-entitlement-free-fallback"
              ? "The subscription record is invalid. Free access is being used until the trusted record is repaired."
              : null
          );
        },
        (snapshotError) => {
          console.warn("Subscription entitlement listener failed:", snapshotError);
          setRuntime(buildUnavailableSubscriptionRuntime());
          setError(
            "Subscription status could not be refreshed. Free access is being used until the connection recovers."
          );
          setLoading(false);
        }
      );

      unsubPromotion = onSnapshot(
        promotionRef,
        (snapshot) => {
          setPromotionalGrant(snapshot.exists() ? snapshot.data() || {} : null);
          setPromotionReady(true);
        },
        (snapshotError) => {
          console.warn("Promotional access listener failed:", snapshotError);
          setPromotionalGrant(null);
          setPromotionReady(true);
        }
      );

      unsubUi = onSnapshot(
        uiRef,
        (snapshot) => {
          const data = snapshot.exists() ? snapshot.data() || {} : {};
          setUiState({
            lastTrialNoticeDismissedDateKey:
              data.lastTrialNoticeDismissedDateKey || null,
            trialExpirationAcknowledgedAt:
              data.trialExpirationAcknowledgedAt || null,
          });
          setUiReady(true);
        },
        (snapshotError) => {
          console.warn("Subscription UI-state listener failed:", snapshotError);
          setUiReady(true);
        }
      );
    });

    return () => {
      disposed = true;
      authGeneration += 1;
      stopUserListeners();
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    if (!runtime?.accessReady || !runtime?.sourceEntitlement) return;

    setRuntime((current) =>
      resolveSubscriptionRuntime({
        storedEntitlement: current.sourceEntitlement,
        entitlementExists: current.entitlementExists,
        accountCreatedAt: getAccountCreatedAt(user),
        now,
      })
    );
  }, [now, user]);

  const promotionalRuntime = useMemo(
    () => applyPromotionalGrantToRuntime(runtime, promotionalGrant, now),
    [now, promotionalGrant, runtime]
  );

  const effectiveRuntime = useMemo(
    () =>
      applyInternalAdminFullAccess(
        promotionalRuntime,
        internalAdminAccess.fullAccess
      ),
    [internalAdminAccess.fullAccess, promotionalRuntime]
  );

  const internalFullAccess =
    internalAdminAccess.ready && effectiveRuntime.internalFullAccess === true;
  const effectiveLoading = internalFullAccess ? false : loading;
  const effectiveError = internalFullAccess ? null : error;
  const accessReady = internalFullAccess
    ? true
    : effectiveRuntime.accessReady === true &&
      !loading &&
      promotionReady &&
      internalAdminAccess.ready;

  const trialNotice = useMemo(() => {
    if (
      !user ||
      !uiReady ||
      !accessReady ||
      internalFullAccess ||
      effectiveRuntime.promotionApplied === true
    ) {
      return {
        shouldShow: false,
        phase: "none",
        daysRemaining: null,
        dateKey: getTrialNoticeDateKey(
          now,
          SUBSCRIPTION_TRIAL_CONFIG.defaultDismissalTimeZone
        ),
        dismissedToday: false,
        upgradeAvailable: false,
      };
    }

    return getTrialNoticeState({
      entitlement: runtime.trialEntitlement,
      now,
      lastDismissedDateKey: uiState.lastTrialNoticeDismissedDateKey,
      expirationAcknowledged: Boolean(uiState.trialExpirationAcknowledgedAt),
      timeZone: SUBSCRIPTION_TRIAL_CONFIG.defaultDismissalTimeZone,
    });
  }, [
    accessReady,
    effectiveRuntime.promotionApplied,
    internalFullAccess,
    now,
    runtime.trialEntitlement,
    uiReady,
    uiState,
    user,
  ]);

  const dismissTrialNotice = useCallback(async () => {
    if (!user || !trialNotice?.dateKey || trialNotice.phase === "none") {
      return;
    }

    const uiRef = doc(
      db,
      "users",
      user.uid,
      "settings",
      "subscriptionUi"
    );
    const update = {
      lastTrialNoticeDismissedDateKey: trialNotice.dateKey,
      lastTrialNoticeDismissedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (trialNotice.phase === "expired") {
      update.trialExpirationAcknowledgedAt = serverTimestamp();
    }

    await setDoc(uiRef, update, { merge: true });

    setUiState((current) => ({
      ...current,
      lastTrialNoticeDismissedDateKey: trialNotice.dateKey,
      trialExpirationAcknowledgedAt:
        trialNotice.phase === "expired"
          ? new Date().toISOString()
          : current.trialExpirationAcknowledgedAt,
    }));
  }, [trialNotice, user]);

  const hasFeature = useCallback(
    (featureKey) =>
      accessReady && canEntitlementUseFeature(effectiveRuntime.entitlement, featureKey),
    [accessReady, effectiveRuntime.entitlement]
  );

  const getLimit = useCallback(
    (limitKey) => {
      if (!accessReady) {
        return getEntitlementLimit(
          buildUnavailableSubscriptionRuntime().entitlement,
          limitKey
        );
      }

      return getEntitlementLimit(effectiveRuntime.entitlement, limitKey);
    },
    [accessReady, effectiveRuntime.entitlement]
  );

  const clearBillingError = useCallback(() => {
    setBillingError("");
  }, []);

  const redirectToBillingUrl = useCallback((value) => {
    const url = requireSafeBillingRedirectUrl(value, {
      allowLocalhostHttp: FAKE_BILLING_TRANSPORT_ENABLED,
    });
    window.location.assign(url);
    return url;
  }, []);

  const startSubscriptionCheckout = useCallback(
    async (planId) => {
      if (!user) {
        setBillingError("Sign in again before changing billing.");
        return null;
      }
      if (!accessReady) {
        setBillingError(
          "Subscription access is still loading. No billing request was sent."
        );
        return null;
      }

      setBillingBusy(true);
      setBillingAction({ kind: "checkout", planId });
      setBillingError("");

      try {
        const payload = FAKE_BILLING_TRANSPORT_ENABLED
          ? {
              url: buildEmulatorBillingReturnUrl({
                baseUrl: window.location.href,
                state: "success",
                planId,
              }),
              sessionId: "cs_test_cnm_e2e",
            }
          : (
              await createSubscriptionCheckoutSessionCallable({
                planId,
                requestId: buildBillingRequestId("checkout"),
              })
            )?.data;

        redirectToBillingUrl(payload?.url);
        return payload || null;
      } catch (requestError) {
        console.warn("Subscription Checkout request failed:", requestError);
        setBillingError(
          normalizeBillingError(
            requestError,
            "Secure Checkout could not be opened. No billing changes were made."
          )
        );
        setBillingBusy(false);
        setBillingAction(null);
        return null;
      }
    },
    [accessReady, redirectToBillingUrl, user]
  );

  const openBillingPortal = useCallback(async () => {
    if (!user) {
      setBillingError("Sign in again before managing billing.");
      return null;
    }
    if (!accessReady) {
      setBillingError(
        "Subscription access is still loading. No billing request was sent."
      );
      return null;
    }

    setBillingBusy(true);
    setBillingAction({ kind: "portal", planId: null });
    setBillingError("");

    try {
      const payload = FAKE_BILLING_TRANSPORT_ENABLED
        ? {
            url: buildEmulatorBillingReturnUrl({
              baseUrl: window.location.href,
              state: "portal-return",
            }),
            sessionId: "bps_test_cnm_e2e",
          }
        : (
            await createBillingPortalSessionCallable({
              requestId: buildBillingRequestId("portal"),
            })
          )?.data;

      redirectToBillingUrl(payload?.url);
      return payload || null;
    } catch (requestError) {
      console.warn("Billing portal request failed:", requestError);
      setBillingError(
        normalizeBillingError(
          requestError,
          "The billing portal could not be opened. No billing changes were made."
        )
      );
      setBillingBusy(false);
      setBillingAction(null);
      return null;
    }
  }, [accessReady, redirectToBillingUrl, user]);

  const value = useMemo(
    () => ({
      user,
      loading: effectiveLoading,
      accessReady,
      uiReady,
      error: effectiveError,
      internalAccessReady: internalAdminAccess.ready,
      internalFullAccess,
      entitlement: effectiveRuntime.entitlement,
      sourceEntitlement: runtime.sourceEntitlement,
      trialEntitlement: runtime.trialEntitlement,
      entitlementExists: runtime.entitlementExists,
      resolution: effectiveRuntime.resolution,
      grace: runtime.grace,
      promotionalGrant: effectiveRuntime.promotionalGrant,
      promotionActive:
        !internalFullAccess && effectiveRuntime.promotionActive === true,
      promotionScheduled:
        !internalFullAccess && effectiveRuntime.promotionScheduled === true,
      promotionApplied:
        !internalFullAccess && effectiveRuntime.promotionApplied === true,
      promotionReady,
      summary: buildSubscriptionRuntimeSummary({
        entitlement: effectiveRuntime.entitlement,
        sourceEntitlement: runtime.sourceEntitlement,
        now,
        grace: runtime.grace,
        accessReady,
      }),
      trialNotice,
      dismissTrialNotice,
      hasFeature,
      getLimit,
      billingBusy,
      billingAction,
      billingError,
      billingTransport: FAKE_BILLING_TRANSPORT_ENABLED ? "emulator-fake" : "live",
      clearBillingError,
      startSubscriptionCheckout,
      openBillingPortal,
      activeGrowLimitWhileLoading: getEntitlementLimit(
        buildUnavailableSubscriptionRuntime().entitlement,
        SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS
      ),
    }),
    [
      user,
      effectiveLoading,
      accessReady,
      uiReady,
      effectiveError,
      internalAdminAccess.ready,
      internalFullAccess,
      runtime,
      effectiveRuntime,
      promotionReady,
      now,
      trialNotice,
      dismissTrialNotice,
      hasFeature,
      getLimit,
      billingBusy,
      billingAction,
      billingError,
      clearBillingError,
      startSubscriptionCheckout,
      openBillingPortal,
    ]
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);

  if (!context) {
    throw new Error("useSubscription must be used within SubscriptionProvider.");
  }

  return context;
}

export { SubscriptionContext };
