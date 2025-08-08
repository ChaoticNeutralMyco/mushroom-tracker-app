// src/components/recipes/COGManager.jsx
import React, { useEffect, useState } from "react";
import { db, auth } from "../../firebase-config";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
} from "firebase/firestore";
import { saveAs } from "file-saver";
import Papa from "papaparse";
import { PlusCircle, Trash2, ExternalLink, FileDown, Check } from "lucide-react";

const SUPPLY_TYPES = ["substrate", "container", "tool", "supplement", "labor"];
const UNITS = ["count", "g", "oz", "ml", "liter", "lbs", "hour"];

export default function COGManager() {
  const [supplies, setSupplies] = useState([]);
  const [form, setForm] = useState({
    name: "",
    cost: "",
    type: "",
    unit: "",
    quantity: "",
    reorderLink: "",
  });
  const [restockAmounts, setRestockAmounts] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [batchEdit, setBatchEdit] = useState({ type: "", unit: "", reorderLink: "" });

  const fetchData = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const suppliesSnap = await getDocs(collection(db, "users", user.uid, "supplies"));
    const auditsSnap = await getDocs(collection(db, "users", user.uid, "supply_audits"));
    setSupplies(suppliesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    setAuditLogs(auditsSnap.docs.map((doc) => doc.data()));
  };

  useEffect(() => { fetchData(); }, []);

  const logAudit = async (supplyId, action, amount, note = "") => {
    const user = auth.currentUser;
    if (!user) return;
    await addDoc(collection(db, "users", user.uid, "supply_audits"), {
      supplyId, action, amount, note, timestamp: Timestamp.now().toDate().toISOString(),
    });
  };

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleAdd = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const newSupply = {
      ...form,
      cost: parseFloat(form.cost),
      quantity: parseFloat(form.quantity || 0),
      reorderLink: form.reorderLink || "",
    };
    const docRef = await addDoc(collection(db, "users", user.uid, "supplies"), newSupply);
    await logAudit(docRef.id, "add", newSupply.quantity, "Initial supply added");
    setForm({ name: "", cost: "", type: "", unit: "", quantity: "", reorderLink: "" });
    fetchData();
  };

  const handleDelete = async (id, name) => {
    const user = auth.currentUser;
    if (!user) return;
    await deleteDoc(doc(db, "users", user.uid, "supplies", id));
    await logAudit(id, "delete", 0, `Supply deleted: ${name || id}`);
    fetchData();
  };

  const handleBatchDelete = async () => {
    if (!window.confirm(`Delete ${selected.length} selected supplies?`)) return;
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
    fetchData();
  };

  const handleRestock = async (id) => {
    const user = auth.currentUser;
    const supply = supplies.find((s) => s.id === id);
    const restockAmount = parseFloat(restockAmounts[id] || 0);
    if (!user || !supply || isNaN(restockAmount) || restockAmount <= 0) return;

    const newQuantity = (supply.quantity || 0) + restockAmount;
    await updateDoc(doc(db, "users", user.uid, "supplies", id), { quantity: newQuantity });
    await logAudit(id, "restock", restockAmount, "Manual restock");
    setRestockAmounts({ ...restockAmounts, [id]: "" });
    fetchData();
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

  return (
    <div className="p-4 md:p-6 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-2xl shadow max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">💰 Supplies / Cost of Goods</h2>

      {/* Input Form */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <input name="name" value={form.name} onChange={handleChange} placeholder="Name" className="p-2 rounded border dark:bg-zinc-800" />
        <input name="cost" value={form.cost} onChange={handleChange} type="number" placeholder="Cost per unit" className="p-2 rounded border dark:bg-zinc-800" />
        <select name="type" value={form.type} onChange={handleChange} className="p-2 rounded border dark:bg-zinc-800">
          <option value="">Type</option>
          {SUPPLY_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select name="unit" value={form.unit} onChange={handleChange} className="p-2 rounded border dark:bg-zinc-800">
          <option value="">Unit</option>
          {UNITS.map((u) => <option key={u}>{u}</option>)}
        </select>
        <input name="quantity" value={form.quantity} onChange={handleChange} type="number" placeholder="Quantity on hand" className="p-2 rounded border dark:bg-zinc-800" />
        <input name="reorderLink" value={form.reorderLink} onChange={handleChange} placeholder="Reorder URL (optional)" className="p-2 rounded border dark:bg-zinc-800 col-span-full" />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-4">
        <button
          onClick={handleAdd}
          aria-label="Add Supply"
          data-testid="add-supply"
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow"
        >
          <PlusCircle className="w-4 h-4" /> Add Supply
        </button>
        <button
          onClick={exportAuditCSV}
          aria-label="Export Audit Log"
          data-testid="export-audit-log"
          className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded shadow"
        >
          <FileDown className="w-4 h-4" /> Export Audit Log
        </button>
      </div>

      {/* Batch Edit */}
      {selected.length > 0 && (
        <div className="bg-yellow-100 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 p-3 rounded-md space-y-2">
          <div className="text-sm font-medium">
            {selected.length} selected —
            <button className="ml-2 text-blue-500 hover:underline" onClick={() => setSelected(supplies.map(s => s.id))}>Select All</button>
            <button className="ml-2 text-red-500 hover:underline" onClick={() => setSelected([])}>Clear</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={batchEdit.type} onChange={(e) => setBatchEdit({ ...batchEdit, type: e.target.value })} className="p-1 border rounded text-sm dark:bg-zinc-800">
              <option value="">Set Type</option>
              {SUPPLY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={batchEdit.unit} onChange={(e) => setBatchEdit({ ...batchEdit, unit: e.target.value })} className="p-1 border rounded text-sm dark:bg-zinc-800">
              <option value="">Set Unit</option>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
            <input value={batchEdit.reorderLink} onChange={(e) => setBatchEdit({ ...batchEdit, reorderLink: e.target.value })} placeholder="Reorder URL" className="p-1 border rounded text-sm dark:bg-zinc-800" />
            <button onClick={handleBatchEdit} className="flex items-center gap-1 bg-green-600 text-white px-3 py-1 rounded text-sm">
              <Check className="w-4 h-4" /> Apply Edits
            </button>
            <button onClick={handleBatchDelete} className="flex items-center gap-1 bg-red-600 text-white px-3 py-1 rounded text-sm">
              <Trash2 className="w-4 h-4" /> Delete Selected
            </button>
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
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Restock</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {supplies.map((supply) => {
              const isChecked = selected.includes(supply.id);
              return (
                <tr key={supply.id} className={`border-t border-zinc-200 dark:border-zinc-700 ${supply.quantity < 1 ? 'bg-yellow-100 dark:bg-yellow-900' : ''}`}>
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      aria-label={`Select ${supply.name}`}
                      onChange={() =>
                        setSelected(prev => isChecked ? prev.filter(id => id !== supply.id) : [...prev, supply.id])
                      }
                    />
                  </td>
                  <td className="p-2">{supply.name}</td>
                  <td className="p-2">${supply.cost?.toFixed(2)}</td>
                  <td className="p-2">{supply.quantity || 0}</td>
                  <td className="p-2">{supply.unit}</td>
                  <td className="p-2">{supply.type}</td>
                  <td className="p-2 flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="+"
                      className="w-20 p-1 border rounded dark:bg-zinc-800"
                      value={restockAmounts[supply.id] || ""}
                      onChange={(e) =>
                        setRestockAmounts({ ...restockAmounts, [supply.id]: e.target.value })
                      }
                    />
                    <button
                      onClick={() => handleRestock(supply.id)}
                      aria-label={`Restock ${supply.name}`}
                      className="text-green-600 hover:underline"
                    >
                      <PlusCircle className="w-4 h-4" />
                    </button>
                  </td>
                  <td className="p-2 space-x-2">
                    <button
                      onClick={() => handleDelete(supply.id, supply.name)}
                      aria-label={`Delete supply ${supply.name || supply.id}`}
                      className="text-red-500 hover:underline"
                    >
                      <Trash2 className="inline w-4 h-4" />
                    </button>
                    {supply.reorderLink && (
                      <a
                        href={supply.reorderLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open reorder link for ${supply.name}`}
                        className="text-blue-500 hover:underline"
                      >
                        <ExternalLink className="inline w-4 h-4" />
                      </a>
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
