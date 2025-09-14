// src/pages/StrainManager.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { auth, db, storage } from "../firebase-config";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  UploadCloud,
  Trash2,
  Pencil,
  Boxes,
  Rocket,
  PlusCircle,
  ScrollText,
  Syringe,
  Wand2,
  TestTube,
  X,
} from "lucide-react";
import { isActiveGrow } from "../lib/growFilters";
import { useNavigate } from "react-router-dom";
import GrowForm from "../components/Grow/GrowForm";

/* ---------- Species presets ---------- */
const PSILOCYBIN_SPECIES = [
  "Psilocybe cubensis",
  "Psilocybe cyanescens",
  "Psilocybe azurescens",
  "Psilocybe semilanceata",
  "Psilocybe subaeruginosa",
  "Psilocybe allenii",
  "Psilocybe baeocystis",
  "Psilocybe mexicana",
  "Psilocybe tampanensis",
  "Psilocybe caerulescens",
  "Psilocybe caerulipes",
  "Psilocybe hoogshagenii",
  "Psilocybe stuntzii",
  "Psilocybe zapotecorum",
  "Psilocybe weilii",
  "Panaeolus cyanescens",
  "Panaeolus cambodginiensis",
];

const MED_EDIBLE_SPECIES = [
  "Pleurotus ostreatus (Oyster)",
  "Pleurotus pulmonarius (Phoenix Oyster)",
  "Pleurotus djamor (Pink Oyster)",
  "Pleurotus eryngii (King Oyster)",
  "Hericium erinaceus (Lion’s Mane)",
  "Ganoderma lucidum (Reishi)",
  "Grifola frondosa (Maitake)",
  "Lentinula edodes (Shiitake)",
  "Agaricus bisporus (Button/Portobello)",
  "Flammulina velutipes (Enoki)",
  "Hypsizygus tessellatus (Shimeji)",
  "Auricularia auricula-judae (Wood Ear)",
  "Volvariella volvacea (Paddy Straw)",
  "Stropharia rugosoannulata (Wine Cap)",
  "Cordyceps militaris",
  "Coprinus comatus (Shaggy Mane)",
  "Morchella esculenta (Morel)",
];

const norm = (s) => String(s || "").trim().toLowerCase();

/* Basic type normalizer for modal list */
function normalizeType(t = "") {
  const s = String(t).toLowerCase();
  if (s.includes("agar")) return "Agar";
  if (s.includes("lc") || s.includes("liquid")) return "LC";
  if (s.includes("bulk")) return "Bulk";
  if (s.includes("grain")) return "Grain Jar";
  return "Other";
}

export default function StrainManager({
  strains,
  grows,
  onUpdateStrain,
  onDeleteStrain,
  onUploadStrainImage,
  setEditingGrow, // optional: open Add Grow prefilled from Library (Dashboard path)
}) {
  const navigate = useNavigate();

  const [localStrains, setLocalStrains] = useState(Array.isArray(strains) ? strains : []);
  const [localGrows, setLocalGrows] = useState(Array.isArray(grows) ? grows : []);
  const [libraryItems, setLibraryItems] = useState([]);
  const [savedSpecies, setSavedSpecies] = useState([]); // user's custom species list

  // Edit form (only shown when editing an existing strain)
  const [form, setForm] = useState({
    name: "",
    scientificName: "",
    description: "",
    genetics: "",
    notes: "",
    photoURL: "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Modal: all grows for a strain
  const [viewStrain, setViewStrain] = useState(null); // {name, scientificName?}

  // Inline GrowForm state (Strains page)
  const [inlineGrow, setInlineGrow] = useState(null);

  // Library add form
  const LIBRARY_TYPES = [
    "Spore Syringe",
    "Spore Swab",
    "Spore Print",
    "LC",
    "Agar Plate",
    "Agar Slant",
  ];
  const LOCATION_OPTS = ["Fridge", "Freezer", "Room"];
  const [newItem, setNewItem] = useState({
    type: "Spore Syringe",
    strainName: "",
    scientificName: "",
    qty: 1,
    unit: "count",
    location: "Fridge",
    acquired: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  /* ---------------- Data wiring ---------------- */
  useEffect(() => {
    if (Array.isArray(strains)) setLocalStrains(strains);
  }, [strains]);
  useEffect(() => {
    if (Array.isArray(grows)) setLocalGrows(grows);
  }, [grows]);

  // Live data when props not provided + always live for library/species
  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;

    const unsubLib = onSnapshot(collection(db, "users", u.uid, "library"), (snap) => {
      setLibraryItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsubSpecies = onSnapshot(collection(db, "users", u.uid, "species"), (snap) => {
      setSavedSpecies(
        snap.docs.map((d) => (d.data()?.name ? String(d.data().name) : "")).filter(Boolean)
      );
    });

    (async () => {
      if (!Array.isArray(strains)) {
        const sSnap = await getDocs(collection(db, "users", u.uid, "strains"));
        setLocalStrains(snapToArray(sSnap));
      }
      if (!Array.isArray(grows)) {
        const gSnap = await getDocs(collection(db, "users", u.uid, "grows"));
        setLocalGrows(snapToArray(gSnap));
      }
    })();

    return () => {
      unsubLib();
      unsubSpecies();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapToArray = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  /* ---------------- Species suggestions ---------------- */
  const speciesSuggestions = useMemo(() => {
    const set = new Set();
    [...PSILOCYBIN_SPECIES, ...MED_EDIBLE_SPECIES, ...savedSpecies].forEach((s) => {
      const clean = String(s || "").trim();
      if (clean) set.add(clean);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [savedSpecies]);

  const ensureSpeciesSaved = async (name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    if (savedSpecies.some((s) => norm(s) === norm(clean))) return;
    const u = auth.currentUser;
    if (!u) return;
    const qRef = query(collection(db, "users", u.uid, "species"), where("norm", "==", norm(clean)));
    const qSnap = await getDocs(qRef);
    if (!qSnap.empty) return;
    await addDoc(collection(db, "users", u.uid, "species"), {
      name: clean,
      norm: norm(clean),
      addedAt: new Date().toISOString(),
    });
  };

  /* ---------------- Strain edit ---------------- */
  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const handleImageChange = (e) => setImageFile(e.target.files?.[0] || null);

  const uploadImage = async () => {
    if (!imageFile) return form.photoURL || "";
    if (typeof onUploadStrainImage === "function") {
      return await onUploadStrainImage(imageFile);
    }
    const u = auth.currentUser;
    if (!u) return form.photoURL || "";
    const path = `users/${u.uid}/strains/${Date.now()}_${imageFile.name}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, imageFile);
    return await getDownloadURL(r);
  };

  const resetForm = () => {
    setForm({
      name: "",
      scientificName: "",
      description: "",
      genetics: "",
      notes: "",
      photoURL: "",
    });
    setImageFile(null);
    setEditingId(null);
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      setSaving(true);
      const photoURL = await uploadImage();

      const data = {
        name: form.name.trim(),
        scientificName: form.scientificName.trim(),
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
        await ensureSpeciesSaved(data.scientificName);
      }

      if (!(Array.isArray(strains))) {
        const u = auth.currentUser;
        if (u) {
          const sSnap = await getDocs(collection(db, "users", u.uid, "strains"));
          setLocalStrains(snapToArray(sSnap));
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
      scientificName: s.scientificName || "",
      description: s.description || "",
      genetics: s.genetics || "",
      notes: s.notes || "",
      photoURL: s.photoURL || "",
    });
    setImageFile(null);
    setEditingId(s.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
        setLocalStrains(snapToArray(sSnap));
      }
    }
  };

  /* ---------------- Stats & storage ---------------- */
  const calculateStats = (strainName) => {
    const related = (Array.isArray(localGrows) ? localGrows : []).filter(
      (g) => norm(g.strain) === norm(strainName)
    );
    const activeCount = related.filter(isActiveGrow).length;

    const asDate = (v) => {
      if (!v) return null;
      if (v?.toDate) return v.toDate();
      if (v instanceof Date) return v;
      const d = new Date(v);
      return isNaN(d) ? null : d;
    };
    const span = (a, b) => {
      const A = asDate(a),
        B = asDate(b);
      return A && B ? (B - A) / 86400000 : null;
    };
    const avg = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null);
    const fmt = (v) => (v == null ? "—" : Number(v).toFixed(1));

    const relatedAll = related;
    const colonize = relatedAll
      .map((g) => span(g?.stageDates?.Inoculated, g?.stageDates?.Colonized))
      .filter(Number.isFinite);
    const fruit = relatedAll
      .map((g) => span(g?.stageDates?.Colonized, g?.stageDates?.Fruiting))
      .filter(Number.isFinite);
    const harvest = relatedAll
      .map((g) => span(g?.stageDates?.Fruiting, g?.stageDates?.Harvested))
      .filter(Number.isFinite);

    const sumFromFlushes = (g) => {
      const list = Array.isArray(g?.flushes)
        ? g.flushes
        : Array.isArray(g?.harvest?.flushes)
        ? g.harvest.flushes
        : [];
      const wet = list.reduce((s, f) => s + (Number(f?.wet) || 0), 0) || Number(g?.wetYield) || 0;
      const dry = list.reduce((s, f) => s + (Number(f?.dry) || 0), 0) || Number(g?.dryYield) || 0;
      return { wet, dry };
    };
    const wetVals = relatedAll.map((g) => sumFromFlushes(g).wet).filter(Number.isFinite);
    const dryVals = relatedAll.map((g) => sumFromFlushes(g).dry).filter(Number.isFinite);

    return {
      activeCount,
      avgColonize: fmt(avg(colonize)),
      avgFruit: fmt(avg(fruit)),
      avgHarvest: fmt(avg(harvest)),
      avgWet: fmt(avg(wetVals)),
      avgDry: fmt(avg(dryVals)),
    };
  };

  const calculateContam = (strainName) => {
    const isContam = (g) => {
      const s = `${g?.status || ""} ${g?.stage || ""} ${g?.outcome || ""}`.toLowerCase();
      return (
        s.includes("contam") ||
        s.includes("failed") ||
        g?.contaminated === true ||
        String(g?.result || "").toLowerCase() === "contaminated"
      );
    };
    const related = (Array.isArray(localGrows) ? localGrows : []).filter(
      (g) => norm(g.strain) === norm(strainName)
    );
    const total = related.length;
    const contam = related.filter(isContam).length;
    const rate = total ? ((contam / total) * 100).toFixed(1) : "—";
    return { total, contam, rate };
  };

  const ensureStrainExists = async (name, scientificName) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    const u = auth.currentUser;
    if (!u) return;
    const col = collection(db, "users", u.uid, "strains");
    const qRef = query(col, where("name", "==", clean));
    const snap = await getDocs(qRef);
    if (!snap.empty) return; // already exists
    await addDoc(col, {
      name: clean,
      scientificName: String(scientificName || "").trim(),
      createdAt: new Date().toISOString(),
      source: "library",
    });
  };

  const onAddLibraryItem = async (e) => {
    e?.preventDefault?.();
    const u = auth.currentUser;
    if (!u) return;
    const payload = {
      ...newItem,
      qty: Number(newItem.qty || 0),
      createdAt: new Date().toISOString(),
    };
    await addDoc(collection(db, "users", u.uid, "library"), payload);
    await ensureStrainExists(newItem.strainName, newItem.scientificName);
    await ensureSpeciesSaved(newItem.scientificName);

    setNewItem((s) => ({
      ...s,
      strainName: "",
      scientificName: "",
      qty: 1,
      unit: "count",
      acquired: new Date().toISOString().slice(0, 10),
      notes: "",
    }));
  };

  const onDeleteLibraryItem = async (id) => {
    const u = auth.currentUser;
    if (!u || !id) return;
    await deleteDoc(doc(db, "users", u.uid, "library", id));
  };

  // 🔧 New Grow from Library
  const startGrowFromLibrary = (it) => {
    const kind = it?.type || "";
    const strain = it?.strainName || "";

    // choose next step based on source item
    let nextType = "Agar";
    if (kind === "LC") nextType = "Grain Jar";
    else if (kind.includes("Agar")) nextType = "LC";

    const prefill = {
      strain,
      strainName: strain,
      type: nextType,
      growType: nextType,
      stage: "Inoculated",
      status: "Active",
      parentId: it?.id,
      parentType: kind,
      parentLabel: strain || kind,
      parentSource: "Library",
    };

    if (typeof setEditingGrow === "function") {
      setEditingGrow(prefill); // open global modal if provided
      return;
    }

    // Fallback: open inline on Strains page
    setInlineGrow(prefill);
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  };

  // Per-strain counts (swabs / syringes / prints / LC)
  const groupedCountsMap = useMemo(() => {
    const map = new Map();
    for (const it of libraryItems) {
      const key = norm(it.strainName);
      if (!key) continue;
      const entry = map.get(key) || { name: it.strainName, counts: {} };
      const t = it.type || "Item";
      const qty = Number(it.qty || 0) || 0;
      entry.counts[t] = (entry.counts[t] || 0) + qty;
      map.set(key, entry);
    }
    return map;
  }, [libraryItems]);

  const strainsToShow = Array.isArray(strains) ? strains : localStrains;

  // Modal grows for selected strain
  const growsForSelected = useMemo(() => {
    if (!viewStrain) return [];
    const target = norm(viewStrain.name || viewStrain);
    return (Array.isArray(localGrows) ? localGrows : []).filter(
      (g) => norm(g.strain) === target
    );
  }, [viewStrain, localGrows]);

  /* Close inline modal on ESC */
  useEffect(() => {
    if (!inlineGrow) return;
    const onKey = (e) => {
      if (e.key === "Escape") setInlineGrow(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineGrow]);

  /* ---------------- UI ---------------- */
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Edit Strain (only when editing) */}
      {editingId && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow space-y-4"
        >
          <h2 className="text-xl font-bold">Edit Strain</h2>

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

            {/* Scientific name combobox */}
            <div className="relative">
              <input
                name="scientificName"
                list="speciesOptions"
                placeholder="Scientific name (e.g., Psilocybe cubensis)"
                value={form.scientificName}
                onChange={handleChange}
                className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 w-full"
                aria-label="Scientific name"
              />
              <datalist id="speciesOptions">
                {speciesSuggestions.map((s) => (
                  <option value={s} key={s} />
                ))}
              </datalist>
            </div>

            <input
              name="genetics"
              placeholder="Genetics (optional)"
              value={form.genetics}
              onChange={handleChange}
              className="p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 md:col-span-2"
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
              onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              className="md:col-span-2"
              aria-label="Upload strain image"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 accent-bg text-white px-4 py-2 rounded-full hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
              aria-busy={saving ? "true" : "false"}
            >
              <UploadCloud className="w-4 h-4" />
              {saving ? "Saving…" : "Update Strain"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 rounded-full bg-zinc-200 dark:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Library / Storage */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <ScrollText className="h-5 w-5 opacity-80" />
          <h2 className="text-xl font-bold">Strain Library / Storage</h2>
        </div>

        {/* Add library item */}
        <form onSubmit={onAddLibraryItem} className="grid grid-cols-1 md:grid-cols-7 gap-2">
          <select
            className="chip w-full"
            value={newItem.type}
            onChange={(e) => setNewItem((s) => ({ ...s, type: e.target.value }))}
            aria-label="Item type"
          >
            {LIBRARY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <input
            className="chip w-full"
            placeholder="Strain name"
            value={newItem.strainName}
            onChange={(e) => setNewItem((s) => ({ ...s, strainName: e.target.value }))}
            required
            aria-label="Strain name"
          />

          {/* Scientific name combobox */}
          <div className="relative">
            <input
              list="speciesOptions"
              className="chip w-full"
              placeholder="Scientific name"
              value={newItem.scientificName}
              onChange={(e) => setNewItem((s) => ({ ...s, scientificName: e.target.value }))}
              aria-label="Scientific name"
            />
            <datalist id="speciesOptions">
              {speciesSuggestions.map((s) => (
                <option value={s} key={s} />
              ))}
            </datalist>
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="1"
              className="chip w-full"
              placeholder="Qty"
              value={newItem.qty}
              onChange={(e) => setNewItem((s) => ({ ...s, qty: e.target.value }))}
              required
              aria-label="Quantity"
            />
            <select
              className="chip"
              value={newItem.unit}
              onChange={(e) => setNewItem((s) => ({ ...s, unit: e.target.value }))}
              title="Unit"
              aria-label="Unit"
            >
              <option value="count">count</option>
              <option value="ml">ml</option>
              <option value="plate">plate</option>
            </select>
          </div>

          <select
            className="chip w-full"
            value={newItem.location}
            onChange={(e) => setNewItem((s) => ({ ...s, location: e.target.value }))}
            aria-label="Location"
          >
            {LOCATION_OPTS.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>

          <input
            type="date"
            className="chip w-full"
            value={newItem.acquired}
            onChange={(e) => setNewItem((s) => ({ ...s, acquired: e.target.value }))}
            title="Acquired"
            aria-label="Acquired date"
          />

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full accent-bg text-white shadow-sm"
            title="Add to Library"
          >
            <PlusCircle className="h-4 w-4" />
            <span className="whitespace-nowrap">Add to Library</span>
          </button>

          <textarea
            className="chip md:col-span-7 w-full"
            placeholder="Notes (optional)"
            value={newItem.notes}
            onChange={(e) => setNewItem((s) => ({ ...s, notes: e.target.value }))}
            rows={2}
            aria-label="Notes"
          />
        </form>

        {/* Library list */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="bg-zinc-50 dark:bg-zinc-900/60 px-3 py-2 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {libraryItems.length} items
          </div>
          {libraryItems.length === 0 ? (
            <div className="p-4 text-sm text-zinc-500">
              Nothing in your library yet. Add Swabs, Syringes, Prints, LCs, or Agar.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {libraryItems.map((it) => {
                const kind = it.type || "";
                let KindIcon = Boxes;
                if (kind === "Spore Syringe") KindIcon = Syringe;
                else if (kind === "Spore Swab") KindIcon = Wand2;
                else if (kind === "Spore Print") KindIcon = ScrollText;
                else if (kind.includes("Agar")) KindIcon = Boxes;
                else if (kind === "LC") KindIcon = TestTube;

                return (
                  <li key={it.id} className="p-3 flex items-center gap-3 justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <KindIcon className="h-5 w-5 opacity-80 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {kind} — {it.strainName || "Unknown strain"}
                        </div>
                        <div className="text-xs text-zinc-500 truncate">
                          {it.scientificName ? `${it.scientificName} · ` : ""}
                          Qty: {it.qty ?? 0} {it.unit || "count"} · {it.location || "Unknown"} ·{" "}
                          Acquired: {it.acquired || "—"}
                        </div>
                        {it.notes ? (
                          <div className="text-xs text-zinc-500 mt-1 line-clamp-2">
                            {it.notes}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 px-3 py-1.5 min-w-[110px] rounded-full accent-bg text-white shadow-sm"
                        title="Start a new grow using this library item"
                        onClick={() => startGrowFromLibrary(it)}
                      >
                        <Rocket className="h-4 w-4" />
                        <span className="whitespace-nowrap">New Grow</span>
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-full text-sm bg-zinc-100 text-zinc-800 border border-zinc-300 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700 dark:hover:bg-zinc-700"
                        title="Delete"
                        onClick={() => onDeleteLibraryItem(it.id)}
                      >
                        <Trash2 className="h-4 w-4 inline -mt-0.5 mr-1" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Strain cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {strainsToShow.map((s) => {
          const stats = calculateStats(s.name);
          const contam = calculateContam(s.name);

          const entry = groupedCountsMap.get(norm(s.name));
          const gc = entry?.counts || {};
          const nPrints = gc["Spore Print"] || 0;
          const nSwabs = gc["Spore Swab"] || 0;
          const nSyringes = gc["Spore Syringe"] || 0;
          const nLC = gc["LC"] || 0;

          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => setViewStrain({ name: s.name, scientificName: s.scientificName })}
              onKeyDown={(e) =>
                e.key === "Enter"
                  ? setViewStrain({ name: s.name, scientificName: s.scientificName })
                  : null
              }
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4 space-y-2 relative cursor-pointer hover:ring-2 hover:ring-zinc-300 dark:hover:ring-zinc-700 transition"
              title="Click to view all grows for this strain"
            >
              {s.photoURL ? (
                <img
                  src={s.photoURL}
                  alt={s.name}
                  className="w-full h-40 object-cover rounded-xl"
                />
              ) : null}
              <h3 className="text-lg font-bold">{s.name}</h3>
              {s.scientificName ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300 italic">
                  {s.scientificName}
                </p>
              ) : s.genetics ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{s.genetics}</p>
              ) : null}
              {s.description && <p className="text-sm">{s.description}</p>}
              {s.notes && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{s.notes}</p>
              )}

              {/* Storage counts as pills */}
              <div className="flex flex-wrap gap-1 pt-1">
                {nSyringes > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700">
                    Syringes: <strong>{nSyringes}</strong>
                  </span>
                )}
                {nSwabs > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700">
                    Swabs: <strong>{nSwabs}</strong>
                  </span>
                )}
                {nPrints > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700">
                    Prints: <strong>{nPrints}</strong>
                  </span>
                )}
                {nLC > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700">
                    LC: <strong>{nLC}</strong>
                  </span>
                )}
                {nSyringes + nSwabs + nPrints + nLC === 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-100/70 dark:bg-zinc-800/50">
                    No stored items
                  </span>
                )}
              </div>

              {/* Grow + contam stats */}
              <div className="text-sm text-blue-300 pt-2 space-y-1">
                <div>📈 Active Grows: <strong>{stats.activeCount}</strong></div>
                <div>🧫 Contam Rate: <strong>{contam.rate}%</strong> {contam.total ? `(${contam.contam}/${contam.total})` : ""}</div>
                <div>⏱️ Colonize Avg: <strong>{stats.avgColonize}d</strong></div>
                <div>🍄 Fruiting Avg: <strong>{stats.avgFruit}d</strong></div>
                <div>✂️ Harvest Avg: <strong>{stats.avgHarvest}d</strong></div>
                <div>💧 Wet Yield Avg: <strong>{stats.avgWet}g</strong></div>
                <div>🌬️ Dry Yield Avg: <strong>{stats.avgDry}g</strong></div>
              </div>

              {/* edit/delete: stop opening modal */}
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleEdit(s); }}
                  className="text-blue-500 hover:text-blue-700 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
                  aria-label={`Edit ${s.name}`}
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
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
          <div className="text-sm opacity-70">No strains yet. Add a Library item to create one.</div>
        )}
      </div>

      {/* Modal: All grows for selected strain */}
      {viewStrain && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setViewStrain(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`All grows for ${viewStrain.name}`}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl max-w-5xl w-full max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h3 className="text-lg font-semibold">{viewStrain.name}</h3>
                {viewStrain.scientificName ? (
                  <p className="text-sm text-zinc-500 italic">{viewStrain.scientificName}</p>
                ) : null}
              </div>
              <button
                onClick={() => setViewStrain(null)}
                className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-auto">
              {/* your existing list of grows-by-strain stays as-is */}
            </div>
          </div>
        </div>
      )}

      {/* Inline GrowForm modal (opens when pressing “New Grow” in Library) */}
      {inlineGrow && (
        <div
          className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setInlineGrow(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 font-semibold flex items-center justify-between">
              <span>New Grow</span>
              <button
                className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setInlineGrow(null)}
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <GrowForm
                editingGrow={inlineGrow}
                Close={() => setInlineGrow(null)}
                onClose={() => setInlineGrow(null)}
                onCancel={() => setInlineGrow(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
