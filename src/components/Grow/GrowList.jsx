// src/components/Grow/GrowList.jsx

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { db, auth } from "../../firebase-config";
import {
  updateDoc,
  doc,
  serverTimestamp,
  collection,
  getDocs,
} from "firebase/firestore";
import { useConfirm } from "../ui/ConfirmDialog";
import Modal from "../ui/Modal";
import {
  DEFAULT_STORAGE_LOCATIONS,
  subscribeLocations,
  seedDefaultsIfEmpty,
  addLocation,
} from "../../lib/storage-locations";
import { getCoverSrc } from "../../lib/grow-images";
import {
  normalizeStage,
  normalizeType,
  titleOfGrow,
  bestTimeMs,
  isArchivedish,
} from "../../lib/growFilters";
import GrowForm from "./GrowForm";
import { enqueueReusablesForGrow } from "../../lib/clean-queue";

/**
 * Dashboard/Archive Grow List
 *
 * KEY GUARANTEES:
 * - “Active” dataset hard-filters out archived rows via isArchivedish().
 * - Archive/unarchive and store/unstore writes are normalized.
 * - Fully-consumed (new model) auto-fixes to Archived once rendered (legacy consumables).
 * - Cost display is normalized from recipe + supplies for UI display only.
 */

// ---------- Date formatting helpers ----------
const STAGE_TS_FIELD = {
  Inoculated: "inoculatedAt",
  Colonizing: "colonizingAt",
  Colonized: "colonizedAt",
  Fruiting: "fruitingAt",
  Harvesting: "harvestingAt",
  Harvested: "harvestedAt",
  Consumed: "consumedAt",
  Contaminated: "contaminatedAt",
};

function toDateObj(v) {
  try {
    if (!v) return null;
    if (v?.toDate && typeof v.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
    if (typeof v === "string") {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}

function fmtDateYYYYMMDD(v) {
  const d = toDateObj(v);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function stageDateString(grow) {
  const cur = normalizeStage(grow?.stage || "");
  const field = STAGE_TS_FIELD[cur];
  const primary =
    (field && grow?.[field]) ||
    grow?.inoculationDate ||
    grow?.inoc ||
    grow?.createdAt;
  return fmtDateYYYYMMDD(primary) || "—";
}

function getCreatedMs(grow) {
  const candidates = [
    grow?.createdAt,
    grow?.created_on,
    grow?.startDate,
    grow?.start,
    grow?.inoculationDate,
    grow?.inoc,
    grow?.updatedAt,
  ];

  for (const value of candidates) {
    const d = toDateObj(value);
    if (d) return d.getTime();
  }

  return 0;
}

// ---------- Remaining helper (handles new & legacy fields) ----------
function calcRemaining(g) {
  const total = Number(g?.amountTotal);
  const used = Number(g?.amountUsed);
  const remNew =
    Number.isFinite(total) && total > 0
      ? Math.max(0, total - (Number.isFinite(used) ? used : 0))
      : null;
  const remLegacy = Number(g?.amountAvailable);
  return Number.isFinite(remNew)
    ? remNew
    : Number.isFinite(remLegacy)
    ? remLegacy
    : 0;
}

// ---------- Cost normalization helpers ----------
function resolveRecipeItemsForGrow(g, recipesMap) {
  if (Array.isArray(g?.recipeItems) && g.recipeItems.length) {
    return g.recipeItems;
  }
  const rid = g?.recipeId || g?.recipe_id || g?.recipe?.id;
  if (!rid) return null;
  const rec = recipesMap.get(rid);
  if (rec && Array.isArray(rec.items)) return rec.items;
  return null;
}

function toNumber(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function computeItemsCost(items, suppliesMap) {
  if (!Array.isArray(items) || !items.length) return 0;
  let sum = 0;
  for (const it of items) {
    const sid = it?.supplyId;
    const per = toNumber(
      sid && suppliesMap.has(sid) ? suppliesMap.get(sid)?.cost : it?.cost,
      0
    );
    const amt = toNumber(it?.amount, 0);
    sum += per * amt;
  }
  return Math.max(0, Number(sum.toFixed(2)));
}

function getRecipeYieldForGrow(g, recipesMap) {
  if (!g) return 1;

  const inlineY = toNumber(g.recipeYield, 0);
  if (inlineY > 0) return inlineY;

  const rid = g?.recipeId || g?.recipe_id || g?.recipe?.id;
  if (!rid) return 1;
  const rec = recipesMap.get(rid);
  if (!rec) return 1;

  const recY = toNumber(rec.yield, 0);
  return recY > 0 ? recY : 1;
}

function computeStoredLabConsumablesCost(g, suppliesMap) {
  const inline = Number(g?.labConsumablesCost);
  if (Number.isFinite(inline)) return Math.max(0, Number(inline.toFixed(2)));

  const rows = Array.isArray(g?.labConsumablesUsed) ? g.labConsumablesUsed : [];
  if (!rows.length) return 0;

  let total = 0;
  for (const row of rows) {
    const directTotal = Number(row?.totalCost ?? row?.totalCostPerGrow ?? row?.costTotal);
    if (Number.isFinite(directTotal)) {
      total += directTotal;
      continue;
    }

    const amount = toNumber(row?.amount ?? row?.amountPerGrow ?? row?.qty, 0);
    const directUnitCost = Number(row?.unitCost ?? row?.unitPrice ?? row?.costPerUnit);
    if (Number.isFinite(directUnitCost)) {
      total += directUnitCost * amount;
      continue;
    }

    const liveUnitCost = toNumber(
      row?.supplyId && suppliesMap.has(row.supplyId)
        ? suppliesMap.get(row.supplyId)?.cost
        : 0,
      0
    );
    total += liveUnitCost * amount;
  }

  return Math.max(0, Number(total.toFixed(2)));
}

function buildSuppliesMap(source) {
  const map = new Map();
  const arr = Array.isArray(source) ? source : [];
  for (const item of arr) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}

function buildRecipesMap(source) {
  const map = new Map();
  const arr = Array.isArray(source) ? source : [];
  for (const item of arr) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}

export default function GrowList({
  growsActive = [],
  archivedGrows = [],
  recipes,
  supplies,
  setEditingGrow,
  showAddButton = false,
  onUpdateStatus,
  onUpdateStage,
  onDeleteGrow,
}) {
  const confirm = useConfirm();

  const hasRecipesProp = Array.isArray(recipes);
  const hasSuppliesProp = Array.isArray(supplies);

  // User-defined storage locations + prompt
  const [storageLocations, setStorageLocations] = useState([]);
  const [storePrompt, setStorePrompt] = useState({
    open: false,
    ids: [],
    chosen: "",
  });

  // Subscribe to storage locations (seed defaults)
  useEffect(() => {
    const u = auth.currentUser;
    if (!u) return undefined;

    (async () => {
      try {
        await seedDefaultsIfEmpty(db, u.uid);
      } catch {}
    })();

    const unsub = subscribeLocations(db, u.uid, setStorageLocations);
    return () => unsub && unsub();
  }, []);

  // ---------- Filtering state ----------
  const [dataset, setDataset] = useState("active"); // "active" | "stored" | "archived"
  const [q, setQ] = useState("");

  const TYPE_OPTIONS = ["Agar", "LC", "Grain Jar", "Bulk", "Other"];
  const STAGE_OPTIONS = [
    "Inoculated",
    "Colonizing",
    "Colonized",
    "Fruiting",
    "Harvesting",
    "Harvested",
    "Consumed",
    "Contaminated",
    "Other",
  ];
  const STAGE_FLOW = [
    "Inoculated",
    "Colonizing",
    "Colonized",
    "Fruiting",
    "Harvesting",
    "Harvested",
  ];

  // Persisted filters (localStorage)
  const lastKey = "growFiltersLast";
  const presetsKey = "growFiltersPresets";

  const restoreLast = (key, fallback) => {
    try {
      const obj = JSON.parse(localStorage.getItem(lastKey) || "{}");
      return obj[key] ?? fallback;
    } catch {
      return fallback;
    }
  };

  const [types, setTypes] = useState(() => restoreLast("types", []));
  const [stages, setStages] = useState(() => restoreLast("stages", []));
  const [presets, setPresets] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(presetsKey) || "[]");
    } catch {
      return [];
    }
  });
  const [selectedPreset, setSelectedPreset] = useState("");
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");

  // ---------- Sort state ----------
  const [sortMode, setSortMode] = useState(() => restoreLast("sortMode", "new"));

  const persistLast = (next) => {
    try {
      const prev = JSON.parse(localStorage.getItem(lastKey) || "{}");
      localStorage.setItem(lastKey, JSON.stringify({ ...prev, ...next }));
    } catch {}
  };

  useEffect(() => {
    persistLast({ types, stages, sortMode });
  }, [types, stages, sortMode]);

  // ---------- Selection ----------
  const [selected, setSelected] = useState(() => new Set());
  const clearSel = () => setSelected(new Set());
  const toggleSel = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ---------- Local optimistic fields ----------
  const [localStage, setLocalStage] = useState({});
  const [localStatus, setLocalStatus] = useState({});
  const [localArchived, setLocalArchived] = useState({});

  // ---------- Full edit modal ----------
  const [editingGrowFull, setEditingGrowFull] = useState(null);

  // ---------- Datasets from props (extra guard filtering) ----------
  const itemsActiveRaw = useMemo(() => {
    const arr = Array.isArray(growsActive) ? growsActive : [];
    return arr.filter((g) => {
      const id = g.id;
      const locArchived = localArchived[id] === true;
      const locStatus = String(localStatus[id] || "").toLowerCase();
      const locStage = normalizeStage(localStage[id] || g.stage || "");
      const optimisticArchived = locArchived || locStatus === "archived";
      const hideHarvested = locStage === "Harvested";
      return !isArchivedish(g) && !optimisticArchived && !hideHarvested;
    });
  }, [growsActive, localArchived, localStatus, localStage]);

  const itemsArchived = useMemo(
    () => (Array.isArray(archivedGrows) ? archivedGrows : []),
    [archivedGrows]
  );

  const normStatus = (g) =>
    String(localStatus[g.id] ?? g.status ?? "Active").toLowerCase();

  const itemsActiveOnly = useMemo(
    () => itemsActiveRaw.filter((g) => normStatus(g) !== "stored"),
    [itemsActiveRaw, localStatus]
  );

  const itemsStoredOnly = useMemo(
    () => itemsActiveRaw.filter((g) => normStatus(g) === "stored"),
    [itemsActiveRaw, localStatus]
  );

  const items = useMemo(() => {
    if (dataset === "archived") return itemsArchived;
    if (dataset === "stored") return itemsStoredOnly;
    return itemsActiveOnly;
  }, [dataset, itemsActiveOnly, itemsStoredOnly, itemsArchived]);

  // ---------- Auto-fix fully consumed grows (legacy consumables) ----------
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    const toFix = [];
    for (const g of items) {
      const remaining = calcRemaining(g);
      const notConsumed = normalizeStage(g.stage) !== "Consumed";
      const notArchived =
        String(g.status || "").toLowerCase() !== "archived" && !g.archived;

      if (remaining <= 0 && (notConsumed || notArchived) && g.id) {
        toFix.push(g);
      }
    }

    if (!toFix.length) return undefined;

    (async () => {
      for (const g of toFix) {
        try {
          const patch = {
            stage: "Consumed",
            status: "Archived",
            archived: true,
            archivedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (!g.consumedAt) patch.consumedAt = serverTimestamp();
          if (g.recipeId && !g.cleanQueued) patch.cleanQueued = true;

          await updateDoc(doc(db, "users", uid, "grows", g.id), patch);

          setLocalStage((p) => ({ ...p, [g.id]: "Consumed" }));
          setLocalStatus((p) => ({ ...p, [g.id]: "Archived" }));
          setLocalArchived((p) => ({ ...p, [g.id]: true }));
        } catch (e) {
          console.error("auto-consume/auto-archive failed:", e);
        }
      }
    })();

    return undefined;
  }, [items]);

  // ---------- Supplies & Recipes (for cost computation) ----------
  const [fetchedSuppliesMap, setFetchedSuppliesMap] = useState(() => new Map());
  const [fetchedRecipesMap, setFetchedRecipesMap] = useState(() => new Map());

  const propSuppliesMap = useMemo(() => buildSuppliesMap(supplies), [supplies]);
  const propRecipesMap = useMemo(() => buildRecipesMap(recipes), [recipes]);

  useEffect(() => {
    if (hasSuppliesProp) return undefined;

    const u = auth.currentUser;
    if (!u) {
      setFetchedSuppliesMap(new Map());
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const sSnap = await getDocs(collection(db, "users", u.uid, "supplies"));
        if (cancelled) return;
        const sMap = new Map();
        sSnap.forEach((d) => {
          const data = d.data() || {};
          sMap.set(d.id, { id: d.id, ...data });
        });
        setFetchedSuppliesMap(sMap);
      } catch (e) {
        if (!cancelled) {
          console.warn("Failed to load supplies for cost calc:", e);
          setFetchedSuppliesMap(new Map());
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasSuppliesProp]);

  useEffect(() => {
    if (hasRecipesProp) return undefined;

    const u = auth.currentUser;
    if (!u) {
      setFetchedRecipesMap(new Map());
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const rSnap = await getDocs(collection(db, "users", u.uid, "recipes"));
        if (cancelled) return;
        const rMap = new Map();
        rSnap.forEach((d) => {
          const data = d.data() || {};
          rMap.set(d.id, { id: d.id, ...data });
        });
        setFetchedRecipesMap(rMap);
      } catch (e) {
        if (!cancelled) {
          console.warn("Failed to load recipes for cost calc:", e);
          setFetchedRecipesMap(new Map());
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasRecipesProp]);

  const suppliesMap = hasSuppliesProp ? propSuppliesMap : fetchedSuppliesMap;
  const recipesMap = hasRecipesProp ? propRecipesMap : fetchedRecipesMap;

  // Compute per-grow normalized cost from recipe+supplies (fallback to stored grow.cost)
  // Uses PER-SERVING cost: batch cost ÷ recipe.yield
  const computedCosts = useMemo(() => {
    const map = new Map();
    const source = [...itemsActiveOnly, ...itemsStoredOnly, ...itemsArchived];

    for (const g of source) {
      let cost = null;

      const stored = Number(g?.cost);
      const hasStored = Number.isFinite(stored) && stored >= 0;

      const itemsArr = resolveRecipeItemsForGrow(g, recipesMap);
      let derived = null;

      if (itemsArr) {
        const batchCost = computeItemsCost(itemsArr, suppliesMap);
        const y = getRecipeYieldForGrow(g, recipesMap);
        const divisor = y > 0 ? y : 1;
        derived = Math.max(0, Number(((batchCost || 0) / divisor).toFixed(2)));
      }

      const labConsumablesCost = computeStoredLabConsumablesCost(g, suppliesMap);

      if (derived != null) cost = Number((derived + labConsumablesCost).toFixed(2));
      else if (hasStored) cost = stored;
      else cost = labConsumablesCost > 0 ? labConsumablesCost : null;

      map.set(g.id, cost);
    }

    return map;
  }, [itemsActiveOnly, itemsStoredOnly, itemsArchived, recipesMap, suppliesMap]);

  // ---------- Abbreviation migration guard ----------
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    const active = Array.isArray(growsActive) ? growsActive : [];
    const archived = Array.isArray(archivedGrows) ? archivedGrows : [];
    const all = [...active, ...archived];

    if (!all.length) return undefined;

    const byKey = new Map();
    const baseMaxSuffix = new Map();

    const parseKey = (raw) => {
      const key = String(raw || "").trim();
      if (!key) return { key: "", base: "", suffix: 0 };

      let match = key.match(/^(.*-\d{6})-(\d+)$/);
      if (match) {
        return {
          key,
          base: match[1],
          suffix: parseInt(match[2], 10) || 0,
        };
      }

      if (/^.*-\d{6}$/.test(key)) {
        return { key, base: key, suffix: 0 };
      }

      match = key.match(/^(.*?)-(\d+)$/);
      if (match) {
        return {
          key,
          base: match[1],
          suffix: parseInt(match[2], 10) || 0,
        };
      }

      return { key, base: key, suffix: 0 };
    };

    for (const grow of all) {
      const rawKey =
        grow.abbr ||
        grow.abbreviation ||
        grow.subName ||
        grow.subname ||
        "";

      const { key, base, suffix } = parseKey(rawKey);
      if (!key || !base) continue;

      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ grow, base, key });

      const suffForMax = suffix || 1;
      const prevMax = baseMaxSuffix.get(base) || 0;
      baseMaxSuffix.set(base, Math.max(prevMax, suffForMax));
    }

    const updates = [];

    for (const [, entries] of byKey.entries()) {
      if (entries.length <= 1) continue;

      const base = entries[0].base;
      let maxSuffix = baseMaxSuffix.get(base) || 1;

      const sorted = [...entries].sort(
        (a, b) => getCreatedMs(a.grow) - getCreatedMs(b.grow)
      );

      for (let i = 1; i < sorted.length; i += 1) {
        maxSuffix += 1;
        const newKey = `${base}-${maxSuffix}`;
        if (newKey === sorted[i].key) continue;
        const id = sorted[i].grow.id;
        if (!id) continue;
        updates.push({ id, newKey });
      }
    }

    if (!updates.length) return undefined;

    (async () => {
      try {
        await Promise.all(
          updates.map(({ id, newKey }) =>
            updateDoc(doc(db, "users", uid, "grows", id), {
              abbr: newKey,
              abbreviation: newKey,
              subName: newKey,
              updatedAt: serverTimestamp(),
            })
          )
        );
      } catch (err) {
        console.error("Abbreviation migration guard failed", err);
      }
    })();

    return undefined;
  }, [growsActive, archivedGrows]);

  // ---------- Filtering ----------
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const ts = new Set(types);
    const ss = new Set(stages);

    const matchQ = (g) =>
      !qq ||
      String(g.name || g.title || "")
        .toLowerCase()
        .includes(qq) ||
      String(g.strain || "")
        .toLowerCase()
        .includes(qq) ||
      String(g.type || "")
        .toLowerCase()
        .includes(qq) ||
      String(g.abbreviation || g.abbr || "")
        .toLowerCase()
        .includes(qq);

    const matchType = (g) =>
      ts.size === 0 || ts.has(normalizeType(g.type || g.growType));

    const matchStage = (g) =>
      ss.size === 0 || ss.has(normalizeStage(g.stage || ""));

    let out = items.filter((g) => matchQ(g) && matchType(g) && matchStage(g));

    if (dataset === "active" && ss.has("Consumed")) {
      out = out.filter((g) => calcRemaining(g) > 0);
    }

    return out;
  }, [items, q, types, stages, dataset]);

  // ---------- Sorting ----------
  const sorted = useMemo(() => {
    const base = filtered.slice();

    const cmpTitle = (a, b) =>
      titleOfGrow(a).localeCompare(titleOfGrow(b), undefined, {
        sensitivity: "base",
      }) || String(a.id || "").localeCompare(String(b.id || ""));

    const cmpTimeDesc = (a, b) => bestTimeMs(b) - bestTimeMs(a) || cmpTitle(a, b);
    const cmpTimeAsc = (a, b) => bestTimeMs(a) - bestTimeMs(b) || cmpTitle(a, b);

    if (sortMode === "az") base.sort(cmpTitle);
    else if (sortMode === "za") base.sort((a, b) => cmpTitle(b, a));
    else if (sortMode === "old") base.sort(cmpTimeAsc);
    else base.sort(cmpTimeDesc);

    return base;
  }, [filtered, sortMode]);

  const selectedIds = useMemo(() => [...selected], [selected]);

  const savePreset = useCallback((rawName) => {
    const name = String(rawName || "").trim();
    if (!name) return false;
    const next = { name, types, stages };
    setPresets((prev) => {
      const arr = prev.filter((x) => x.name !== name);
      const out = [...arr, next];
      try {
        localStorage.setItem(presetsKey, JSON.stringify(out));
      } catch {}
      return out;
    });
    setSelectedPreset(name);
    setPresetNameDraft("");
    setPresetModalOpen(false);
    return true;
  }, [types, stages]);

  // ---------- Firestore ops ----------
  async function applyStatus(id, nextStatus) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const lower = String(nextStatus || "").toLowerCase();
    const archive = lower === "archived";
    const patch = {
      status: nextStatus,
      archived: archive,
      archivedAt: archive ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    };

    await updateDoc(doc(db, "users", uid, "grows", id), patch);

    setLocalStatus((p) => ({ ...p, [id]: nextStatus }));
    setLocalArchived((p) => ({ ...p, [id]: archive }));
    onUpdateStatus?.(id, nextStatus);
  }

  const applyStage = async (id, stage) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid, "grows", id), {
      stage,
      updatedAt: serverTimestamp(),
    });
    setLocalStage((p) => ({ ...p, [id]: stage }));
    onUpdateStage?.(id, stage);
  };

  const applyDelete = async (id) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid, "grows", id), {
      status: "Archived",
      archived: true,
      archivedAt: serverTimestamp(),
      deleted: true,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    onDeleteGrow?.(id);
  };

  // ---------- Row actions ----------
  const handleStoreToggle = async (grow) => {
    if (!grow?.id) return;
    const isStored =
      String(localStatus[grow.id] || grow.status || "").toLowerCase() === "stored";

    if (isStored) {
      if (!(await confirm("Unstore this grow?"))) return;
      await applyStatus(grow.id, "Active");
      return;
    }

    const first = storageLocations.length
      ? storageLocations[0].name
      : DEFAULT_STORAGE_LOCATIONS[0];

    setStorePrompt({ open: true, ids: [grow.id], chosen: first });
  };

  const nextStageOf = (cur) => {
    const idx = STAGE_FLOW.indexOf(cur);
    if (idx < 0 || idx >= STAGE_FLOW.length - 1) return null;
    return STAGE_FLOW[idx + 1];
  };

  const handleNextStage = async (grow) => {
    const cur = normalizeStage(localStage[grow.id] || grow.stage);
    const next = nextStageOf(cur);
    if (!next) return;
    if (!(await confirm(`Advance stage to "${next}"?`))) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (next === "Harvested") {
      await updateDoc(doc(db, "users", uid, "grows", grow.id), {
        stage: "Harvested",
        harvestedAt: serverTimestamp(),
        status: "Archived",
        archived: true,
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setLocalStage((p) => ({ ...p, [grow.id]: "Harvested" }));
      setLocalStatus((p) => ({ ...p, [grow.id]: "Archived" }));
      setLocalArchived((p) => ({ ...p, [grow.id]: true }));
      try {
        await enqueueReusablesForGrow(uid, grow.id);
      } catch {}
    } else {
      await applyStage(grow.id, next);
    }
  };

  const handleArchiveToggle = async (grow) => {
    if (!grow?.id) return;
    const status = String(localStatus[grow.id] || grow.status || "").toLowerCase();
    const next = status === "archived" ? "Active" : "Archived";

    if (!(await confirm(`${status === "archived" ? "Unarchive" : "Archive"} this grow?`))) {
      return;
    }

    await applyStatus(grow.id, next);
  };

  const handleDelete = async (grow) => {
    if (!grow?.id) return;
    if (!(await confirm("Delete this grow? This cannot be undone."))) return;
    await applyDelete(grow.id);
  };

  // ---------- Batch actions ----------
  const eligibleForStagePlus = useMemo(() => {
    const out = [];
    for (const id of selectedIds) {
      const grow = filtered.find((g) => g.id === id);
      if (!grow) continue;
      const cur = normalizeStage(localStage[id] || grow.stage);
      const idx = STAGE_FLOW.indexOf(cur);
      const next =
        idx >= 0 && idx < STAGE_FLOW.length - 1 ? STAGE_FLOW[idx + 1] : null;
      if (next) out.push({ id, next });
    }
    return out;
  }, [selectedIds, filtered, localStage]);

  const batchStagePlus = async () => {
    if (!eligibleForStagePlus.length) return;
    if (!(await confirm(`Advance stage for ${eligibleForStagePlus.length} grow(s)?`))) return;

    await Promise.all(
      eligibleForStagePlus.map(async ({ id, next }) => {
        if (next === "Harvested") {
          const uid = auth.currentUser?.uid;
          if (!uid) return;
          await updateDoc(doc(db, "users", uid, "grows", id), {
            stage: "Harvested",
            harvestedAt: serverTimestamp(),
            status: "Archived",
            archived: true,
            archivedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          try {
            await enqueueReusablesForGrow(uid, id);
          } catch {}
        } else {
          await applyStage(id, next);
        }
      })
    );

    clearSel();
  };

  const batchArchive = async () => {
    if (!selectedIds.length) return;
    if (!(await confirm(`Archive ${selectedIds.length} grow(s)?`))) return;
    await Promise.all(selectedIds.map((id) => applyStatus(id, "Archived")));
  };

  const batchUnarchive = async () => {
    if (!selectedIds.length) return;
    if (!(await confirm(`Unarchive ${selectedIds.length} grow(s)?`))) return;
    await Promise.all(selectedIds.map((id) => applyStatus(id, "Active")));
    clearSel();
  };

  const batchStore = async () => {
    const ids = Array.from(selected).filter((id) => {
      const row = items.find((g) => g.id === id);
      const status = String(localStatus[id] || row?.status || "").toLowerCase();
      return row && status !== "stored";
    });

    if (!ids.length) return;

    const first = storageLocations.length
      ? storageLocations[0].name
      : DEFAULT_STORAGE_LOCATIONS[0];

    setStorePrompt({ open: true, ids, chosen: first });
  };

  const batchUnstore = async () => {
    const ids = selectedIds.filter((id) => {
      const grow = filtered.find((g) => g.id === id);
      return (
        grow &&
        String(localStatus[id] || grow.status || "").toLowerCase() === "stored"
      );
    });

    if (!ids.length) return;
    if (!(await confirm(`Unstore ${ids.length} grow(s)?`))) return;

    await Promise.all(ids.map((id) => applyStatus(id, "Active")));
    clearSel();
  };

  // ---------- Row ----------
  const Row = useCallback(
    ({ grow, style }) => {
      const abbr = grow.abbreviation || grow.abbr || grow.subName || "";
      const strain = grow.strain || "Unknown strain";
      const type = grow.type || grow.growType || "";
      const stage = localStage[grow.id] || grow.stage || "—";
      const status = localStatus[grow.id] || grow.status || "—";

      const computed = computedCosts.get(grow.id);
      const costNumber =
        Number.isFinite(computed) && computed >= 0
          ? computed
          : typeof grow.cost === "number" && !Number.isNaN(grow.cost)
          ? grow.cost
          : null;

      const dateTxt = stageDateString(grow);
      const title = abbr || strain;
      const checked = selected.has(grow.id);

      const curNorm = normalizeStage(stage);
      const atEnd =
        STAGE_FLOW.indexOf(curNorm) === STAGE_FLOW.length - 1 || curNorm === "Other";
      const canStagePlus = !atEnd;

      const isArchived =
        String(localArchived[grow.id] ?? (grow.status || "")).toLowerCase() === "archived" ||
        !!(grow.archived || false);
      const isStored = String(status || "").toLowerCase() === "stored";

      const cover = getCoverSrc(grow);

      return (
        <div
          className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
          style={style}
          data-testid="grow-row"
        >
          <div className="sr-only">
            <span data-testid="grow-row-title">{title || "Untitled"}</span>
            <span data-testid="grow-row-strain">{strain}</span>
            <span data-testid="grow-row-type">{type || "Other"}</span>
            <span data-testid="grow-row-stage">{stage}</span>
            <span data-testid="grow-row-status">{status}</span>
          </div>

          <input
            type="checkbox"
            aria-label="Select row"
            checked={checked}
            onChange={() => toggleSel(grow.id)}
          />

          <img
            alt=""
            src={cover}
            className="w-12 h-12 rounded-lg object-cover bg-zinc-200 dark:bg-zinc-800"
            loading="lazy"
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link
                to={`/grow/${grow.id}`}
                className="font-medium truncate hover:underline"
              >
                {title || "Untitled"}
              </Link>
              <span className="chip">{type || "Other"}</span>
              <span className="chip">{stage}</span>
              <span className="chip">{status}</span>
              {costNumber !== null && (
                <span className="chip">${Number(costNumber).toFixed(2)}</span>
              )}
            </div>
            <div className="text-xs opacity-70">
              Stage date: {dateTxt} • Strain: {strain}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Link className="chip" to={`/grow/${grow.id}`} data-testid="grow-row-open">
              Open
            </Link>
            <button className="chip" onClick={() => setEditingGrow(grow)}>
              Stage/Status
            </button>
            <button className="chip" onClick={() => setEditingGrowFull(grow)}>
              Edit
            </button>
            <button
              className="chip"
              onClick={() => handleNextStage(grow)}
              disabled={!canStagePlus}
              data-testid="grow-row-stage-plus"
            >
              Stage +
            </button>
            <button className="chip" onClick={() => handleArchiveToggle(grow)}>
              {isArchived ? "Unarchive" : "Archive"}
            </button>
            <button className="chip" onClick={() => handleStoreToggle(grow)}>
              {isStored ? "Unstore" : "Store"}
            </button>
            <button className="chip" onClick={() => handleDelete(grow)}>
              Delete
            </button>
          </div>
        </div>
      );
    },
    [
      selected,
      localStage,
      localStatus,
      localArchived,
      setEditingGrow,
      computedCosts,
    ]
  );

  // ---------- Render ----------
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
          <button
            className={`px-3 py-1.5 ${dataset === "active" ? "accent-bg text-white" : ""}`}
            onClick={() => {
              setDataset("active");
              clearSel();
            }}
          >
            Active
          </button>
          <button
            className={`px-3 py-1.5 ${dataset === "stored" ? "accent-bg text-white" : ""}`}
            onClick={() => {
              setDataset("stored");
              clearSel();
            }}
          >
            Stored
          </button>
          <button
            className={`px-3 py-1.5 ${dataset === "archived" ? "accent-bg text-white" : ""}`}
            onClick={() => {
              setDataset("archived");
              clearSel();
            }}
          >
            Archived
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search grows…"
          className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
          aria-label="Search grows"
        />

        <select
          className="px-2 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value)}
          aria-label="Sort grows"
          title="Sort grows"
        >
          <option value="new">New → Old</option>
          <option value="old">Old → New</option>
          <option value="az">A → Z</option>
          <option value="za">Z → A</option>
        </select>

        <div className="flex flex-wrap items-center gap-1">
          {TYPE_OPTIONS.map((t) => {
            const active = types.includes(t);
            return (
              <button
                key={t}
                className={`chip ${active ? "chip--active" : ""}`}
                onClick={() =>
                  setTypes((prev) =>
                    prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                  )
                }
              >
                {t}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {STAGE_OPTIONS.map((t) => {
            const active = stages.includes(t);
            return (
              <button
                key={t}
                className={`chip ${active ? "chip--active" : ""}`}
                onClick={() =>
                  setStages((prev) =>
                    prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                  )
                }
              >
                {t}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs"
            value={selectedPreset}
            onChange={(e) => {
              const name = e.target.value;
              setSelectedPreset(name);
              const p = presets.find((x) => x.name === name);
              if (!p) return;
              setTypes([...p.types]);
              setStages([...p.stages]);
              persistLast({ types: p.types, stages: p.stages });
            }}
          >
            <option value="">Presets…</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            className="chip"
            onClick={() => {
              setPresetNameDraft(selectedPreset || "");
              setPresetModalOpen(true);
            }}
          >
            Save preset
          </button>

          <button
            className="chip"
            onClick={() => {
              if (!selectedPreset) return;
              setPresets((prev) => {
                const out = prev.filter((x) => x.name !== selectedPreset);
                try {
                  localStorage.setItem(presetsKey, JSON.stringify(out));
                } catch {}
                return out;
              });
              setSelectedPreset("");
            }}
          >
            Delete preset
          </button>
        </div>

        {showAddButton && (
          <button
            className="chip chip--active"
            onClick={() => setEditingGrow({})}
          >
            + New
          </button>
        )}
      </div>

      {/* Batch bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800">
          <span className="text-sm opacity-80">{selectedIds.length} selected</span>

          <button
            className="chip"
            onClick={() => setSelected(new Set(filtered.map((g) => g.id)))}
          >
            Select all
          </button>

          <button className="chip" onClick={clearSel}>
            Clear
          </button>

          <button
            className="chip"
            onClick={batchStagePlus}
            disabled={eligibleForStagePlus.length === 0}
          >
            Stage +
          </button>

          <button className="chip" onClick={batchArchive}>
            Archive
          </button>

          <button className="chip" onClick={batchUnarchive}>
            Unarchive
          </button>

          <button
            className="chip"
            onClick={batchStore}
            disabled={
              selectedIds.filter((id) => {
                const grow = filtered.find((g) => g.id === id);
                return (
                  grow &&
                  String(localStatus[id] || grow.status || "").toLowerCase() !== "stored"
                );
              }).length === 0
            }
          >
            Store
          </button>

          <button
            className="chip"
            onClick={batchUnstore}
            disabled={
              selectedIds.filter((id) => {
                const grow = filtered.find((g) => g.id === id);
                return (
                  grow &&
                  String(localStatus[id] || grow.status || "").toLowerCase() === "stored"
                );
              }).length === 0
            }
          >
            Unstore
          </button>

          <button
            className="chip"
            onClick={async () => {
              if (!selectedIds.length) return;
              if (
                !(await confirm(
                  `Delete ${selectedIds.length} grow(s)? This cannot be undone.`
                ))
              ) {
                return;
              }
              await Promise.all(selectedIds.map((id) => applyDelete(id)));
              clearSel();
            }}
          >
            Delete
          </button>
        </div>
      )}

      {/* Rows */}
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow">
        {sorted.map((g) => (
          <Row key={g.id || g.abbreviation || g.strain} grow={g} />
        ))}
      </div>

      {/* Full Edit Modal */}
      {editingGrowFull && (
        <Modal
          open={!!editingGrowFull}
          onClose={() => setEditingGrowFull(null)}
          title="Edit Grow"
          size="lg"
        >
          <GrowForm
            editingGrow={editingGrowFull}
            onClose={() => setEditingGrowFull(null)}
            onSaveComplete={() => setEditingGrowFull(null)}
            grows={[...itemsActiveRaw, ...itemsArchived]}
            recipes={Array.isArray(recipes) ? recipes : []}
            supplies={Array.isArray(supplies) ? supplies : []}
          />
        </Modal>
      )}

      <Modal
        open={presetModalOpen}
        onClose={() => {
          setPresetModalOpen(false);
          setPresetNameDraft("");
        }}
        title="Save filter preset"
        size="md"
      >
        <div className="space-y-3">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Save the current type and stage filters as a reusable preset.
          </div>
          <input
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
            placeholder="Preset name"
            value={presetNameDraft}
            onChange={(e) => setPresetNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                savePreset(presetNameDraft);
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => setPresetModalOpen(false)}>Cancel</button>
            <button className="btn btn-accent" onClick={() => savePreset(presetNameDraft)}>Save preset</button>
          </div>
        </div>
      </Modal>

      {/* Store → choose location */}
      {storePrompt.open && (
        <Modal
          open={storePrompt.open}
          onClose={() => setStorePrompt({ open: false, ids: [], chosen: "" })}
          title={`Store ${storePrompt.ids.length} grow${storePrompt.ids.length > 1 ? "s" : ""}`}
          size="md"
        >
          <div className="space-y-3">
            <div className="text-sm">
              Choose a storage location for the selected grow
              {storePrompt.ids.length > 1 ? "s" : ""}:
            </div>

            <select
              className="chip w-full"
              value={storePrompt.chosen}
              onChange={(e) =>
                setStorePrompt((s) => ({ ...s, chosen: e.target.value }))
              }
            >
              {storageLocations.length === 0
                ? DEFAULT_STORAGE_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))
                : storageLocations.map((row) => (
                    <option key={row.id} value={row.name}>
                      {row.name}
                    </option>
                  ))}
            </select>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const input = e.currentTarget.querySelector("input[name='newLoc']");
                const val = input?.value?.trim();
                if (!val) return;
                const u = auth.currentUser;
                if (!u) return;
                await addLocation(db, u.uid, val);
                setStorePrompt((s) => ({ ...s, chosen: val }));
                input.value = "";
              }}
              className="flex items-center gap-2"
            >
              <input
                name="newLoc"
                className="chip flex-1"
                placeholder="Add new location…"
              />
              <button type="submit" className="chip">
                Add
              </button>
            </form>

            <div className="flex justify-end gap-2 pt-2">
              <button
                className="chip"
                onClick={() => setStorePrompt({ open: false, ids: [], chosen: "" })}
              >
                Cancel
              </button>

              <button
                className="chip chip--active"
                onClick={async () => {
                  const uid = auth.currentUser?.uid;
                  if (!uid || !storePrompt.ids.length) return;

                  const loc =
                    (storePrompt.chosen || storageLocations[0]?.name) ??
                    DEFAULT_STORAGE_LOCATIONS[0];

                  await Promise.all(
                    storePrompt.ids.map((id) =>
                      updateDoc(doc(db, "users", uid, "grows", id), {
                        status: "Stored",
                        archived: false,
                        archivedAt: null,
                        storageLocation: loc,
                        storedAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                      })
                    )
                  );

                  setLocalStatus((p) => {
                    const n = { ...p };
                    storePrompt.ids.forEach((id) => {
                      n[id] = "Stored";
                    });
                    return n;
                  });

                  setStorePrompt({ open: false, ids: [], chosen: "" });
                  setSelected(new Set());
                }}
              >
                Store
              </button>
            </div>
          </div>
        </Modal>
      )}

      {items.length === 0 && (
        <div className="text-sm text-slate-500 dark:text-slate-400 px-1 py-2">
          No{" "}
          {dataset === "archived"
            ? "archived"
            : dataset === "stored"
            ? "stored"
            : "active"}{" "}
          grows match your filters.
        </div>
      )}
    </div>
  );
}