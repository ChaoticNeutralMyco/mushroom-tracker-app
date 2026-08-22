// tests/unit/subscriptionGrowLimitIntegration.test.js

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativeUrl) =>
  readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), "utf8");

const sourceBetween = (source, startMarker, endMarker) => {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

const appSource = readSource("../../src/App.jsx");
const growFormSource = readSource("../../src/components/Grow/GrowForm.jsx");
const archiveSource = readSource("../../src/pages/Archive.jsx");
const growListSource = readSource("../../src/components/Grow/GrowList.jsx");
const noticeSource = readSource("../../src/components/ui/ActiveGrowLimitNotice.jsx");
const functionsIndexSource = readSource("../../functions/src/index.js");
const growServiceSource = readSource("../../functions/src/growService.js");
const firestoreRulesSource = readSource("../../firestore.rules");

describe("active-grow limit live integration", () => {
  it("reads the configured limit through the subscription context", () => {
    expect(appSource).toContain("useSubscription()");
    expect(appSource).toContain("SUBSCRIPTION_LIMIT_KEYS.ACTIVE_GROWS");
    expect(appSource).toContain("subscription.getLimit");
  });

  it("checks single creates and sends full create batches through one trusted callable", () => {
    expect(appSource).toContain("validateCreateGrowBatch");
    expect(appSource).toContain("countRequestedActiveGrows(payloads)");
    expect(appSource).toContain('"createGrowBatch"');
    expect(appSource).toContain("onCreateGrowBatch");
    expect(appSource).toContain("encodeGrowPayloadForCallable");
    expect(growFormSource).toContain("onValidateCreateBatch(createPayloads)");
    expect(growFormSource).toContain("await onCreateGrowBatch(createPayloads)");
    expect(growFormSource.indexOf("onValidateCreateBatch(createPayloads)")).toBeLessThan(
      growFormSource.indexOf("await onCreateGrowBatch(createPayloads)")
    );
  });

  it("checks every grow update path that can reactivate a record", () => {
    const updateStageSource = sourceBetween(
      appSource,
      "const onUpdateStage = async",
      "const onUpdateStageDate = async"
    );
    const updateStatusSource = sourceBetween(
      appSource,
      "const onUpdateStatus = async",
      "const onUpdateGrow = async"
    );
    const updateGrowSource = sourceBetween(
      appSource,
      "const onUpdateGrow = async",
      "const validateCreateGrowBatch"
    );

    expect(updateStageSource).toContain(
      "assertGrowReactivationAllowed(currentGrow, patch)"
    );
    expect(updateStatusSource).toContain(
      "assertGrowReactivationAllowed(currentGrow, patch)"
    );
    expect(updateGrowSource).toContain(
      "assertGrowReactivationAllowed(currentGrow, patch)"
    );
    expect(appSource).toContain("const validateGrowReactivationBatch = (updates = []) =>");
    expect(appSource).toContain('assertGrowCapacity({ requestedCount, action: "reactivate" })');
    expect(appSource).toContain(
      "onValidateReactivationBatch={validateGrowReactivationBatch}"
    );
    expect(appSource).toContain(
      "onReactivateGrowBatch={onReactivateGrowBatch}"
    );
    expect(appSource).toContain('"reactivateGrowBatch"');
    expect(appSource).toContain("encodeGrowPatchForCallable");
    expect(growListSource).toContain("onUpdateGrow={onUpdateGrow}");

    const applyStatusSource = sourceBetween(
      growListSource,
      "async function applyStatus",
      "const applyStage = async"
    );
    expect(applyStatusSource).toContain("await onUpdateGrow(id, patch)");
    expect(applyStatusSource.indexOf("await onUpdateGrow(id, patch)")).toBeLessThan(
      applyStatusSource.indexOf('await updateDoc(doc(db, "users", uid, "grows", id), patch)')
    );

    const batchUnarchiveSource = sourceBetween(
      growListSource,
      "const batchUnarchive = async",
      "const batchStore = async"
    );
    const batchUnstoreSource = sourceBetween(
      growListSource,
      "const batchUnstore = async",
      "// ---------- Row ----------"
    );
    expect(batchUnarchiveSource).toContain("onValidateReactivationBatch?.(updates)");
    expect(batchUnarchiveSource).toContain("await onReactivateGrowBatch(updates)");
    expect(batchUnarchiveSource.indexOf("await onReactivateGrowBatch(updates)")).toBeLessThan(
      batchUnarchiveSource.indexOf('await applyStatus(id, "Active")')
    );
    expect(batchUnstoreSource).toContain("onValidateReactivationBatch?.(updates)");
    expect(batchUnstoreSource).toContain("await onReactivateGrowBatch(updates)");
    expect(batchUnstoreSource.indexOf("await onReactivateGrowBatch(updates)")).toBeLessThan(
      batchUnstoreSource.indexOf('await applyStatus(id, "Active")')
    );
  });

  it("keeps Archive open and displays a rejected reactivation error", () => {
    expect(archiveSource).toContain("await onSubmit");
    expect(archiveSource).toContain(
      'setErr(error?.message || "Unable to reactivate this grow.")'
    );
    expect(archiveSource).toContain("Checking limit…");
  });

  it("shows usage and a plans action without hiding existing records", () => {
    expect(appSource).toContain('data-testid="active-grow-usage"');
    expect(appSource).toContain("<ActiveGrowLimitNotice");
    expect(noticeSource).toContain("Existing grows remain fully available");
    expect(noticeSource).toContain("View plans");
  });

  it("exports trusted create and reactivation callables backed by a serialized capacity transaction", () => {
    expect(functionsIndexSource).toContain("export const createGrowBatch = onCall");
    expect(functionsIndexSource).toContain("export const reactivateGrowBatch = onCall");
    expect(functionsIndexSource).toContain("createGrowBatchWithEntitlement");
    expect(functionsIndexSource).toContain("reactivateGrowBatchWithEntitlement");
    expect(growServiceSource).toContain("transaction.get(lockRef)");
    expect(growServiceSource).toContain("transaction.get(collectionRef)");
    expect(growServiceSource).toContain("activeCountAfter");
    expect(growServiceSource).toContain("ACTIVE_GROW_LIMIT_ERROR_CODE");
  });

  it("blocks direct grow creation and browser reactivation while preserving completion-safe updates", () => {
    expect(firestoreRulesSource).toContain("match /grows/{growId}");
    expect(firestoreRulesSource).toContain("allow create: if false");
    expect(firestoreRulesSource).toContain(
      "allow update: if isOwner(uid) && !wouldReactivateGrow()"
    );
    expect(firestoreRulesSource).toContain("allow delete: if isOwner(uid)");
    expect(firestoreRulesSource).toContain("collectionId != 'grows'");
  });

});
