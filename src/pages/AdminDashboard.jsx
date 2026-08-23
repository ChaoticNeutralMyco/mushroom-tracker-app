// src/pages/AdminDashboard.jsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportAdminMarketingSubscribers,
  grantAdminPromotionalAccess,
  listAdminAccounts,
  normalizeAdminRequestError,
  revokeAdminPromotionalAccess,
} from "../lib/adminApi.js";
import {
  SUBSCRIPTION_PLAN_IDS,
  SUBSCRIPTION_PLANS,
} from "../lib/subscriptionPlans.js";
import { toSubscriptionDate } from "../lib/subscriptionTrial.js";

const PROMO_PLAN_IDS = Object.freeze([
  SUBSCRIPTION_PLAN_IDS.HOBBY,
  SUBSCRIPTION_PLAN_IDS.CULTIVATOR,
  SUBSCRIPTION_PLAN_IDS.LAB,
]);

function planLabel(planId) {
  return SUBSCRIPTION_PLANS[planId]?.label || String(planId || "Unknown");
}

function formatDate(value, { includeTime = false } = {}) {
  const date = toSubscriptionDate(value);
  if (!date) return "Not available";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime
      ? {
          hour: "numeric",
          minute: "2-digit",
        }
      : {}),
  }).format(date);
}

function promoState(account, now = new Date()) {
  const promotion = account?.promotion;
  if (!promotion || promotion.status !== "active") {
    return promotion?.status === "revoked" ? "Revoked" : "None";
  }

  const startsAt = toSubscriptionDate(promotion.startsAt);
  const endsAt = toSubscriptionDate(promotion.endsAt);

  if (startsAt && startsAt.getTime() > now.getTime()) return "Scheduled";
  if (endsAt && endsAt.getTime() <= now.getTime()) return "Expired";
  return "Active";
}

function accountSearchText(account) {
  return [
    account?.email,
    account?.displayName,
    account?.uid,
    account?.effectivePlanId,
    account?.entitlement?.planId,
    account?.entitlement?.source,
    account?.emailVerified ? "verified" : "not verified",
    account?.marketingEmailOptIn ? "marketing opted in" : "marketing not opted in",
    promoState(account),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function upsertAccounts(current, incoming) {
  const byUid = new Map(current.map((account) => [account.uid, account]));
  for (const account of incoming) {
    if (account?.uid) byUid.set(account.uid, account);
  }
  return Array.from(byUid.values());
}

function neutralizeSpreadsheetFormula(value) {
  const text = value === null || value === undefined ? "" : String(value);

  if (/^[\s\uFEFF]*[=+\-@]/u.test(text)) {
    return `'${text}`;
  }

  return text;
}

function csvCell(value) {
  const text = neutralizeSpreadsheetFormula(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadMarketingCsv(subscribers = []) {
  const rows = [
    ["Email", "Display Name", "Email Verified", "Opted In At", "Consent Version"],
    ...subscribers.map((subscriber) => [
      subscriber.email || "",
      subscriber.displayName || "",
      subscriber.emailVerified === true ? "Yes" : "No",
      subscriber.optedInAt || "",
      subscriber.consentVersion || "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cnm-marketing-subscribers-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function AdminDashboard() {
  const [accounts, setAccounts] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [selectedUid, setSelectedUid] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [promoPlanId, setPromoPlanId] = useState(SUBSCRIPTION_PLAN_IDS.LAB);
  const [durationDays, setDurationDays] = useState("30");
  const [reason, setReason] = useState("");
  const [campaign, setCampaign] = useState("");
  const [revokeReason, setRevokeReason] = useState("");

  const loadAccounts = useCallback(
    async ({ append = false } = {}) => {
      if (append) {
        if (!nextPageToken || loadingMore) return;
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      setError("");

      try {
        const result = await listAdminAccounts({
          pageSize: 50,
          pageToken: append ? nextPageToken : null,
        });

        setAccounts((current) =>
          append
            ? upsertAccounts(current, result.accounts)
            : result.accounts
        );
        setNextPageToken(result.nextPageToken);
      } catch (requestError) {
        setError(
          normalizeAdminRequestError(
            requestError,
            "The private account directory could not be loaded."
          )
        );
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [loadingMore, nextPageToken]
  );

  useEffect(() => {
    loadAccounts();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((left, right) => {
        const leftDate = toSubscriptionDate(left.createdAt)?.getTime() || 0;
        const rightDate = toSubscriptionDate(right.createdAt)?.getTime() || 0;
        return rightDate - leftDate;
      }),
    [accounts]
  );

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return sortedAccounts.filter((account) => {
      if (query && !accountSearchText(account).includes(query)) {
        return false;
      }

      if (planFilter === "all") return true;
      if (planFilter === "promo") {
        return ["Active", "Scheduled"].includes(promoState(account));
      }
      if (planFilter === "stripe") {
        return account?.entitlement?.stripeManaged === true;
      }
      if (planFilter === "marketing") {
        return account?.marketingEmailOptIn === true;
      }

      return account?.effectivePlanId === planFilter;
    });
  }, [planFilter, search, sortedAccounts]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.uid === selectedUid) || null,
    [accounts, selectedUid]
  );

  const refreshAfterMutation = useCallback(async () => {
    await loadAccounts({ append: false });
  }, [loadAccounts]);

  const handleMarketingExport = useCallback(async () => {
    setBusyAction("marketing-export");
    setError("");
    setNotice("");

    try {
      const result = await exportAdminMarketingSubscribers();
      const subscribers = Array.isArray(result?.subscribers)
        ? result.subscribers
        : [];
      downloadMarketingCsv(subscribers);
      setNotice(
        `Downloaded ${subscribers.length} explicitly opted-in marketing subscriber${
          subscribers.length === 1 ? "" : "s"
        }. Email verification is included as a separate CSV field and is not treated as consent.`
      );
    } catch (requestError) {
      setError(
        normalizeAdminRequestError(
          requestError,
          "The marketing subscriber list could not be downloaded."
        )
      );
    } finally {
      setBusyAction("");
    }
  }, []);

  const handleGrant = useCallback(async () => {
    if (!selectedAccount) return;

    const days = Number(durationDays);
    if (!Number.isInteger(days) || days < 1) {
      setError("Promotional duration must be a positive whole number of days.");
      return;
    }

    if (reason.trim().length < 3) {
      setError("Enter a short reason for the promotional access.");
      return;
    }

    const label = planLabel(promoPlanId);
    const confirmed = window.confirm(
      `Grant or extend ${label} promotional access for ${days} day${days === 1 ? "" : "s"}?\n\nThis does not change Stripe billing.`
    );

    if (!confirmed) return;

    setBusyAction("grant");
    setError("");
    setNotice("");

    try {
      const result = await grantAdminPromotionalAccess({
        targetUid: selectedAccount.uid,
        planId: promoPlanId,
        durationDays: days,
        reason,
        campaign,
      });

      setNotice(
        `${label} promotional access saved${
          result?.grant?.endsAt
            ? ` through ${formatDate(result.grant.endsAt)}`
            : ""
        }. Stripe billing was not changed.`
      );
      setReason("");
      setCampaign("");
      await refreshAfterMutation();
    } catch (requestError) {
      setError(
        normalizeAdminRequestError(
          requestError,
          "Promotional access could not be saved."
        )
      );
    } finally {
      setBusyAction("");
    }
  }, [
    campaign,
    durationDays,
    promoPlanId,
    reason,
    refreshAfterMutation,
    selectedAccount,
  ]);

  const handleRevoke = useCallback(async () => {
    if (!selectedAccount) return;

    if (revokeReason.trim().length < 3) {
      setError("Enter a short reason for revoking the promotional grant.");
      return;
    }

    const confirmed = window.confirm(
      `Revoke only the administrative promotional grant for ${selectedAccount.email || selectedAccount.uid}?\n\nAny valid Stripe, Trial, or Free access remains untouched.`
    );

    if (!confirmed) return;

    setBusyAction("revoke");
    setError("");
    setNotice("");

    try {
      await revokeAdminPromotionalAccess({
        targetUid: selectedAccount.uid,
        reason: revokeReason,
      });

      setNotice(
        "Promotional grant revoked. Underlying Stripe, Trial, or Free access was not changed."
      );
      setRevokeReason("");
      await refreshAfterMutation();
    } catch (requestError) {
      setError(
        normalizeAdminRequestError(
          requestError,
          "The promotional grant could not be revoked."
        )
      );
    } finally {
      setBusyAction("");
    }
  }, [
    refreshAfterMutation,
    revokeReason,
    selectedAccount,
  ]);

  return (
    <div className="space-y-5" data-testid="admin-dashboard">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--_accent-rgb))]">
              Private administration
            </p>
            <h2 className="mt-1 text-2xl font-bold">Account access dashboard</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Review account access and issue temporary promotional upgrades.
              Purchased subscriptions remain controlled by Stripe and cannot be
              canceled, downgraded, or refunded from this dashboard.
            </p>
          </div>

          <button
            type="button"
            className="chip chip--active self-start"
            disabled={loading}
            onClick={() => loadAccounts({ append: false })}
          >
            {loading ? "Refreshing…" : "Refresh accounts"}
          </button>
        </div>
      </section>

      {error ? (
        <section
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-100"
          role="alert"
        >
          {error}
        </section>
      ) : null}

      {notice ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100">
          {notice}
        </section>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Search
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Email, UID, plan, source…"
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Filter
            </span>
            <select
              value={planFilter}
              onChange={(event) => setPlanFilter(event.target.value)}
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="all">All accounts</option>
              <option value="stripe">Stripe managed</option>
              <option value="promo">Promo active/scheduled</option>
              <option value="marketing">Marketing opted in</option>
              <option value="free">Effective Free</option>
              <option value="trial">Effective Trial</option>
              <option value="hobby">Effective Hobby</option>
              <option value="cultivator">Effective Cultivator</option>
              <option value="lab">Effective Lab</option>
              <option value="admin">Internal Admin</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>{accounts.length} account(s) loaded</span>
          <span>•</span>
          <span>{filteredAccounts.length} shown</span>
          <span>•</span>
          <span>
            {accounts.filter((account) => account.marketingEmailOptIn === true).length} marketing opt-in(s) loaded
          </span>
          {nextPageToken ? (
            <>
              <span>•</span>
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2"
                disabled={loadingMore}
                onClick={() => loadAccounts({ append: true })}
              >
                {loadingMore ? "Loading more…" : "Load more accounts"}
              </button>
            </>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <div>
            <div className="text-sm font-semibold">Marketing distribution list</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Downloads only accounts with explicit current-email marketing consent. Email verification is reported separately and never counts as consent.
            </p>
          </div>
          <button
            type="button"
            data-testid="admin-marketing-export"
            className="btn-outline"
            disabled={Boolean(busyAction)}
            onClick={handleMarketingExport}
          >
            {busyAction === "marketing-export"
              ? "Preparing CSV…"
              : "Download opted-in CSV"}
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow dark:border-zinc-800 dark:bg-zinc-900">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-slate-500 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Effective</th>
                  <th className="px-4 py-3">Base billing</th>
                  <th className="px-4 py-3">Promo</th>
                  <th className="px-4 py-3">Grows</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {loading && accounts.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                      Loading private account directory…
                    </td>
                  </tr>
                ) : filteredAccounts.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>
                      No accounts match the current filter.
                    </td>
                  </tr>
                ) : (
                  filteredAccounts.map((account) => {
                    const promotionState = promoState(account);
                    const selected = selectedUid === account.uid;

                    return (
                      <tr
                        key={account.uid}
                        className={selected ? "bg-[rgba(var(--_accent-rgb),0.08)]" : ""}
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="font-semibold">
                            {account.email || "No email"}
                          </div>
                          <div className="mt-1 max-w-72 truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {account.uid}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {account.isAuthorizedAdmin ? (
                              <span className="rounded-full border border-violet-300 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:border-violet-700 dark:text-violet-300">
                                Authorized admin
                              </span>
                            ) : null}
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                account.emailVerified
                                  ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                                  : "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                              }`}
                            >
                              {account.emailVerified ? "Email verified" : "Email not verified"}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                account.marketingEmailOptIn
                                  ? "border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300"
                                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                              }`}
                            >
                              {account.marketingEmailOptIn
                                ? "Marketing opt-in"
                                : account.marketingConsentStale
                                  ? "Marketing re-confirm required"
                                  : "No marketing opt-in"}
                            </span>
                            {account.disabled ? (
                              <span className="rounded-full border border-rose-300 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:border-rose-700 dark:text-rose-300">
                                Disabled
                              </span>
                            ) : null}
                          </div>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <div className="font-semibold">
                            {planLabel(account.effectivePlanId)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Created {formatDate(account.createdAt)}
                          </div>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <div className="font-semibold">
                            {planLabel(account.entitlement?.planId)}
                          </div>
                          <div className="mt-1 text-xs capitalize text-slate-500 dark:text-slate-400">
                            {account.entitlement?.status || "missing"} ·{" "}
                            {(account.entitlement?.source || "missing").replaceAll("_", " ")}
                          </div>
                          {account.entitlement?.stripeManaged ? (
                            <div className="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300">
                              Stripe managed
                            </div>
                          ) : null}
                        </td>

                        <td className="px-4 py-3 align-top">
                          <div className="font-semibold">{promotionState}</div>
                          {account.promotion?.planId ? (
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {planLabel(account.promotion.planId)} ·{" "}
                              {formatDate(account.promotion.endsAt)}
                            </div>
                          ) : null}
                        </td>

                        <td className="px-4 py-3 align-top font-semibold">
                          {account.activeGrowCount ?? 0}
                        </td>

                        <td className="px-4 py-3 text-right align-top">
                          <button
                            type="button"
                            className={`chip ${selected ? "chip--active" : ""}`}
                            onClick={() => {
                              setSelectedUid(account.uid);
                              setError("");
                              setNotice("");
                            }}
                          >
                            Manage access
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-2xl border border-zinc-200 bg-white p-5 shadow dark:border-zinc-800 dark:bg-zinc-900">
          {!selectedAccount ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Select an account to issue or revoke a promotional access grant.
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Selected account
                </p>
                <p className="mt-1 break-all font-semibold">
                  {selectedAccount.email || selectedAccount.uid}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {selectedAccount.uid}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">
                    Effective
                  </dt>
                  <dd className="font-semibold">
                    {planLabel(selectedAccount.effectivePlanId)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">
                    Base
                  </dt>
                  <dd className="font-semibold">
                    {planLabel(selectedAccount.entitlement?.planId)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">
                    Last sign-in
                  </dt>
                  <dd className="font-semibold">
                    {formatDate(selectedAccount.lastSignInAt, {
                      includeTime: true,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">
                    Email
                  </dt>
                  <dd className="font-semibold">
                    {selectedAccount.emailVerified ? "Verified" : "Not verified"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">
                    Marketing
                  </dt>
                  <dd className="font-semibold">
                    {selectedAccount.marketingEmailOptIn
                      ? "Opted in"
                      : selectedAccount.marketingConsentStale
                        ? "Re-confirm required"
                        : "Not opted in"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500 dark:text-slate-400">
                    Promo
                  </dt>
                  <dd className="font-semibold">{promoState(selectedAccount)}</dd>
                </div>
              </dl>

              {selectedAccount.entitlement?.stripeManaged ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-100">
                  This account has Stripe-managed billing. Promotional controls
                  can only add access; paid cancellation, refund, and downgrade
                  actions remain outside this dashboard.
                </div>
              ) : null}

              {selectedAccount.effectivePlanId === SUBSCRIPTION_PLAN_IDS.ADMIN ? (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900 dark:border-violet-900/70 dark:bg-violet-950/30 dark:text-violet-100">
                  This account already has internal Admin entitlement. A
                  promotional customer tier would not increase its access.
                </div>
              ) : (
                <>
                  <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                    <h3 className="font-semibold">Grant / extend promotion</h3>

                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                        Promotional tier
                      </span>
                      <select
                        value={promoPlanId}
                        onChange={(event) => setPromoPlanId(event.target.value)}
                        className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      >
                        {PROMO_PLAN_IDS.map((planId) => (
                          <option key={planId} value={planId}>
                            {planLabel(planId)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                        Days to add
                      </span>
                      <input
                        type="number"
                        min="1"
                        max="3650"
                        step="1"
                        value={durationDays}
                        onChange={(event) => setDurationDays(event.target.value)}
                        className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                        Reason
                      </span>
                      <textarea
                        rows="3"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Giveaway, support credit, testing access…"
                        className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                        Campaign (optional)
                      </span>
                      <input
                        type="text"
                        value={campaign}
                        onChange={(event) => setCampaign(event.target.value)}
                        placeholder="launch-2026"
                        className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </label>

                    <button
                      type="button"
                      className="btn-accent w-full"
                      disabled={Boolean(busyAction)}
                      onClick={handleGrant}
                    >
                      {busyAction === "grant"
                        ? "Saving promotional access…"
                        : "Grant / extend access"}
                    </button>
                  </div>

                  {selectedAccount.promotion?.status === "active" ? (
                    <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                      <h3 className="font-semibold">Revoke promotion only</h3>
                      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                        Current grant: {planLabel(selectedAccount.promotion.planId)}{" "}
                        through {formatDate(selectedAccount.promotion.endsAt)}.
                      </p>

                      <label className="block">
                        <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                          Revocation reason
                        </span>
                        <textarea
                          rows="2"
                          value={revokeReason}
                          onChange={(event) => setRevokeReason(event.target.value)}
                          placeholder="Promotion completed, correction…"
                          className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                        />
                      </label>

                      <button
                        type="button"
                        className="w-full rounded-xl border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30"
                        disabled={Boolean(busyAction)}
                        onClick={handleRevoke}
                      >
                        {busyAction === "revoke"
                          ? "Revoking promotion…"
                          : "Revoke promotional grant"}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
