// src/pages/Archive.jsx
import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../firebase-config";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { isArchivedish } from "../lib/growFilters";
import {
  Archive as ArchiveIcon,
  Boxes,
  FlaskConical,
  TestTube,
  Package,
  Syringe,
  Wand2,
  ScrollText,
  Trash2,
  PlusCircle,
  Rocket,
} from "lucide-react";

/* ---------------- Helpers ---------------- */
function normalizeType(t = "") {
  const s = String(t).toLowerCase();
  if (s.includes("agar")) return "Agar";
  if (s.includes("lc") || s.includes("liquid")) return "LC";
  if (s.includes("bulk")) return "Bulk";
  if (s.includes("grain")) return "Grain Jar";
  return "Other";
}

const TYPE_ICON = {
  Agar: FlaskConical,
  LC: TestTube,
  "Grain Jar": Package,
  Bulk: Package,
  Other: Boxes,
};

const LIBRARY_TYPES = [
  "Spore Syringe",
  "Spore Swab",
  "Spore Print",
  "LC",
  "Agar Plate",
  "Agar Slant",
];
const LOCATION_OPTS = ["Fridge", "Freezer", "Room"];

/* Map library item -> suggested new grow type */
function suggestTypeFromLibrary(kind) {
  switch (kind) {
    case "LC":
      return "Grain Jar";      // typical next step
    case "Agar Plate":
    case "Agar Slant":
      return "LC";             // make an LC from agar
    case "Spore Syringe":
    case "Spore Swab":
    case "Spore Print":
    default:
      return "Agar";           // germinate on agar
  }
}

/* Map stored culture -> suggested new grow type */
function suggestTypeFromStored(grow) {
  const t = normalizeType(grow.type || grow.growType);
  if (t === "LC") return "Grain Jar";
  if (t === "Agar") return "LC";
  return t || "Agar";
}

/* ---------------- Component ---------------- */
export default function Archive({ grows = [], setEditingGrow }) {
  const [activeTab, setActiveTab] = useState("storage"); // 'storage' | 'archived'
  const [uid, setUid] = useState(null);

  // Library (users/{uid}/library)
  const [library, setLibrary] = useState([]);
  const [loadingLib, setLoadingLib] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => setUid(u ? u.uid : null));
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!uid) {
      setLibrary([]);
      setLoadingLib(false);
      return;
    }
    setLoadingLib(true);
    const ref = collection(db, "users", uid, "library");
    const unsub = onSnapshot(ref, (snap) => {
      setLibrary(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoadingLib(false);
    });
    return () => unsub();
  }, [uid]);

  // Stored cultures: strictly Agar/LC with status === "Stored"
  const storedCultures = useMemo(() => {
    const arr = Array.isArray(grows) ? grows : [];
    return arr
      .filter((g) => String(g.status || "").toLowerCase() === "stored")
      .filter((g) => {
        const t = normalizeType(g.type || g.growType);
        return t === "Agar" || t === "LC";
      })
      .sort((a, b) => String(a.type).localeCompare(String(b.type)));
  }, [grows]);

  // Archived grows (unchanged)
  const archivedGrows = useMemo(
    () => (Array.isArray(grows) ? grows.filter(isArchivedish) : []),
    [grows]
  );

  // ------- Add to Library form -------
  const [newItem, setNewItem] = useState({
    type: "Spore Syringe",
    strainName: "",
    qty: 1,
    unit: "count", // count | ml | plate
    location: "Fridge",
    acquired: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const onAddLibraryItem = async (e) => {
    e?.preventDefault?.();
    if (!uid) return;
    const payload = {
      ...newItem,
      qty: Number(newItem.qty || 0),
      createdAt: new Date().toISOString(),
    };
    await addDoc(collection(db, "users", uid, "library"), payload);
    setNewItem({
      type: "Spore Syringe",
      strainName: "",
      qty: 1,
      unit: "count",
      location: newItem.location,
      acquired: new Date().toISOString().slice(0, 10),
      notes: "",
    });
  };

  const onDeleteLibraryItem = async (id) => {
    if (!uid || !id) return;
    await deleteDoc(doc(db, "users", uid, "library", id));
  };

  // ------- Prefill helpers for “New Grow” -------
  const startGrowFromStored = (g) => {
    if (typeof setEditingGrow !== "function") return;
    const strain = g.strainName || g.strain || "";
    const abbr = g.abbreviation || g.abbr || g.subName || g.name || g.code || "";
    const nextType = suggestTypeFromStored(g);

    setEditingGrow({
      // New grow draft
      strain,
      strainName: strain,
      type: nextType,
      growType: nextType,
      stage: "Inoculated",
      status: "Active",

      // Link to parent (stored culture)
      parentId: g.id,
      parentType: normalizeType(g.type || g.growType),
      parentLabel: abbr,
      parentSource: "StoredCulture",
    });
  };

  const startGrowFromLibrary = (it) => {
    if (typeof setEditingGrow !== "function") return;
    const kind = it.type || "";
    const strain = it.strainName || "";

    const nextType = suggestTypeFromLibrary(kind);
    setEditingGrow({
      strain,
      strainName: strain,
      type: nextType,
      growType: nextType,
      stage: "Inoculated",
      status: "Active",

      // Link to parent (library item)
      parentId: it.id,
      parentType: kind,
      parentLabel: strain || kind,
      parentSource: "Library",
    });
  };

  // ------- UI bits -------
  const TabChip = ({ id, label }) => {
    const isActive = activeTab === id;
    return (
      <button
        className={`chip ${isActive ? "chip--active" : ""}`}
        onClick={() => setActiveTab(id)}
        role="tab"
        aria-selected={isActive}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow p-4">
        <div className="flex items-center gap-2 mb-3">
          <ArchiveIcon className="h-5 w-5 opacity-80" />
          <h2 className="text-lg font-semibold">Storage &amp; Archive</h2>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <TabChip id="storage" label="Storage" />
          <TabChip id="archived" label="Archived" />
        </div>

        {activeTab === "storage" && (
          <div className="space-y-6">
            {/* Stored cultures */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Boxes className="h-4 w-4 opacity-80" />
                <h3 className="font-medium">Stored Cultures (Agar &amp; LC)</h3>
              </div>
              {storedCultures.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No stored cultures yet. From the Dashboard list, use{" "}
                  <span className="font-medium">Store</span> on an Agar or LC grow to move it here.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {storedCultures.map((g) => {
                    const t = normalizeType(g.type || g.growType);
                    const Icon = TYPE_ICON[t] || Boxes;
                    return (
                      <li
                        key={g.id}
                        className="py-3 px-2 flex items-center gap-3 justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Icon className="h-5 w-5 opacity-80 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {g.name || g.code || g.id}
                            </div>
                            <div className="text-xs text-zinc-500 truncate">
                              {t} — Strain: {g.strainName || g.strain || "Unknown"}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="chip">Stored</span>
                          <button
                            className="btn-accent"
                            onClick={() => startGrowFromStored(g)}
                            title="Start a new grow using this stored culture"
                          >
                            <Rocket className="h-4 w-4" />
                            <span>New Grow</span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Strain Library */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <ScrollText className="h-4 w-4 opacity-80" />
                <h3 className="font-medium">Strain Library</h3>
              </div>

              {/* Add new item */}
              <form
                onSubmit={onAddLibraryItem}
                className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-3"
              >
                <select
                  className="chip w-full"
                  value={newItem.type}
                  onChange={(e) =>
                    setNewItem((s) => ({ ...s, type: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setNewItem((s) => ({ ...s, strainName: e.target.value }))
                  }
                  required
                />

                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="chip w-full"
                    placeholder="Qty"
                    value={newItem.qty}
                    onChange={(e) =>
                      setNewItem((s) => ({ ...s, qty: e.target.value }))
                    }
                    required
                  />
                  <select
                    className="chip"
                    value={newItem.unit}
                    onChange={(e) =>
                      setNewItem((s) => ({ ...s, unit: e.target.value }))
                    }
                    title="Unit"
                  >
                    <option value="count">count</option>
                    <option value="ml">ml</option>
                    <option value="plate">plate</option>
                  </select>
                </div>

                <select
                  className="chip w-full"
                  value={newItem.location}
                  onChange={(e) =>
                    setNewItem((s) => ({ ...s, location: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setNewItem((s) => ({ ...s, acquired: e.target.value }))
                  }
                  title="Acquired"
                />

                <button type="submit" className="btn-accent w-full">
                  <PlusCircle className="h-4 w-4" />
                  <span>Add to Library</span>
                </button>

                <textarea
                  className="chip md:col-span-6 w-full"
                  placeholder="Notes (optional)"
                  value={newItem.notes}
                  onChange={(e) =>
                    setNewItem((s) => ({ ...s, notes: e.target.value }))
                  }
                  rows={2}
                />
              </form>

              {/* Library list */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="bg-zinc-50 dark:bg-zinc-900/60 px-3 py-2 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {loadingLib ? "Loading…" : `${library.length} items`}
                </div>
                {library.length === 0 ? (
                  <div className="p-4 text-sm text-zinc-500">
                    Nothing in your library yet. Add Spore Syringes, Swabs, Prints,
                    LCs, or Agar to track long-term storage.
                  </div>
                ) : (
                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {library.map((it) => {
                      const kind = it.type || "";
                      let KindIcon = Boxes;
                      if (kind === "Spore Syringe") KindIcon = Syringe;
                      else if (kind === "Spore Swab") KindIcon = Wand2;
                      else if (kind === "Spore Print") KindIcon = ScrollText;
                      else if (kind.includes("Agar")) KindIcon = FlaskConical;
                      else if (kind === "LC") KindIcon = TestTube;

                      return (
                        <li key={it.id} className="p-3 flex items-center gap-3">
                          <KindIcon className="h-5 w-5 opacity-80 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">
                              {kind} — {it.strainName || "Unknown strain"}
                            </div>
                            <div className="text-xs text-zinc-500 truncate">
                              Qty: {it.qty ?? 0} {it.unit || "count"} ·{" "}
                              {it.location || "Unknown"} · Acquired:{" "}
                              {it.acquired || "—"}
                            </div>
                            {it.notes ? (
                              <div className="text-xs text-zinc-500 mt-1 line-clamp-2">
                                {it.notes}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="btn-accent"
                              title="Start a new grow using this library item"
                              onClick={() => startGrowFromLibrary(it)}
                            >
                              <Rocket className="h-4 w-4" />
                              <span>New Grow</span>
                            </button>
                            <button
                              className="chip"
                              title="Delete"
                              onClick={() => onDeleteLibraryItem(it.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              <span>Delete</span>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </div>
        )}

        {activeTab === "archived" && (
          <div className="space-y-3">
            <div className="text-sm text-zinc-500">
              {archivedGrows.length} archived grows
            </div>
            <div className="rounded-2xl overflow-hidden">
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {archivedGrows.map((g) => {
                  const t = normalizeType(g.type || g.growType);
                  const Icon = TYPE_ICON[t] || Boxes;
                  const remaining =
                    Number.isFinite(Number(g?.amountAvailable))
                      ? Number(g.amountAvailable)
                      : Number(g?.remaining ?? NaN);
                  return (
                    <li key={g.id} className="p-4 bg-zinc-50/50 dark:bg-zinc-900">
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5 opacity-80" />
                        <div className="font-medium">
                          {g.name || g.code || g.id}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {t} — {g.strainName || g.strain || "Unknown"} —{" "}
                        {String(g.status || "Archived")}
                        {Number.isFinite(remaining) ? (
                          <> — Remaining: {remaining}</>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
