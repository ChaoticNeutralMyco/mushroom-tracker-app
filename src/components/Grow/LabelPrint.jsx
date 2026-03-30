// src/components/Grow/LabelPrint.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { db, auth } from "../../firebase-config";
import { collection, getDocs } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import { isActiveGrow } from "../../lib/growFilters";
import { useConfirm } from "../ui/ConfirmDialog";
import {
  buildLotCode,
  getLabelMetadataSnapshot,
  getLotWorkflowState,
  getShelfLifeAction,
  isFinishedGoodsLot,
  isLotBlockedForUse,
} from "../../lib/postprocess";

/** ---------- Templates (no new files) ---------- */
const LABEL_TEMPLATES = {
  "5160": {
    id: "5160",
    name: 'Avery 5160 / 8160 (2.625" × 1")',
    cols: 3,
    rows: 10,
    labelW: "2.625in",
    labelH: "1in",
    gapX: "0in",
    gapY: "0in",
    sheetW: "8.5in",
    sheetH: "11in",
    padX: "0.1875in",
    padY: "0.5in",
  },
  "5167": {
    id: "5167",
    name: 'Avery 5167 (mini, 1.75" × 0.5")',
    cols: 4,
    rows: 20,
    labelW: "1.75in",
    labelH: "0.5in",
    gapX: "0in",
    gapY: "0in",
    sheetW: "8.5in",
    sheetH: "11in",
    padX: "0.25in",
    padY: "0.5in",
  },
};

/** ---------- Typography ---------- */
const T1_PT = 11;
const T2_PT = 7.5;
const F_PT = 6.7;

/** ---------- Watermark ---------- */
const WM_CANDIDATES = [
  "/labels-watermark.png",
  "/logo.png",
  "/logo512.png",
  "/logo192.png",
  "/android-chrome-192x192.png",
  "/favicon.png",
];
const LOGO_OPACITY = 0.18;
const LOGO_SCALE = 1.0;

/** ---------- localStorage keys ---------- */
const LOCAL_KEY_WATERMARK_ENABLED = "labels.watermark.enabled";
const LOCAL_KEY_WATERMARK_URL = "labels.watermark.url";
const LOCAL_KEY_STARTPOS = "labels.start.position";
const LOCAL_KEY_TEMPLATE = "labels.template";
const LOCAL_KEY_GRID = "labels.gridOverlay";
const LOCAL_KEY_SCALE = "labels.previewScale";
const LOCAL_KEY_CODE = "labels.codeType";
const LOCAL_KEY_SOURCE = "labels.source";

/** ---------- Helpers ---------- */
const toText = (v) => (v == null ? "" : String(v).trim());
const isoYYYYMMDD = (s) => /^\d{4}-\d{2}-\d{2}/.test(toText(s));
const looksLikeDateValue = (v) =>
  v instanceof Date ||
  (typeof v === "string" && isoYYYYMMDD(v)) ||
  (typeof v === "object" && v && typeof v.seconds === "number");

const normalizeDate10 = (v) => {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v && typeof v.seconds === "number") {
    const d = new Date(v.seconds * 1000);
    return d.toISOString().slice(0, 10);
  }
  const s = toText(v);
  if (isoYYYYMMDD(s)) return s.slice(0, 10);
  return "";
};

const getStrain = (g) =>
  toText(g?.strain || g?.strainName || g?.name || g?.title || g?.label) || "Unknown";

const getAbbrev = (g) => {
  const keys = ["abbreviation", "abbr", "code", "labelCode", "growCode", "batchCode", "subName"];
  for (const k of keys) {
    const v = toText(g?.[k]);
    if (v) return v;
  }
  return "";
};

const getInoc = (g) => {
  const explicit = g?.inoc || g?.inocDate || g?.inoculationDate || g?.inoculatedAt;
  if (looksLikeDateValue(explicit)) return normalizeDate10(explicit);

  const fb = g?.createdAt || g?.created_on || g?.startDate || g?.start;
  if (looksLikeDateValue(fb)) return normalizeDate10(fb);

  const isoInside =
    typeof g?.inoc === "string" && isoYYYYMMDD(g.inoc)
      ? g.inoc
      : typeof g?.inocDate === "string" && isoYYYYMMDD(g.inocDate)
        ? g.inocDate
        : "";

  return normalizeDate10(isoInside);
};

const getType = (g) => toText(g?.type ?? g?.growType ?? g?.container ?? g?.kind ?? g?.category);

/** ---------- Stored Items helpers ---------- */
const isActiveLibraryItem = (it) => {
  if (!it) return false;
  const archived = !!(it.archived || it.isArchived || it.deleted || it.trashed);
  if (archived) return false;
  const qty = Number(
    it.qty ?? it.quantity ?? it.count ?? it.amount ?? it.onHand ?? it.available ?? 0
  );
  if (!Number.isFinite(qty)) return true;
  return qty > 0;
};

const getLibStrain = (it) =>
  toText(it?.strainName || it?.strain || it?.name || it?.label || it?.title) || "Unknown";
const getLibSpecies = (it) =>
  toText(it?.scientificName || it?.species || it?.latinName || it?.genusSpecies) || "";
const getLibType = (it) => toText(it?.type || it?.itemType || it?.category || it?.kind || it?.form) || "";
const getLibQtyNum = (it) => {
  const v = it?.qty ?? it?.quantity ?? it?.count ?? it?.amount ?? it?.onHand ?? it?.available;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const getLibUnit = (it) => toText(it?.unit || it?.uom || it?.units) || "";
const getLibLocation = (it) =>
  toText(it?.location || it?.storageLocation || it?.storedAt || it?.bin || it?.shelf) || "";
const getLibAcquired = (it) => {
  const v = it?.acquiredAt || it?.acquiredOn || it?.dateAcquired || it?.createdAt;
  if (looksLikeDateValue(v)) return normalizeDate10(v);
  return "";
};

/** ---------- Finished goods helpers ---------- */
const isActiveFinishedGood = (it) => {
  if (!it) return false;
  if (!isFinishedGoodsLot(it)) return false;

  const archived =
    !!(it.archived || it.isArchived || it.deleted || it.trashed) ||
    String(it?.status || "").toLowerCase() === "archived" ||
    String(it?.status || "").toLowerCase() === "inactive" ||
    String(it?.status || "").toLowerCase() === "depleted";

  if (archived) return false;

  const qty = Number(it?.remainingQuantity ?? it?.quantity ?? it?.count ?? 0);
  return Number.isFinite(qty) ? qty > 0 : true;
};

const getFinishedName = (it) =>
  toText(it?.name || it?.batchName || it?.variant || it?.label || it?.title) || "Finished Lot";

const getFinishedTypeLabel = (it) => {
  const raw = toText(it?.finishedGoodType || it?.productType || it?.lotType).toLowerCase();
  if (raw === "capsule" || raw === "capsules") return "Capsules";
  if (raw === "gummy" || raw === "gummies") return "Gummies";
  if (raw === "chocolate" || raw === "chocolates") return "Chocolates";
  if (raw === "tincture" || raw === "tinctures") return "Tinctures";
  return toText(it?.finishedGoodType || it?.productType || it?.lotType) || "Finished Goods";
};

const getFinishedQtyNum = (it) => {
  const v = it?.remainingQuantity ?? it?.quantity ?? it?.count ?? it?.initialQuantity ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const getFinishedInitialQtyNum = (it) => {
  const v = it?.initialQuantity ?? it?.quantity ?? it?.count ?? it?.remainingQuantity ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const getFinishedUnitLabel = (it) => {
  return (
    toText(it?.displayUnitLabel || it?.unitLabel || it?.unit || it?.pieceLabelPlural || it?.pieceLabel) ||
    "units"
  );
};

const getFinishedBatchDate = (it) => {
  const v =
    it?.createdDate ||
    it?.updatedDate ||
    it?.date ||
    it?.createdAt ||
    it?.updatedAt ||
    it?.manufacturedAt;
  if (looksLikeDateValue(v)) return normalizeDate10(v);
  return "";
};

const getFinishedPrice = (it) => {
  const n = Number(it?.pricePerUnit ?? it?.pricing?.pricePerUnit ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const getFinishedMsrp = (it) => {
  const n = Number(it?.msrpPerUnit ?? it?.pricing?.suggestedMsrpPerUnit ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const getFinishedUnitCost = (it) => {
  const explicit =
    it?.costs?.unitCost ??
    it?.unitCost ??
    it?.costPerUnit ??
    it?.pricing?.unitCost ??
    0;
  const numeric = Number(explicit);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const total =
    it?.costs?.batchTotalCost ??
    it?.batchTotalCost ??
    it?.costs?.totalCost ??
    it?.totalCost ??
    0;
  const qty = getFinishedInitialQtyNum(it);
  const totalNum = Number(total);
  if (Number.isFinite(totalNum) && totalNum > 0 && qty > 0) return totalNum / qty;
  return 0;
};

const compactJoin = (parts = [], sep = " · ") =>
  (Array.isArray(parts) ? parts : []).map((part) => toText(part)).filter(Boolean).join(sep);

const getFinishedLabelSnapshot = (it) => getLabelMetadataSnapshot(it) || {};

const getFinishedLotCode = (it) => {
  const meta = getFinishedLabelSnapshot(it);
  if (meta.lotCode) return meta.lotCode;
  return buildLotCode({
    prefix: "CNM",
    productType: it?.finishedGoodType || it?.productType || it?.lotType || "lot",
    date: meta.packDate || getFinishedBatchDate(it),
    variant: it?.variant || it?.strain || getFinishedName(it),
    lotId: it?.id || it?.lotId || it?.batchId || "",
  });
};

const getFinishedPackDate = (it) => {
  const meta = getFinishedLabelSnapshot(it);
  return normalizeDate10(meta.packDate || getFinishedBatchDate(it) || it?.createdDate || it?.date || "");
};

const getFinishedBestByDate = (it) => {
  const meta = getFinishedLabelSnapshot(it);
  return normalizeDate10(meta.bestBy || meta.expirationDate || it?.shelfLife?.bestBy || it?.shelfLife?.expirationDate || "");
};

const getFinishedLabelDeclaration = (it) => {
  const meta = getFinishedLabelSnapshot(it);
  const warnings = Array.isArray(meta.warnings) ? meta.warnings : [];
  const allergens = Array.isArray(meta.allergens) ? meta.allergens : [];
  const ingredients = Array.isArray(meta.ingredients) ? meta.ingredients : [];
  const storage = toText(meta.storage);
  const footer = toText(meta.footer);

  const primary =
    compactJoin([
      warnings.length ? `Warn ${warnings.slice(0, 2).join("/")}` : "",
      allergens.length ? `Allergens ${allergens.slice(0, 2).join("/")}` : "",
      storage ? `Store ${storage}` : "",
    ]) ||
    (ingredients.length ? `Ingredients ${ingredients.slice(0, 3).join(", ")}` : "") ||
    footer;

  return primary;
};

const getFinishedLabelSupportTitle = (it) => {
  const meta = getFinishedLabelSnapshot(it);
  return [
    Array.isArray(meta.ingredients) && meta.ingredients.length
      ? `Ingredients: ${meta.ingredients.join(", ")}`
      : "",
    Array.isArray(meta.allergens) && meta.allergens.length
      ? `Allergens: ${meta.allergens.join(", ")}`
      : "",
    Array.isArray(meta.warnings) && meta.warnings.length
      ? `Warnings: ${meta.warnings.join(", ")}`
      : "",
    meta.storage ? `Storage: ${meta.storage}` : "",
    meta.footer ? `Footer: ${meta.footer}` : "",
    meta.bestBy ? `Best by: ${meta.bestBy}` : "",
    meta.expirationDate ? `Expiration: ${meta.expirationDate}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
      workflow,
      shelfAction: getShelfLifeAction(it),
    };
  }

  const shelfAction = String(getShelfLifeAction(it) || "").toLowerCase();
  if (shelfAction === "expired") {
    return { printable: false, reason: "Expired", workflow, shelfAction };
  }
  if (shelfAction === "do_not_sell") {
    return { printable: false, reason: "Do not sell", workflow, shelfAction };
  }

  return { printable: true, reason: "", workflow, shelfAction };
};

const formatMoneyShort = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `$${n.toFixed(2).replace(/\.00$/, "")}`;
};

const preloadOK = (url) =>
  new Promise((resolve) => {
    if (!url) {
      resolve(false);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });

const waitForIframeImages = async (doc) => {
  const images = Array.from(doc.images || []);
  if (!images.length) return;

  await Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) {
            resolve(true);
            return;
          }
          const done = () => resolve(true);
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        })
    )
  );
};

const safeOrigin = () => {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  if (typeof location !== "undefined" && location.origin) return location.origin;
  return "";
};

const buildAppUrl = (path, params) => {
  const origin = safeOrigin();
  if (!origin) {
    if (!params) return path;
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== "") sp.set(k, String(v));
    });
    const qs = sp.toString();
    return qs ? `${path}?${qs}` : path;
  }

  const url = new URL(path, origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    });
  }
  return url.toString();
};

function normalizeLabelSource(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "library") return "library";
  if (normalized === "finished" || normalized === "finished_goods") return "finished_goods";
  return "grows";
}

/** ---------- component ---------- */
function LabelPrint(props) {
  const confirm = useConfirm();
  const hasGrowsProp = Object.prototype.hasOwnProperty.call(props || {}, "grows");
  const propGrows = hasGrowsProp ? props.grows || [] : undefined;

  const hasLibraryProp = Object.prototype.hasOwnProperty.call(props || {}, "libraryItems");
  const propLibraryItems = hasLibraryProp ? props.libraryItems || [] : undefined;

  const hasFinishedGoodsProp = Object.prototype.hasOwnProperty.call(props || {}, "finishedGoods");
  const propFinishedGoods = hasFinishedGoodsProp ? props.finishedGoods || [] : undefined;

  const [uid, setUid] = useState(() => auth.currentUser?.uid || null);
  const location = useLocation();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid || null));
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, []);

  const [fetched, setFetched] = useState([]);
  const [fetchedLibrary, setFetchedLibrary] = useState([]);
  const [fetchedFinishedGoods, setFetchedFinishedGoods] = useState([]);

  const [templateId, setTemplateId] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_KEY_TEMPLATE) || "5160";
    } catch {}
    return "5160";
  });

  const template = LABEL_TEMPLATES[templateId] || LABEL_TEMPLATES["5160"];
  const COLS = template.cols;
  const ROWS = template.rows;
  const PER_SHEET = COLS * ROWS;

  const metrics = useMemo(() => {
    const isMini = templateId === "5167";
    const qrPx = isMini ? 26 : 56;
    const qrIn = isMini ? 0.26 : 0.6;
    const wmPx = isMini ? 20 : 56;
    const wmIn = isMini ? 0.22 : 0.55;
    const padIn = isMini ? 0.04 : 0.06;
    const qrMarginPx = 0;
    const qrMarginIn = 0;
    const contentPadRightPx = qrPx + qrMarginPx * 2;
    const contentPadBottomPx = Math.max(10, Math.round(qrPx * 0.55));
    const contentPadRightIn = qrIn + qrMarginIn * 2;
    const contentPadBottomIn = Math.max(padIn, qrIn * 0.55);

    return {
      qrPx,
      wmPx,
      qrMarginPx,
      qrIn,
      wmIn,
      padIn,
      qrMarginIn,
      contentPadRightPx,
      contentPadBottomPx,
      contentPadRightIn,
      contentPadBottomIn,
      labelTextColor: "#111827",
    };
  }, [templateId]);

  const [gridOverlay, setGridOverlay] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_KEY_GRID) === "1";
    } catch {}
    return false;
  });

  const [scalePct, setScalePct] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(LOCAL_KEY_SCALE) || "100", 10);
      return Number.isFinite(v) ? Math.min(150, Math.max(50, v)) : 100;
    } catch {}
    return 100;
  });

  const [codeType, setCodeType] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_KEY_CODE) || "qr";
    } catch {}
    return "qr";
  });

  const [source, setSource] = useState(() => {
    try {
      return normalizeLabelSource(localStorage.getItem(LOCAL_KEY_SOURCE) || "grows");
    } catch {}
    return "grows";
  });

  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search || "");
      if (!params.has("labelSource")) return;
      const requested = normalizeLabelSource(params.get("labelSource") || "grows");
      setSource(requested);
    } catch {
      // ignore bad label source query strings
    }
  }, [location.search]);

  const [watermarkEnabled, setWatermarkEnabled] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_KEY_WATERMARK_ENABLED) !== "0";
    } catch {}
    return true;
  });

  const [wmInput, setWmInput] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_KEY_WATERMARK_URL) || "";
    } catch {}
    return "";
  });

  const [wmUrl, setWmUrl] = useState("");
  const [wmTextFallback, setWmTextFallback] = useState(false);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [startRow, setStartRow] = useState(1);
  const [startCol, setStartCol] = useState(1);

  const printSheetsRef = useRef(null);
  const selectAllRef = useRef(null);
  const printFrameRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY_TEMPLATE, templateId);
    } catch {}
  }, [templateId]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY_GRID, gridOverlay ? "1" : "0");
    } catch {}
  }, [gridOverlay]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY_SCALE, String(scalePct));
    } catch {}
  }, [scalePct]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY_CODE, codeType);
    } catch {}
  }, [codeType]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY_SOURCE, source);
    } catch {}
  }, [source]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY_WATERMARK_ENABLED, watermarkEnabled ? "1" : "0");
    } catch {}
  }, [watermarkEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY_WATERMARK_URL, wmInput || "");
    } catch {}
  }, [wmInput]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LOCAL_KEY_STARTPOS) || "";
      const [r, c] = v.split(",").map((x) => parseInt(x, 10));
      if (Number.isFinite(r) && Number.isFinite(c)) {
        setStartRow(Math.max(1, Math.min(ROWS, r)));
        setStartCol(Math.max(1, Math.min(COLS, c)));
      }
    } catch {}
  }, [ROWS, COLS]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY_STARTPOS, `${startRow},${startCol}`);
    } catch {}
  }, [startRow, startCol]);

  useEffect(() => {
    if (hasGrowsProp || !uid) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(collection(db, "users", uid, "grows"));
        if (cancelled) return;
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setFetched(items.filter(isActiveGrow));
      } catch {
        if (!cancelled) setFetched([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasGrowsProp, uid]);

  useEffect(() => {
    if (hasLibraryProp || !uid) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(collection(db, "users", uid, "library"));
        if (cancelled) return;
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setFetchedLibrary(items.filter(isActiveLibraryItem));
      } catch {
        if (!cancelled) setFetchedLibrary([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasLibraryProp, uid]);

  useEffect(() => {
    if (hasFinishedGoodsProp || !uid) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(collection(db, "users", uid, "materialLots"));
        if (cancelled) return;
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setFetchedFinishedGoods(items.filter(isActiveFinishedGood));
      } catch {
        if (!cancelled) setFetchedFinishedGoods([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasFinishedGoodsProp, uid]);

  useEffect(() => {
    let abort = false;

    (async () => {
      let custom = "";
      try {
        custom = localStorage.getItem(LOCAL_KEY_WATERMARK_URL) || "";
      } catch {}

      const list = [wmInput || custom, ...(props.watermarkUrl ? [props.watermarkUrl] : []), ...WM_CANDIDATES]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i);

      for (const url of list) {
        const ok = await preloadOK(url);
        if (abort) return;
        if (ok) {
          setWmUrl(url);
          setWmTextFallback(false);
          return;
        }
      }

      setWmUrl("");
      setWmTextFallback(true);
    })();

    return () => {
      abort = true;
    };
  }, [props.watermarkUrl, wmInput]);

  useEffect(() => {
    return () => {
      if (printFrameRef.current?.parentNode) {
        try {
          printFrameRef.current.parentNode.removeChild(printFrameRef.current);
        } catch {}
      }
      printFrameRef.current = null;
    };
  }, []);

  const baseGrows = hasGrowsProp ? propGrows : fetched;
  const baseLibrary = hasLibraryProp ? propLibraryItems : fetchedLibrary;
  const baseFinishedGoods = hasFinishedGoodsProp ? propFinishedGoods : fetchedFinishedGoods;

  const allGrows = useMemo(() => baseGrows || [], [baseGrows]);
  const allLibrary = useMemo(() => baseLibrary || [], [baseLibrary]);
  const allFinishedGoods = useMemo(() => baseFinishedGoods || [], [baseFinishedGoods]);

  const finishedGoodsBuckets = useMemo(() => {
    const printable = [];
    const blocked = [];

    for (const lot of Array.isArray(allFinishedGoods) ? allFinishedGoods : []) {
      const eligibility = getFinishedLabelEligibility(lot);
      if (eligibility.printable) {
        printable.push(lot);
      } else {
        blocked.push({
          ...lot,
          __labelBlockReason: eligibility.reason || "Blocked for labels",
          __labelWorkflow: eligibility.workflow || getLotWorkflowState(lot),
          __labelShelfAction: eligibility.shelfAction || getShelfLifeAction(lot),
        });
      }
    }

    return { printable, blocked };
  }, [allFinishedGoods]);

  const allItems = useMemo(() => {
    if (source === "library") return allLibrary;
    if (source === "finished_goods") return finishedGoodsBuckets.printable;
    return allGrows;
  }, [source, allLibrary, finishedGoodsBuckets.printable, allGrows]);

  useEffect(() => {
    if (!allItems.length) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds((prev) => {
      if (prev.size) {
        const next = new Set([...prev].filter((id) => allItems.some((x) => x.id === id)));
        return next.size ? next : new Set(allItems.map((x) => x.id));
      }
      return new Set(allItems.map((x) => x.id));
    });
  }, [allItems]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    const all = allItems.length;
    const sel = selectedIds.size;
    selectAllRef.current.indeterminate = sel > 0 && sel < all;
  }, [allItems.length, selectedIds]);

  const sheetStyle = {
    width: template.sheetW,
    height: template.sheetH,
    paddingLeft: template.padX,
    paddingRight: template.padX,
    paddingTop: template.padY,
    paddingBottom: template.padY,
    boxSizing: "border-box",
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: `repeat(${COLS}, ${template.labelW})`,
    gridAutoRows: template.labelH,
    columnGap: template.gapX,
    rowGap: template.gapY,
    transform: `scale(${scalePct / 100})`,
    transformOrigin: "top left",
  };

  const labelBoxStyle = {
    width: template.labelW,
    height: template.labelH,
    boxSizing: "border-box",
    border: gridOverlay ? "1px dashed rgba(0,0,0,0.25)" : "1px solid transparent",
    position: "relative",
    overflow: "hidden",
    background: "white",
    color: metrics.labelTextColor,
  };

  const checkboxStyle = { position: "absolute", top: 3, left: 3, zIndex: 10 };
  const selectedOverlay = (selected) => ({
    position: "absolute",
    inset: 0,
    border: selected ? "2px solid #22c55e" : "none",
    borderRadius: "2px",
    pointerEvents: "none",
    zIndex: 9,
  });

  const sourceLabel =
    source === "library"
      ? "Stored Items"
      : source === "finished_goods"
        ? "Finished Inventory"
        : "Grows";

  const finishedLabelStats = useMemo(() => ({
    printable: finishedGoodsBuckets.printable.length,
    blocked: finishedGoodsBuckets.blocked.length,
  }), [finishedGoodsBuckets.blocked.length, finishedGoodsBuckets.printable.length]);

  const getLabelData = (x) => {
    if (source === "library") {
      const strain = getLibStrain(x);
      const species = getLibSpecies(x);
      const kind = getLibType(x);
      const qty = getLibQtyNum(x);
      const unit = getLibUnit(x);
      const loc = getLibLocation(x);
      const acq = getLibAcquired(x);

      let f2 = `Qty: ${qty}${unit ? ` ${unit}` : ""}`;
      if (loc) f2 += ` · ${loc}`;
      if (acq) f2 += ` · ${acq}`;

      const stamp =
        normalizeDate10(
          x?.updatedAt ||
            x?.updated_on ||
            x?.modifiedAt ||
            x?.createdAt ||
            x?.acquiredAt ||
            x?.acquiredOn ||
            ""
        ) || x.id;

      return {
        t1: strain,
        t2: species,
        f1: `Type: ${kind || "—"}`,
        f2,
        codeValue: buildAppUrl("/", {
          tab: "strains",
          lib: x.id,
          _: `lib-${stamp}`,
        }),
        t1Title: strain,
        t2Title: species || "",
        f1Title: kind || "",
        f2Title: [f2, x?.notes ? `Notes: ${toText(x.notes)}` : ""].filter(Boolean).join("\n"),
      };
    }

    if (source === "finished_goods") {
      const labelMeta = getFinishedLabelSnapshot(x);
      const workflow = getLotWorkflowState(x);
      const shelfAction = getShelfLifeAction(x);
      const name = getFinishedName(x);
      const variant = toText(x?.variant);
      const productType = getFinishedTypeLabel(x);
      const qty = getFinishedQtyNum(x);
      const unitLabel = getFinishedUnitLabel(x);
      const batchDate = getFinishedBatchDate(x);
      const batchName = toText(x?.batchName || x?.sourceBatchId);
      const mgPerUnit = Number(x?.mgPerUnit || 0);
      const bottleSize = Number(x?.bottleSize || 0);
      const bottleSizeUnit = toText(x?.bottleSizeUnit) || "mL";
      const price = formatMoneyShort(getFinishedPrice(x));
      const msrp = formatMoneyShort(getFinishedMsrp(x));
      const unitCost = formatMoneyShort(getFinishedUnitCost(x));
      const lotCode = getFinishedLotCode(x);
      const packDate = getFinishedPackDate(x);
      const bestBy = getFinishedBestByDate(x);
      const declarationLine = getFinishedLabelDeclaration(x);
      const supportTitle = getFinishedLabelSupportTitle(x);

      const primaryName = variant || name;
      const t1 = lotCode || primaryName;
      const t2Base = [primaryName && primaryName !== t1 ? primaryName : "", productType, toText(x?.strain)].filter(Boolean).join(" · ");

      const f1Parts = [];
      if (packDate) f1Parts.push(`Pack ${packDate}`);
      if (bestBy) f1Parts.push(`BB ${bestBy}`);
      if (mgPerUnit > 0) f1Parts.push(`${mgPerUnit} mg`);
      if ((x?.productType === "tincture" || x?.finishedGoodType === "tincture" || x?.lotType === "tinctures") && bottleSize > 0) {
        f1Parts.push(`${bottleSize} ${bottleSizeUnit}`);
      }
      if (!f1Parts.length && batchDate) f1Parts.push(`Made ${batchDate}`);
      if (!f1Parts.length) f1Parts.push(`Qty ${qty} ${unitLabel}`);
      const f1 = f1Parts.join(" · ");

      const f2 =
        declarationLine ||
        compactJoin([batchName ? `Batch ${batchName}` : "", `Qty ${qty} ${unitLabel}`]) ||
        `Qty ${qty} ${unitLabel}`;

      const stamp =
        normalizeDate10(
          x?.updatedAt ||
            x?.createdAt ||
            x?.updatedDate ||
            x?.createdDate ||
            x?.date ||
            ""
        ) || x.id;

      return {
        t1,
        t2: t2Base,
        f1,
        f2,
        codeValue: buildAppUrl("/", {
          tab: "postprocess",
          finished: x.id,
          _: `fg-${stamp}`,
        }),
        t1Title: [
          `Lot code: ${lotCode}`,
          primaryName && primaryName !== t1 ? `Name: ${primaryName}` : name ? `Name: ${name}` : "",
          variant ? `Variant: ${variant}` : "",
        ].filter(Boolean).join("\n"),
        t2Title: [
          productType ? `Type: ${productType}` : "",
          x?.strain ? `Strain: ${x.strain}` : "",
          workflow.releaseRequired ? `Release: ${workflow.releaseStatus || "released"}` : "Release: not required",
          workflow.blocked ? `Workflow block: ${workflow.blockReason || "Blocked"}` : "",
          shelfAction ? `Shelf action: ${String(shelfAction).replace(/_/g, " ")}` : "",
        ].filter(Boolean).join("\n"),
        f1Title: [
          packDate ? `Pack date: ${packDate}` : "",
          bestBy ? `Best by: ${bestBy}` : "",
          batchDate ? `Batch date: ${batchDate}` : "",
          batchName ? `Batch: ${batchName}` : "",
          mgPerUnit > 0 ? `Potency: ${mgPerUnit} mg per unit` : "",
          bottleSize > 0 ? `Bottle size: ${bottleSize} ${bottleSizeUnit}` : "",
          `Remaining: ${qty} ${unitLabel}`,
        ].filter(Boolean).join("\n"),
        f2Title: [
          supportTitle,
          price ? `Price per unit: ${price}` : "",
          msrp ? `Suggested MSRP: ${msrp}` : "",
          unitCost ? `Unit cost: ${unitCost}` : "",
          labelMeta.footer ? `Footer: ${labelMeta.footer}` : "",
          labelMeta.storage ? `Storage: ${labelMeta.storage}` : "",
        ].filter(Boolean).join("\n"),
      };
    }

    const strain = getStrain(x);
    const sub = getAbbrev(x);
    const type = getType(x);
    const inoc = getInoc(x);

    return {
      t1: sub || strain,
      t2: sub ? strain : "",
      f1: `Type: ${type || "—"}`,
      f2: `Inoc: ${inoc || "—"}`,
      codeValue: buildAppUrl(`/quick/${encodeURIComponent(x.id)}`),
      t1Title: sub || strain,
      t2Title: sub ? strain : "",
      f1Title: type || "",
      f2Title: inoc || "",
      isGrowWithAbbrev: Boolean(sub),
    };
  };

  const buildPrintHTML = (sheetsInnerHTML) => {
    const contentPadR = metrics.padIn + metrics.contentPadRightIn;
    const contentPadB = metrics.padIn + metrics.contentPadBottomIn;

    const css = `
      @page { size: letter; margin: 0; }
      html, body { margin: 0; padding: 0; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }

      .sheet { width: ${template.sheetW}; height: ${template.sheetH}; padding: ${template.padY} ${template.padX}; box-sizing: border-box; page-break-after: always; }
      .grid { display: grid; grid-template-columns: repeat(${COLS}, ${template.labelW}); grid-auto-rows: ${template.labelH}; column-gap: ${template.gapX}; row-gap: ${template.gapY}; }

      .label { width: ${template.labelW}; height: ${template.labelH}; box-sizing: border-box; overflow: hidden; position: relative; background: white; color: #111827; }
      .content { width: 100%; height: 100%; box-sizing: border-box; position: relative; padding: ${metrics.padIn}in ${contentPadR}in ${contentPadB}in ${metrics.padIn}in; color: #111827; }

      .wm { position: absolute; left: 50%; top: 50%; width: ${metrics.wmIn}in; height: ${metrics.wmIn}in; object-fit: contain; opacity: ${LOGO_OPACITY}; transform: translate(-50%, -50%) scale(${LOGO_SCALE}); transform-origin: center; z-index: 0; }
      .wmtxt { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font-weight: 900; font-size: 10px; opacity: ${LOGO_OPACITY}; z-index: 0; }

      .t1 { font-weight: 800; font-size: ${T1_PT}pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #111827; position: relative; z-index: 1; }
      .t2 { margin-top: 1px; font-weight: 600; font-size: ${T2_PT}pt; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.85; color: #111827; position: relative; z-index: 1; }
      .fields { margin-top: 2px; font-size: ${F_PT}pt; line-height: 1.05; opacity: 0.85; color: #111827; position: relative; z-index: 1; }
      .f { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      .qr { position: absolute; right: 0; bottom: 0; width: ${metrics.qrIn}in; height: ${metrics.qrIn}in; display: flex; align-items: center; justify-content: center; z-index: 2; }
      .qr svg { width: ${metrics.qrIn}in !important; height: ${metrics.qrIn}in !important; }
    `;

    return `<!doctype html>
      <html>
        <head><meta charset="utf-8" /><title>Print Labels</title><style>${css}</style></head>
        <body>${sheetsInnerHTML}</body>
      </html>
    `;
  };

  const printNow = async () => {
    if (!selectedIds.size) {
      await confirm.alert({
        title: "Nothing selected",
        message: "Select at least one label to print.",
        confirmLabel: "OK",
      });
      return;
    }

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const sheetsEl = printSheetsRef.current;
    if (!sheetsEl) {
      await confirm.alert({
        title: "Print preview missing",
        message: "Print sheets not found.",
        confirmLabel: "OK",
      });
      return;
    }

    if (printFrameRef.current?.parentNode) {
      try {
        printFrameRef.current.parentNode.removeChild(printFrameRef.current);
      } catch {}
      printFrameRef.current = null;
    }

    const html = buildPrintHTML(sheetsEl.innerHTML);
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";

    document.body.appendChild(iframe);
    printFrameRef.current = iframe;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      await confirm.alert({
        title: "Print frame unavailable",
        message: "Unable to open print frame.",
        confirmLabel: "OK",
      });
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    await new Promise((resolve) => {
      if (iframe.contentWindow?.document?.readyState === "complete") {
        resolve(true);
        return;
      }
      iframe.onload = () => resolve(true);
      setTimeout(() => resolve(true), 250);
    });

    await waitForIframeImages(doc);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const cleanup = () => {
      if (iframe.parentNode) {
        try {
          iframe.parentNode.removeChild(iframe);
        } catch {}
      }
      if (printFrameRef.current === iframe) {
        printFrameRef.current = null;
      }
    };

    try {
      iframe.contentWindow?.focus();
      if (iframe.contentWindow) {
        iframe.contentWindow.onafterprint = cleanup;
      }
      iframe.contentWindow?.print();
      setTimeout(cleanup, 2000);
    } catch {
      cleanup();
      await confirm.alert({
        title: "Print failed",
        message: "Print failed to open.",
        confirmLabel: "OK",
      });
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (checked) => {
    if (checked) setSelectedIds(new Set(allItems.map((x) => x.id)));
    else setSelectedIds(new Set());
  };

  return (
    <div className="px-6 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-400">
          {LABEL_TEMPLATES[templateId]?.name || "Avery 5160 / 8160"} · {sourceLabel} ·{" "}
          {allItems.length} labels
          {source === "finished_goods" ? (
            <>
              {" "}· {finishedLabelStats.printable} printable · {finishedLabelStats.blocked} blocked
            </>
          ) : null}
        </div>

        <div className="inline-flex flex-wrap items-center gap-4">
          <div className="inline-flex items-center gap-2">
            <span className="text-sm">Source</span>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              value={source}
              onChange={(e) => setSource(normalizeLabelSource(e.target.value))}
            >
              <option value="grows">Grows</option>
              <option value="library">Stored Items</option>
              <option value="finished_goods">Finished Inventory</option>
            </select>
          </div>

          <div className="inline-flex items-center gap-2">
            <span className="text-sm">Template</span>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              value={templateId}
              onChange={(e) => {
                const next = e.target.value === "5167" ? "5167" : "5160";
                setTemplateId(next);
                setStartRow(1);
                setStartCol(1);
              }}
            >
              <option value="5160">Avery 5160 / 8160</option>
              <option value="5167">Avery 5167 (mini)</option>
            </select>
          </div>

          <div className="inline-flex items-center gap-2">
            <span className="text-sm">Start at</span>
            <label className="text-xs opacity-70">Row</label>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              value={startRow}
              onChange={(e) =>
                setStartRow(Math.max(1, Math.min(ROWS, parseInt(e.target.value || "1", 10))))
              }
            >
              {Array.from({ length: ROWS }, (_, i) => i + 1).map((n) => (
                <option key={`r-${n}`} value={n}>
                  {n}
                </option>
              ))}
            </select>

            <label className="text-xs opacity-70">Col</label>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              value={startCol}
              onChange={(e) =>
                setStartCol(Math.max(1, Math.min(COLS, parseInt(e.target.value || "1", 10))))
              }
            >
              {Array.from({ length: COLS }, (_, i) => i + 1).map((n) => (
                <option key={`c-${n}`} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <label className="inline-flex items-center gap-2 select-none">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="h-4 w-4 align-middle"
              checked={allItems.length > 0 && selectedIds.size === allItems.length}
              onChange={(e) => toggleSelectAll(e.target.checked)}
              aria-label="select-all"
            />
            <span className="text-sm">
              Select all
              <span className="ml-2 rounded bg-zinc-200/50 px-1 py-[1px] text-xs text-zinc-600">
                {selectedIds.size}/{allItems.length} selected
              </span>
            </span>
          </label>

          <label className="inline-flex items-center gap-2 select-none">
            <input
              type="checkbox"
              className="h-4 w-4 align-middle"
              checked={gridOverlay}
              onChange={(e) => setGridOverlay(e.target.checked)}
            />
            <span className="text-sm">Grid</span>
          </label>

          <div className="inline-flex items-center gap-2">
            <span className="text-sm">Scale</span>
            <input
              type="range"
              min={50}
              max={150}
              value={scalePct}
              onChange={(e) => setScalePct(parseInt(e.target.value, 10))}
            />
            <span className="text-xs opacity-70 w-10 text-right">{scalePct}%</span>
          </div>

          <div className="inline-flex items-center gap-2">
            <span className="text-sm">Code</span>
            <select
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
              value={codeType}
              onChange={(e) => setCodeType(e.target.value === "none" ? "none" : "qr")}
            >
              <option value="qr">QR</option>
              <option value="none">None</option>
            </select>
          </div>

          <label className="inline-flex items-center gap-2 select-none">
            <input
              type="checkbox"
              className="h-4 w-4 align-middle"
              checked={watermarkEnabled}
              onChange={(e) => setWatermarkEnabled(e.target.checked)}
            />
            <span className="text-sm">Watermark</span>
          </label>

          <div className="inline-flex items-center gap-2">
            <span className="text-sm">WM URL</span>
            <input
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm w-56"
              placeholder="optional override"
              value={wmInput}
              onChange={(e) => setWmInput(e.target.value)}
            />
          </div>

          <button
            onClick={printNow}
            className="inline-flex items-center gap-2 rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      {source === "finished_goods" && finishedGoodsBuckets.blocked.length > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-medium">Blocked finished lots are excluded from sellable label printing.</div>
          <div className="mt-1 text-xs text-amber-800">
            Released finished lots can print labels here. Quarantined, recalled, on-hold, pending-release, or do-not-sell lots stay out of the printable set.
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {finishedGoodsBuckets.blocked.slice(0, 9).map((lot) => (
              <div key={`blocked-${lot.id}`} className="rounded border border-amber-200 bg-white/70 px-3 py-2">
                <div className="font-medium">{getFinishedName(lot)}</div>
                <div className="text-xs opacity-80">{lot.__labelBlockReason || "Blocked for labels"}</div>
              </div>
            ))}
          </div>
          {finishedGoodsBuckets.blocked.length > 9 ? (
            <div className="mt-2 text-xs text-amber-800">
              Showing 9 of {finishedGoodsBuckets.blocked.length} blocked finished lots.
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="rounded-lg border border-zinc-200 bg-white p-3 overflow-auto"
        style={{ maxHeight: "70vh" }}
      >
        <div style={sheetStyle}>
          <div style={gridStyle}>
            {Array.from({
              length: Math.max(0, Math.min(PER_SHEET - 1, (startRow - 1) * COLS + (startCol - 1))),
            }).map((_, i) => (
              <div key={`blank-${i}`} style={labelBoxStyle} aria-hidden="true" />
            ))}

            {allItems.map((x) => {
              const d = getLabelData(x);
              const selected = selectedIds.has(x.id);

              const wmImgStyle = {
                position: "absolute",
                left: "50%",
                top: "50%",
                width: metrics.wmPx,
                height: metrics.wmPx,
                objectFit: "contain",
                opacity: LOGO_OPACITY,
                transform: `translate(-50%, -50%) scale(${LOGO_SCALE})`,
                transformOrigin: "center",
                pointerEvents: "none",
                zIndex: 0,
              };

              const wmTextStyle = {
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                fontWeight: 900,
                fontSize: 10,
                opacity: LOGO_OPACITY,
                pointerEvents: "none",
                color: metrics.labelTextColor,
                zIndex: 0,
              };

              const contentStyle = {
                position: "relative",
                width: "100%",
                height: "100%",
                boxSizing: "border-box",
                padding: 4,
                paddingRight: 4 + metrics.contentPadRightPx,
                paddingBottom: 4 + metrics.contentPadBottomPx,
              };

              const t1Style = {
                fontWeight: 800,
                fontSize: `${T1_PT}pt`,
                lineHeight: 1.05,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: metrics.labelTextColor,
                position: "relative",
                zIndex: 1,
              };

              const t2Style = {
                marginTop: 1,
                fontWeight: 600,
                fontSize: `${T2_PT}pt`,
                lineHeight: 1.05,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                opacity: 0.85,
                color: metrics.labelTextColor,
                position: "relative",
                zIndex: 1,
              };

              const fStyle = {
                marginTop: 2,
                fontSize: `${F_PT}pt`,
                lineHeight: 1.05,
                opacity: 0.85,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: metrics.labelTextColor,
                position: "relative",
                zIndex: 1,
              };

              const qrStyle = {
                position: "absolute",
                right: 0,
                bottom: 0,
                width: metrics.qrPx,
                height: metrics.qrPx,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 5,
                pointerEvents: "none",
              };

              return (
                <div
                  key={x.id}
                  style={labelBoxStyle}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSelect(x.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSelect(x.id);
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    style={checkboxStyle}
                    checked={selected}
                    onChange={() => toggleSelect(x.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`select-${x.id}`}
                  />
                  <div style={selectedOverlay(selected)} />

                  <div style={contentStyle}>
                    {watermarkEnabled ? (
                      wmUrl ? (
                        <img src={wmUrl} alt="" style={wmImgStyle} />
                      ) : wmTextFallback ? (
                        <div style={wmTextStyle}>CN</div>
                      ) : null
                    ) : null}

                    <div
                      style={t1Style}
                      title={d.t1Title || d.t1}
                      data-testid={d.isGrowWithAbbrev ? "label-abbr" : "label-title"}
                    >
                      {d.t1}
                    </div>

                    {d.t2 ? (
                      <div style={t2Style} title={d.t2Title || d.t2} data-testid="label-strain">
                        {d.t2}
                      </div>
                    ) : (
                      <div style={{ ...t2Style, opacity: 0 }} aria-hidden="true">
                        &nbsp;
                      </div>
                    )}

                    <div className="mt-[1px]">
                      <div style={fStyle} title={d.f1Title || ""} data-testid="label-type">
                        {d.f1}
                      </div>
                      <div style={fStyle} title={d.f2Title || ""} data-testid="label-inoc">
                        {d.f2}
                      </div>
                    </div>
                  </div>

                  {codeType === "qr" ? (
                    <div style={qrStyle} aria-label="QR code">
                      <QRCodeSVG
                        value={d.codeValue}
                        width={metrics.qrPx}
                        height={metrics.qrPx}
                        includeMargin
                        level="M"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        ref={printSheetsRef}
        style={{ position: "absolute", left: "-10000px", top: 0, visibility: "hidden" }}
        aria-hidden
        id="sheets"
      >
        {(() => {
          const pages = [];
          const items = Array.from(selectedIds)
            .map((id) => allItems.find((g) => g.id === id))
            .filter(Boolean);

          const prefill = Math.max(
            0,
            Math.min(PER_SHEET - 1, (startRow - 1) * COLS + (startCol - 1))
          );

          const makeLabel = (x, key) => {
            const d = getLabelData(x);
            return (
              <div key={key} className="label">
                <div className="content">
                  {watermarkEnabled ? (
                    wmUrl ? (
                      <img src={wmUrl} alt="" className="wm" />
                    ) : wmTextFallback ? (
                      <div className="wmtxt">CN</div>
                    ) : null
                  ) : null}

                  <div
                    className="t1"
                    title={d.t1Title || d.t1}
                    data-testid={d.isGrowWithAbbrev ? "label-abbr" : "label-title"}
                  >
                    {d.t1}
                  </div>

                  {d.t2 ? (
                    <div className="t2" title={d.t2Title || d.t2} data-testid="label-strain">
                      {d.t2}
                    </div>
                  ) : (
                    <div className="t2" style={{ opacity: 0 }} aria-hidden="true">
                      &nbsp;
                    </div>
                  )}

                  <div className="fields">
                    <div className="f" title={d.f1Title || ""} data-testid="label-type">
                      {d.f1}
                    </div>
                    <div className="f" title={d.f2Title || ""} data-testid="label-inoc">
                      {d.f2}
                    </div>
                  </div>
                </div>

                {codeType === "qr" ? (
                  <div className="qr" aria-label="QR code">
                    <QRCodeSVG value={d.codeValue} width={120} height={120} includeMargin level="M" />
                  </div>
                ) : null}
              </div>
            );
          };

          const blanks = Array.from({ length: prefill }, (_, i) => (
            <div key={`blank-${i}`} className="label" />
          ));

          let page = [...blanks];
          let countOnPage = blanks.length;

          for (const item of items) {
            page.push(makeLabel(item, `g-${item.id}-${countOnPage}`));
            countOnPage += 1;
            if (countOnPage === PER_SHEET) {
              pages.push(
                <div key={`sheet-${pages.length}`} className="sheet">
                  <div className="grid">{page}</div>
                </div>
              );
              page = [];
              countOnPage = 0;
            }
          }

          if (page.length) {
            pages.push(
              <div key={`sheet-${pages.length}`} className="sheet">
                <div className="grid">{page}</div>
              </div>
            );
          }

          return pages;
        })()}
      </div>
    </div>
  );
}

export default LabelPrint;