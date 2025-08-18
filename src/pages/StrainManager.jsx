// src/pages/StrainManager.jsx
import React, { useEffect, useMemo, useState } from "react";

// Fallback-only Firebase imports (used iff App doesn't pass props/handlers yet)
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db, storage } from "../firebase-config";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { UploadCloud, Trash2, Pencil } from "lucide-react";
// ✅ Use the same active-grow rule everywhere
import { isActiveGrow } from "../lib/growFilters";

/**
 * StrainManager
 * Preferred (prop-driven) usage — NO reads here when App supplies data/handlers:
 *   <StrainManager
 *     strains={strains}                // [{ id, name, description, ... }]
 *     grows={grows}                    // used for per-strain stats
 *     onCreateStrain={(data) => ...}   // returns new id
 *     onUpdateStrain={(id, patch) => ...}
 *     onDeleteStrain={(id) => ...}
 *     onUploadStrainImage={async (file) => "https://..."} // optional
 *   />
 *
 * Fallback (legacy) — if props/handlers are not provided, this file will:
 *   - read strains & grows directly from Firestore
 *   - upload strain photo to Firebase Storage
 *   - write strains to Firestore
 */
export default function StrainManager({
  strains,
  grows,
  onCreateStrain,
  onUpdateStrain,
  onDeleteStrain,
  onUploadStrainImage,
}) {
  // Local mirrors so the UI stays snappy regardless of data source
  const [localStrains, setLocalStrains] = useState(Array.isArray(strains) ? strains : []);
  const [localGrows, setLocalGrows] = useState(Array.isArray(grows) ? grows : []);
  const [form, setForm] = useState({
    name: "",
    description: "",
    genetics: "",
    notes: "",
    photoURL: "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Keep local mirrors in sync with props when provided
  useEffect(() => {
    if (Array.isArray(strains)) setLocalStrains(strains);
  }, [strains]);
  useEffect(() => {
    if (Array.isArray(grows)) setLocalGrows(grows);
  }, [grows]);

  // Fallback fetch when props aren’t provided
  useEffect(() => {
    if (Array.isArray(strains) && Array.isArray(grows)) return;
    (async () => {
      const user = auth.currentUser;
      if (!user) return;

      if (!Array.isArray(strains)) {
        const sSnap = await getDocs(collection(db, "users", user.uid, "strains"));
        setLocalStrains(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
      if (!Array.isArray(grows)) {
        const gSnap = await getDocs(collection(db, "users", user.uid, "grows"));
        setLocalGrows(gSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const handleImageChange = (e) => setImageFile(e.target.files?.[0] || null);

  // Upload helper (uses App handler if provided, else Storage)
  const uploadImage = async () => {
    if (!imageFile) return form.photoURL || "";
    if (typeof onUploadStrainImage === "function") {
      return await onUploadStrainImage(imageFile);
    }
    const user = auth.currentUser;
    if (!user) return form.photoURL || "";
    const path = `users/${user.uid}/strains/${Date.now()}_${imageFile.name}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, imageFile);
    return await getDownloadURL(r);
  };

  const resetForm = () => {
    setForm({ name: "", description: "", genetics: "", notes: "", photoURL: "" });
    setImageFile(null);
    setEditingId(null);
    setError("");
  };

  // Create/Update (prefers App handlers)
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      setSaving(true);
      const photoURL = await uploadImage();

      const data = {
        name: form.name.trim(),
        description: form.description || "",
        genetics: form.genetics || "",
        notes: form.notes || "",
        photoURL,
      };

      if (!data.name) throw new Error("Strain name is required.");

      if (editingId) {
        if (typeof onUpdateStrain === "function") {
          await onUpdateStrain(editingId, { ...data, updatedAt: new Date().toISOString() });
        } else {
          const u = auth.currentUser;
          if (!u) return;
          await updateDoc(doc(db, "users", u.uid, "strains", editingId), {
            ...data,
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        if (typeof onCreateStrain === "function") {
          await onCreateStrain({ ...data, createdAt: new Date().toISOString() });
        } else {
          const u = auth.currentUser;
          if (!u) return;
          await addDoc(collection(db, "users", u.uid, "strains"), {
            ...data,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      // Refresh fallback lists if we’re not prop-driven
      if (!(Array.isArray(strains))) {
        const u = auth.currentUser;
        if (u) {
          const sSnap = await getDocs(collection(db, "users", u.uid, "strains"));
          setLocalStrains(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
      }
      resetForm();
    } catch (err) {
      console.error(err);
      setError(err?.message || "Failed to save strain.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (s) => {
    setForm({
      name: s.name || "",
      description: s.description || "",
      genetics: s.genetics || "",
      notes: s.notes || "",
      photoURL: s.photoURL || "",
    });
    setImageFile(null);
    setEditingId(s.id);
  };

  const handleDelete = async (id) => {
    if (!id) return;
    if (!confirm("Delete this strain? This cannot be undone.")) return;

    if (typeof onDeleteStrain === "function") {
      await onDeleteStrain(id);
    } else {
      const u = auth.currentUser;
      if (!u) return;
      await deleteDoc(doc(db, "users", u.uid, "strains", id));
    }

    if (!(Array.isArray(strains))) {
      const u = auth.currentUser;
      if (u) {
        const sSnap = await getDocs(collection(db, "users", u.uid, "strains"));
        setLocalStrains(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    }
  };

  // ---- Stats from grows (works in both modes) ----
  const calculateStats = (strainName) => {
    const norm = (s) => String(s || "").trim().toLowerCase();

    // Only grows that exactly match this strain (case-insensitive)
    const related = (Array.isArray(localGrows) ? localGrows : []).filter(
      (g) => norm(g.strain) === norm(strainName)
    );

    // Active count using the unified app rule
    const activeCount = related.filter(isActiveGrow).length;

    // Helpers
    const asDate = (v) => {
      if (!v) return null;
      if (v?.toDate) return v.toDate();
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d) ? null : d;
    };
    const daysBetween = (from, to) => {
      const f = asDate(from);
      const t = asDate(to);
      return f && t ? (t - f) / (1000 * 60 * 60 * 24) : null;
    };
    const avg = (arr) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const fmt = (v) => (v == null ? "—" : Number(v).toFixed(1));

    // Stage duration averages (ignore items missing either date)
    const colonizeDays = related
      .map((g) => daysBetween(g?.stageDates?.Inoculated, g?.stageDates?.Colonized))
      .filter((n) => Number.isFinite(n));
    const fruitDays = related
      .map((g) => daysBetween(g?.stageDates?.Colonized, g?.stageDates?.Fruiting))
      .filter((n) => Number.isFinite(n));
    const harvestDays = related
      .map((g) => daysBetween(g?.stageDates?.Fruiting, g?.stageDates?.Harvested))
      .filter((n) => Number.isFinite(n));

    // ✅ Yield from flushes (fallback to top-level fields if present)
    const sumFromFlushes = (g) => {
      const list = Array.isArray(g?.flushes)
        ? g.flushes
        : Array.isArray(g?.harvest?.flushes)
        ? g.harvest.flushes
        : [];
      const wet = list.reduce((s, f) => s + (Number(f?.wet) || 0), 0);
      const dry = list.reduce((s, f) => s + (Number(f?.dry) || 0), 0);
      // keep old schema support if someone stored flat totals
      const flatWet = Number(g?.wetYield) || 0;
      const flatDry = Number(g?.dryYield) || 0;
      return {
        wet: wet || flatWet,
        dry: dry || flatDry,
      };
    };

    const wetVals = related
      .map((g) => sumFromFlushes(g).wet)
      .filter((n) => Number.isFinite(n));
    const dryVals = related
      .map((g) => sumFromFlushes(g).dry)
      .filter((n) => Number.isFinite(n));

    return {
      activeCount,
      avgColonize: fmt(avg(colonizeDays)),
      avgFruit: fmt(avg(fruitDays)),
      avgHarvest: fmt(avg(harvestDays)),
      avgWet: fmt(avg(wetVals)),
      avgDry: fmt(avg(dryVals)),
    };
  };

  const strainsToShow = Array.isArray(strains) ? strains : localStrains;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow space-y-4"
      >
        <h2 className="text-xl font-bold">
          {editingId ? "Edit Strain" : "Add Strain"}
        </h2>

        {error && (
          <div className="p-2 rounded bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            name="name"
            placeholder="Strain Name"
            value={form.name}
            onChange={handleChange}
            required
            className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
            aria-label="Strain name"
          />
          <input
            name="genetics"
            placeholder="Genetics (e.g., P. cubensis GT)"
            value={form.genetics}
            onChange={handleChange}
            className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
            aria-label="Genetics"
          />
          <input
            name="description"
            placeholder="Short Description"
            value={form.description}
            onChange={handleChange}
            className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 md:col-span-2"
            aria-label="Short description"
          />
          <textarea
            name="notes"
            placeholder="Notes"
            value={form.notes}
            onChange={handleChange}
            className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 md:col-span-2"
            aria-label="Notes"
            rows={3}
          />
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="md:col-span-2"
            aria-label="Upload strain image"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 accent-bg text-white px-4 py-2 rounded hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
          aria-busy={saving ? "true" : "false"}
        >
          <UploadCloud className="w-4 h-4" />
          {saving ? "Saving…" : editingId ? "Update Strain" : "Add Strain"}
        </button>
      </form>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {strainsToShow.map((s) => {
          const stats = calculateStats(s.name);
          return (
            <div
              key={s.id}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4 space-y-2 relative"
            >
              {s.photoURL ? (
                <img
                  src={s.photoURL}
                  alt={s.name}
                  className="w-full h-40 object-cover rounded-xl"
                />
              ) : null}
              <h3 className="text-lg font-bold">{s.name}</h3>
              {s.genetics && (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{s.genetics}</p>
              )}
              {s.description && <p className="text-sm">{s.description}</p>}
              {s.notes && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{s.notes}</p>
              )}

              <div className="text-sm text-blue-300 pt-2 space-y-1">
                <div>
                  📈 Active Grows: <strong>{stats.activeCount}</strong>
                </div>
                <div>
                  ⏱️ Colonize Avg: <strong>{stats.avgColonize}d</strong>
                </div>
                <div>
                  🍄 Fruiting Avg: <strong>{stats.avgFruit}d</strong>
                </div>
                <div>
                  ✂️ Harvest Avg: <strong>{stats.avgHarvest}d</strong>
                </div>
                <div>
                  💧 Wet Yield Avg: <strong>{stats.avgWet}g</strong>
                </div>
                <div>
                  🌬️ Dry Yield Avg: <strong>{stats.avgDry}g</strong>
                </div>
              </div>

              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={() => handleEdit(s)}
                  className="text-blue-500 hover:text-blue-700 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
                  aria-label={`Edit ${s.name}`}
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="text-red-500 hover:text-red-700 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
                  aria-label={`Delete ${s.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
        {strainsToShow.length === 0 && (
          <div className="text-sm opacity-70">No strains yet.</div>
        )}
      </div>
    </div>
  );
}
