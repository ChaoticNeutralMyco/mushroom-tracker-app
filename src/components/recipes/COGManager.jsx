// src/components/recipes/COGManager.jsx
import React, { useEffect, useState, useRef } from "react";
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
  Save,
  X,
  AlertTriangle,
  Sparkles,
  ScanLine,
  Lock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useConfirm } from "../ui/ConfirmDialog";
import {
  decrementCleanPending,
  scanArchivesForDirty,
} from "../../lib/clean-queue";

const SUPPLY_TYPES = ["substrate", "container", "tool", "supplement", "labor"];
const UNITS = ["count", "g", "oz", "ml", "liter", "lbs", "hour"];

const byName = (a, b) =>
  String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
    sensitivity: "base",
  });

// default row for inline add
const DEFAULT_NEW = {
  name: "",
  cost: "", // NOTE: user enters TOTAL cost here; we convert to per-unit on save
  type: "",
  unit: "",
  quantity: "",
  reorderLink: "",
  lowStockThreshold: "",
};

export default function COGManager() {
  const confirm = useConfirm();

  const [supplies, setSupplies] = useState([]);
  const [restockAmounts, setRestockAmounts] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [expandedAudit, setExpandedAudit] = useState({}); // supplyId -> bool

  // inline edit
  const [editingId, setEditingId] = useState(null); // 'NEW' or doc id
  const [editRow, setEditRow] = useState(null);
  const nameRef = useRef(null);

  // live pending clean queue counts
  const [pendingClean, setPendingClean] = useState({}); // supplyId -> pending number

  // ---- LIVE SNAPSHOTS (auth-aware) ----
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
      // keep a slot for applied cost if some flows pass it
      unitCostApplied: null,
      totalCostApplied: null,
      unit: null,
      timestamp: Timestamp.now().toDate().toISOString(),
    });
  };

  // --- ADD FLOW (inline) ---
  const startAdd = () => {
    setEditingId("NEW");
    setEditRow({ ...DEFAULT_NEW });
    setTimeout(() => nameRef.current?.focus?.(), 0);
  };

  // Convert “total cost” to per-unit cost (price lock).
  const computePerUnitFromTotal = (totalCostInput, qtyInput) => {
    const total = parseFloat(totalCostInput || 0);
    const qty = parseFloat(qtyInput || 0);
    if (qty > 0 && Number.isFinite(total)) {
      const per = total / qty;
      return Number.isFinite(per) ? per : total;
    }
    return Number.isFinite(total) ? total : 0;
  };

  const saveNew = async () => {
    const user = auth.currentUser;
    if (!user || !editRow) return;

    const perUnitCost = computePerUnitFromTotal(
      editRow.cost,
      editRow.quantity
    );

    const quantityNum = parseFloat(editRow.quantity || 0) || 0;

    const newSupply = {
      name: String(editRow.name || "").trim(),
      // store per-unit in `cost` (locked)
      cost: perUnitCost,
      type: editRow.type || "",
      unit: editRow.unit || "",
      quantity: quantityNum,
      reorderLink: editRow.reorderLink || "",
      lowStockThreshold:
        parseFloat(editRow.lowStockThreshold || 0) || 0,
      // lock metadata for tooltip/history
      lastPurchaseTotal: parseFloat(editRow.cost || 0) || 0,
      lastPurchaseQty: quantityNum,
      lastPriceEditedAt: serverTimestamp(),
      lastUpdatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    if (!newSupply.name) {
      alert("Please enter a name for the supply.");
      return;
    }

    const ref = await addDoc(
      collection(db, "users", user.uid, "supplies"),
      newSupply
    );
    await logAudit(ref.id, "add", newSupply.quantity, "Initial supply added");

    setEditingId(null);
    setEditRow(null);
  };

  const handleDelete = async (id, name) => {
    const user = auth.currentUser;
    if (!user) return;
    if (
      !(await confirm(
        `Delete "${name || "Unnamed"}"? This cannot be undone.`
      ))
    )
      return;
    await deleteDoc(doc(db, "users", user.uid, "supplies", id));
    await logAudit(id, "delete", 0, `Supply deleted: ${name || id}`);
  };

  const handleRestock = async (id) => {
    const user = auth.currentUser;
    const supply = supplies.find((s) => s.id === id);
    const restockAmount = parseFloat(restockAmounts[id] || 0);
    if (!user || !supply || isNaN(restockAmount) || restockAmount <= 0) return;

    const newQuantity = (supply.quantity || 0) + restockAmount;
    await updateDoc(doc(db, "users", user.uid, "supplies", id), {
      quantity: newQuantity,
      lastUpdatedAt: serverTimestamp(),
    });
    await logAudit(id, "restock", restockAmount, "Manual restock");
    setRestockAmounts({ ...restockAmounts, [supply.id]: "" });
  };

  // ---- Exports (now include price lock + applied costs when present) ----
  const exportAuditCSV = () => {
    // Map supplies for quick joins
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
        UnitCostApplied: log.unitCostApplied != null ? Number(log.unitCostApplied).toFixed(4) : "",
        TotalCostApplied: log.totalCostApplied != null ? Number(log.totalCostApplied).toFixed(4) : "",
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
        const applied = log.unitCostApplied != null ? Number(log.unitCostApplied) : locked;
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
    // Editing shows TOTAL price; per-unit is locked on save.
    const impliedTotal =
      (Number(s.cost || 0) || 0) * (Number(s.lastPurchaseQty || s.quantity || 0) || 0);
    const total = Number.isFinite(Number(s.lastPurchaseTotal))
      ? Number(s.lastPurchaseTotal)
      : impliedTotal;

    setEditingId(s.id);
    setEditRow({
      ...s,
      cost: total, // show total in the input
    });
    setTimeout(() => nameRef.current?.focus?.(), 0);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditRow(null);
  };

  const saveEdit = async () => {
    const user = auth.currentUser;
    if (!user || !editingId || !editRow) return;

    const qty = parseFloat(editRow.quantity || 0) || 0;
    const perUnitCost = computePerUnitFromTotal(editRow.cost, qty);

    const payload = {
      name: String(editRow.name || "").trim(),
      // store per-unit cost (locked)
      cost: perUnitCost,
      quantity: qty,
      unit: editRow.unit || "",
      type: editRow.type || "",
      reorderLink: editRow.reorderLink || "",
      lowStockThreshold:
        parseFloat(editRow.lowStockThreshold || 0) || 0,
      lastPurchaseTotal: parseFloat(editRow.cost || 0) || 0,
      lastPurchaseQty: qty,
      lastPriceEditedAt: serverTimestamp(),
      lastUpdatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, "users", user.uid, "supplies", editingId), payload);
    await logAudit(editingId, "edit", 0, "Inline edit (total→per-unit)");
    setEditingId(null);
    setEditRow(null);
  };

  const emptyItems = supplies.filter((s) => Number(s?.quantity || 0) <= 0);
  const lowItems = supplies.filter((s) => {
    const qty = Number(s?.quantity || 0);
    const low = Number(s?.lowStockThreshold || 0);
    return qty > 0 && low > 0 && qty <= low;
  });

  // ----- Clean & Return (with destroy remainder) -----
  const handleCleanReturn = async (supply) => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const pending = Number(pendingClean[supply.id] || 0);

      // If nothing is pending, offer to run the backfill scan
      if (pending <= 0) {
        const run = window.confirm(
          `No "${supply.name}" are pending cleaning.\n\nScan ARCHIVED grows for returnable containers/tools now?`
        );
        if (run) {
          const res = await scanArchivesForDirty(user.uid);
          alert(
            `Scan complete.\nGrows scanned: ${res.scanned}\nGrows affected: ${res.affectedGrows}\nItems enqueued: ${res.enqueuedCount}`
          );
        }
        return;
      }

      const defaultVal = String(pending);
      const input = window.prompt(
        `How many "${supply.name}" are cleaned and returning to inventory? (0–${pending})\n\nAny not returned will be marked destroyed/overused.`,
        defaultVal
      );
      if (input == null) return;
      const qtyRet = Math.max(
        0,
        Math.min(pending, parseInt(input, 10) || 0)
      );

      // compute destroyed remainder
      const destroyed = Math.max(0, pending - qtyRet);

      // 1) Increment supply stock for the returned amount
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

      // 2) Clear ALL pending (returned + destroyed)
      await decrementCleanPending(user.uid, supply.id, pending);

      // 3) Log destruction for the remainder
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
      alert("Failed to process clean & return.");
    }
  };

  const handleScanAll = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const ok = window.confirm(
      "Scan ARCHIVED grows for returnable containers/tools and enqueue them for cleaning?"
    );
    if (!ok) return;
    const res = await scanArchivesForDirty(user.uid);
    alert(
      `Scan complete.\nGrows scanned: ${res.scanned}\nGrows affected: ${res.affectedGrows}\nItems enqueued: ${res.enqueuedCount}`
    );
  };

  // Helper to show last 5 audits for a supply id
  const lastAudits = (supplyId) =>
    auditLogs
      .filter((l) => l.supplyId === supplyId)
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
      .slice(-5)
      .reverse();

  return (
    <div className="p-4 md:p-6 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">💰 Supplies / Cost of Goods</h2>

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

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={startAdd}
          aria-label="Add Supply"
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow"
        >
          <PlusCircle className="w-4 h-4" /> Add Supply
        </button>
        <button
          onClick={exportAuditCSV}
          aria-label="Export Audit Log"
          className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow"
        >
          <FileDown className="w-4 h-4" /> Export Audit Log
        </button>
        <button
          onClick={exportConsumeCSV}
          aria-label="Export consumption CSV"
          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded shadow"
        >
          <FileDown className="w-4 h-4" /> Export CONSUME CSV
        </button>
        <button
          onClick={handleScanAll}
          aria-label="Scan archived grows for returnables"
          className="flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded shadow"
        >
          <ScanLine className="w-4 h-4" /> Scan returns
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-zinc-300 dark:border-zinc-600">
          <thead>
            <tr className="bg-zinc-100 dark:bg-zinc-700">
              <th></th>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">
                Cost{" "}
                <span className="ml-1 text-[11px] opacity-70">
                  (per-unit, <em>locked</em>; enter <em>total</em> when adding/editing)
                </span>
              </th>
              <th className="p-2 text-left">Qty</th>
              <th className="p-2 text-left">Unit</th>
              <th className="p-2 text-left">Low ≤</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Restock / Reorder / Edit / Delete</th>
              <th className="p-2 text-left">Clean</th>
            </tr>
          </thead>
          <tbody>
            {/* Inline NEW row */}
            {editingId === "NEW" && (
              <tr className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                <td className="p-2"></td>
                <td className="p-2">
                  <input
                    ref={nameRef}
                    className="w-full p-1 border rounded dark:bg-zinc-800"
                    value={editRow?.name || ""}
                    onChange={(e) =>
                      setEditRow({ ...editRow, name: e.target.value })
                    }
                    placeholder="Supply name"
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    step="0.01"
                    className="w-28 p-1 border rounded dark:bg-zinc-800"
                    value={editRow?.cost ?? ""}
                    onChange={(e) =>
                      setEditRow({ ...editRow, cost: e.target.value })
                    }
                    placeholder="Total cost"
                    title="Enter the TOTAL cost of your purchase; we'll store per-unit."
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    step="0.01"
                    className="w-24 p-1 border rounded dark:bg-zinc-800"
                    value={editRow?.quantity ?? ""}
                    onChange={(e) =>
                      setEditRow({ ...editRow, quantity: e.target.value })
                    }
                    placeholder="Qty bought"
                  />
                </td>
                <td className="p-2">
                  <select
                    className="p-1 border rounded dark:bg-zinc-800"
                    value={editRow?.unit || ""}
                    onChange={(e) =>
                      setEditRow({ ...editRow, unit: e.target.value })
                    }
                  >
                    <option value="">unit</option>
                    {UNITS.sort().map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    step="0.01"
                    className="w-20 p-1 border rounded dark:bg-zinc-800"
                    value={editRow?.lowStockThreshold ?? ""}
                    onChange={(e) =>
                      setEditRow({
                        ...editRow,
                        lowStockThreshold: e.target.value,
                      })
                    }
                    placeholder="0"
                  />
                </td>
                <td className="p-2">
                  <select
                    className="p-1 border rounded dark:bg-zinc-800"
                    value={editRow?.type || ""}
                    onChange={(e) =>
                      setEditRow({ ...editRow, type: e.target.value })
                    }
                  >
                    <option value="">type</option>
                    {SUPPLY_TYPES.sort().map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </td>
                {/* Grouped actions for NEW row */}
                <td className="p-2 space-x-2">
                  <input
                    className="w-full p-1 border rounded dark:bg-zinc-800 mb-2"
                    value={editRow?.reorderLink || ""}
                    onChange={(e) =>
                      setEditRow({
                        ...editRow,
                        reorderLink: e.target.value,
                      })
                    }
                    placeholder="Reorder URL (optional)"
                  />
                  <button
                    onClick={saveNew}
                    className="text-green-600 hover:underline"
                    title="Save"
                  >
                    <Check className="inline w-4 h-4" /> Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="text-zinc-400 hover:underline"
                    title="Cancel"
                  >
                    <X className="inline w-4 h-4" /> Cancel
                  </button>
                </td>
                {/* Clean column empty for new row */}
                <td className="p-2"></td>
              </tr>
            )}

            {supplies.map((supply) => {
              const isEditing = editingId === supply.id;

              const qty = Number(supply.quantity || 0);
              const low = Number(supply.lowStockThreshold || 0);

              const rowClass =
                qty <= 0
                  ? "bg-red-100 dark:bg-red-900/40"
                  : qty <= low && low > 0
                  ? "bg-yellow-100 dark:bg-yellow-900/30"
                  : "";

              const statusBadge =
                qty <= 0 ? (
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

              const lockTip = `Price lock: $${Number(supply.cost || 0).toFixed(
                4
              )} per ${supply.unit || ""}\n` +
                (Number.isFinite(Number(supply.lastPurchaseTotal))
                  ? `Derived from $${Number(
                      supply.lastPurchaseTotal
                    ).toFixed(2)} / ${Number(
                      supply.lastPurchaseQty || 0
                    )} ${supply.unit || ""}`
                  : "Derived from last edit") +
                (supply.lastPriceEditedAt ? `\nEdited: ${new Date(
                  supply.lastPriceEditedAt.seconds
                    ? supply.lastPriceEditedAt.seconds * 1000
                    : Date.now()
                ).toLocaleString()}` : "");

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

                    {/* Name */}
                    <td className="p-2">
                      {isEditing ? (
                        <input
                          ref={nameRef}
                          className="w-full p-1 border rounded dark:bg-zinc-800"
                          value={editRow?.name || ""}
                          onChange={(e) =>
                            setEditRow({ ...editRow, name: e.target.value })
                          }
                        />
                      ) : (
                        supply.name
                      )}
                    </td>

                    {/* Cost — shows per-unit with lock */}
                    <td className="p-2">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          className="w-28 p-1 border rounded dark:bg-zinc-800"
                          value={editRow?.cost ?? ""}
                          onChange={(e) =>
                            setEditRow({ ...editRow, cost: e.target.value })
                          }
                          placeholder="Total cost"
                          title="Enter TOTAL cost; we'll store per-unit."
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span title={lockTip}>
                            <Lock className="inline w-3.5 h-3.5 opacity-70" />
                          </span>
                          ${Number(supply.cost || 0).toFixed(4)} / {supply.unit || ""}
                        </span>
                      )}
                    </td>

                    {/* Qty + badge */}
                    <td className="p-2">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          className="w-24 p-1 border rounded dark:bg-zinc-800"
                          value={editRow?.quantity ?? ""}
                          onChange={(e) =>
                            setEditRow({ ...editRow, quantity: e.target.value })
                          }
                        />
                      ) : (
                        <>
                          {qty}
                          {statusBadge}
                        </>
                      )}
                    </td>

                    {/* Unit */}
                    <td className="p-2">
                      {isEditing ? (
                        <select
                          className="p-1 border rounded dark:bg-zinc-800"
                          value={editRow?.unit || ""}
                          onChange={(e) =>
                            setEditRow({ ...editRow, unit: e.target.value })
                          }
                        >
                          <option value="">unit</option>
                          {UNITS.sort().map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </select>
                      ) : (
                        supply.unit
                      )}
                    </td>

                    {/* Low threshold */}
                    <td className="p-2">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          className="w-20 p-1 border rounded dark:bg-zinc-800"
                          value={editRow?.lowStockThreshold ?? ""}
                          onChange={(e) =>
                            setEditRow({
                              ...editRow,
                              lowStockThreshold: e.target.value,
                            })
                          }
                        />
                      ) : (
                        Number(supply.lowStockThreshold || 0)
                      )}
                    </td>

                    {/* Type */}
                    <td className="p-2">
                      {isEditing ? (
                        <select
                          className="p-1 border rounded dark:bg-zinc-800"
                          value={editRow?.type || ""}
                          onChange={(e) =>
                            setEditRow({ ...editRow, type: e.target.value })
                          }
                        >
                          <option value="">type</option>
                          {SUPPLY_TYPES.sort().map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      ) : (
                        supply.type
                      )}
                    </td>

                    {/* Restock / Reorder / Edit / Delete */}
                    <td className="p-2">
                      {isEditing ? (
                        <>
                          <input
                            className="w-full p-1 border rounded dark:bg-zinc-800 mb-2"
                            value={editRow?.reorderLink || ""}
                            onChange={(e) =>
                              setEditRow({
                                ...editRow,
                                reorderLink: e.target.value,
                              })
                            }
                            placeholder="Reorder URL"
                          />
                          <div className="space-x-2">
                            <button
                              onClick={saveEdit}
                              className="text-green-600 hover:underline"
                              title="Save"
                            >
                              <Save className="inline w-4 h-4" /> Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-zinc-400 hover:underline"
                              title="Cancel"
                            >
                              <X className="inline w-4 h-4" /> Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            placeholder="+"
                            className="w-20 p-1 border rounded dark:bg-zinc-800"
                            value={restockAmounts[supply.id] || ""}
                            onChange={(e) =>
                              setRestockAmounts({
                                ...restockAmounts,
                                [supply.id]: e.target.value,
                              })
                            }
                          />
                          <button
                            onClick={() => handleRestock(supply.id)}
                            aria-label={`Restock ${supply.name}`}
                            className="text-green-600 hover:underline"
                          >
                            <PlusCircle className="w-4 h-4" />
                          </button>
                          {supply.reorderLink && (
                            <a
                              href={supply.reorderLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open reorder link for ${supply.name}`}
                              className="text-blue-500 hover:underline"
                              title="Open reorder link"
                            >
                              <ExternalLink className="inline w-4 h-4" />
                            </a>
                          )}
                          {/* Edit/Delete grouped here */}
                          <button
                            onClick={() => startEdit(supply)}
                            className="text-blue-500 hover:underline"
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
                      )}
                    </td>

                    {/* CLEAN (far right) */}
                    <td className="p-2">
                      {canClean && (
                        <button
                          onClick={() => handleCleanReturn(supply)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm ${
                            pend > 0
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-200 dark:bg-zinc-700"
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

                  {/* Inline Audit Peek (last 5) */}
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
                                    @ ${Number(a.unitCostApplied).toFixed(4)} {a.unit || supply.unit || ""}
                                  </span>
                                )}
                                {a.totalCostApplied != null && (
                                  <span className="opacity-80">
                                    (total ${Number(a.totalCostApplied).toFixed(4)})
                                  </span>
                                )}
                                <span className="opacity-60">
                                  {a.timestamp}
                                </span>
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
