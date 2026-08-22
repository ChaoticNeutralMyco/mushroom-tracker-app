// src/components/ui/ActiveGrowLimitNotice.jsx

import React from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "./Modal.jsx";

export default function ActiveGrowLimitNotice({
  open = false,
  message = "",
  usage = 0,
  limit = 0,
  onClose = () => {},
  onViewPlans = () => {},
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Active grow limit reached"
      size="md"
    >
      <div className="space-y-4" data-testid="active-grow-limit-notice">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">
              {usage} of {limit} active grows are currently in use
            </p>
            <p className="mt-1 text-sm leading-6">{message}</p>
          </div>
        </div>

        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          Existing grows remain fully available. You can keep editing, harvesting,
          contaminating, completing, or archiving them. No records are deleted or hidden.
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
