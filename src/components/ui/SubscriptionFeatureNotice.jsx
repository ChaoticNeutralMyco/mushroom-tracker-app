// src/components/ui/SubscriptionFeatureNotice.jsx

import React from "react";
import { LockKeyhole } from "lucide-react";
import Modal from "./Modal.jsx";

export default function SubscriptionFeatureNotice({
  open = false,
  featureLabel = "Subscription feature",
  minimumPlanLabel = "an eligible plan",
  actionLabel = "Use this feature",
  message = "",
  supportingText = "",
  onClose = () => {},
  onViewPlans = () => {},
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${featureLabel} requires an upgrade`}
      size="md"
    >
      <div className="space-y-4" data-testid="subscription-feature-notice">
        <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">{actionLabel}</p>
            <p className="mt-1 text-sm leading-6">
              {message || `${featureLabel} begins with the ${minimumPlanLabel} plan.`}
            </p>
          </div>
        </div>

        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          {supportingText || (
            <>
              Existing SOP-linked grows, generated tasks, checklists, and workflow history remain
              available. You can continue and complete work that was already started before a
              downgrade.
            </>
          )}
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-zinc-200 px-4 py-2 text-sm font-medium dark:bg-zinc-800"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onViewPlans}
            className="rounded-full accent-bg px-4 py-2 text-sm font-semibold text-white"
          >
            View plans
          </button>
        </div>
      </div>
    </Modal>
  );
}
