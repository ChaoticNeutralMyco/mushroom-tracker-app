// src/components/recipes/COGManager.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "../../firebase-config";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { saveAs } from "file-saver";
import Papa from "papaparse";
import {
  PlusCircle,
  Trash2,
  ExternalLink,
  FileDown,
  Check,
  Edit3,
  X,
  AlertTriangle,
  Sparkles,
  ScanLine,
  Lock,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Package,
  DollarSign,
  Factory,
  Archive,
} from "lucide-react";
import { useConfirm } from "../ui/ConfirmDialog";
import {
  decrementCleanPending,
  scanArchivesForDirty,
} from "../../lib/clean-queue";

const SUPPLY_TYPES = [
  "substrate",
  "container",
  "grow-container",
  "tool",
  "labor",
  "packaging",
  "ingredient",
  "lab-consumable",
  "sanitation",
];

const LEGACY_SUPPLY_TYPES = ["carrier", "supplement"];

const UNITS = [
  "count",
  "piece",
  "bag",
  "syringe",
  "capsule",
  "bottle",
  "g",
  "mg",
  "kg",
  "oz",
  "ml",
  "liter",
  "lbs",
  "hour",
];

const byName = (a, b) =>
  String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
    sensitivity: "base",
  });

const DEFAULT_NEW = {
  name: "",
  purchaseUnitCost: "",
  purchaseUnitSize: "",
  purchaseQuantity: "",
  cost: "",
  type: "",
  unit: "",
  quantity: "",
  reorderLink: "",
  lowStockThreshold: "",
};

function money(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <Icon size={14} />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>
      ) : null}
    </div>
  );
}

export default function COGManager() {
  const confirm = useConfirm();

  const [supplies, setSupplies] = useState([]);
  const [restockAmounts, setRestockAmounts] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [expandedAudit, setExpandedAudit] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const nameRef = useRef(null);
  const [pendingClean, setPendingClean] = useState({});
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let unsubs = [];
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      unsubs.forEach((fn) => fn && fn());
      unsubs = [];

      if (!u) {
        setSupplies([]);
        setAuditLogs([]);
        setPendingClean({});
        return;
      }

      const supCol = collection(db, "users", u.uid, "supplies");
      const auditCol = collection(db, "users", u.uid, "supply_audits");
      const cleanCol = collection(db, "users", u.uid, "clean_queue");

      const unsub1 = onSnapshot(supCol, (snap) => {
        setSupplies(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byName)
        );
      });

      const unsub2 = onSnapshot(auditCol, (snap) => {
        setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      });

      const unsub3 = onSnapshot(cleanCol, (snap) => {
        const map = {};
        snap.forEach((d) => {
          const data = d.data();
          map[d.id] = Number(data?.pending || 0);
        });
        setPendingClean(map);
      });

      unsubs.push(unsub1, unsub2, unsub3);
    });

    return () => {
      unsubAuth();
      unsubs.forEach((fn) => fn && fn());
    };
  }, []);

  const logAudit = async (supplyId, action, amount, note = "") => {
    const user = auth.currentUser;
    if (!user) return;
    await addDoc(collection(db, "users", user.uid, "supply_audits"), {
      supplyId,
      action,
      amount,
      note,
      unitCostApplied: null,
      totalCostApplied: null,
      unit: null,
      timestamp: Timestamp.now().toDate().toISOString(),
    });
  };

  const startAdd = () => {
    setEditingId("NEW");
    setEditRow({ ...DEFAULT_NEW });
    setTimeout(() => nameRef.current?.focus?.(), 0);
  };

  const parseNumericInput = (value, fallback = 0) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const formatInputNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : "";
  };

  const derivePurchaseModel = (values) => {
    const enteredCost = parseNumericInput(values?.purchaseUnitCost ?? values?.cost, 0);
    const enteredSize = parseFloat(values?.purchaseUnitSize);
    const enteredQty = parseFloat(values?.purchaseQuantity ?? values?.quantity);

    const hasPackageSize = Number.isFinite(enteredSize) && enteredSize > 0;
    const enteredCount =
      Number.isFinite(enteredQty) && enteredQty > 0 ? enteredQty : 0;

    if (hasPackageSize) {
      const lockedUnitCost = enteredCost / enteredSize;
      return {
        mode: "packaged",
        purchaseUnitCost: enteredCost,
        purchaseUnitSize: enteredSize,
        purchaseQuantity: enteredCount,
        lockedUnitCost: Number.isFinite(lockedUnitCost) ? lockedUnitCost : 0,
        derivedQuantity: enteredSize * enteredCount,
        purchaseTotal: enteredCost * enteredCount,
      };
    }

    const lockedUnitCost = enteredCount > 0 ? enteredCost / enteredCount : 0;
    return {
      mode: "legacy-total",
      purchaseUnitCost: enteredCost,
      purchaseUnitSize: 0,
      purchaseQuantity: enteredCount,
      lockedUnitCost: Number.isFinite(lockedUnitCost) ? lockedUnitCost : 0,
      derivedQuantity: enteredCount,
      purchaseTotal: enteredCost,
    };
  };

  const hydrateEditRow = (supply) => {
    const hasStoredPackageSize = Number(supply?.purchaseUnitSize || 0) > 0;

    if (hasStoredPackageSize) {
      const storedPackageSize = Number(supply.purchaseUnitSize || 0) || 0;
      const storedPackageQty =
        Number(supply.purchaseQuantity || 0) ||
        (storedPackageSize > 0
          ? Number(supply.lastPurchaseQty || supply.quantity || 0) /
            storedPackageSize
          : 0);
      const storedPackageCost =
        Number(supply.purchaseUnitCost || 0) ||
        (Number(supply.cost || 0) || 0) * storedPackageSize;

      return {
        ...supply,
        purchaseUnitCost: formatInputNumber(storedPackageCost),
        purchaseUnitSize: formatInputNumber(storedPackageSize),
        purchaseQuantity: formatInputNumber(storedPackageQty),
        quantity: formatInputNumber(Number(supply.quantity || 0) || 0),
        lowStockThreshold: formatInputNumber(
          Number(supply.lowStockThreshold || 0) || 0
        ),
      };
    }

    const legacyQty = Number(supply?.lastPurchaseQty || supply?.quantity || 0) || 0;
    const legacyTotal = Number.isFinite(Number(supply?.lastPurchaseTotal))
      ? Number(supply.lastPurchaseTotal)
      : (Number(supply?.cost || 0) || 0) * legacyQty;

    return {
      ...supply,
      purchaseUnitCost: formatInputNumber(legacyTotal),
      purchaseUnitSize: "",
      purchaseQuantity: formatInputNumber(legacyQty),
      quantity: formatInputNumber(Number(supply.quantity || 0) || 0),
      lowStockThreshold: formatInputNumber(
        Number(supply.lowStockThreshold || 0) || 0
      ),
    };
  };

  const validateSupplyDraft = (row) => {
    const draftName = String(row?.name || "").trim();
    const pricing = derivePurchaseModel(row);

    if (!draftName) {
      return { ok: false, message: "Please enter a name for the supply." };
    }

    if (!String(row?.unit || "").trim()) {
      return { ok: false, message: "Please choose the stock unit for this supply." };
    }

    if (pricing.purchaseUnitCost <= 0) {
      return {
        ok: false,
        message:
          pricing.mode === "packaged"
            ? "Enter the cost for one purchased unit (bag, bottle, box, etc.)."
            : "Enter the total cost for this supply.",
      };
    }

    if (pricing.mode === "packaged" && pricing.purchaseUnitSize <= 0) {
      return {
        ok: false,
        message: "Enter how much stock is inside one purchased unit.",
      };
    }

    if (pricing.purchaseQuantity <= 0) {
      return {
        ok: false,
        message:
          pricing.mode === "packaged"
            ? "Enter how many purchased units you bought."
            : "Enter how much stock quantity you bought.",
      };
    }

    if (pricing.derivedQuantity <= 0) {
      return {
        ok: false,
        message: "The starting on-hand quantity must be greater than zero.",
      };
    }

    return { ok: true, pricing };
  };

  const saveNew = async () => {
    const user = auth.currentUser;
    if (!user || !editRow) return;

    const validation = validateSupplyDraft(editRow);
    if (!validation.ok) {
      setNotice({ tone: "danger", message: validation.message });
      return;
    }

    const { pricing } = validation;

    const newSupply = {
      name: String(editRow.name || "").trim(),
      cost: pricing.lockedUnitCost,
      type: editRow.type || "",
      unit: editRow.unit || "",
      quantity: pricing.derivedQuantity,
      reorderLink: editRow.reorderLink || "",
      lowStockThreshold: parseNumericInput(editRow.lowStockThreshold, 0),
      inventoryResetPending: false,
      lastPurchaseTotal: pricing.purchaseTotal,
      lastPurchaseQty: pricing.derivedQuantity,
      lastPriceEditedAt: serverTimestamp(),
      lastUpdatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      pricingInputMode: pricing.mode,
      purchaseUnitCost:
        pricing.mode === "packaged" ? pricing.purchaseUnitCost : null,
      purchaseUnitSize:
        pricing.mode === "packaged" ? pricing.purchaseUnitSize : null,
      purchaseQuantity:
        pricing.mode === "packaged" ? pricing.purchaseQuantity : null,
    };

    const ref = await addDoc(collection(db, "users", user.uid, "supplies"), newSupply);
    await logAudit(ref.id, "add", newSupply.quantity, "Initial supply added");

    setEditingId(null);
    setEditRow(null);
    setNotice({
      tone: "success",
      message: `Saved ${newSupply.name} at ${money(newSupply.cost)} per ${newSupply.unit}.`,
    });
  };

  const handleDelete = async (id, name) => {
    const user = auth.currentUser;
    if (!user) return;
    if (!(await confirm(`Delete "${name || "Unnamed"}"? This cannot be undone.`))) {
      return;
    }
    await deleteDoc(doc(db, "users", user.uid, "supplies", id));
    await logAudit(id, "delete", 0, `Supply deleted: ${name || id}`);
  };

  const handleResetSupplyInventory = async (supply) => {
    const user = auth.currentUser;
    if (!user || !supply?.id) return;

    const ok = await confirm(
      `Reset on-hand inventory for "${supply.name || "Unnamed"}"?\n\nThis keeps the supply record, cost, type, unit, reorder link, and low threshold. Quantity will be set to 0, and the next refill will become the new baseline without creating an audit entry.`
    );
    if (!ok) return;

    await updateDoc(doc(db, "users", user.uid, "supplies", supply.id), {
      quantity: 0,
      inventoryResetPending: true,
      inventoryResetAt: serverTimestamp(),
      lastUpdatedAt: serverTimestamp(),
    });

    setRestockAmounts((prev) => ({
      ...prev,
      [supply.id]: "",
    }));
  };

  const handleResetAllInventory = async () => {
    const user = auth.currentUser;
    if (!user || supplies.length === 0) return;

    const ok = await confirm(
      `Reset on-hand inventory for ALL supplies?\n\nThis keeps every supply record and its metadata, sets quantity to 0, and makes the next refill for each supply the new baseline without creating audit entries.`
    );
    if (!ok) return;

    await Promise.all(
      supplies.map((supply) =>
        updateDoc(doc(db, "users", user.uid, "supplies", supply.id), {
          quantity: 0,
          inventoryResetPending: true,
          inventoryResetAt: serverTimestamp(),
          lastUpdatedAt: serverTimestamp(),
        })
      )
    );

    setRestockAmounts({});
  };

  const handleRestock = async (id) => {
    const user = auth.currentUser;
    const supply = supplies.find((s) => s.id === id);
    const restockAmount = parseFloat(restockAmounts[id] || 0);
    if (!user || !supply || isNaN(restockAmount) || restockAmount <= 0) return;

    const isBaselinePending = Boolean(supply.inventoryResetPending);
    const newQuantity = isBaselinePending
      ? restockAmount
      : Number(supply.quantity || 0) + restockAmount;

    const payload = {
      quantity: newQuantity,
      inventoryResetPending: false,
      lastUpdatedAt: serverTimestamp(),
    };

    if (isBaselinePending) {
      payload.baselineSetAt = serverTimestamp();
    }

    await updateDoc(doc(db, "users", user.uid, "supplies", id), payload);

    if (!isBaselinePending) {
      await logAudit(id, "restock", restockAmount, "Manual restock");
    }

    setRestockAmounts({ ...restockAmounts, [supply.id]: "" });
  };

  const exportAuditCSV = () => {
    const sMap = new Map(supplies.map((s) => [s.id, s]));
    const rows = auditLogs.map((log) => {
      const s = sMap.get(log.supplyId);
      return {
        SupplyID: log.supplyId,
        SupplyName: s?.name || "",
        Action: log.action,
        Amount: log.amount,
        Unit: log.unit || s?.unit || "",
        UnitCostLocked: Number(s?.cost || 0).toFixed(4),
        UnitCostApplied:
          log.unitCostApplied != null ? Number(log.unitCostApplied).toFixed(4) : "",
        TotalCostApplied:
          log.totalCostApplied != null
            ? Number(log.totalCostApplied).toFixed(4)
            : "",
        Note: log.note || "",
        Timestamp: log.timestamp,
      };
    });
    const blob = new Blob([Papa.unparse(rows)], {
      type: "text/csv;charset=utf-8;",
    });
    saveAs(blob, "supply_audit_log.csv");
  };

  const exportConsumeCSV = () => {
    const sMap = new Map(supplies.map((s) => [s.id, s]));
    const rows = auditLogs
      .filter((log) => String(log.action).toLowerCase() === "consume")
      .map((log) => {
        const s = sMap.get(log.supplyId);
        const locked = Number(s?.cost || 0);
        const applied =
          log.unitCostApplied != null ? Number(log.unitCostApplied) : locked;
        const totalApplied =
          log.totalCostApplied != null
            ? Number(log.totalCostApplied)
            : applied * Number(log.amount || 0);
        return {
          SupplyID: log.supplyId,
          SupplyName: s?.name || "",
          Amount: log.amount,
          Unit: log.unit || s?.unit || "",
          UnitCostLocked: locked.toFixed(4),
          UnitCostApplied: applied.toFixed(4),
          TotalCostApplied: totalApplied.toFixed(4),
          RecipeID: log.recipeId || "",
          RecipeName: log.recipeName || "",
          GrowID: log.growId || "",
          Note: log.note || "",
          Timestamp: log.timestamp,
        };
      });
    const blob = new Blob([Papa.unparse(rows)], {
      type: "text/csv;charset=utf-8;",
    });
    saveAs(blob, "supply_consumption.csv");
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditRow(hydrateEditRow(s));
    setTimeout(() => nameRef.current?.focus?.(), 0);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditRow(null);
  };

  const saveEdit = async () => {
    const user = auth.currentUser;
    if (!user || !editingId || !editRow) return;

    const validation = validateSupplyDraft(editRow);
    if (!validation.ok) {
      setNotice({ tone: "danger", message: validation.message });
      return;
    }

    const currentSupply = supplies.find((s) => s.id === editingId);
    const wasBaselinePending = Boolean(currentSupply?.inventoryResetPending);
    const { pricing } = validation;
    const onHandQuantity = parseNumericInput(editRow.quantity, 0);

    const payload = {
      name: String(editRow.name || "").trim(),
      cost: pricing.lockedUnitCost,
      quantity: onHandQuantity,
      unit: editRow.unit || "",
      type: editRow.type || "",
      reorderLink: editRow.reorderLink || "",
      lowStockThreshold: parseNumericInput(editRow.lowStockThreshold, 0),
      lastPurchaseTotal: pricing.purchaseTotal,
      lastPurchaseQty: pricing.derivedQuantity,
      lastPriceEditedAt: serverTimestamp(),
      lastUpdatedAt: serverTimestamp(),
      pricingInputMode: pricing.mode,
      purchaseUnitCost:
        pricing.mode === "packaged" ? pricing.purchaseUnitCost : null,
      purchaseUnitSize:
        pricing.mode === "packaged" ? pricing.purchaseUnitSize : null,
      purchaseQuantity:
        pricing.mode === "packaged" ? pricing.purchaseQuantity : null,
    };

    if (wasBaselinePending) {
      payload.inventoryResetPending = onHandQuantity <= 0;
      if (onHandQuantity > 0) {
        payload.baselineSetAt = serverTimestamp();
      }
    }

    await updateDoc(doc(db, "users", user.uid, "supplies", editingId), payload);

    if (!wasBaselinePending) {
      await logAudit(editingId, "edit", 0, "Supply pricing metadata updated");
    }

    setEditingId(null);
    setEditRow(null);
    setNotice({
      tone: "success",
      message: `Updated ${payload.name} at ${money(payload.cost)} per ${payload.unit}.`,
    });
  };

  const emptyItems = supplies.filter(
    (s) => Number(s?.quantity || 0) <= 0 && !Boolean(s?.inventoryResetPending)
  );

  const lowItems = supplies.filter((s) => {
    const qty = Number(s?.quantity || 0);
    const low = Number(s?.lowStockThreshold || 0);
    return qty > 0 && low > 0 && qty <= low;
  });

  const baselineItems = supplies.filter((s) =>
    Boolean(s?.inventoryResetPending)
  );

  const handleCleanReturn = async (supply) => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const pending = Number(pendingClean[supply.id] || 0);

      if (pending <= 0) {
        const run = await confirm({
          title: "Scan archived grows?",
          message: `No "${supply.name}" are pending cleaning.\n\nScan ARCHIVED grows for returnable containers/tools now?`,
          confirmLabel: "Scan now",
        });
        if (run) {
          const res = await scanArchivesForDirty(user.uid);
          setNotice({
            tone: "success",
            message: `Scan complete. Grows scanned: ${res.scanned}. Grows affected: ${res.affectedGrows}. Items enqueued: ${res.enqueuedCount}.`,
          });
        }
        return;
      }
      const defaultVal = String(pending);
      const input = await confirm.prompt({
        title: "Clean & Return",
        message:
          `How many "${supply.name}" are cleaned and returning to inventory?

Any not returned will be marked destroyed or overused.`,
        inputLabel: `Returned to inventory (0-${pending})`,
        inputType: "number",
        defaultValue: defaultVal,
        min: 0,
        max: pending,
        step: 1,
        confirmLabel: "Apply",
        validate: (value) => {
          if (String(value).trim() === "") return "Enter how many items are returning to inventory.";
          const parsed = parseInt(value, 10);
          if (!Number.isFinite(parsed)) return "Enter a whole number.";
          if (parsed < 0) return "Value cannot be negative.";
          if (parsed > pending) return `You only have ${pending} pending clean.`;
          return true;
        },
      });
      if (input == null) return;
      const qtyRet = Math.max(0, Math.min(pending, parseInt(input, 10) || 0));
      const destroyed = Math.max(0, pending - qtyRet);

      if (qtyRet > 0) {
        const newQuantity = Number(supply.quantity || 0) + qtyRet;
        await updateDoc(doc(db, "users", user.uid, "supplies", supply.id), {
          quantity: newQuantity,
          lastUpdatedAt: serverTimestamp(),
        });
        await logAudit(
          supply.id,
          "clean_return",
          qtyRet,
          "Returned after cleaning"
        );
      }

      await decrementCleanPending(user.uid, supply.id, pending);

      if (destroyed > 0) {
        await logAudit(
          supply.id,
          "clean_destroyed",
          destroyed,
          "Destroyed/overused during cleaning"
        );
      }
    } catch (e) {
      console.error(e);
      setNotice({ tone: "danger", message: "Failed to process clean & return." });
    }
  };

  const handleScanAll = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const ok = await confirm({
      title: "Scan archived grows?",
      message:
        "Scan ARCHIVED grows for returnable containers/tools and enqueue them for cleaning?",
      confirmLabel: "Scan now",
    });
    if (!ok) return;
    const res = await scanArchivesForDirty(user.uid);
    setNotice({
      tone: "success",
      message: `Scan complete. Grows scanned: ${res.scanned}. Grows affected: ${res.affectedGrows}. Items enqueued: ${res.enqueuedCount}.`,
    });
  };

  const lastAudits = (supplyId) =>
    auditLogs
      .filter((l) => l.supplyId === supplyId)
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
      .slice(-5)
      .reverse();

  const activePricing = editRow ? derivePurchaseModel(editRow) : null;
  const isEditingExisting = Boolean(editingId && editingId !== "NEW");

  const availableTypeOptions = useMemo(() => {
    const currentType = String(editRow?.type || "").trim();
    const isLegacyCurrent = LEGACY_SUPPLY_TYPES.includes(currentType);
    return isLegacyCurrent ? [...SUPPLY_TYPES, currentType] : SUPPLY_TYPES;
  }, [editRow]);

  const stats = useMemo(() => {
    const totalSupplies = supplies.length;
    const inventoryValue = supplies.reduce((sum, s) => {
      const qty = Number(s?.quantity || 0) || 0;
      const cost = Number(s?.cost || 0) || 0;
      return sum + qty * cost;
    }, 0);

    const packagingCount = supplies.filter(
      (s) => String(s?.type || "").toLowerCase() === "packaging"
    ).length;

    const productionReadyCount = supplies.filter((s) =>
      ["packaging", "ingredient", "labor", "lab-consumable"].includes(
        String(s?.type || "").toLowerCase()
      )
    ).length;

    return {
      totalSupplies,
      inventoryValue,
      packagingCount,
      productionReadyCount,
      lowCount: lowItems.length,
      emptyCount: emptyItems.length,
    };
  }, [supplies, lowItems.length, emptyItems.length]);

  return (
    <div className="p-4 md:p-6 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm max-w-7xl mx-auto space-y-6">
      <div className="space-y-3">
        <h2 className="text-2xl font-bold">💰 Supplies / Cost of Goods</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-4xl">
          This is the COG source for both cultivation and post processing. Recipes pull from these
          supplies, and Production batches can now scale recipe supply cost into finished batch
          costing for capsules, gummies, tinctures, and chocolates.
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            notice.tone === "danger"
              ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-100"
              : notice.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-100"
                : "border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-100"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <span>{notice.message}</span>
            <button
              type="button"
              className="chip !px-2 !py-0.5"
              onClick={() => setNotice(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        <StatCard
          icon={Package}
          label="Total supplies"
          value={String(stats.totalSupplies)}
          hint="Tracked COG items"
        />
        <StatCard
          icon={DollarSign}
          label="On-hand value"
          value={money(stats.inventoryValue)}
          hint="Qty × locked unit cost"
        />
        <StatCard
          icon={Factory}
          label="Production ready"
          value={String(stats.productionReadyCount)}
          hint="Packaging, ingredients, lab consumables, labor"
        />
        <StatCard
          icon={Archive}
          label="Packaging"
          value={String(stats.packagingCount)}
          hint="Useful for finished goods"
        />
        <StatCard
          icon={AlertTriangle}
          label="Low stock"
          value={String(stats.lowCount)}
          hint="At or below threshold"
        />
        <StatCard
          icon={RotateCcw}
          label="Empty"
          value={String(stats.emptyCount)}
          hint="Need refill or reset"
        />
      </div>

      {(emptyItems.length > 0 || lowItems.length > 0) && (
        <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-100 p-3 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">
            {emptyItems.length > 0 && (
              <div className="mb-1">
                <span className="font-semibold">Empty:</span>{" "}
                {emptyItems.map((s) => s.name).join(", ")}
              </div>
            )}
            {lowItems.length > 0 && (
              <div>
                <span className="font-semibold">Low stock:</span>{" "}
                {lowItems.map((s) => s.name).join(", ")}
              </div>
            )}
          </div>
        </div>
      )}

      {baselineItems.length > 0 && (
        <div className="rounded-md border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/30 text-sky-900 dark:text-sky-100 p-3 text-sm">
          <span className="font-semibold">Waiting for fresh baseline:</span>{" "}
          {baselineItems.map((s) => s.name).join(", ")}
        </div>
      )}

      <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/20 p-3 text-sm text-blue-900 dark:text-blue-100">
        Use <span className="font-semibold">packaging</span>,{" "}
        <span className="font-semibold">ingredient</span>,{" "}
        <span className="font-semibold">lab-consumable</span>, and{" "}
        <span className="font-semibold">labor</span> supply types for post-processing formulas.
        Those supply costs can now roll through Recipes into Production batch costing and finished
        inventory pricing.
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={startAdd}
          aria-label="Add Supply"
          data-testid="cog-add-supply"
          className="btn btn-accent"
        >
          <PlusCircle className="w-4 h-4" /> Add Supply
        </button>
        <button
          onClick={exportAuditCSV}
          aria-label="Export Audit Log"
          className="btn"
        >
          <FileDown className="w-4 h-4" /> Export Audit Log
        </button>
        <button
          onClick={exportConsumeCSV}
          aria-label="Export consumption CSV"
          className="btn"
        >
          <FileDown className="w-4 h-4" /> Export CONSUME CSV
        </button>
        <button
          onClick={handleScanAll}
          aria-label="Scan archived grows for returnables"
          className="btn btn-accent"
        >
          <ScanLine className="w-4 h-4" /> Scan returns
        </button>
        <button
          onClick={handleResetAllInventory}
          aria-label="Reset all on-hand inventory"
          className="btn"
          title="Set all quantities to zero and wait for fresh baseline counts without audit entries"
        >
          <RotateCcw className="w-4 h-4" /> Reset All Inventory
        </button>
      </div>

      {editingId && editRow && (
        <div
          data-testid={editingId === "NEW" ? "cog-new-panel" : "cog-edit-panel"}
          className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 space-y-4"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-lg font-semibold">
                {editingId === "NEW"
                  ? "Add Supply"
                  : `Edit Supply · ${editRow.name || "Unnamed"}`}
              </h3>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 max-w-3xl">
                Enter purchase packaging once, and the app will lock the per-
                {editRow.unit || "unit"} cost from that data. Leave “Size per purchased unit”
                blank to use the older total-cost ÷ total-quantity workflow.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={editingId === "NEW" ? saveNew : saveEdit}
                data-testid={editingId === "NEW" ? "cog-new-save" : "cog-edit-save"}
                className="btn btn-accent"
              >
                <Check className="w-4 h-4" /> Save
              </button>
              <button
                onClick={cancelEdit}
                data-testid={editingId === "NEW" ? "cog-new-cancel" : "cog-edit-cancel"}
                className="btn"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                ref={nameRef}
                data-testid={editingId === "NEW" ? "cog-new-name" : "cog-edit-name"}
                className="w-full p-2 border rounded-lg dark:bg-zinc-800"
                value={editRow?.name || ""}
                onChange={(e) => setEditRow({ ...editRow, name: e.target.value })}
                placeholder="Supply name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                {activePricing?.mode === "packaged"
                  ? "Cost per purchased unit"
                  : "Total cost or cost per purchased unit"}
              </label>
              <input
                type="number"
                step="0.01"
                data-testid={editingId === "NEW" ? "cog-new-cost" : "cog-edit-cost"}
                className="w-full p-2 border rounded-lg dark:bg-zinc-800"
                value={editRow?.purchaseUnitCost ?? ""}
                onChange={(e) =>
                  setEditRow({
                    ...editRow,
                    purchaseUnitCost: e.target.value,
                  })
                }
                placeholder={activePricing?.mode === "packaged" ? "2.38" : "Total cost"}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Size per purchased unit</label>
              <input
                type="number"
                step="0.01"
                data-testid={editingId === "NEW" ? "cog-new-unit-size" : "cog-edit-unit-size"}
                className="w-full p-2 border rounded-lg dark:bg-zinc-800"
                value={editRow?.purchaseUnitSize ?? ""}
                onChange={(e) =>
                  setEditRow({
                    ...editRow,
                    purchaseUnitSize: e.target.value,
                  })
                }
                placeholder={`How many ${editRow?.unit || "stock units"} per bag/bottle/box`}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                {activePricing?.mode === "packaged" ? "How many purchased" : "Quantity bought"}
              </label>
              <input
                type="number"
                step="0.01"
                data-testid={
                  editingId === "NEW" ? "cog-new-quantity" : "cog-edit-purchase-quantity"
                }
                className="w-full p-2 border rounded-lg dark:bg-zinc-800"
                value={editRow?.purchaseQuantity ?? ""}
                onChange={(e) =>
                  setEditRow({
                    ...editRow,
                    purchaseQuantity: e.target.value,
                  })
                }
                placeholder={
                  activePricing?.mode === "packaged"
                    ? "How many bags/bottles/boxes"
                    : "Total qty bought"
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Stock unit</label>
              <select
                data-testid={editingId === "NEW" ? "cog-new-unit" : "cog-edit-unit"}
                className="w-full p-2 border rounded-lg dark:bg-zinc-800"
                value={editRow?.unit || ""}
                onChange={(e) => setEditRow({ ...editRow, unit: e.target.value })}
              >
                <option value="">unit</option>
                {UNITS.slice()
                  .sort()
                  .map((u) => (
                    <option key={u}>{u}</option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Derived locked cost</label>
              <div className="w-full p-2 border rounded-lg bg-white/70 dark:bg-zinc-900/60 text-sm">
                {money(activePricing?.lockedUnitCost || 0)} / {editRow?.unit || "unit"}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                {isEditingExisting ? "On-hand quantity" : "Starting on-hand quantity"}
              </label>
              {isEditingExisting ? (
                <input
                  type="number"
                  step="0.01"
                  data-testid="cog-edit-on-hand"
                  className="w-full p-2 border rounded-lg dark:bg-zinc-800"
                  value={editRow?.quantity ?? ""}
                  onChange={(e) => setEditRow({ ...editRow, quantity: e.target.value })}
                  placeholder={`Qty currently on hand in ${editRow?.unit || "stock units"}`}
                />
              ) : (
                <div className="w-full p-2 border rounded-lg bg-white/70 dark:bg-zinc-900/60 text-sm">
                  {Number(activePricing?.derivedQuantity || 0).toLocaleString()}{" "}
                  {editRow?.unit || ""}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Low threshold</label>
              <input
                type="number"
                step="0.01"
                data-testid={
                  editingId === "NEW" ? "cog-new-low-threshold" : "cog-edit-low-threshold"
                }
                className="w-full p-2 border rounded-lg dark:bg-zinc-800"
                value={editRow?.lowStockThreshold ?? ""}
                onChange={(e) =>
                  setEditRow({
                    ...editRow,
                    lowStockThreshold: e.target.value,
                  })
                }
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                data-testid={editingId === "NEW" ? "cog-new-type" : "cog-edit-type"}
                className="w-full p-2 border rounded-lg dark:bg-zinc-800"
                value={editRow?.type || ""}
                onChange={(e) => setEditRow({ ...editRow, type: e.target.value })}
              >
                <option value="">type</option>
                {availableTypeOptions
                  .slice()
                  .sort()
                  .map((t) => (
                    <option key={t} value={t}>
                      {LEGACY_SUPPLY_TYPES.includes(t) ? `${t} (legacy)` : t}
                    </option>
                  ))}
              </select>
            </div>

            <div className="md:col-span-2 xl:col-span-3">
              <label className="block text-sm font-medium mb-1">Reorder URL</label>
              <input
                data-testid={
                  editingId === "NEW" ? "cog-new-reorder-link" : "cog-edit-reorder-link"
                }
                className="w-full p-2 border rounded-lg dark:bg-zinc-800"
                value={editRow?.reorderLink || ""}
                onChange={(e) =>
                  setEditRow({
                    ...editRow,
                    reorderLink: e.target.value,
                  })
                }
                placeholder="Reorder URL (optional)"
              />
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/40 p-3 text-sm text-zinc-700 dark:text-zinc-300">
            {activePricing?.mode === "packaged" ? (
              <>
                <span className="font-semibold">Pack math:</span>{" "}
                {money(activePricing.purchaseUnitCost)} per purchased unit ×{" "}
                {activePricing.purchaseQuantity || 0} purchased ={" "}
                {money(activePricing.purchaseTotal)} total spend, yielding{" "}
                {Number(activePricing.derivedQuantity || 0).toLocaleString()}{" "}
                {editRow?.unit || "units"} on hand at{" "}
                {money(activePricing.lockedUnitCost)} per {editRow?.unit || "unit"}.
              </>
            ) : (
              <>
                <span className="font-semibold">Legacy math:</span> total cost{" "}
                {money(activePricing?.purchaseTotal || 0)} ÷{" "}
                {Number(activePricing?.derivedQuantity || 0).toLocaleString()}{" "}
                {editRow?.unit || "units"} ={" "}
                {money(activePricing?.lockedUnitCost || 0)} per {editRow?.unit || "unit"}.
              </>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-zinc-300 dark:border-zinc-600">
          <thead>
            <tr className="bg-zinc-100 dark:bg-zinc-700">
              <th></th>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">
                Cost{" "}
                <span className="ml-1 text-[11px] opacity-70">
                  (locked per stock unit; derived from pack cost/size when provided)
                </span>
              </th>
              <th className="p-2 text-left">Qty</th>
              <th className="p-2 text-left">Unit</th>
              <th className="p-2 text-left">Low ≤</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Restock / Reset / Reorder / Edit / Delete</th>
              <th className="p-2 text-left">Clean</th>
            </tr>
          </thead>
          <tbody>
            {supplies.map((supply) => {
              const isBaselinePending = Boolean(supply.inventoryResetPending);
              const qty = Number(supply.quantity || 0);
              const low = Number(supply.lowStockThreshold || 0);

              const rowClass = isBaselinePending
                ? "bg-sky-100 dark:bg-sky-900/20"
                : qty <= 0
                  ? "bg-red-100 dark:bg-red-900/40"
                  : qty <= low && low > 0
                    ? "bg-yellow-100 dark:bg-yellow-900/30"
                    : "";

              const statusBadge = isBaselinePending ? (
                <span className="ml-2 px-2 py-0.5 rounded text-xs font-semibold bg-sky-200 text-sky-900 dark:bg-sky-700 dark:text-white">
                  BASELINE
                </span>
              ) : qty <= 0 ? (
                <span className="ml-2 px-2 py-0.5 rounded text-xs font-semibold bg-red-200 text-red-900 dark:bg-red-700 dark:text-white">
                  EMPTY
                </span>
              ) : qty <= low && low > 0 ? (
                <span className="ml-2 px-2 py-0.5 rounded text-xs font-semibold bg-yellow-200 text-yellow-900 dark:bg-yellow-600 dark:text-white">
                  LOW
                </span>
              ) : null;

              const canClean =
                String(supply.type || "").toLowerCase() === "container" ||
                String(supply.type || "").toLowerCase() === "tool";
              const pend = Number(pendingClean[supply.id] || 0);

              const auditOpen = !!expandedAudit[supply.id];
              const last5 = lastAudits(supply.id);

              const hasPackPricing = Number(supply.purchaseUnitSize || 0) > 0;
              const lockTip = [
                `Price lock: $${Number(supply.cost || 0).toFixed(4)} per ${supply.unit || "unit"}`,
                hasPackPricing
                  ? `Pack: $${Number(supply.purchaseUnitCost || 0).toFixed(2)} each for ${Number(
                      supply.purchaseUnitSize || 0
                    )} ${supply.unit || "unit"}`
                  : Number.isFinite(Number(supply.lastPurchaseTotal)) &&
                      Number(supply.lastPurchaseQty || 0) > 0
                    ? `Derived from $${Number(supply.lastPurchaseTotal).toFixed(2)} / ${Number(
                        supply.lastPurchaseQty || 0
                      )} ${supply.unit || "unit"}`
                    : "Derived from last edit",
                hasPackPricing
                  ? `Last purchase: ${Number(supply.purchaseQuantity || 0)} purchased unit(s) = ${Number(
                      supply.lastPurchaseQty || supply.quantity || 0
                    )} ${supply.unit || "unit"}`
                  : null,
                supply.lastPriceEditedAt
                  ? `Edited: ${new Date(
                      supply.lastPriceEditedAt.seconds
                        ? supply.lastPriceEditedAt.seconds * 1000
                        : Date.now()
                    ).toLocaleString()}`
                  : null,
              ]
                .filter(Boolean)
                .join("\n");

              return (
                <React.Fragment key={supply.id}>
                  <tr
                    className={`border-t border-zinc-200 dark:border-zinc-700 ${rowClass}`}
                  >
                    <td className="p-2">
                      <button
                        className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() =>
                          setExpandedAudit((m) => ({
                            ...m,
                            [supply.id]: !auditOpen,
                          }))
                        }
                        title={auditOpen ? "Hide recent audits" : "Show recent audits"}
                      >
                        {auditOpen ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    </td>

                    <td className="p-2">{supply.name}</td>

                    <td className="p-2">
                      <span className="inline-flex items-center gap-1">
                        <span title={lockTip}>
                          <Lock className="inline w-3.5 h-3.5 opacity-70" />
                        </span>
                        ${Number(supply.cost || 0).toFixed(4)} / {supply.unit || ""}
                      </span>
                    </td>

                    <td className="p-2">
                      <>
                        {qty}
                        {statusBadge}
                      </>
                    </td>

                    <td className="p-2">{supply.unit}</td>

                    <td className="p-2">{Number(supply.lowStockThreshold || 0)}</td>

                    <td className="p-2">{supply.type}</td>

                    <td className="p-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder={isBaselinePending ? "set" : "+"}
                          className="w-20 p-1 border rounded dark:bg-zinc-800"
                          value={restockAmounts[supply.id] || ""}
                          onChange={(e) =>
                            setRestockAmounts({
                              ...restockAmounts,
                              [supply.id]: e.target.value,
                            })
                          }
                          title={
                            isBaselinePending
                              ? "First refill after reset sets the new baseline and is not audited"
                              : "Restock amount"
                          }
                        />
                        <button
                          onClick={() => handleRestock(supply.id)}
                          aria-label={`Restock ${supply.name}`}
                          className={`hover:underline ${
                            isBaselinePending ? "text-sky-600" : "accent-text"
                          }`}
                          title={
                            isBaselinePending
                              ? "Set fresh baseline quantity (not audited)"
                              : "Restock"
                          }
                        >
                          <PlusCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleResetSupplyInventory(supply)}
                          aria-label={`Reset inventory for ${supply.name}`}
                          className="text-amber-600 hover:underline"
                          title="Set quantity to zero and wait for a fresh baseline without audit"
                        >
                          <RotateCcw className="inline w-4 h-4" />
                        </button>
                        {supply.reorderLink && (
                          <a
                            href={supply.reorderLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open reorder link for ${supply.name}`}
                            className="accent-text hover:underline"
                            title="Open reorder link"
                          >
                            <ExternalLink className="inline w-4 h-4" />
                          </a>
                        )}
                        <button
                          onClick={() => startEdit(supply)}
                          className="accent-text hover:underline"
                          title="Edit"
                        >
                          <Edit3 className="inline w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(supply.id, supply.name)}
                          aria-label={`Delete supply ${supply.name || supply.id}`}
                          className="text-red-500 hover:underline"
                          title="Delete"
                        >
                          <Trash2 className="inline w-4 h-4" />
                        </button>
                      </div>
                    </td>

                    <td className="p-2">
                      {canClean && (
                        <button
                          onClick={() => handleCleanReturn(supply)}
                          className={`chip !px-2 !py-1 text-sm ${
                            pend > 0 ? "chip--active" : ""
                          }`}
                          title={
                            pend > 0
                              ? `${pend} archived items ready to clean`
                              : "No items pending clean — click to scan archived grows"
                          }
                        >
                          <Sparkles className="w-4 h-4" />
                          Clean
                          {pend > 0 ? ` (${pend})` : ""}
                        </button>
                      )}
                    </td>
                  </tr>

                  {auditOpen && (
                    <tr className="border-t border-zinc-200 dark:border-zinc-800">
                      <td></td>
                      <td colSpan={8} className="p-2">
                        {last5.length === 0 ? (
                          <div className="text-xs opacity-70">No recent audits.</div>
                        ) : (
                          <div className="text-xs grid gap-1">
                            {last5.map((a) => (
                              <div
                                key={`${a.id || a.timestamp}-${a.action}-${a.amount}`}
                                className="flex flex-wrap items-center gap-3"
                              >
                                <span className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700">
                                  {a.action}
                                </span>
                                <span>
                                  {a.amount} {a.unit || supply.unit || ""}
                                </span>
                                {a.unitCostApplied != null && (
                                  <span className="opacity-80">
                                    @ ${Number(a.unitCostApplied).toFixed(4)}{" "}
                                    {a.unit || supply.unit || ""}
                                  </span>
                                )}
                                {a.totalCostApplied != null && (
                                  <span className="opacity-80">
                                    (total ${Number(a.totalCostApplied).toFixed(4)})
                                  </span>
                                )}
                                <span className="opacity-60">{a.timestamp}</span>
                                {a.note && (
                                  <span className="opacity-70 italic">— {a.note}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}