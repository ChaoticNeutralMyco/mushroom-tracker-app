// src/components/recipes/COGManager.jsx
import React, { useEffect, useState } from "react";
import { db, auth } from "../../firebase-config";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
  onSnapshot,
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
} from "lucide-react";
import { useConfirm } from "../ui/ConfirmDialog";

const SUPPLY_TYPES = ["substrate", "container", "tool", "supplement", "labor"];
const UNITS = ["count", "g", "oz", "ml", "liter", "lbs", "hour"];

const byName = (a, b) =>
  String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
    sensitivity: "base",
  });

export default function COGManager() {
  const confirm = useConfirm();

  const [supplies, setSupplies] = useState([]);
  const [form, setForm] = useState({
    name: "",
    cost: "",
    type: "",
    unit: "",
    quantity: "",
    reorderLink: "",
    lowStockThreshold: "",
  });
  const [restockAmounts, setRestockAmounts] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [batchEdit, setBatchEdit] = useState({
    type: "",
    unit: "",
    reorderLink: "",
  });

  // inline edit
  const [editingId, setEditingId] = useState(null);
  const [editRow, setEditRow] = useState(null);

  // ---- LIVE SNAPSHOTS (auth-aware) ----
  useEffect(() => {
    let unsubs = [];
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      unsubs.forEach((fn) => fn && fn());
      unsubs = [];

      if (!u) {
        setSupplies([]);
        setAuditLogs([]);
        return;
      }

      const supCol = collection(db, "users", u.uid, "supplies");
      const auditCol = collection(db, "users", u.uid, "supply_audits");

      const unsub1 = onSnapshot(supCol, (snap) => {
        setSupplies(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byName)
        );
      });

      const unsub2 = onSnapshot(auditCol, (snap) => {
        setAuditLogs(snap.docs.map((d) => d.data()));
      });

      unsubs.push(unsub1, unsub2);
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
      timestamp: Timestamp.now().toDate().toISOString(),
    });
  };

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleAdd = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const newSupply = {
      name: String(form.name || "").trim(),
      cost: parseFloat(form.cost || 0) || 0,
      type: form.type || "",
      unit: form.unit || "",
      quantity: parseFloat(form.quantity || 0) || 0,
      reorderLink: form.reorderLink || "",
      lowStockThreshold: parseFloat(form.lowStockThreshold || 0) || 0,
    };

    const ref = await addDoc(
      collection(db, "users", user.uid, "supplies"),
      newSupply
    );
    await logAudit(ref.id, "add", newSupply.quantity, "Initial supply added");

    setForm({
      name: "",
      cost: "",
      type: "",
      unit: "",
      quantity: "",
      reorderLink: "",
      lowStockThreshold: "",
    });
  };

  const handleDelete = async (id, name) => {
    const user = auth.currentUser;
    if (!user) return;
    await deleteDoc(doc(db, "users", user.uid, "supplies", id));
    await logAudit(id, "delete", 0, `Supply deleted: ${name || id}`);
  };

  const handleBatchDelete = async () => {
    if (!selected.length) return;
    const ok = await confirm(`Delete ${selected.length} selected supplies?`);
    if (!ok) return;
    for (const id of selected) await handleDelete(id);
    setSelected([]);
  };

  const handleBatchEdit = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const updates = {};
    if (batchEdit.type) updates.type = batchEdit.type;
    if (batchEdit.unit) updates.unit = batchEdit.unit;
    if (batchEdit.reorderLink) updates.reorderLink = batchEdit.reorderLink;

    await Promise.all(
      selected.map(async (id) => {
        const ref = doc(db, "users", user.uid, "supplies", id);
        await updateDoc(ref, updates);
      })
    );

    alert("✅ Supplies updated.");
    setBatchEdit({ type: "", unit: "", reorderLink: "" });
    setSelected([]);
  };

  const handleRestock = async (id) => {
    const user = auth.currentUser;
    const supply = supplies.find((s) => s.id === id);
    const restockAmount = parseFloat(restockAmounts[id] || 0);
    if (!user || !supply || isNaN(restockAmount) || restockAmount <= 0) return;

    const newQuantity = (supply.quantity || 0) + restockAmount;
    await updateDoc(doc(db, "users", user.uid, "supplies", id), {
      quantity: newQuantity,
    });
    await logAudit(id, "restock", restockAmount, "Manual restock");
    setRestockAmounts({ ...restockAmounts, [supply.id]: "" });
  };

  const exportAuditCSV = () => {
    const csv = Papa.unparse(
      auditLogs.map((log) => ({
        SupplyID: log.supplyId,
        Action: log.action,
        Amount: log.amount,
        Note: log.note,
        Timestamp: log.timestamp,
      }))
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, "supply_audit_log.csv");
  };

  /* NEW: export only "consume" events */
  const exportConsumeCSV = () => {
    const rows = auditLogs
      .filter((log) => String(log.action).toLowerCase() === "consume")
      .map((log) => ({
        SupplyID: log.supplyId,
        Action: log.action,
        Amount: log.amount,
        Note: log.note,
        Timestamp: log.timestamp,
      }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, "supply_consumption.csv");
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditRow({ ...s });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditRow(null);
  };

  const saveEdit = async () => {
    const user = auth.currentUser;
    if (!user || !editingId || !editRow) return;

    const payload = {
      name: String(editRow.name || "").trim(),
      cost: parseFloat(editRow.cost || 0) || 0,
      quantity: parseFloat(editRow.quantity || 0) || 0,
      unit: editRow.unit || "",
      type: editRow.type || "",
      reorderLink: editRow.reorderLink || "",
      lowStockThreshold: parseFloat(editRow.lowStockThreshold || 0) || 0,
    };

    await updateDoc(doc(db, "users", user.uid, "supplies", editingId), payload);
    await logAudit(editingId, "edit", 0, "Inline edit");
    setEditingId(null);
    setEditRow(null);
  };

  // ------- Derived low/empty sets for warnings -------
  const emptyItems = supplies.filter((s) => Number(s?.quantity || 0) <= 0);
  const lowItems = supplies.filter((s) => {
    const qty = Number(s?.quantity || 0);
    const low = Number(s?.lowStockThreshold || 0);
    return qty > 0 && low > 0 && qty <= low;
  });

  return (
    <div className="p-4 md:p-6 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">💰 Supplies / Cost of Goods</h2>

      {/* Top warnings */}
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

      {/* Input Form */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <input name="name" value={form.name} onChange={handleChange} placeholder="Name" className="p-2 rounded border dark:bg-zinc-800" />
        <input name="cost" value={form.cost} onChange={handleChange} type="number" placeholder="Cost per unit" className="p-2 rounded border dark:bg-zinc-800" />
        <select name="type" value={form.type} onChange={handleChange} className="p-2 rounded border dark:bg-zinc-800">
          <option value="">Type</option>
          {SUPPLY_TYPES.sort().map((t) => (<option key={t}>{t}</option>))}
        </select>
        <select name="unit" value={form.unit} onChange={handleChange} className="p-2 rounded border dark:bg-zinc-800">
          <option value="">Unit</option>
          {UNITS.sort().map((u) => (<option key={u}>{u}</option>))}
        </select>
        <input name="quantity" value={form.quantity} onChange={handleChange} type="number" placeholder="Quantity on hand" className="p-2 rounded border dark:bg-zinc-800" />
        <input name="lowStockThreshold" value={form.lowStockThreshold} onChange={handleChange} type="number" placeholder="Low stock ≤" className="p-2 rounded border dark:bg-zinc-800" />
        <input name="reorderLink" value={form.reorderLink} onChange={handleChange} placeholder="Reorder URL (optional)" className="p-2 rounded border dark:bg-zinc-800 col-span-full" />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-4">
        <button onClick={handleAdd} aria-label="Add Supply" className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow">
          <PlusCircle className="w-4 h-4" /> Add Supply
        </button>
        <button onClick={exportAuditCSV} aria-label="Export Audit Log" className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow">
          <FileDown className="w-4 h-4" /> Export Audit Log
        </button>
        {/* NEW: Export only consume events */}
        <button onClick={exportConsumeCSV} aria-label="Export consumption CSV" className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded shadow">
          <FileDown className="w-4 h-4" /> Export CONSUME CSV
        </button>
      </div>

      {/* Batch Edit */}
      {selected.length > 0 && (
        <div className="bg-yellow-100 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 p-3 rounded-md space-y-2">
          <div className="text-sm font-medium">
            {selected.length} selected —
            <button className="ml-2 text-blue-500 hover:underline" onClick={() => setSelected(supplies.map((s) => s.id))}>Select All</button>
            <button className="ml-2 text-red-500 hover:underline" onClick={() => setSelected([])}>Clear</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={batchEdit.type} onChange={(e) => setBatchEdit({ ...batchEdit, type: e.target.value })} className="p-1 border rounded text-sm dark:bg-zinc-800">
              <option value="">Set Type</option>
              {SUPPLY_TYPES.map((t) => (<option key={t}>{t}</option>))}
            </select>
            <select value={batchEdit.unit} onChange={(e) => setBatchEdit({ ...batchEdit, unit: e.target.value })} className="p-1 border rounded text-sm dark:bg-zinc-800">
              <option value="">Set Unit</option>
              {UNITS.map((u) => (<option key={u}>{u}</option>))}
            </select>
            <input value={batchEdit.reorderLink} onChange={(e) => setBatchEdit({ ...batchEdit, reorderLink: e.target.value })} placeholder="Reorder URL" className="p-1 border rounded text-sm dark:bg-zinc-800" />
            <button onClick={handleBatchEdit} className="flex items-center gap-1 bg-green-600 text-white px-3 py-1 rounded text-sm"><Check className="w-4 h-4" /> Apply Edits</button>
            <button onClick={handleBatchDelete} className="flex items-center gap-1 bg-red-600 text-white px-3 py-1 rounded text-sm"><Trash2 className="w-4 h-4" /> Delete Selected</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-zinc-300 dark:border-zinc-600">
          <thead>
            <tr className="bg-zinc-100 dark:bg-zinc-700">
              <th></th>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">Cost</th>
              <th className="p-2 text-left">Qty</th>
              <th className="p-2 text-left">Unit</th>
              <th className="p-2 text-left">Low ≤</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Restock</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {supplies.map((supply) => {
              const isChecked = selected.includes(supply.id);
              const isEditing = editingId === supply.id;

              const qty = Number(supply.quantity || 0);
              const low = Number(supply.lowStockThreshold || 0);

              // Row color: red when empty, yellow when low
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

              return (
                <tr key={supply.id} className={`border-t border-zinc-200 dark:border-zinc-700 ${rowClass}`}>
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      aria-label={`Select ${supply.name}`}
                      onChange={() =>
                        setSelected((prev) =>
                          isChecked ? prev.filter((id) => id !== supply.id) : [...prev, supply.id]
                        )
                      }
                    />
                  </td>

                  {/* Name */}
                  <td className="p-2">
                    {isEditing ? (
                      <input className="w-full p-1 border rounded dark:bg-zinc-800" value={editRow?.name || ""} onChange={(e) => setEditRow({ ...editRow, name: e.target.value })} />
                    ) : (
                      supply.name
                    )}
                  </td>

                  {/* Cost */}
                  <td className="p-2">
                    {isEditing ? (
                      <input type="number" step="0.01" className="w-24 p-1 border rounded dark:bg-zinc-800" value={editRow?.cost ?? ""} onChange={(e) => setEditRow({ ...editRow, cost: e.target.value })} />
                    ) : (
                      `$${Number(supply.cost || 0).toFixed(2)}`
                    )}
                  </td>

                  {/* Qty + badge */}
                  <td className="p-2">
                    {isEditing ? (
                      <input type="number" step="0.01" className="w-24 p-1 border rounded dark:bg-zinc-800" value={editRow?.quantity ?? ""} onChange={(e) => setEditRow({ ...editRow, quantity: e.target.value })} />
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
                      <select className="p-1 border rounded dark:bg-zinc-800" value={editRow?.unit || ""} onChange={(e) => setEditRow({ ...editRow, unit: e.target.value })}>
                        <option value="">unit</option>
                        {UNITS.sort().map((u) => (<option key={u}>{u}</option>))}
                      </select>
                    ) : (
                      supply.unit
                    )}
                  </td>

                  {/* Low threshold */}
                  <td className="p-2">
                    {isEditing ? (
                      <input type="number" step="0.01" className="w-20 p-1 border rounded dark:bg-zinc-800" value={editRow?.lowStockThreshold ?? ""} onChange={(e) => setEditRow({ ...editRow, lowStockThreshold: e.target.value })} />
                    ) : (
                      Number(supply.lowStockThreshold || 0)
                    )}
                  </td>

                  {/* Type */}
                  <td className="p-2">
                    {isEditing ? (
                      <select className="p-1 border rounded dark:bg-zinc-800" value={editRow?.type || ""} onChange={(e) => setEditRow({ ...editRow, type: e.target.value })}>
                        <option value="">type</option>
                        {SUPPLY_TYPES.sort().map((t) => (<option key={t}>{t}</option>))}
                      </select>
                    ) : (
                      supply.type
                    )}
                  </td>

                  {/* Restock */}
                  <td className="p-2">
                    {isEditing ? (
                      <input className="w-full p-1 border rounded dark:bg-zinc-800" value={editRow?.reorderLink || ""} onChange={(e) => setEditRow({ ...editRow, reorderLink: e.target.value })} placeholder="Reorder URL" />
                    ) : (
                      <div className="flex items-center gap-2">
                        <input type="number" min="0" step="0.1" placeholder="+" className="w-20 p-1 border rounded dark:bg-zinc-800" value={restockAmounts[supply.id] || ""} onChange={(e) => setRestockAmounts({ ...restockAmounts, [supply.id]: e.target.value })} />
                        <button onClick={() => handleRestock(supply.id)} aria-label={`Restock ${supply.name}`} className="text-green-600 hover:underline">
                          <PlusCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="p-2 space-x-2">
                    {isEditing ? (
                      <>
                        <button onClick={saveEdit} className="text-green-600 hover:underline" title="Save">
                          <Save className="inline w-4 h-4" />
                        </button>
                        <button onClick={cancelEdit} className="text-zinc-400 hover:underline" title="Cancel">
                          <X className="inline w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(supply)} className="text-blue-500 hover:underline" title="Edit">
                          <Edit3 className="inline w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(supply.id, supply.name)} aria-label={`Delete supply ${supply.name || supply.id}`} className="text-red-500 hover:underline" title="Delete">
                          <Trash2 className="inline w-4 h-4" />
                        </button>
                        {supply.reorderLink && (
                          <a href={supply.reorderLink} target="_blank" rel="noopener noreferrer" aria-label={`Open reorder link for ${supply.name}`} className="text-blue-500 hover:underline" title="Open reorder link">
                            <ExternalLink className="inline w-4 h-4" />
                          </a>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
