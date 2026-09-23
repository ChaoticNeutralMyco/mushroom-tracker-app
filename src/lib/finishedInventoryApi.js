// src/lib/finishedInventoryApi.js
// finished-inventory-api-v1-trusted-callable

import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase-config.js";

const recordFinishedInventoryMovementTrustedCallable = httpsCallable(
  functions,
  "recordFinishedInventoryMovementTrusted"
);

export async function recordFinishedInventoryMovementTrusted(input = {}) {
  const payload =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...input }
      : {};

  // Identity and authoritative accounting/FEFO evidence are derived by the
  // trusted backend. Never send caller-computed values for those fields.
  delete payload.userId;
  delete payload.revenue;
  delete payload.defaultPricePerUnit;
  delete payload.fefoSkippedLotId;
  delete payload.fefoSkippedLotCode;
  delete payload.fefoSkippedBestBy;
  delete payload.fefoSelectedBestBy;

  const response =
    await recordFinishedInventoryMovementTrustedCallable(payload);

  return response?.data || null;
}
