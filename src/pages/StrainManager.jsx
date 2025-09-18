// src/pages/StrainManager.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  serverTimestamp,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { auth, db, storage } from "../firebase-config";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
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
  CheckSquare,
  Image as ImageIcon,
  List as ListIcon,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import GrowForm from "../components/Grow/GrowForm";
import { useConfirm } from "../components/ui/ConfirmDialog";

/* ---------- helpers ---------- */
const norm = (s) => String(s || "").trim().toLowerCase();

function normalizeType(t = "") {
  const s = String(t).toLowerCase();
  if (s.includes("agar")) return "Agar";
  if (s.includes("lc") || s.includes("liquid")) return "LC";
  if (s.includes("bulk")) return "Bulk";
  if (s.includes("grain")) return "Grain Jar";
  return "Other";
}
const asDate = (v) => {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmtDate = (v) => {
  const d = asDate(v);
  return d ? d.toLocaleDateString() : "—";
};
const getYields = (g) => {
  const list = Array.isArray(g?.flushes)
    ? g.flushes
    : Array.isArray(g?.harvest?.flushes)
    ? g.harvest.flushes
    : [];
  const wet = list.reduce((s, f) => s + (Number(f?.wet) || 0), 0) || Number(g?.wetYield) || 0;
  const dry = list.reduce((s, f) => s + (Number(f?.dry) || 0), 0) || Number(g?.dryYield) || 0;
  return { wet: Number.isFinite(wet) ? wet : 0, dry: Number.isFinite(dry) ? dry : 0 };
};

/* ——— robust grow-state checks ——— */
const isArchived = (g) => {
  const status = norm(g?.status);
  return g?.archived === true || status === "archived";
};
const isActive = (g) => {
  if (isArchived(g)) return false;
  const status = norm(g?.status);
  if (status === "active") return true;
  if (!status) {
    const stage = norm(g?.stage);
    const activeStages = ["inoculated", "colonizing", "colonized", "fruiting"];
    if (activeStages.some((s) => stage.includes(s))) return true;
  }
  return false;
};
const isContamGrow = (g) => {
  const s = `${g?.status || ""} ${g?.stage || ""} ${g?.outcome || ""}`.toLowerCase();
  return (
    s.includes("contam") ||
    s.includes("failed") ||
    g?.contaminated === true ||
    String(g?.result || "").toLowerCase() === "contaminated"
  );
};

// Timestamp helper for photos that may use createdAt or timestamp
const photoTime = (p) => {
  const v = p?.createdAt || p?.timestamp;
  const d = asDate(v);
  return d ? d.getTime() : 0;
};

// Extract Storage path from a download URL
const pathFromDownloadURL = (url) => {
  try {
    const m = String(url).match(/\/o\/([^?]+)/);
    if (m && m[1]) return decodeURIComponent(m[1]);
  } catch {}
  return null;
};

/* ---------- species presets ---------- */
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

export default function StrainManager({
  strains,
  grows,
  onUpdateStrain,
  onDeleteStrain,
  onUploadStrainImage,
  setEditingGrow,
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [localStrains, setLocalStrains] = useState(Array.isArray(strains) ? strains : []);
  const [localGrows, setLocalGrows] = useState(Array.isArray(grows) ? grows : []);
  const [libraryItems, setLibraryItems] = useState([]);
  const [savedSpecies, setSavedSpecies] = useState([]);

  // Edit form
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
  const [viewStrain, setViewStrain] = useState(null);
  const [viewTab, setViewTab] = useState("grows");

  // photos across all grows of the selected strain
  const [strainPhotos, setStrainPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);

  // Inline “New Grow” from Library
  const [inlineGrow, setInlineGrow] = useState(null);

  // Batch selection state
  const [selectedLib, setSelectedLib] = useState([]);
  const [selectedStrains, setSelectedStrains] = useState([]);

  // Gallery selection + caption edit
  const [gallerySelectMode, setGallerySelectMode] = useState(false);
  const [gallerySelected, setGallerySelected] = useState(new Set());
  const gallerySelectedCount = gallerySelected.size;

  const [capEditId, setCapEditId] = useState(null);
  const [capEditText, setCapEditText] = useState("");

  /* ---------------- Data wiring ---------------- */
  useEffect(() => {
    if (Array.isArray(strains)) setLocalStrains(strains);
  }, [strains]);
  useEffect(() => {
    if (Array.isArray(grows)) setLocalGrows(grows);
  }, [grows]);

  const snapToArray = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  };

  const handleDelete = async (id) => {
    if (!id) return;
    if (!(await confirm("Delete this strain? This cannot be undone."))) return;
    if (typeof onDeleteStrain === "function") {
      await onDeleteStrain(id);
    } else {
      const u = auth.currentUser;
      if (!u) return;
      await deleteDoc(doc(db, "users", u.uid, "strains", id));
    }
  };

  /* ---------------- Library ---------------- */
  const LIBRARY_TYPES = [
    "Spore Syringe",
    "Spore Swab",
    "Spore Print",
    "LC",
    "Agar Plate",
    "Agar Slant",
  ];
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

  const ensureStrainExists = async (name, scientificName) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    const u = auth.currentUser;
    if (!u) return;
    const col = collection(db, "users", u.uid, "strains");
    const qRef = query(col, where("name", "==", clean));
    const snap = await getDocs(qRef);
    if (!snap.empty) return;
    await addDoc(col, {
      name: clean,
      scientificName: String(scientificName || "").trim(),
      createdAt: new Date().toISOString(),
      source: "library",
    });
  };

  const onDeleteLibraryItem = async (id) => {
    const u = auth.currentUser;
    if (!u || !id) return;
    await deleteDoc(doc(db, "users", u.uid, "library", id));
  };

  const startGrowFromLibrary = (it) => {
    const kind = it?.type || "";
    const strain = it?.strainName || "";

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
      setEditingGrow(prefill);
      return;
    }
    setInlineGrow(prefill);
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  };

  /* ---------------- Derived data ---------------- */
  const strainsToShow = Array.isArray(strains) ? strains : localStrains;

  const storedItemsCountByStrain = useMemo(() => {
    const map = new Map();
    for (const it of libraryItems) {
      const key = norm(it.strainName);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [libraryItems]);

  const growsForSelected = useMemo(() => {
    if (!viewStrain) return [];
    const target = norm(viewStrain.name || viewStrain);
    return (Array.isArray(localGrows) ? localGrows : []).filter(
      (g) => norm(g.strain) === target
    );
  }, [viewStrain, localGrows]);

  const statsForSelected = useMemo(() => {
    const arr = Array.isArray(growsForSelected) ? growsForSelected : [];
    const days = (a, b) => {
      const A = asDate(a), B = asDate(b);
      return A && B ? (B - A) / 86400000 : null;
    };
    const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
    const fmt1 = (v) => (v == null ? null : Number(v).toFixed(1));
    const contam = arr.filter(isContamGrow).length;
    const total = arr.length;

    const colonize = arr
      .map((g) => days(g?.stageDates?.Inoculated, g?.stageDates?.Colonized))
      .filter((n) => Number.isFinite(n));
    const fruit = arr
      .map((g) => days(g?.stageDates?.Colonized, g?.stageDates?.Fruiting))
      .filter((n) => Number.isFinite(n));
    const harvest = arr
      .map((g) => days(g?.stageDates?.Fruiting, g?.stageDates?.Harvested))
      .filter((n) => Number.isFinite(n));

    const wetVals = arr.map((g) => getYields(g).wet).filter((n) => Number.isFinite(n));
    const dryVals = arr.map((g) => getYields(g).dry).filter((n) => Number.isFinite(n));

    return {
      total,
      contamRate: total ? ((contam / total) * 100).toFixed(1) : "—",
      avgColonize: fmt1(avg(colonize)) || "—",
      avgFruit: fmt1(avg(fruit)) || "—",
      avgHarvest: fmt1(avg(harvest)) || "—",
      avgWet: fmt1(avg(wetVals)) || "—",
      avgDry: fmt1(avg(dryVals)) || "—",
    };
  }, [growsForSelected]);

  /* ---------------- Batch actions (helpers) ---------------- */
  const toggleLib = (id) =>
    setSelectedLib((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleStrain = (id) =>
    setSelectedStrains((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const clearSelections = () => {
    setSelectedLib([]);
    setSelectedStrains([]);
  };

  const batchDeleteLibrary = async () => {
    if (selectedLib.length === 0) return;
    if (!(await confirm(`Delete ${selectedLib.length} selected library item(s)?`))) return;
    const u = auth.currentUser;
    if (!u) return;
    await Promise.all(
      selectedLib.map((id) => deleteDoc(doc(db, "users", u.uid, "library", id)))
    );
    setSelectedLib([]);
  };

  const batchDeleteStrains = async () => {
    if (selectedStrains.length === 0) return;
    if (!(await confirm(`Delete ${selectedStrains.length} selected strain(s)? This cannot be undone.`))) return;

    if (typeof onDeleteStrain === "function") {
      for (const id of selectedStrains) {
        // eslint-disable-next-line no-await-in-loop
        await onDeleteStrain(id);
      }
    } else {
      const u = auth.currentUser;
      if (!u) return;
      await Promise.all(
        selectedStrains.map((id) => deleteDoc(doc(db, "users", u.uid, "strains", id)))
      );
    }
    setSelectedStrains([]);
  };

  /* ---------------- Fetch photos for the Gallery tab ---------------- */
  useEffect(() => {
    const run = async () => {
      if (!viewStrain || viewTab !== "gallery") return;
      const u = auth.currentUser;
      if (!u) return;

      const ids = growsForSelected.map((g) => g.id).filter(Boolean);
      setPhotosLoading(true);
      try {
        if (ids.length === 0) {
          setStrainPhotos([]);
          return;
        }
        const chunks = [];
        for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));

        let rows = [];
        for (const part of chunks) {
          // eslint-disable-next-line no-await-in-loop
          const snap = await getDocs(
            query(collection(db, "users", u.uid, "photos"), where("growId", "in", part))
          );
          rows = rows.concat(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
        rows.sort((a, b) => photoTime(b) - photoTime(a));
        setStrainPhotos(rows);
        setGallerySelected(new Set());
        setGallerySelectMode(false);
      } finally {
        setPhotosLoading(false);
      }
    };
    run();
  }, [viewStrain, viewTab, growsForSelected]);

  /* ---------------- GALLERY: selection & edits ---------------- */
  const toggleGallerySelect = (id) =>
    setGallerySelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clearGallerySelection = () => setGallerySelected(new Set());
  const selectAllGallery = () => setGallerySelected(new Set(strainPhotos.map((p) => p.id)));

  const deleteOnePhoto = async (photo) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !photo?.id) return;
    try {
      const storagePath = photo.storagePath || pathFromDownloadURL(photo.url);
      if (storagePath) {
        try {
          await deleteObject(storageRef(storage, storagePath));
        } catch (e) {
          console.warn("Storage delete warning:", e?.message || e);
        }
      }
      await deleteDoc(doc(db, "users", uid, "photos", photo.id));

      if (photo.growId) {
        const gRef = doc(db, "users", uid, "grows", photo.growId);
        try {
          const gSnap = await getDoc(gRef);
          if (gSnap.exists() && gSnap.data()?.coverPhotoId === photo.id) {
            await updateDoc(gRef, {
              coverPhotoId: null,
              coverUrl: null,
              coverStoragePath: null,
              coverUpdatedAt: serverTimestamp(),
            });
          }
        } catch (e) {
          console.warn("Cover clear warning:", e?.message || e);
        }
      }
    } catch (e) {
      throw e;
    }
  };

  const onBatchDeletePhotos = async () => {
    if (!gallerySelectedCount) return;
    if (!(await confirm(`Delete ${gallerySelectedCount} photo(s)? This cannot be undone.`))) return;

    const ids = new Set(gallerySelected);
    const list = strainPhotos.filter((p) => ids.has(p.id));
    for (const p of list) {
      // eslint-disable-next-line no-await-in-loop
      await deleteOnePhoto(p);
    }
    setStrainPhotos((curr) => curr.filter((p) => !ids.has(p.id)));
    clearGallerySelection();
    setGallerySelectMode(false);
  };

  const beginCaptionEdit = (p) => {
    setCapEditId(p.id);
    setCapEditText(p.caption || "");
  };
  const cancelCaptionEdit = () => {
    setCapEditId(null);
    setCapEditText("");
  };
  const saveCaptionEdit = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !capEditId) return;
    await updateDoc(doc(db, "users", uid, "photos", capEditId), { caption: capEditText });
    setStrainPhotos((curr) =>
      curr.map((x) => (x.id === capEditId ? { ...x, caption: capEditText } : x))
    );
    cancelCaptionEdit();
  };

  /* ---------------- UI ---------------- */
  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {(selectedLib.length > 0 || selectedStrains.length > 0) && (
        <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-100 p-3 flex flex-wrap items-center gap-3">
          <CheckSquare className="w-4 h-4" />
          <span className="text-sm">
            {selectedLib.length > 0 && <strong>{selectedLib.length}</strong>} {selectedLib.length > 0 && "library"}
            {selectedLib.length > 0 && selectedStrains.length > 0 ? " & " : ""}
            {selectedStrains.length > 0 && (
              <>
                <strong>{selectedStrains.length}</strong> strains
              </>
            )}{" "}
            selected
          </span>
          {selectedLib.length > 0 && (
            <button
              onClick={batchDeleteLibrary}
              className="px-3 py-1 rounded-full bg-red-600 text-white text-sm"
            >
              Delete library items
            </button>
          )}
          {selectedStrains.length > 0 && (
            <button
              onClick={batchDeleteStrains}
              className="px-3 py-1 rounded-full bg-red-600 text-white text-sm"
            >
              Delete strains
            </button>
          )}
          <button
            onClick={clearSelections}
            className="px-3 py-1 rounded-full bg-zinc-200 dark:bg-zinc-700 text-sm"
          >
            Clear
          </button>
        </div>
      )}

      {editingId && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow space-y-4">
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
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
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

      {/* Strain Library / Storage */}
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
            {["Fridge", "Freezer", "Room"].map((loc) => (
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

        {/* Library selection toolbar */}
        {selectedLib.length > 0 && (
          <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-100 p-2 text-sm flex items-center justify-between">
            <span>{selectedLib.length} selected</span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedLib(libraryItems.map((i) => i.id))}
                className="px-3 py-1 rounded-full bg-zinc-200 dark:bg-zinc-700"
              >
                Select all
              </button>
              <button
                onClick={batchDeleteLibrary}
                className="px-3 py-1 rounded-full bg-red-600 text-white"
              >
                Delete selected
              </button>
              <button
                onClick={() => setSelectedLib([])}
                className="px-3 py-1 rounded-full bg-zinc-200 dark:bg-zinc-700"
              >
                Clear
              </button>
            </div>
          </div>
        )}

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

                const checked = selectedLib.includes(it.id);

                return (
                  <li key={it.id} className="p-3 flex items-center gap-3 justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={checked}
                        onChange={() => toggleLib(it.id)}
                        aria-label={`Select ${kind} — ${it.strainName || "Unknown"}`}
                      />
                      <KindIcon className="h-5 w-5 opacity-80 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {kind} — {it.strainName || "Unknown strain"}
                        </div>
                        <div className="text-xs text-zinc-500 truncate">
                          {it.scientificName ? `${it.scientificName} · ` : ""}
                          Qty: {it.qty ?? 0} {it.unit || "count"} · {it.location || "Unknown"} · Acquired:{" "}
                          {it.acquired || "—"}
                        </div>
                        {it.notes ? (
                          <div className="text-xs text-zinc-500 mt-1 line-clamp-2">{it.notes}</div>
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
                        <Trash2 className="w-4 h-4 inline -mt-0.5 mr-1" />
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
      {selectedStrains.length > 0 && (
        <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-100 p-2 text-sm flex items-center justify-between">
          <span>{selectedStrains.length} strain(s) selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedStrains(strainsToShow.map((s) => s.id))}
              className="px-3 py-1 rounded-full bg-zinc-200 dark:bg-zinc-700"
            >
              Select all
            </button>
            <button
              onClick={batchDeleteStrains}
              className="px-3 py-1 rounded-full bg-red-600 text-white"
            >
              Delete selected
            </button>
            <button
              onClick={() => setSelectedStrains([])}
              className="px-3 py-1 rounded-full bg-zinc-200 dark:bg-zinc-700"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {strainsToShow.map((s) => {
          const allG = (Array.isArray(localGrows) ? localGrows : []).filter(
            (g) => norm(g.strain) === norm(s.name)
          );
          const activeCount = allG.filter(isActive).length;
          const archivedCount = allG.filter(isArchived).length;
          const storedCount = storedItemsCountByStrain.get(norm(s.name)) || 0;

          const isChecked = selectedStrains.includes(s.id);

          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setViewStrain({ name: s.name, scientificName: s.scientificName });
                setViewTab("grows");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setViewStrain({ name: s.name, scientificName: s.scientificName });
                  setViewTab("grows");
                }
              }}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4 space-y-2 relative cursor-pointer hover:ring-2 hover:ring-zinc-300 dark:hover:ring-zinc-700 transition"
              title="Click to view all grows for this strain"
            >
              <input
                type="checkbox"
                className="absolute left-2 top-2 z-10"
                checked={isChecked}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleStrain(s.id)}
                aria-label={`Select ${s.name}`}
              />

              {s.photoURL ? (
                <img src={s.photoURL} alt={s.name} className="w-full h-40 object-cover rounded-xl" />
              ) : null}
              <h3 className="text-lg font-bold">{s.name}</h3>
              {s.scientificName ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300 italic">{s.scientificName}</p>
              ) : s.genetics ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{s.genetics}</p>
              ) : null}
              {s.description && <p className="text-sm">{s.description}</p>}
              {s.notes && <p className="text-xs text-zinc-500 dark:text-zinc-400">{s.notes}</p>}

              <div className="flex flex-wrap gap-1 pt-1">
                <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700">
                  Active grows: <strong>{activeCount}</strong>
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700">
                  Archived grows: <strong>{archivedCount}</strong>
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700">
                  Stored items: <strong>{storedCount}</strong>
                </span>
              </div>

              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit(s);
                  }}
                  className="text-blue-500 hover:text-blue-700 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
                  aria-label={`Edit ${s.name}`}
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(s.id);
                  }}
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

      {/* Modal: All grows (and Gallery) for selected strain */}
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

            <div className="px-4 pt-3 flex items-center gap-2">
              <button
                className={`chip flex items-center gap-1 ${viewTab === "grows" ? "accent-chip" : ""}`}
                onClick={() => setViewTab("grows")}
                aria-pressed={viewTab === "grows" ? "true" : "false"}
              >
                <ListIcon className="w-4 h-4" />
                Grows
              </button>
              <button
                className={`chip flex items-center gap-1 ${viewTab === "gallery" ? "accent-chip" : ""}`}
                onClick={() => setViewTab("gallery")}
                aria-pressed={viewTab === "gallery" ? "true" : "false"}
                title="Show all photos across all grows of this strain"
              >
                <ImageIcon className="w-4 h-4" />
                Gallery
              </button>
            </div>

            <div className="p-4 overflow-auto">
              {viewTab === "grows" && (
                <>
                  <div className="mb-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                    <div className="rounded bg-zinc-100 dark:bg-zinc-800 px-3 py-2">
                      <div className="opacity-70">⏱ Colonize Avg</div>
                      <div className="font-semibold">{statsForSelected.avgColonize}d</div>
                    </div>
                    <div className="rounded bg-zinc-100 dark:bg-zinc-800 px-3 py-2">
                      <div className="opacity-70">🍄 Fruiting Avg</div>
                      <div className="font-semibold">{statsForSelected.avgFruit}d</div>
                    </div>
                    <div className="rounded bg-zinc-100 dark:bg-zinc-800 px-3 py-2">
                      <div className="opacity-70">✂️ Harvest Avg</div>
                      <div className="font-semibold">{statsForSelected.avgHarvest}d</div>
                    </div>
                    <div className="rounded bg-zinc-100 dark:bg-zinc-800 px-3 py-2">
                      <div className="opacity-70">💧 Wet Avg</div>
                      <div className="font-semibold">{statsForSelected.avgWet}g</div>
                    </div>
                    <div className="rounded bg-zinc-100 dark:bg-zinc-800 px-3 py-2">
                      <div className="opacity-70">🌬️ Dry Avg</div>
                      <div className="font-semibold">{statsForSelected.avgDry}g</div>
                    </div>
                    <div className="rounded bg-zinc-100 dark:bg-zinc-800 px-3 py-2">
                      <div className="opacity-70">🦠 Contam Rate</div>
                      <div className="font-semibold">{statsForSelected.contamRate}%</div>
                    </div>
                  </div>

                  <div className="text-sm text-zinc-600 dark:text-zinc-300 mb-3">
                    Showing <strong>{growsForSelected.length}</strong> grow
                    {growsForSelected.length === 1 ? "" : "s"} for <strong>{viewStrain.name}</strong>
                  </div>

                  {growsForSelected.length === 0 ? (
                    <div className="text-sm opacity-70">No grows found for this strain yet.</div>
                  ) : (
                    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {growsForSelected
                        .slice()
                        .sort((a, b) => {
                          const ta =
                            asDate(a.updatedAt || a.createdAt || a.stageDates?.Inoculated)?.getTime() || 0;
                          const tb =
                            asDate(b.updatedAt || b.createdAt || b.stageDates?.Inoculated)?.getTime() || 0;
                          return tb - ta;
                        })
                        .map((g) => {
                          const yields = getYields(g);
                          const started = g?.stageDates?.Inoculated || g?.createdAt;
                          const colonized = g?.stageDates?.Colonized;
                          const fruiting = g?.stageDates?.Fruiting;
                          const harvested = g?.stageDates?.Harvested;

                          const type = g.type || g.growType || "—";
                          const stage = g.stage || "—";
                          const status = g.status || "—";

                          return (
                            <li
                              key={g.id}
                              className="py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition rounded-lg px-2 -mx-2 cursor-pointer"
                              onClick={() => {
                                setViewStrain(null);
                                navigate(`/grow/${g.id}`);
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  setViewStrain(null);
                                  navigate(`/grow/${g.id}`);
                                }
                              }}
                              title="Open grow detail"
                            >
                              <div className="flex flex-wrap items-center gap-2 justify-between">
                                <div className="min-w-0">
                                  <div className="font-semibold truncate">
                                    {g.subName ? `${g.strain} — ${g.subName}` : g.strain}
                                  </div>
                                  <div className="text-xs text-zinc-500">
                                    Type: <strong>{normalizeType(type)}</strong> · Stage:{" "}
                                    <strong>{stage}</strong> · Status: <strong>{status}</strong>
                                  </div>
                                </div>

                                <div className="text-xs text-zinc-500">
                                  Started: <strong>{fmtDate(started)}</strong>
                                  {colonized ? <> · Colonized: <strong>{fmtDate(colonized)}</strong></> : null}
                                  {fruiting ? <> · Fruiting: <strong>{fmtDate(fruiting)}</strong></> : null}
                                  {harvested ? <> · Harvested: <strong>{fmtDate(harvested)}</strong></> : null}
                                </div>

                                <div className="text-xs">
                                  💧 Wet: <strong>{yields.wet}g</strong> · 🌬️ Dry: <strong>{yields.dry}g</strong>
                                  {Number.isFinite(Number(g?.cost)) ? (
                                    <> · 💲 Cost: <strong>${Number(g.cost).toFixed(2)}</strong></>
                                  ) : null}
                                  {g.recipeName ? <> · 📋 Recipe: <strong>{g.recipeName}</strong></> : null}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </>
              )}

              {viewTab === "gallery" && (
                <>
                  <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/40 px-2 py-1 mb-3 flex items-center gap-2">
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {photosLoading
                        ? "Loading photos…"
                        : `${strainPhotos.length} photo${strainPhotos.length === 1 ? "" : "s"}`}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      {!gallerySelectMode ? (
                        <button
                          className="chip"
                          onClick={() => {
                            clearGallerySelection();
                            setGallerySelectMode(true);
                          }}
                        >
                          Select
                        </button>
                      ) : (
                        <>
                          <button className="chip" onClick={selectAllGallery}>
                            Select all
                          </button>
                          <button className="chip" onClick={clearGallerySelection}>
                            Clear
                          </button>
                          <button
                            className="chip bg-red-600 text-white hover:bg-red-700"
                            onClick={onBatchDeletePhotos}
                            disabled={!gallerySelectedCount}
                          >
                            Delete {gallerySelectedCount ? `(${gallerySelectedCount})` : ""}
                          </button>
                          <button
                            className="btn-outline"
                            onClick={() => {
                              clearGallerySelection();
                              setGallerySelectMode(false);
                            }}
                          >
                            Done
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {strainPhotos.length === 0 && !photosLoading ? (
                    <div className="text-sm opacity-70">No photos found for this strain yet.</div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {strainPhotos.map((p) => {
                        const g = growsForSelected.find((x) => x.id === p.growId);
                        const label =
                          (g?.subName ? `${g.strain} — ${g.subName}` : g?.strain) || p.growId || "";
                        const isSel = gallerySelected.has(p.id);
                        const isEditing = capEditId === p.id;

                        return (
                          <figure
                            key={p.id || p.url}
                            className={`relative rounded-md overflow-hidden border bg-white dark:bg-zinc-900 ${
                              isSel
                                ? "border-indigo-400 dark:border-indigo-500"
                                : "border-zinc-200 dark:border-zinc-800"
                            }`}
                            title={p.caption || ""}
                          >
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              <img
                                src={p.url}
                                alt={p.caption || "Strain photo"}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-40 object-cover bg-gray-100"
                              />
                            </a>

                            {gallerySelectMode && (
                              <label className="absolute left-2 top-2 z-20 bg-black/40 rounded px-1.5 py-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="mr-1 align-middle"
                                  checked={isSel}
                                  onChange={() => toggleGallerySelect(p.id)}
                                />
                                <span className="text-white text-xs align-middle">Select</span>
                              </label>
                            )}

                            <div className="absolute left-2 top-2 z-10 space-x-1 flex">
                              {p.stage ? (
                                <span className="rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                                  {p.stage}
                                </span>
                              ) : null}
                            </div>

                            {!gallerySelectMode && (
                              <button
                                onClick={async () => {
                                  if (!(await confirm("Delete this photo? This cannot be undone."))) return;
                                  await deleteOnePhoto(p);
                                  setStrainPhotos((curr) => curr.filter((x) => x.id !== p.id));
                                }}
                                className="absolute right-2 top-2 z-20 rounded-md bg-red-600/90 px-2 py-1 text-xs text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400"
                                aria-label="Delete photo"
                                title="Delete photo"
                              >
                                Delete
                              </button>
                            )}

                            <figcaption className="p-2 text-xs">
                              {!isEditing ? (
                                <div className="flex items-center gap-2">
                                  <div className="font-medium truncate flex-1">{p.caption || "—"}</div>
                                  <button
                                    className="chip px-2 py-0.5 text-[11px]"
                                    onClick={() => beginCaptionEdit(p)}
                                    title="Edit caption"
                                  >
                                    ✎ Edit
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <input
                                    className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-zinc-900 px-2 py-1"
                                    value={capEditText}
                                    onChange={(e) => setCapEditText(e.target.value)}
                                    placeholder="Caption…"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") saveCaptionEdit();
                                      if (e.key === "Escape") cancelCaptionEdit();
                                    }}
                                  />
                                  <button className="chip px-2 py-0.5 text-[11px]" onClick={saveCaptionEdit}>
                                    Save
                                  </button>
                                  <button className="btn-outline px-2 py-0.5 text-[11px]" onClick={cancelCaptionEdit}>
                                    Cancel
                                  </button>
                                </div>
                              )}
                              <div className="opacity-70 mt-1">
                                {label} · {photoTime(p) ? new Date(photoTime(p)).toLocaleString() : "—"}
                              </div>
                            </figcaption>
                          </figure>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Inline GrowForm modal */}
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
