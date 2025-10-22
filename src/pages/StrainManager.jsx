// src/pages/StrainManager.jsx
// Strain Manager + Library/Storage: auto-archive zero-qty items and hide archived ones from the list.
import React, { useEffect, useMemo, useState, useCallback } from "react";
import Modal from "../components/ui/Modal";
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
import { isArchivedish, normalizeStage, normalizeStatus } from "../lib/growFilters";
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
  GitBranch,
  GitCommit,
  ChevronRight,
  Spline,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import GrowForm from "../components/Grow/GrowForm";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { sortAlpha, byKey, alpha } from "../lib/sort";
import StrainCard from "../components/Strains/StrainCard";
import { DEFAULT_STORAGE_LOCATIONS, subscribeLocations, seedDefaultsIfEmpty, addLocation, renameLocation, deleteLocation, moveLocation } from "../lib/storage-locations";

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

/* —— robust grow-state checks —— */
const isArchived = (g) => isArchivedish(g);

// ✅ Active definition per spec:
// NOT archived, NOT stored, NOT harvested;
// and (status === Active OR stage ∈ {Inoculated, Colonizing, Colonized, Fruiting})
const isActive = (g) => {
  if (!g) return false;
  // Active per spec: NOT archived-ish, NOT deleted (covered by isArchivedish), NOT stored, NOT harvested
  if (isArchivedish(g)) return false;
  const status = normalizeStatus(g?.status);
  const stage = normalizeStage(g?.stage);
  if (status === "stored") return false;
  if (stage === "Harvested") return false;
  const activeStages = new Set(["Inoculated", "Colonizing", "Colonized", "Fruiting"]);
  return status === "active" || activeStages.has(stage);
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

/* ---------- species alias shortcuts (type "cube" => Psilocybe cubensis) ---------- */
const SPECIES_ALIASES = {
  cube: "Psilocybe cubensis",
  cubensis: "Psilocybe cubensis",
  cyan: "Psilocybe cyanescens",
  cyanescens: "Psilocybe cyanescens",
  azure: "Psilocybe azurescens",
  azurescens: "Psilocybe azurescens",
  allenii: "Psilocybe allenii",
  mex: "Psilocybe mexicana",
  mexicana: "Psilocybe mexicana",
  tamp: "Psilocybe tampanensis",
  tamps: "Psilocybe tampanensis",
  tampanensis: "Psilocybe tampanensis",
  semilanceata: "Psilocybe semilanceata",
  "liberty cap": "Psilocybe semilanceata",
  weilii: "Psilocybe weilii",
  baeocystis: "Psilocybe baeocystis",
};


/* ---------- per-strain stats helper ---------- */
// Uses only ARCHIVED grows for analytics. Durations use fallbacks:
// stageDates.* preferred, then *At legacy fields; Inoculated falls back to createdAt.
function calcStatsFromGrows(arr) {
  const days = (a, b) => {
    const A = asDate(a), B = asDate(b);
    return A && B ? (B - A) / 86400000 : null;
  };
  const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  const fmt1 = (v) => (v == null ? "—" : Number(v).toFixed(1));

  // Fallback date getters (legacy support)
  const dInoc = (g) =>
    g?.stageDates?.Inoculated ??
    g?.inoculatedAt ??
    g?.inoculationDate ??
    g?.inoc ??
    g?.createdAt;

  const dColonized = (g) => g?.stageDates?.Colonized ?? g?.colonizedAt;
  const dFruiting  = (g) => g?.stageDates?.Fruiting  ?? g?.fruitingAt;
  const dHarvested = (g) => g?.stageDates?.Harvested ?? g?.harvestedAt;

  // Only archived grows count for analytics (deleted included for stats)
  const source = (Array.isArray(arr) ? arr : []).filter((g) => isArchived(g));

  const contam = source.filter(isContamGrow).length;
  const total = source.length;

  const colonize = source
    .map((g) => days(dInoc(g), dColonized(g)))
    .filter((n) => Number.isFinite(n));
  const fruit = source
    .map((g) => days(dColonized(g), dFruiting(g)))
    .filter((n) => Number.isFinite(n));
  const harvest = source
    .map((g) => days(dFruiting(g), dHarvested(g)))
    .filter((n) => Number.isFinite(n));

  const wetVals = source.map((g) => getYields(g).wet).filter((n) => Number.isFinite(n));
  const dryVals = source.map((g) => getYields(g).dry).filter((n) => Number.isFinite(n));

  return {
    total,
    contamRate: total ? ((contam / total) * 100).toFixed(1) : "—",
    avgColonize: fmt1(avg(colonize)),
    avgFruit: fmt1(avg(fruit)),
    avgHarvest: fmt1(avg(harvest)),
    avgWet: fmt1(avg(wetVals)),
    avgDry: fmt1(avg(dryVals)),
  };
}

/* ---------- lineage helpers ---------- */
const ORIGINS = [
  "MSS (Spore Syringe)",
  "Spore Swab",
  "Spore Print",
  "LC Syringe",
  "Wild→Agar",
];

function inferOriginFromLibrary(kind = "") {
  const s = String(kind).toLowerCase();
  if (s.includes("syringe")) return "MSS (Spore Syringe)";
  if (s.includes("swab")) return "Spore Swab";
  if (s.includes("print")) return "Spore Print";
  if (s === "lc" || s.includes("liquid")) return "LC Syringe";
  return null;
}

function getGrowParentId(g, growsById) {
  if (g?.parentGrowId && growsById.has(g.parentGrowId)) return g.parentGrowId;
  if (g?.parentId && growsById.has(g.parentId)) return g.parentId;
  return null;
}

function growLabel(g) {
  const abbrev = g?.abbreviation || g?.abbr || g?.code || "";
  const type = normalizeType(g?.type || g?.growType || "");
  return abbrev ? `${abbrev} · ${type}` : `${type}`;
}

/* ---------------- TREE LAYOUT (simple tidy algorithm) ---------------- */
function buildForest(roots, childrenMap, growsById) {
  const makeNode = (id) => {
    const g = growsById.get(id);
    return {
      id,
      label: growLabel(g),
      stage: g?.stage || "—",
      status: g?.status || "—",
      inoc: g?.stageDates?.Inoculated || g?.createdAt,
      children: (childrenMap.get(id) || []).map((cid) => makeNode(cid)),
      // layout fields
      depth: 0,
      prelim: 0,
      mod: 0,
      x: 0,
    };
  };
  const trees = roots.map(makeNode);
  return trees;
}

function firstWalk(node, depth, nextX) {
  node.depth = depth;
  if (node.children.length === 0) {
    node.prelim = nextX.value;
    nextX.value += 1;
  } else {
    node.children.forEach((c) => firstWalk(c, depth + 1, nextX));
    const first = node.children[0].prelim;
    const last = node.children[node.children.length - 1].prelim;
    node.prelim = (first + last) / 2;
  }
}

function secondWalk(node, m = 0, positions = []) {
  node.x = node.prelim + m;
  positions.push(node);
  node.children.forEach((c) => secondWalk(c, m, positions));
  return positions;
}

function layoutForest(trees) {
  const positions = [];
  let offset = 0;
  trees.forEach((tree, idx) => {
    const nextX = { value: 0 };
    firstWalk(tree, 0, nextX);
    const nodes = secondWalk(tree).map((n) => ({ ...n, x: n.x + offset }));
    positions.push(...nodes);
    // space 2 columns between trees
    offset = Math.max(offset, ...nodes.map((n) => n.x)) + 2;
  });
  const maxDepth = Math.max(0, ...positions.map((p) => p.depth));
  const maxX = Math.max(0, ...positions.map((p) => p.x));
  return { nodes: positions, maxDepth, maxX };
}

/* ---------- local cache for strain name suggestions ---------- */
const LS_STRAIN_NAMES = "cnm_strain_names";
const loadStrainNameCache = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_STRAIN_NAMES) || "[]");
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()) : [];
  } catch { return []; }
};
const saveStrainNameCache = (names) => {
  try { localStorage.setItem(LS_STRAIN_NAMES, JSON.stringify(names)); } catch {}
};
const mergeNamesCI = (...lists) => {
  const map = new Map();
  lists.flat().forEach((n) => {
    const v = String(n || "").trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (!map.has(k)) map.set(k, v);
  });
  return Array.from(map.values());
};

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

  // User-defined Storage Locations
  const [storageLocations, setStorageLocations] = useState([]);
  const [manageLocOpen, setManageLocOpen] = useState(false);

  // Strain name suggestions cache (persisted)
  const [cachedStrainNames, setCachedStrainNames] = useState([]);

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

  // lineage view mode
  const [lineageView, setLineageView] = useState("tree"); // "tree" | "list"

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
  // Subscribe to user Storage Locations and seed defaults if empty
  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;
    (async () => { try { await seedDefaultsIfEmpty(db, u.uid); } catch {} })();
    const unsub = subscribeLocations(db, u.uid, setStorageLocations);
    return () => unsub && unsub();
  }, []);

  useEffect(() => {
    if (Array.isArray(strains)) setLocalStrains(strains);
  }, [strains]);
  useEffect(() => {
    if (Array.isArray(grows)) setLocalGrows(grows);
  }, [grows]);

  useEffect(() => {
    // Load cached strain-name suggestions on mount
    setCachedStrainNames(loadStrainNameCache());
  }, []);

  const snapToArray = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return;

    const unsubLib = onSnapshot(collection(db, "users", u.uid, "library"), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLibraryItems(rows);

      // 🔒 Auto-archive any library item at or below zero so it disappears from the active list
      rows.forEach((it) => {
        const qty = Number(it?.qty || 0);
        const archivedish = !!it?.archived || String(it?.status || "").toLowerCase() === "archived";
        if (qty <= 0 && !archivedish) {
          updateDoc(doc(db, "users", u.uid, "library", it.id), {
            qty: 0,
            status: "Archived",
            archived: true,
            archivedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      });
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


  // Default form location to first available
  useEffect(() => {
    const first = storageLocations.length ? storageLocations[0].name : DEFAULT_STORAGE_LOCATIONS[0];
    setNewItem((prev) => ({ ...prev, location: prev.location || first }));
  }, [storageLocations]);

  /* ---------------- Species suggestions ---------------- */
  const speciesSuggestions = useMemo(() => {
    const set = new Set();
    [...PSILOCYBIN_SPECIES, ...MED_EDIBLE_SPECIES, ...savedSpecies].forEach((s) => {
      const clean = String(s || "").trim();
      if (clean) set.add(clean);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [savedSpecies]);


  // Fuzzy canonicalization for species field
  const fuzzyPickSpecies = (text) => {
    const q = norm(text);
    if (!q) return "";
    if (SPECIES_ALIASES[q]) return SPECIES_ALIASES[q];
    const all = speciesSuggestions;
    const exact = all.find((s) => norm(s) === q);
    if (exact) return exact;
    // token-based contains match (prefix/substring)
    const hit = all.find((s) => norm(s).includes(q));
    return hit || text;
  };

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
  const DEFAULT_UNIT_BY_TYPE = {
  "Spore Swab": "count",
  "Spore Print": "count",
  "Spore Syringe": "ml",
  "LC": "ml",
  "Agar Plate": "ml",
  "Agar Slant": "ml",
};
const LIBRARY_TYPES = [
    "Spore Syringe",
    "Spore Swab",
    "Spore Print",
    "LC",
    "Agar Plate",
    "Agar Slant",
  ];
  const [speciesOpen, setSpeciesOpen] = useState(false);
  const [newItem, setNewItem] = useState({
    type: "Spore Syringe",
    strainName: "",
    scientificName: "",
    qty: 1,
    unit: DEFAULT_UNIT_BY_TYPE["Spore Syringe"] || "ml",
    location: "Fridge",
    acquired: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  // Build strain-name suggestions from active Library items + locally cached names
  const activeLibraryItems = useMemo(() => {
    const arr = Array.isArray(libraryItems) ? libraryItems : [];
    return arr.filter((it) => {
      const qty = Number(it?.qty || 0);
      const archivedish = !!it?.archived || String(it?.status || "").toLowerCase() === "archived";
      return qty > 0 && !archivedish;
    });
  }, [libraryItems]);

  const strainNameSuggestions = useMemo(() => {
    const fromLib = activeLibraryItems.map((it) => it.strainName).filter(Boolean);
    return mergeNamesCI(fromLib, cachedStrainNames).sort((a, b) => alpha(a, b));
  }, [activeLibraryItems, cachedStrainNames]);

  const addNameToCache = (name) => {
    const merged = mergeNamesCI(cachedStrainNames, [name]);
    setCachedStrainNames(merged);
    saveStrainNameCache(merged);
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

    // ✨ write-through to local suggestion cache (deduped, case-insensitive)
    addNameToCache(newItem.strainName);

    setNewItem((s) => ({
      ...s,
      strainName: "",
      scientificName: "",
      qty: 1,
      unit: DEFAULT_UNIT_BY_TYPE["Spore Syringe"] || "ml",
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

  // A→Z by strain name (case-insensitive, natural)
  const strainsSorted = useMemo(
    () => sortAlpha(strainsToShow, (s) => s?.name || ""),
    [strainsToShow]
  );

  // Count of stored items per strain (ACTIVE items only)
  const storedItemsCountByStrain = useMemo(() => {
    const map = new Map();
    for (const it of activeLibraryItems) {
      const key = norm(it.strainName);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [activeLibraryItems]);

  const growsForSelected = useMemo(() => {
    if (!viewStrain) return [];
    const target = norm(viewStrain.name || viewStrain);
    return (Array.isArray(localGrows) ? localGrows : []).filter(
      (g) => norm(g.strain) === target
    );
  }, [viewStrain, localGrows]);

  const statsForSelected = useMemo(
    () => calcStatsFromGrows(growsForSelected),
    [growsForSelected]
  );

  /* ---------- lineage derived ---------- */
  const {
    roots,
    childrenMap,
    growsById,
    inferredOriginByRoot,
  } = useMemo(() => {
    const byId = new Map();
    for (const g of growsForSelected) byId.set(g.id, g);

    const kids = new Map();
    for (const g of growsForSelected) kids.set(g.id, []);

    const rootsArr = [];
    for (const g of growsForSelected) {
      const pid = getGrowParentId(g, byId);
      if (pid && byId.has(pid)) {
        kids.get(pid).push(g.id);
      } else {
        rootsArr.push(g.id);
      }
    }

    // Inferred origin (for roots)
    const inferred = new Map();
    for (const rid of rootsArr) {
      const rg = byId.get(rid);
      let origin = rg?.origin || null;
      if (!origin && rg?.parentSource === "Library") {
        origin = inferOriginFromLibrary(rg?.parentType) || null;
      }
      inferred.set(rid, origin);
    }

    // Sort children by inoculated/created desc (so newer children render on the right)
    for (const [pid, list] of kids) {
      list.sort((a, b) => {
        const ga = byId.get(a), gb = byId.get(b);
        const ta =
          asDate(ga?.updatedAt || ga?.createdAt || ga?.stageDates?.Inoculated)?.getTime() || 0;
        const tb =
          asDate(gb?.updatedAt || gb?.createdAt || gb?.stageDates?.Inoculated)?.getTime() || 0;
        return ta - tb; // left→right oldest→newest
      });
    }

    return { roots: rootsArr, childrenMap: kids, growsById: byId, inferredOriginByRoot: inferred };
  }, [growsForSelected]);

  const updateRootOrigin = useCallback(
    async (rootId, origin) => {
      const uid = auth.currentUser?.uid;
      if (!uid || !rootId) return;
      try {
        await updateDoc(doc(db, "users", uid, "grows", rootId), { origin: origin || null });
      } catch (e) {
        console.warn("Origin update failed:", e?.message || e);
      }
    },
    []
  );

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
  // A→Z by strainName (primary) then by type for tie-breakers
  const libraryItemsSorted = useMemo(() => {
    const arr = Array.isArray(activeLibraryItems) ? [...activeLibraryItems] : [];
    arr.sort((a, b) => {
      const byStrain = alpha(a?.strainName, b?.strainName);
      if (byStrain !== 0) return byStrain;
      return alpha(a?.type, b?.type);
    });
    return arr;
  }, [activeLibraryItems]);

  const renderLineageListNode = useCallback(
    (id) => {
      const g = growsById.get(id);
      if (!g) return null;
      const children = childrenMap.get(id) || [];
      const started = g?.stageDates?.Inoculated || g?.createdAt;
      const stage = g?.stage || "—";
      const status = g?.status || "—";
      const label = growLabel(g);

      return (
        <li key={id} className="pl-2">
          <div className="flex items-center gap-2 py-1">
            <GitCommit className="w-4 h-4 opacity-70 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium truncate">{label}</div>
              <div className="text-xs text-zinc-500">
                Stage: <strong>{stage}</strong> · Status: <strong>{status}</strong> · Inoculated:{" "}
                <strong>{fmtDate(started)}</strong>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                className="chip px-2 py-1 text-[12px]"
                onClick={() => navigate(`/grow/${id}`)}
                title="Open grow"
              >
                Open
              </button>
            </div>
          </div>

          {children.length > 0 && (
            <ul className="ml-6 border-l border-zinc-300 dark:border-zinc-700 pl-3">
              {children.map((cid) => renderLineageListNode(cid))}
            </ul>
          )}
        </li>
      );
    },
    [childrenMap, growsById, navigate]
  );

  const rootsListUI = useMemo(() => {
    if (!roots.length) {
      return <div className="text-sm opacity-70">No lineage detected for this strain.</div>;
    }
    return (
      <ul className="space-y-2">
        {roots.map((rid) => {
          const g = growsById.get(rid);
          const inferred = inferredOriginByRoot.get(rid) || null;
          const currentOrigin = g?.origin || inferred || null;

          return (
            <li key={rid} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="flex items-center gap-2 mb-2">
                <GitBranch className="w-4 h-4 opacity-70" />
                <div className="font-semibold">Root</div>
                <ChevronRight className="w-4 h-4 opacity-50" />
                <div className="text-sm">
                  Origin:&nbsp;
                  <select
                    className="chip"
                    value={currentOrigin || ""}
                    onChange={(e) => updateRootOrigin(rid, e.target.value || null)}
                  >
                    <option value="">{inferred ? `(Inferred) ${inferred}` : "Unknown"}</option>
                    {ORIGINS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <ul className="ml-1">{renderLineageListNode(rid)}</ul>
            </li>
          );
        })}
      </ul>
    );
  }, [roots, growsById, inferredOriginByRoot, renderLineageListNode, updateRootOrigin]);

  /* ---------------- Lineage: TREE (SVG + absolutely-positioned nodes) ---------------- */
  const lineageTreeUI = useMemo(() => {
    if (!roots.length) {
      return <div className="text-sm opacity-70">No lineage detected for this strain.</div>;
    }

    // Build tidy layout
    const forest = buildForest(roots, childrenMap, growsById);
    const { nodes, maxDepth, maxX } = layoutForest(forest);

    const H = 120; // vertical gap
    const W = 180; // horizontal column width
    const PAD = 40; // padding inside container

    const width = Math.max(600, (maxX + 1) * W + PAD * 2);
    const height = Math.max(300, (maxDepth + 1) * H + PAD * 2);

    // Index for quick lookup
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edges = [];
    nodes.forEach((n) => {
      const g = growsById.get(n.id);
      (childrenMap.get(n.id) || []).forEach((cid) => {
        edges.push([n.id, cid]);
      });
    });

    const nodePos = (id) => {
      const n = nodeById.get(id);
      return {
        x: PAD + n.x * W + W / 2,
        y: PAD + n.depth * H + 28, // node header height
      };
    };

    const NodeCard = ({ n }) => {
      const g = growsById.get(n.id);
      const label = growLabel(g);
      const started = g?.stageDates?.Inoculated || g?.createdAt;
      const isRoot = !getGrowParentId(g, growsById);

      const left = PAD + n.x * W + (W / 2 - 90);
      const top = PAD + n.depth * H;

      return (
        <div
          className="absolute rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm px-3 py-2 w-[180px] cursor-pointer hover:shadow-md transition"
          style={{ left, top }}
          onClick={() => navigate(`/grow/${n.id}`)}
          title="Open grow"
        >
          <div className="font-semibold text-sm truncate">{label}</div>
          <div className="text-[11px] text-zinc-500">
            Stage: <strong>{g?.stage || "—"}</strong> · Status: <strong>{g?.status || "—"}</strong>
          </div>
          <div className="text-[11px] text-zinc-500">Inoculated: {fmtDate(started)}</div>

          {isRoot && (
            <div className="mt-1">
              <label className="text-[10px] opacity-60 mr-1">Origin</label>
              <select
                className="chip !px-1 !py-0.5 text-[11px]"
                value={g?.origin || inferredOriginByRoot.get(n.id) || ""}
                onChange={(e) => updateRootOrigin(n.id, e.target.value || null)}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="">
                  {inferredOriginByRoot.get(n.id) ? `(Inferred) ${inferredOriginByRoot.get(n.id)}` : "Unknown"}
                </option>
                {ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      );
    };

    return (
      <div
        className="relative rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/30 dark:bg-zinc-900/30 overflow-auto"
        style={{ width: "100%", maxHeight: "60vh" }}
      >
        {/* edges */}
        <svg width={width} height={height} className="block">
          {edges.map(([a, b]) => {
            const p1 = nodePos(a);
            const p2 = nodePos(b);
            const path = `M ${p1.x} ${p1.y + 22} C ${p1.x} ${p1.y + 60}, ${p2.x} ${p2.y - 60}, ${p2.x} ${p2.y - 4}`;
            return (
              <path
                key={`${a}-${b}`}
                d={path}
                fill="none"
                className="stroke-zinc-300 dark:stroke-zinc-700"
                strokeWidth="2"
              />
            );
          })}
        </svg>

        {/* nodes */}
        <div style={{ width, height, position: "absolute", inset: 0 }}>
          {nodes.map((n) => (
            <NodeCard key={n.id} n={n} />
          ))}
        </div>
      </div>
    );
  }, [roots, childrenMap, growsById, inferredOriginByRoot, navigate, updateRootOrigin]);

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
              className="px-3 py-1 rounded-full bg-red-600 text-white"
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
              list="strainNames"
              placeholder="Strain Name"
              value={form.name}
              onChange={handleChange}
                onBlur={() => setForm((f) => ({ ...f, scientificName: fuzzyPickSpecies(f.scientificName) }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setForm((f) => ({ ...f, scientificName: fuzzyPickSpecies(f.scientificName) })); } }}
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

      {/* Datalists used across the page */}
      <datalist id="strainNames">
        {strainNameSuggestions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {/* Strain Library / Storage */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl shadow space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <ScrollText className="h-5 w-5 opacity-80" />
          <h2 className="text-xl font-bold">Strain Library / Storage</h2>
        </div>

        {/* Add library item */}
        <form onSubmit={onAddLibraryItem} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
          {/* Type */}
          <select
            className="chip w-full md:col-span-4"
            value={newItem.type}
            onChange={(e) => setNewItem((s) => { const t=e.target.value; const u=DEFAULT_UNIT_BY_TYPE[t]||s.unit||"ml"; return { ...s, type: t, unit: u }; })}
            aria-label="Type"
            title="Type"
          >
            {LIBRARY_TYPES.map((t) => (
              <option key={t} value={t} title={t}>{t}</option>
            ))}
          </select>

          {/* Strain name */}
          <input
            className="chip w-full md:col-span-4"
            placeholder="Strain name (e.g., Albino Penis Envy)"
            value={newItem.strainName}
            onChange={(e) => setNewItem((s) => ({ ...s, strainName: e.target.value }))}
            onBlur={() => { const v = String(newItem.strainName||"").trim(); if (v.length >= 2) addNameToCache(v); }}
            list="strainNameOptions"
            aria-label="Strain name"
            title={newItem.strainName || "Strain name"}
          />
          <datalist id="strainNameOptions">
            {strainNameSuggestions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          {/* Species (scientific name) */}
          <div className="relative md:col-span-2">
            <input
              className="chip w-full pr-10"
              placeholder="Species (e.g., Psilocybe cubensis)"
              value={newItem.scientificName}
              onChange={(e) => setNewItem((s) => ({ ...s, scientificName: e.target.value }))}
              onBlur={() => setNewItem((p) => ({ ...p, scientificName: fuzzyPickSpecies(p.scientificName) }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setNewItem((p) => ({ ...p, scientificName: fuzzyPickSpecies(p.scientificName) })); setSpeciesOpen(false); } }}
              list="speciesOptions"
              aria-label="Species"
              title={newItem.scientificName || "Scientific name"}
              onFocus={() => setSpeciesOpen(true)}
            />
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-sm opacity-80"
              onClick={() => setSpeciesOpen((v)=>!v)} aria-label="Show species list">▾</button>
            {speciesOpen && (
              <div className="absolute z-20 mt-1 max-h-48 overflow-auto w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow">
                {speciesSuggestions
                  .filter(s => norm(s).includes(norm(newItem.scientificName)))
                  .slice(0, 50)
                  .map(s => (
                    <div key={s}
                      className="px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                      onMouseDown={(e) => { e.preventDefault(); setNewItem((p)=>({ ...p, scientificName: s })); setSpeciesOpen(false); }}>
                      {s}
                    </div>
                  ))}
                {speciesSuggestions.length === 0 && (
                  <div className="px-2 py-1 text-sm opacity-60">No suggestions</div>
                )}
              </div>
            )}
          </div>

          {/* Qty */}
          <input
            type="number"
            min="0"
            step={newItem.unit === "ml" ? "0.1" : "1"}
            className="chip w-full md:col-span-1"
            placeholder={newItem.unit === "ml" ? "mL" : "Qty"}
            value={newItem.qty}
            onChange={(e) => setNewItem((s) => ({ ...s, qty: e.target.value }))}
            aria-label="Quantity"
            title="Quantity"
          />

          {/* Unit */}
          <select
            className="chip w-full md:col-span-1"
            value={newItem.unit}
            onChange={(e) => setNewItem((s) => ({ ...s, unit: e.target.value }))}
            aria-label="Unit"
            title="Unit"
          >
            <option value="ml">ml</option>
            <option value="count">count</option>
          </select>

          {/* Location */}
          <div className="flex gap-2 items-center md:col-span-5 min-w-0 flex-nowrap">
            <select
              className="chip w-full md:min-w-[320px]"
              value={newItem.location}
              onChange={(e) => setNewItem((prev) => ({ ...prev, location: e.target.value }))}
              aria-label="Location"
              title={newItem.location}
            >
              {storageLocations.length === 0
                ? DEFAULT_STORAGE_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc} title={loc}>{loc}</option>
                  ))
                : storageLocations.map((row) => (
                    <option key={row.id} value={row.name} title={row.name}>{row.name}</option>
                  ))}
            </select>
            <button type="button" className="chip shrink-0" title="Manage locations" onClick={() => setManageLocOpen(true)}>
              Manage
            </button>
          </div>

          {/* Date */}
          <input
            type="date"
            className="chip w-full md:col-span-3"
            value={newItem.acquired}
            onChange={(e) => setNewItem((s) => ({ ...s, acquired: e.target.value }))}
            title="Acquired date"
            aria-label="Acquired date"
          />

          {/* Submit */}
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full accent-bg text-white shadow-sm md:col-span-2"
            title="Add to Library"
          >
            <PlusCircle className="h-4 w-4" />
            <span className="whitespace-nowrap">Add to Library</span>
          </button>

          {/* Notes */}
          <textarea
            className="chip md:col-span-12 w-full"
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
                onClick={() => setSelectedLib(libraryItemsSorted.map((i) => i.id))}
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

        {/* Library list (A→Z) */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="bg-zinc-50 dark:bg-zinc-900/60 px-3 py-2 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {libraryItemsSorted.length} items
          </div>
          {libraryItemsSorted.length === 0 ? (
            <div className="p-4 text-sm text-zinc-500">
              Nothing in your library yet. Add Swabs, Syringes, Prints, LCs, or Agar.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {libraryItemsSorted.map((it) => {
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

      {/* Strain cards (A→Z) */}
      {selectedStrains.length > 0 && (
        <div className="rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-100 p-2 text-sm flex items-center justify-between">
          <span>{selectedStrains.length} strain(s) selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedStrains(strainsSorted.map((s) => s.id))}
              className="px-3 py-1 rounded-full bg-zinc-200 dark:bg-zinc-700"
            >
              Select all
            </button>
            <button
              onClick={batchDeleteStrains}
              className="px-3 py-1 rounded-full bg-red-600 text-white"
            >
              Delete strains
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
        {strainsSorted.map((s) => {
          const allG = (Array.isArray(localGrows) ? localGrows : []).filter(
            (g) => norm(g.strain) === norm(s.name)
          );

          // Counts per spec
          const activeCount = allG.filter(isActive).length;
          const archivedCount = allG.filter(isArchived).length;
          const storedCount = storedItemsCountByStrain.get(norm(s.name)) || 0;

          // Stats use ARCHIVED only (handled inside helper) with stage-date fallbacks
          const stats = calcStatsFromGrows(allG);

          const isChecked = selectedStrains.includes(s.id);

          return (
            <StrainCard
              key={s.id}
              strain={s}
              stats={stats}
              counts={{ activeCount, archivedCount, storedCount }}
              checked={isChecked}
              onToggleSelect={() => toggleStrain(s.id)}
              onOpen={() => {
                setViewStrain({ name: s.name, scientificName: s.scientificName });
                setViewTab("grows");
                setLineageView("tree");
              }}
              onEdit={() => handleEdit(s)}
              onDelete={() => handleDelete(s.id)}
            />
          );
        })}
        {strainsSorted.length === 0 && (
          <div className="text-sm opacity-70">No strains yet. Add a Library item to create one.</div>
        )}
      </div>

      {/* Modal: All grows (Gallery/Lineage) for selected strain */}
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
              <button
                className={`chip flex items-center gap-1 ${viewTab === "lineage" ? "accent-chip" : ""}`}
                onClick={() => setViewTab("lineage")}
                aria-pressed={viewTab === "lineage" ? "true" : "false"}
                title="Show lineage tree for this strain"
              >
                <GitBranch className="w-4 h-4" />
                Lineage
              </button>

              {viewTab === "lineage" && (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    className={`chip ${lineageView === "tree" ? "accent-chip" : ""}`}
                    onClick={() => setLineageView("tree")}
                    title="Visual tree"
                  >
                    <Spline className="w-4 h-4" />
                    Tree
                  </button>
                  <button
                    className={`chip ${lineageView === "list" ? "accent-chip" : ""}`}
                    onClick={() => setLineageView("list")}
                    title="Compact list"
                  >
                    <ListIcon className="w-4 h-4" />
                    List
                  </button>
                </div>
              )}
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
                            className={`relative rounded-md overflow-hidden border bg-white dark:bg-zinc-9${"00"} ${
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
                                  <button className="chip px-2 py-0.5 text-[11px]" onClick={() => beginCaptionEdit(p)}>
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

              {viewTab === "lineage" && (
                <>
                  <div className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
                    Lineage shows parent→child progressions for this strain. Use <strong>Tree</strong> for a visual
                    diagram or <strong>List</strong> for a compact view. Roots can be tagged with an{" "}
                    <strong>Origin</strong> (MSS / Swab / Print / LC Syringe / Wild→Agar). When a grow was created from a
                    Library item, its origin is inferred automatically — you can override it here.
                  </div>
                  {lineageView === "tree" ? lineageTreeUI : rootsListUI}
                </>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Manage Storage Locations Modal */}
      {manageLocOpen && (
        <Modal open={manageLocOpen} onClose={() => setManageLocOpen(false)} title="Manage Storage Locations" size="lg">
          <div className="space-y-3">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const input = e.currentTarget.querySelector("input[name='newLoc']");
                const val = input?.value?.trim();
                if (!val) return;
                const u = auth.currentUser;
                if (!u) return;
                await addLocation(db, u.uid, val);
                input.value = "";
              }}
              className="flex items-center gap-2"
            >
              <input name="newLoc" className="chip flex-1" placeholder="Add new location…" />
              <button type="submit" className="chip chip--active">Add</button>
            </form>

            {storageLocations.length === 0 ? (
              <div className="text-sm opacity-70">No locations yet. Add your first one above.</div>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded border border-zinc-200 dark:border-zinc-800">
                {storageLocations.map((row, idx) => (
                  <li key={row.id} className="p-2 flex items-center gap-2">
                    <input
                      defaultValue={row.name}
                      className="chip flex-1"
                      onBlur={async (e) => {
                        const name = e.target.value.trim();
                        if (!name || name === row.name) return;
                        const u = auth.currentUser;
                        if (!u) return;
                        await renameLocation(db, u.uid, row.id, name);
                      }}
                      aria-label="Location name"
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="chip"
                        disabled={idx === 0}
                        onClick={async () => {
                          const u = auth.currentUser;
                          if (!u) return;
                          await moveLocation(db, u.uid, storageLocations, idx, idx - 1);
                        }}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="chip"
                        disabled={idx === storageLocations.length - 1}
                        onClick={async () => {
                          const u = auth.currentUser;
                          if (!u) return;
                          await moveLocation(db, u.uid, storageLocations, idx, idx + 1);
                        }}
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="chip bg-red-600 text-white hover:bg-red-700"
                        onClick={async () => {
                          const u = auth.currentUser;
                          if (!u) return;
                          if (!window.confirm("Delete this location?")) return;
                          await deleteLocation(db, u.uid, row.id);
                        }}
                        title="Delete"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="text-xs opacity-70">
              Tip: If you have no locations, defaults (<code>Fridge</code>, <code>Freezer</code>, <code>Room</code>) are seeded automatically.
            </div>
          </div>
        </Modal>
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
