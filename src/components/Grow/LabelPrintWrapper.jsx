// src/components/Grow/LabelPrintWrapper.jsx
// labels-v48-packaged-sku-children-only
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { auth, db } from "../../firebase-config";
import { collection, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import LabelPrint from "./LabelPrint";
import PackagingLabelPreview, {
  buildPackagingLabelDataFromFinishedGood,
  DEMO_PACKAGING_LABEL_DATA,
} from "./PackagingLabelPreview";
import { isActiveGrow } from "../../lib/growFilters";
import { SUBSCRIPTION_FEATURE_KEYS } from "../../lib/subscriptionPlans.js";
import {
  getLotWorkflowState,
  isFinishedGoodsLot,
  isLotBlockedForUse,
} from "../../lib/postprocess";

const LOCAL_KEY_TEMPLATE = "labels.template";

const templateMeta = {
  "5160": {
    title: "Avery 5160 / 8160",
    size: '2.625″ × 1″',
    note: "30-up · 3×10",
  },
  "5167": {
    title: "Avery 5167",
    size: '1.75″ × 0.5″',
    note: "80-up · 4×20 (mini)",
  },
};

function readTemplateId() {
  try {
    const val = localStorage.getItem(LOCAL_KEY_TEMPLATE);
    return val === "5167" ? "5167" : "5160";
  } catch {
    return "5160";
  }
}

const getLibQtyNum = (it) => {
  const raw =
    it?.qty ??
    it?.quantity ??
    it?.count ??
    it?.amount ??
    it?.onHand ??
    it?.available ??
    0;
  const n = Number(raw || 0);
  return Number.isFinite(n) ? n : 0;
};

const isActiveLibraryItem = (it) => {
  if (!it) return false;
  const qty = getLibQtyNum(it);
  const status = String(it?.status || "").toLowerCase();
  const archivedish =
    Boolean(it?.archived) ||
    Boolean(it?.isArchived) ||
    Boolean(it?.deleted) ||
    Boolean(it?.trashed) ||
    status === "archived" ||
    status === "inactive";
  return qty > 0 && !archivedish;
};

const getFinishedQtyNum = (it) => {
  const raw =
    it?.remainingQuantity ??
    it?.qty ??
    it?.quantity ??
    it?.count ??
    0;
  const n = Number(raw || 0);
  return Number.isFinite(n) ? n : 0;
};

const getFinishedShelfBlock = (it) => {
  const status = String(it?.shelfLifeAction || "").toLowerCase();
  return status === "expired" || status === "do_not_sell";
};

const isActiveFinishedGood = (it) => {
  if (!it) return false;
  if (!isFinishedGoodsLot(it)) return false;

  const qty = getFinishedQtyNum(it);
  const status = String(it?.status || "").toLowerCase();
  const archivedish =
    Boolean(it?.archived) ||
    Boolean(it?.isArchived) ||
    Boolean(it?.deleted) ||
    Boolean(it?.trashed) ||
    status === "archived" ||
    status === "inactive" ||
    status === "depleted";

  return qty > 0 && !archivedish;
};

const getFinishedLabelEligibility = (it) => {
  if (!isActiveFinishedGood(it)) {
    return { printable: false, reason: "Inactive or depleted" };
  }

  const workflow = getLotWorkflowState(it);
  if (isLotBlockedForUse(it, "label")) {
    return {
      printable: false,
      reason: workflow.blockReason || "Blocked for labels",
    };
  }

  if (getFinishedShelfBlock(it)) {
    return {
      printable: false,
      reason: String(it?.shelfLifeAction || "Do not sell").replace(/_/g, " "),
    };
  }

  return { printable: true, reason: "" };
};

const getFinishedName = (it) =>
  String(it?.name || it?.batchName || it?.variant || it?.label || it?.title || "Finished Lot").trim();

const getLabelSortOrder = (it) => {
  const n = Number(it?.labelSortOrder ?? it?.sortOrder ?? 9999);
  return Number.isFinite(n) ? n : 9999;
};

const sortLabelLots = (a, b) => {
  const orderDiff = getLabelSortOrder(a) - getLabelSortOrder(b);
  if (orderDiff !== 0) return orderDiff;
  return getFinishedName(a).localeCompare(getFinishedName(b));
};

const ensureApproxLabel = (value, fallback = "") => {
  const text = String(value || fallback || "").trim();
  if (!text) return text;
  return text.startsWith("≈") ? text : `≈ ${text}`;
};

const stripApproxLabel = (value, fallback = "") =>
  String(value || fallback || "")
    .trim()
    .replace(/^≈\s*/, "");

const isCapsulePackageLot = (lot = {}) => {
  const type = String(lot?.productType || lot?.finishedGoodType || lot?.lotType || "").toLowerCase();
  return type.includes("capsule") || Number(lot?.capsulesPerPackage || lot?.labelMetadata?.capsulesPerPackage || 0) > 0;
};

const getApproxCapsuleLabel = (lot = {}, built = {}) => {
  const explicit = built?.perCapsule || lot?.labelMetadata?.perCapsule || lot?.perCapsule;
  if (explicit) return ensureApproxLabel(explicit);
  const grams = Number(
    lot?.averageWeightPerCapsuleG ??
      lot?.labelMetadata?.averageWeightPerCapsuleG ??
      lot?.displayAverageCapsuleWeightG ??
      lot?.actualAverageCapsuleWeightG ??
      lot?.gramsPerUnit ??
      0
  );
  if (grams > 0) {
    const mg = Math.round(grams * 1000 * 100) / 100;
    return `≈ ${String(mg).replace(/\.0+$/, "")} mg`;
  }
  return "";
};

const PACKAGED_SKU_TYPES = new Set(["retail", "sample", "promo", "internal"]);

const getPackagedSkuType = (lot = {}) =>
  String(
    lot?.skuType ||
      lot?.packageSkuType ||
      lot?.package?.skuType ||
      lot?.labelMetadata?.skuType ||
      ""
  )
    .trim()
    .toLowerCase();

const getPackageSizeQuantity = (lot = {}) => {
  const candidates = [
    lot?.packageSize,
    lot?.packageQuantity,
    lot?.unitsPerPackage,
    lot?.capsulesPerPackage,
    lot?.package?.packageSize,
    lot?.package?.unitsPerPackage,
    lot?.labelMetadata?.packageSize,
    lot?.labelMetadata?.capsulesPerPackage,
  ];

  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const label = String(
    lot?.packageSizeLabel ||
      lot?.package?.packageSizeLabel ||
      lot?.labelMetadata?.packageSizeLabel ||
      ""
  ).trim();

  const match = label.match(/\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const isPackagedSkuChildLot = (lot = {}) => {
  if (!lot || !isFinishedGoodsLot(lot)) return false;

  const sourceType = String(lot?.sourceType || "").trim().toLowerCase();
  const manufacturingStage = String(lot?.manufacturingStage || "")
    .trim()
    .toLowerCase();
  const skuType = getPackagedSkuType(lot);

  const hasChildRelationship =
    sourceType === "finished_package" ||
    manufacturingStage === "packaged_inventory" ||
    Boolean(lot?.packageRunId && lot?.parentLotId) ||
    lot?.package?.isPackaged === true;

  const hasPackageRunIdentity =
    Boolean(lot?.packageRunId) ||
    Boolean(lot?.parentLotId) ||
    sourceType === "finished_package";

  const hasValidSkuType = PACKAGED_SKU_TYPES.has(skuType);
  const hasPackageSize = getPackageSizeQuantity(lot) > 0;
  const hasAvailablePackages = getFinishedQtyNum(lot) > 0;

  return (
    hasChildRelationship &&
    hasPackageRunIdentity &&
    hasValidSkuType &&
    hasPackageSize &&
    hasAvailablePackages
  );
};

const buildPackagingDataForLot = (lot) => {
  if (!lot) return { ...DEMO_PACKAGING_LABEL_DATA };

  const built = buildPackagingLabelDataFromFinishedGood(lot);
  if (!isCapsulePackageLot(lot)) return built;

  const perCapsule = getApproxCapsuleLabel(lot, built);
  const totalWeight = stripApproxLabel(
    built?.totalWeight || lot?.labelMetadata?.totalWeight || lot?.totalWeight
  );

  return {
    ...built,
    perCapsule,
    totalWeight,
    approximatePerCapsule: true,
    approximateTotalWeight: false,
  };
};

export default function LabelPrintWrapper(props) {
  const location = useLocation();
  const canUsePostProcessLabels = props?.canUsePostProcessLabels !== false;
  const onSubscriptionFeatureBlocked =
    typeof props?.onSubscriptionFeatureBlocked === "function"
      ? props.onSubscriptionFeatureBlocked
      : () => false;

  const requestPostProcessLabelAccess = () => {
    if (canUsePostProcessLabels) return true;
    onSubscriptionFeatureBlocked({
      featureKey: SUBSCRIPTION_FEATURE_KEYS.POST_PROCESS_LABELS,
      actionLabel: "Preview or print Post Processing labels",
      supportingText:
        "Grow and cultivation labels remain available on every plan. Finished-inventory and packaged-SKU labels require Lab access.",
    });
    return false;
  };
  const requestedPackagingLotId = useMemo(
    () => new URLSearchParams(location.search).get("labelLotId") || "",
    [location.search]
  );
  const hasGrowsProp = Object.prototype.hasOwnProperty.call(props || {}, "grows");
  const hasLibraryProp = Object.prototype.hasOwnProperty.call(props || {}, "libraryItems");
  const hasFinishedGoodsProp = Object.prototype.hasOwnProperty.call(props || {}, "finishedGoods");

  const propGrows = hasGrowsProp ? props.grows || [] : undefined;
  const propLibraryItems = hasLibraryProp ? props.libraryItems || [] : undefined;
  const propFinishedGoods = hasFinishedGoodsProp ? props.finishedGoods || [] : undefined;

  const [fetchedGrows, setFetchedGrows] = useState([]);
  const [fetchedLibraryItems, setFetchedLibraryItems] = useState([]);
  const [fetchedFinishedGoods, setFetchedFinishedGoods] = useState([]);
  const [selectedPackagingLotId, setSelectedPackagingLotId] = useState("");
  const [templateId, setTemplateId] = useState(readTemplateId);
  const [uid, setUid] = useState(() => auth.currentUser?.uid || null);

  useEffect(() => {
    if (hasGrowsProp && hasLibraryProp && hasFinishedGoodsProp) return undefined;

    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid || null);
    });

    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, [hasFinishedGoodsProp, hasGrowsProp, hasLibraryProp]);

  useEffect(() => {
    const syncTemplate = () => setTemplateId(readTemplateId());

    const onStorage = (e) => {
      if (e.key === LOCAL_KEY_TEMPLATE) syncTemplate();
    };

    const onFocus = () => syncTemplate();
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncTemplate();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    let prev = readTemplateId();
    const iv = window.setInterval(() => {
      const cur = readTemplateId();
      if (cur !== prev) {
        prev = cur;
        setTemplateId(cur);
      }
    }, 1000);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    if (hasGrowsProp) return undefined;

    if (!uid) {
      setFetchedGrows([]);
      return undefined;
    }

    const growsRef = collection(db, "users", uid, "grows");
    const unsubGrows = onSnapshot(growsRef, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setFetchedGrows(items);
    });

    return () => {
      try {
        unsubGrows?.();
      } catch {}
    };
  }, [hasGrowsProp, uid]);

  useEffect(() => {
    if (hasLibraryProp) return undefined;

    if (!uid) {
      setFetchedLibraryItems([]);
      return undefined;
    }

    const libRef = collection(db, "users", uid, "library");
    const unsubLib = onSnapshot(libRef, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setFetchedLibraryItems(items);
    });

    return () => {
      try {
        unsubLib?.();
      } catch {}
    };
  }, [hasLibraryProp, uid]);

  useEffect(() => {
    if (hasFinishedGoodsProp) return undefined;

    if (!uid || !canUsePostProcessLabels) {
      setFetchedFinishedGoods([]);
      return undefined;
    }

    const lotsRef = collection(db, "users", uid, "materialLots");
    const unsubLots = onSnapshot(lotsRef, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setFetchedFinishedGoods(items);
    });

    return () => {
      try {
        unsubLots?.();
      } catch {}
    };
  }, [canUsePostProcessLabels, hasFinishedGoodsProp, uid]);

  const growsSource = hasGrowsProp ? propGrows : fetchedGrows;
  const librarySource = hasLibraryProp ? propLibraryItems : fetchedLibraryItems;
  const finishedGoodsSource = canUsePostProcessLabels
    ? hasFinishedGoodsProp
      ? propFinishedGoods
      : fetchedFinishedGoods
    : [];

  const activeGrows = useMemo(() => {
    return Array.isArray(growsSource) ? growsSource.filter(isActiveGrow) : [];
  }, [growsSource]);

  const activeLibrary = useMemo(() => {
    return Array.isArray(librarySource) ? librarySource.filter(isActiveLibraryItem) : [];
  }, [librarySource]);

  const finishedGoodsBuckets = useMemo(() => {
    const active = Array.isArray(finishedGoodsSource)
      ? finishedGoodsSource.filter(isActiveFinishedGood)
      : [];

    const printable = [];
    const blocked = [];

    for (const lot of active) {
      const eligibility = getFinishedLabelEligibility(lot);
      if (eligibility.printable) {
        printable.push(lot);
      } else {
        blocked.push({ ...lot, __labelBlockReason: eligibility.reason || "Blocked for labels" });
      }
    }

    return {
      active: active.slice().sort(sortLabelLots),
      printable: printable.sort(sortLabelLots),
      blocked: blocked.sort(sortLabelLots),
    };
  }, [finishedGoodsSource]);

  const packagingOptions = useMemo(
    () => finishedGoodsBuckets.printable.filter(isPackagedSkuChildLot),
    [finishedGoodsBuckets.printable]
  );

  useEffect(() => {
    if (!packagingOptions.length) {
      setSelectedPackagingLotId("");
      return;
    }

    setSelectedPackagingLotId((prev) => {
      if (requestedPackagingLotId && packagingOptions.some((lot) => lot.id === requestedPackagingLotId)) {
        return requestedPackagingLotId;
      }
      if (prev && packagingOptions.some((lot) => lot.id === prev)) return prev;
      return packagingOptions[0]?.id || "";
    });
  }, [packagingOptions, requestedPackagingLotId]);

  const selectedPackagingLot = useMemo(() => {
    if (!selectedPackagingLotId) return packagingOptions[0] || null;
    return packagingOptions.find((lot) => lot.id === selectedPackagingLotId) || packagingOptions[0] || null;
  }, [packagingOptions, selectedPackagingLotId]);

  const packagingLabelData = useMemo(
    () => buildPackagingDataForLot(selectedPackagingLot),
    [selectedPackagingLot]
  );

  const packagingLabelItems = useMemo(
    () =>
      packagingOptions.map((lot) => ({
        id: lot.id,
        name: getFinishedName(lot),
        data: buildPackagingDataForLot(lot),
        maxQuantity: Math.max(1, Math.floor(getFinishedQtyNum(lot) || 1)),
      })),
    [packagingOptions]
  );

  const packagingSourceLabel = selectedPackagingLot
    ? getFinishedName(selectedPackagingLot)
    : "No finished lot selected yet. Showing the blank template only.";

  const meta = templateMeta[templateId] || templateMeta["5160"];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">Labels — {meta.title}</div>
        <div className="text-xs opacity-70">
          {meta.title} — {meta.size} · {meta.note} ·{" "}
          <span className="font-medium">{activeGrows.length}</span> grow labels ·{" "}
          <span className="font-medium">{activeLibrary.length}</span> stored item labels ·{" "}
          <span className="font-medium">{finishedGoodsBuckets.printable.length}</span> printable finished inventory labels ·{" "}
          <span className="font-medium">{packagingOptions.length}</span> packaged SKU labels
          {finishedGoodsBuckets.blocked.length > 0 ? (
            <>
              {" "}· <span className="font-medium">{finishedGoodsBuckets.blocked.length}</span> blocked finished lots
            </>
          ) : null}
        </div>
      </div>

      {canUsePostProcessLabels ? (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-semibold">Packaging labels — Avery 5659</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Only packaged child SKUs created by a package run are eligible. Parent finished batches never appear here. Uses <span className="font-medium">public/Packaging Label.png</span> unchanged on Avery 5659 sheets with six 3×3 labels per US Letter page.
            </div>

          </div>

          {packagingOptions.length > 0 ? (
            <label className="space-y-1 text-sm min-w-[260px]">
              <span className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Packaged SKU
              </span>
              <select
                value={selectedPackagingLot?.id || ""}
                onChange={(e) => setSelectedPackagingLotId(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
              >
                {packagingOptions.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {getFinishedName(lot)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {packagingOptions.length > 0 ? (
          <PackagingLabelPreview
            data={packagingLabelData}
            sourceLabel={packagingSourceLabel}
            items={packagingLabelItems}
            selectedId={selectedPackagingLot?.id || ""}
            onSelectedIdChange={setSelectedPackagingLotId}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/40 px-4 py-8 text-center">
            <div className="font-semibold">No packaged SKU children are available to print.</div>
            <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Create a retail, sample, promo, or internal package run from a finished parent batch. Only the resulting packaged child lot will appear in the Avery 5659 printer.
            </div>
          </div>
        )}
      </div>

      ) : (
        <div
          className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/25 dark:text-violet-100"
          data-testid="postprocess-labels-locked"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="font-semibold">Post Processing labels require Lab access</div>
              <p className="mt-1 text-sm leading-6">
                Finished-inventory and packaged-SKU label previews and printing are locked on this
                plan. Grow, culture, stored-item, and other cultivation labels remain available
                below.
              </p>
            </div>
            <button
              type="button"
              onClick={requestPostProcessLabelAccess}
              className="rounded-full accent-bg px-4 py-2 text-sm font-semibold text-white"
            >
              View Lab access
            </button>
          </div>
        </div>
      )}

      <LabelPrint
        grows={activeGrows}
        libraryItems={activeLibrary}
        finishedGoods={canUsePostProcessLabels ? finishedGoodsBuckets.active : []}
        canUsePostProcessLabels={canUsePostProcessLabels}
        onSubscriptionFeatureBlocked={onSubscriptionFeatureBlocked}
      />
    </div>
  );
}
