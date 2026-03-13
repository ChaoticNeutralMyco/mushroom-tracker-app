// src/components/Grow/LabelPrintWrapper.jsx
import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebase-config";
import { collection, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import LabelPrint from "./LabelPrint";
import { isActiveGrow } from "../../lib/growFilters";
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

export default function LabelPrintWrapper(props) {
  const hasGrowsProp = Object.prototype.hasOwnProperty.call(props || {}, "grows");
  const hasLibraryProp = Object.prototype.hasOwnProperty.call(props || {}, "libraryItems");
  const hasFinishedGoodsProp = Object.prototype.hasOwnProperty.call(props || {}, "finishedGoods");

  const propGrows = hasGrowsProp ? props.grows || [] : undefined;
  const propLibraryItems = hasLibraryProp ? props.libraryItems || [] : undefined;
  const propFinishedGoods = hasFinishedGoodsProp ? props.finishedGoods || [] : undefined;

  const [fetchedGrows, setFetchedGrows] = useState([]);
  const [fetchedLibraryItems, setFetchedLibraryItems] = useState([]);
  const [fetchedFinishedGoods, setFetchedFinishedGoods] = useState([]);
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

    if (!uid) {
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
  }, [hasFinishedGoodsProp, uid]);

  const growsSource = hasGrowsProp ? propGrows : fetchedGrows;
  const librarySource = hasLibraryProp ? propLibraryItems : fetchedLibraryItems;
  const finishedGoodsSource = hasFinishedGoodsProp ? propFinishedGoods : fetchedFinishedGoods;

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

    return { active, printable, blocked };
  }, [finishedGoodsSource]);

  const meta = templateMeta[templateId] || templateMeta["5160"];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">Labels — {meta.title}</div>
        <div className="text-xs opacity-70">
          {meta.title} — {meta.size} · {meta.note} ·{" "}
          <span className="font-medium">{activeGrows.length}</span> grow labels ·{" "}
          <span className="font-medium">{activeLibrary.length}</span> stored item labels ·{" "}
          <span className="font-medium">{finishedGoodsBuckets.printable.length}</span> printable finished inventory labels
          {finishedGoodsBuckets.blocked.length > 0 ? (
            <>
              {" "}· <span className="font-medium">{finishedGoodsBuckets.blocked.length}</span> blocked finished lots
            </>
          ) : null}
        </div>
      </div>

      <LabelPrint
        grows={activeGrows}
        libraryItems={activeLibrary}
        finishedGoods={finishedGoodsBuckets.active}
      />
    </div>
  );
}
