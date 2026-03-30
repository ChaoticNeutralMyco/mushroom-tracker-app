// src/components/Grow/GrowDetail.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth, storage } from "../../firebase-config";
import { ref as storageRef, deleteObject } from "firebase/storage";
import { useConfirm } from "../ui/ConfirmDialog";
import { getCoverSrc } from "../../lib/grow-images";
import { enqueueReusablesForGrow } from "../../lib/clean-queue";
import {
  buildDryLotId,
  createDryLotFromGrow,
  formatQty,
  getGrowDryTotal,
  getLotStatus,
  isHarvestComplete,
} from "../../lib/postprocess";

/** ===== Stage flow rules by TYPE =====
 * Bulk:        Inoculated → Colonizing → Colonized → Fruiting → Harvesting → Harvested
 * Non-Bulk:    Inoculated → Colonizing → Colonized
 * Terminal:    Contaminated (manual only)
 * Legacy:      Consumed auto when consumables hit 0.
 */
const STAGES_BULK = ["Inoculated", "Colonizing", "Colonized", "Fruiting", "Harvesting", "Harvested"];
const STAGES_NON_BULK = ["Inoculated", "Colonizing", "Colonized"];
const TERMINAL_STAGES = ["Contaminated"];

function pathFromDownloadURL(url) {
  try {
    const m = String(url).match(/\/o\/([^?]+)/);
    if (m && m[1]) return decodeURIComponent(m[1]);
  } catch {}
  return null;
}

function pickCoverUrl(grow, photos) {
  return getCoverSrc(grow, photos);
}

const normalizeType = (t = "") => {
  const s = String(t || "").toLowerCase();
  if (s.includes("agar")) return "Agar";
  if (s.includes("lc") || s.includes("liquid")) return "LC";
  if (s.includes("grain")) return "Grain Jar";
  if (s.includes("bulk")) return "Bulk";
  return "Other";
};

const allowedStagesForType = (t) =>
  normalizeType(t) === "Bulk" ? STAGES_BULK : STAGES_NON_BULK;

function TypeIcon({ type, size = 22, className = "" }) {
  const t = normalizeType(type);
  const stroke = "currentColor";
  const sw = 2;

  if (t === "Agar") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={`inline-block align-[-3px] ${className}`}
        aria-label="Agar"
      >
        <circle cx="12" cy="12" r="8" fill="none" stroke={stroke} strokeWidth={sw} />
        <path d="M5 12a7 7 0 0 0 14 0" fill="none" stroke={stroke} strokeWidth={sw} />
        <path d="M7.5 9.5l2 2M14.5 8.5l2 2" stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }

  if (t === "LC") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={`inline-block align-[-3px] ${className}`}
        aria-label="Liquid Culture"
      >
        <rect x="7" y="4" width="10" height="4" rx="1.5" fill="none" stroke={stroke} strokeWidth={sw} />
        <rect x="6" y="8" width="12" height="12" rx="2" fill="none" stroke={stroke} strokeWidth={sw} />
        <path d="M7 15c2-2 8-2 10 0" fill="none" stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }

  if (t === "Grain Jar") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={`inline-block align-[-3px] ${className}`}
        aria-label="Grain Jar"
      >
        <rect x="7" y="4" width="10" height="4" rx="1.5" fill="none" stroke={stroke} strokeWidth={sw} />
        <rect x="6" y="8" width="12" height="12" rx="2" fill="none" stroke={stroke} strokeWidth={sw} />
        <g fill="currentColor">
          <circle cx="9" cy="14" r="1" />
          <circle cx="12" cy="16" r="1" />
          <circle cx="15" cy="13" r="1" />
          <circle cx="11" cy="12" r="1" />
          <circle cx="14" cy="17" r="1" />
        </g>
      </svg>
    );
  }

  if (t === "Bulk") {
    return (
      <svg
        width={size + 2}
        height={size}
        viewBox="0 0 26 22"
        className={`inline-block align-[-3px] ${className}`}
        aria-label="Bulk (Monotub)"
      >
        <rect x="3" y="2" width="20" height="3" rx="1" fill="none" stroke={stroke} strokeWidth={sw} />
        <rect x="2" y="6" width="22" height="12" rx="2" fill="none" stroke={stroke} strokeWidth={sw} />
        <circle cx="6" cy="12" r="1.2" fill="currentColor" />
        <circle cx="13" cy="12" r="1.2" fill="currentColor" />
        <circle cx="20" cy="12" r="1.2" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`inline-block align-[-3px] ${className}`}
      aria-label="Other"
    >
      <rect x="5" y="6" width="14" height="12" rx="2" fill="none" stroke={stroke} strokeWidth={sw} />
      <path d="M5 10h14" stroke={stroke} strokeWidth={sw} />
    </svg>
  );
}

function toLocalYYYYMMDD(d) {
  try {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "";
  }
}

function parseAnyDate(raw) {
  if (!raw) return null;

  if (raw && typeof raw.toDate === "function") {
    const d = raw.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }

  if (typeof raw === "number") {
    let ms = raw;
    if (ms < 100000000000) ms *= 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function getLatestFlushLocalDate(flushes = []) {
  let latest = null;

  for (const f of Array.isArray(flushes) ? flushes : []) {
    const raw = (f && (f.createdAt ?? f.date ?? f.when)) ?? null;
    const d = parseAnyDate(raw);
    if (!d) continue;
    if (!latest || d > latest) latest = d;
  }

  return latest ? toLocalYYYYMMDD(latest) : "";
}

export default function GrowDetail({
  grows,
  prefs,
  envLogsByGrow,
  onUpdateGrow,
  onAddNote,
  photosByGrow,
  onUploadPhoto,
  onUploadStagePhoto,
  onAddEnvLog,
  onUpdateEnvLog,
  onDeleteEnvLog,
}) {
  const confirm = useConfirm();

  const { growId } = useParams();
  const navigate = useNavigate();

  const goBack = useCallback(() => {
    if (window.history && window.history.length > 1) navigate(-1);
    else navigate("/");
  }, [navigate]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && goBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);

  const growFromProps = useMemo(() => {
    if (!Array.isArray(grows)) return null;
    return grows.find((g) => g.id === growId) || null;
  }, [grows, growId]);

  const [grow, setGrow] = useState(growFromProps);

  const unit = (prefs?.temperatureUnit || "F").toUpperCase() === "C" ? "C" : "F";
  const [noteText, setNoteText] = useState("");
  const [noteTemp, setNoteTemp] = useState("");
  const [noteRH, setNoteRH] = useState("");

  const [editIdx, setEditIdx] = useState(null);
  const [editText, setEditText] = useState("");

  const logsFromProps =
    envLogsByGrow && (envLogsByGrow instanceof Map ? envLogsByGrow.get(growId) : envLogsByGrow[growId]);
  const [logs, setLogs] = useState(Array.isArray(logsFromProps) ? logsFromProps : []);

  const [envInputs, setEnvInputs] = useState({
    stage: "",
    temperature: "",
    humidity: "",
    notes: "",
  });

  const [editLogId, setEditLogId] = useState(null);
  const [editLog, setEditLog] = useState({ stage: "", temperature: "", humidity: "", notes: "" });

  const photosArrFromProps =
    photosByGrow && (photosByGrow instanceof Map ? photosByGrow.get(growId) : photosByGrow[growId]);
  const [photos, setPhotos] = useState(Array.isArray(photosArrFromProps) ? photosArrFromProps : []);
  const [upload, setUpload] = useState({ stage: "", caption: "", file: null });

  const [useAmt, setUseAmt] = useState("");
  const [dryLot, setDryLot] = useState(null);
  const [dryLotBusy, setDryLotBusy] = useState(false);
  const [dryLotMessage, setDryLotMessage] = useState("");
  const [pageNotice, setPageNotice] = useState(null);

  useEffect(() => {
    if (!growFromProps) return;

    setGrow((prev) => {
      if (!prev || prev.id !== growFromProps.id) return growFromProps;

      const prevFlushes = Array.isArray(prev.flushes) ? prev.flushes : [];
      const nextFlushes = Array.isArray(growFromProps.flushes) ? growFromProps.flushes : [];
      const shouldKeepLocalFlushes = prevFlushes.length > nextFlushes.length;

      return shouldKeepLocalFlushes
        ? { ...growFromProps, flushes: prevFlushes }
        : growFromProps;
    });
  }, [growFromProps]);

  useEffect(() => {
    if (Array.isArray(logsFromProps)) setLogs(logsFromProps);
  }, [logsFromProps]);

  useEffect(() => {
    if (Array.isArray(photosArrFromProps)) setPhotos(photosArrFromProps);
  }, [photosArrFromProps]);

  useEffect(() => {
    if (growFromProps) return;

    (async () => {
      const user = auth.currentUser;
      if (!user || !growId) return;

      const snap = await getDoc(doc(db, "users", user.uid, "grows", growId));
      if (snap.exists()) {
        setGrow({ id: snap.id, ...snap.data() });

        const qEnv = query(
          collection(db, `users/${user.uid}/grows/${growId}/environmentLogs`),
          orderBy("timestamp", "desc")
        );
        const ls = await getDocs(qEnv);
        setLogs(ls.docs.map((d) => ({ id: d.id, ...d.data() })));
      }
    })();
  }, [growId, growFromProps]);

  const callUpdateGrow = async (patch) => {
    if (!growId) return;

    setGrow((prev) => {
      if (!prev) return prev;
      const next = { ...prev };

      Object.entries(patch || {}).forEach(([k, val]) => {
        if (k.startsWith("stageDates.")) {
          const stageKey = k.split(".")[1];
          const v =
            typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)
              ? val
              : toLocalYYYYMMDD(new Date());
          next.stageDates = { ...(prev.stageDates || {}), [stageKey]: v };
        } else if (!k.includes(".")) {
          next[k] = val;
        }
      });

      return next;
    });

    if (typeof onUpdateGrow === "function") {
      await onUpdateGrow(growId, patch);
      return;
    }

    const user = auth.currentUser;
    if (!user) return;
    await updateDoc(doc(db, "users", user.uid, "grows", growId), patch);
  };

  const tNorm = normalizeType(grow?.type || grow?.growType || "");
  const isConsumable = tNorm === "Agar" || tNorm === "LC" || tNorm === "Grain Jar";
  const statusLower = String(grow?.status || "").toLowerCase();
  const isArchived = statusLower === "archived" || grow?.archived === true || !!grow?.archivedAt;

  const ALLOWED = allowedStagesForType(grow?.type || grow?.growType);
  const stageIdx = ALLOWED.indexOf(grow?.stage || "");
  const hasNextStage = !isArchived && stageIdx >= 0 && stageIdx < ALLOWED.length - 1;

  const flushesFromGrow =
    (Array.isArray(grow?.flushes) && grow.flushes) ||
    (Array.isArray(grow?.harvest?.flushes) && grow.harvest.flushes) ||
    [];
  const [flushes, setFlushes] = useState(flushesFromGrow);
  const flushesRef = useRef(Array.isArray(flushesFromGrow) ? flushesFromGrow : []);
  const flushWriteQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    const nextFlushes = Array.isArray(flushesFromGrow) ? flushesFromGrow : [];
    flushesRef.current = nextFlushes;
    setFlushes(nextFlushes);
  }, [flushesFromGrow]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user?.uid || !growId) {
      setDryLot(null);
      return undefined;
    }

    const lotRef = doc(db, "users", user.uid, "materialLots", buildDryLotId(growId));
    const unsub = onSnapshot(
      lotRef,
      (snap) => {
        setDryLot(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      },
      () => {
        setDryLot(null);
      }
    );

    return () => unsub();
  }, [growId]);

  const archiveAndEnqueue = async (nextStage) => {
    const user = auth.currentUser;
    if (!user) return;

    const isHarvested = nextStage === "Harvested";
    const localToday = toLocalYYYYMMDD(new Date());
    let harvestedLocal = "";

    if (isHarvested) {
      harvestedLocal = getLatestFlushLocalDate(flushes) || getLatestFlushLocalDate(grow?.flushes) || localToday;
    }

    await callUpdateGrow({
      stage: nextStage,
      ...(isHarvested
        ? {
            [`stageDates.${nextStage}`]: harvestedLocal,
            harvestedAt: serverTimestamp(),
            status: "Archived",
            archived: true,
            archivedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
        : {
            [`stageDates.${nextStage}`]: serverTimestamp(),
            status: "Archived",
            archived: true,
            archivedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
    });

    try {
      await enqueueReusablesForGrow(user.uid, growId);
    } catch {
      // non-fatal
    }
  };

  const handleAdvanceStage = async () => {
    if (!grow) return;

    const idx = ALLOWED.indexOf(grow.stage || "");
    const next = idx >= 0 && idx < ALLOWED.length - 1 ? ALLOWED[idx + 1] : null;
    if (!next) return;

    if (!(await confirm(`Advance stage to "${next}"?`))) return;

    if (next === "Harvested") {
      await archiveAndEnqueue(next);
    } else {
      await callUpdateGrow({
        stage: next,
        [`stageDates.${next}`]: serverTimestamp(),
      });
    }
  };

  const handleArchiveToggle = async () => {
    if (!grow) return;

    const status = String(grow.status || "").toLowerCase();
    const next = status === "archived" ? "Active" : "Archived";

    if (!(await confirm(`${status === "archived" ? "Unarchive" : "Archive"} this grow?`))) return;
    await callUpdateGrow({
      status: next,
      archivedAt: next === "Archived" ? serverTimestamp() : null,
      archived: next === "Archived",
    });
  };

  const handleStoreToggle = async () => {
    if (!grow || !(tNorm === "Agar" || tNorm === "LC")) return;

    const isStored = String(grow.status || "").toLowerCase() === "stored";
    const next = isStored ? "Active" : "Stored";

    if (!(await confirm(`${isStored ? "Unstore" : "Store"} this grow?`))) return;
    await callUpdateGrow({ status: next });
  };

  const handleDeleteGrow = async () => {
    if (!growId) return;
    if (!(await confirm("Delete this grow? This will archive the grow and mark it as deleted."))) return;

    const user = auth.currentUser;
    if (!user) return;

    try {
      await updateDoc(doc(db, "users", user.uid, "grows", growId), {
        status: "Archived",
        archived: true,
        archivedAt: serverTimestamp(),
        deleted: true,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigate("/");
    } catch (e) {
      setPageNotice({ tone: "error", message: e?.message || String(e) });
    }
  };

  const total = Number(grow?.amountTotal) || 0;
  const used = Number(grow?.amountUsed) || 0;
  const remaining = Math.max(total - used, 0);
  const pctRemaining = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  const amountUnit = grow?.amountUnit || "ml";

  const saveAmountSettings = async (newTotal, newUnit) => {
    const t = Math.max(0, Number(newTotal) || 0);
    await callUpdateGrow({
      amountTotal: t,
      amountUnit: (newUnit || amountUnit || "ml").trim(),
    });
  };

  const logUsage = async () => {
    const amt = Number(useAmt);
    if (!Number.isFinite(amt) || amt <= 0 || total <= 0) return;

    const newUsed = Math.min(total, used + amt);
    const willBeConsumed = total > 0 && newUsed >= total;

    const patch = {
      amountUsed: newUsed,
      lastUsedAt: serverTimestamp(),
    };

    if (willBeConsumed) {
      patch.stage = "Consumed";
      patch["stageDates.Consumed"] = serverTimestamp();
      patch.consumedAt = serverTimestamp();
      patch.status = "Archived";
      patch.archived = true;
      patch.archivedAt = serverTimestamp();
    }

    await callUpdateGrow(patch);
    setUseAmt("");
  };

  useEffect(() => {
    const stage = String(grow?.stage || "");
    if (!stage) return;

    if (
      (stage === "Consumed" || stage === "Contaminated") &&
      String(grow?.status || "").toLowerCase() !== "archived"
    ) {
      callUpdateGrow({ status: "Archived", archived: true, archivedAt: serverTimestamp() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grow?.stage]);

  const totals = useMemo(
    () =>
      (flushes || []).reduce(
        (acc, f) => {
          acc.wet += Number(f?.wet) || 0;
          acc.dry += Number(f?.dry) || 0;
          return acc;
        },
        { wet: 0, dry: 0 }
      ),
    [flushes]
  );

  const dryHarvestTotal = totals.dry > 0 ? totals.dry : getGrowDryTotal(grow || {});
  const harvestComplete = isHarvestComplete(grow || {});
  const showPostProcessSection = !!dryLot || dryHarvestTotal > 0 || harvestComplete;
  const canCreateDryLot = harvestComplete && dryHarvestTotal > 0 && !dryLot;
  const dryLotStatus = getLotStatus(dryLot || {});
  const dryLotRemaining = Number(dryLot?.remainingQuantity) || 0;
  const dryLotInitial = Number(dryLot?.initialQuantity) || 0;
  const dryLotAllocated = Number(dryLot?.allocatedQuantity) || 0;

  const handleCreateDryLot = async () => {
    const user = auth.currentUser;
    if (!user?.uid || !grow?.id) return;

    setDryLotBusy(true);
    setDryLotMessage("");

    try {
      const result = await createDryLotFromGrow({ userId: user.uid, grow: { ...grow, flushes } });
      setDryLotMessage(
        result?.created
          ? `Dry material lot created for ${grow?.abbreviation || grow?.strain || "this grow"}.`
          : "Dry material lot already exists for this grow."
      );
    } catch (error) {
      setDryLotMessage(error?.message || "Failed to create dry material lot.");
    } finally {
      setDryLotBusy(false);
    }
  };

  const persistFlushes = useCallback(
    async (next) => {
      const normalized = Array.isArray(next) ? next : [];
      flushesRef.current = normalized;
      setFlushes(normalized);
      setGrow((prev) => (prev ? { ...prev, flushes: normalized } : prev));

      flushWriteQueueRef.current = flushWriteQueueRef.current
        .catch(() => {})
        .then(async () => {
          await callUpdateGrow({ flushes: flushesRef.current });
        });

      await flushWriteQueueRef.current;
    },
    [callUpdateGrow]
  );

  const addFlush = async () => {
    const next = [
      ...(Array.isArray(flushesRef.current) ? flushesRef.current : []),
      { createdAt: new Date().toISOString(), wet: 0, dry: 0, note: "" },
    ];
    await persistFlushes(next);
  };

  const updateFlushAt = async (idx, patch) => {
    const list = (Array.isArray(flushesRef.current) ? flushesRef.current : []).slice();
    list[idx] = { ...(list[idx] || {}), ...patch };
    await persistFlushes(list);
  };

  const deleteFlushAt = async (idx) => {
    if (!(await confirm("Delete this flush entry?"))) return;
    const next = (Array.isArray(flushesRef.current) ? flushesRef.current : []).filter((_, i) => i !== idx);
    await persistFlushes(next);
  };

  const addNote = async () => {
    const text = noteText.trim();
    if (!text) return;

    const extras = {};
    const t = Number(noteTemp);
    const h = Number(noteRH);
    if (Number.isFinite(h)) extras.humidityPct = h;
    if (Number.isFinite(t)) {
      if (unit === "F") extras.temperatureF = t;
      else extras.temperatureC = t;
    }

    await onAddNote?.(growId, "General", text, extras);

    setGrow((prev) => {
      const list = Array.isArray(prev?.notes) ? prev.notes.slice() : [];
      list.push({ text, date: new Date().toISOString(), ...extras });
      return { ...prev, notes: list };
    });

    setNoteText("");
    setNoteTemp("");
    setNoteRH("");
  };

  const beginEditNote = (idx, currentText) => {
    setEditIdx(idx);
    setEditText(currentText || "");
  };

  const cancelEditNote = () => {
    setEditIdx(null);
    setEditText("");
  };

  const saveEditNote = async () => {
    if (editIdx == null) return;

    const newText = editText.trim();
    const nextList = (Array.isArray(grow?.notes) ? grow.notes : []).map((n, i) =>
      i === editIdx ? { ...n, text: newText || n.text, editedAt: new Date().toISOString() } : n
    );

    setGrow((prev) => ({ ...prev, notes: nextList }));
    await callUpdateGrow({ notes: nextList });
    cancelEditNote();
  };

  const deleteNoteAt = async (idx) => {
    if (!(await confirm("Delete this note?"))) return;
    const next = (Array.isArray(grow?.notes) ? grow.notes : []).filter((_, i) => i !== idx);
    setGrow((prev) => ({ ...prev, notes: next }));
    await callUpdateGrow({ notes: next });
  };

  const fmtWhen = (t) => {
    if (!t) return "";
    try {
      if (typeof t?.toDate === "function") return t.toDate().toLocaleString();
      if (t instanceof Date) return t.toLocaleString();
      return new Date(t).toLocaleString();
    } catch {
      return String(t);
    }
  };

  const toInputDate = (raw) => {
    try {
      if (!raw) return "";
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      if (typeof raw?.toDate === "function") return toLocalYYYYMMDD(raw.toDate());
      if (raw instanceof Date) return toLocalYYYYMMDD(raw);
      if (typeof raw === "number") return toLocalYYYYMMDD(new Date(raw));
      const d = new Date(String(raw));
      return Number.isNaN(d.getTime()) ? "" : toLocalYYYYMMDD(d);
    } catch {
      return "";
    }
  };

  const doUploadPhoto = async () => {
    if (!upload.file) return;
    const stage = upload.stage || grow?.stage || "General";

    try {
      if (typeof onUploadStagePhoto === "function") {
        await onUploadStagePhoto(growId, stage, upload.file, upload.caption || "");
      } else if (typeof onUploadPhoto === "function") {
        await onUploadPhoto(growId, upload.file, upload.caption || "");
      }
      setUpload({ stage: "", caption: "", file: null });
    } catch (e) {
      console.error("Upload failed", e);
      setPageNotice({ tone: "error", message: e?.message || "Upload failed." });
    }
  };

  const handleDeletePhoto = async (p) => {
    if (!p || !p.id) return;
    if (!(await confirm("Delete this photo?"))) return;

    const user = auth.currentUser;
    if (!user) return;

    const prev = Array.isArray(photos) ? photos : [];
    setPhotos((curr) => (Array.isArray(curr) ? curr.filter((x) => x.id !== p.id) : curr));

    try {
      const storagePath = p.storagePath || pathFromDownloadURL(p.url);
      if (storagePath) {
        try {
          await deleteObject(storageRef(storage, storagePath));
        } catch (err) {
          console.warn("Storage delete warning:", err?.message || err);
        }
      }

      await deleteDoc(doc(db, "users", user.uid, "photos", p.id));

      if (grow?.coverPhotoId === p.id) {
        await callUpdateGrow({
          coverPhotoId: null,
          coverUrl: null,
          coverStoragePath: null,
          coverUpdatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      setPhotos(prev);
      setPageNotice({ tone: "error", message: err?.message || String(err) });
    }
  };

  const handleSetCoverPhoto = async (p) => {
    if (!p) return;
    if (!(await confirm("Set this photo as the cover image?"))) return;

    const storagePath = p.storagePath || pathFromDownloadURL(p.url) || null;

    setGrow((prev) => ({
      ...prev,
      coverPhotoId: p.id || null,
      coverUrl: p.url || null,
      coverStoragePath: storagePath,
    }));

    await callUpdateGrow({
      coverPhotoId: p.id || null,
      coverUrl: p.url || null,
      coverStoragePath: storagePath,
      coverUpdatedAt: serverTimestamp(),
    });
  };

  const saveEnvLog = async () => {
    const { stage, temperature, humidity, notes } = envInputs || {};
    if (!stage || temperature === "" || humidity === "") return;

    const newLog = {
      stage,
      temperature: parseFloat(temperature),
      humidity: parseFloat(humidity),
      notes: (notes || "").trim(),
      timestamp: new Date().toISOString(),
    };

    const localId = `local-${Date.now()}`;
    setLogs((prev) => [{ id: localId, ...newLog }, ...(prev || [])]);
    setEnvInputs({ stage: "", temperature: "", humidity: "", notes: "" });

    if (typeof onAddEnvLog === "function") {
      await onAddEnvLog(growId, newLog);
      return;
    }

    const user = auth.currentUser;
    if (!user || !growId) return;
    await addDoc(collection(db, `users/${user.uid}/grows/${growId}/environmentLogs`), newLog);
  };

  const beginEditEnvLog = (log) => {
    setEditLogId(log.id);
    setEditLog({
      stage: log.stage || "",
      temperature: String(log.temperature ?? ""),
      humidity: String(log.humidity ?? ""),
      notes: log.notes || "",
    });
  };

  const cancelEditEnvLog = () => {
    setEditLogId(null);
    setEditLog({ stage: "", temperature: "", humidity: "", notes: "" });
  };

  const saveEditEnvLog = async () => {
    if (!editLogId) return;

    const patch = {
      stage: editLog.stage || "",
      temperature: parseFloat(editLog.temperature),
      humidity: parseFloat(editLog.humidity),
      notes: (editLog.notes || "").trim(),
      editedAt: new Date().toISOString(),
    };

    setLogs((prev) =>
      (prev || []).map((l) => (l.id === editLogId ? { ...l, ...patch } : l))
    );

    const isLocal = String(editLogId).startsWith("local-");
    if (!isLocal) {
      if (typeof onUpdateEnvLog === "function") {
        await onUpdateEnvLog(growId, editLogId, patch);
      } else {
        const user = auth.currentUser;
        if (user && growId) {
          await updateDoc(doc(db, `users/${user.uid}/grows/${growId}/environmentLogs/${editLogId}`), patch);
        }
      }
    }

    cancelEditEnvLog();
  };

  const deleteEnvLog = async (log) => {
    if (!(await confirm("Delete this environment log?"))) return;

    setLogs((prev) => (prev || []).filter((l) => l.id !== log.id));

    const isLocal = String(log.id).startsWith("local-");
    if (!isLocal) {
      if (typeof onDeleteEnvLog === "function") {
        await onDeleteEnvLog(growId, log.id);
      } else {
        const user = auth.currentUser;
        if (user && growId) {
          await deleteDoc(doc(db, `users/${user.uid}/grows/${growId}/environmentLogs/${log.id}`));
        }
      }
    }
  };

  const headerCoverUrl = useMemo(
    () => pickCoverUrl(grow, photos),
    [grow, photos]
  );

  if (!grow) return <div className="p-6">Loading grow…</div>;

  const SELECT_STAGE_OPTIONS = [...ALLOWED, "Consumed", ...TERMINAL_STAGES];
  const isHarvesting = String(grow?.stage) === "Harvesting";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <button onClick={goBack} className="chip" title="Go back (Esc)">
          ← Back
        </button>
        <Link to="/" className="text-sm underline opacity-80 hover:opacity-100">
          Dashboard
        </Link>
      </div>

      {pageNotice ? (
        <div
          className={`rounded-xl px-4 py-2 text-sm ${pageNotice.tone === "error" ? "border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200" : "border border-[rgba(var(--_accent-rgb),0.35)] bg-[rgba(var(--_accent-rgb),0.10)]"}`}
        >
          {pageNotice.message}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        {headerCoverUrl ? (
          <img
            src={headerCoverUrl}
            alt={`${grow.strain || "Grow"} cover`}
            className="w-14 h-14 sm:w-16 sm:h-16 object-cover rounded-md border border-zinc-200 dark:border-zinc-800"
            loading="lazy"
          />
        ) : null}

        <h1 className="text-2xl font-bold flex items-center gap-2">
          <TypeIcon type={grow?.type || grow?.growType} className="opacity-90" />
          <span>
            {grow.strain || "Unnamed"}{" "}
            {grow.subName ? <span className="opacity-75">– {grow.subName}</span> : null}{" "}
            <span className="text-sm opacity-70">({grow.stage || "—"})</span>
          </span>
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn btn-accent ${!hasNextStage ? "opacity-50 cursor-not-allowed" : ""}`}
          onClick={() => (hasNextStage ? handleAdvanceStage() : undefined)}
          aria-disabled={!hasNextStage}
          title={hasNextStage ? "Advance to next stage" : "No next stage"}
        >
          Stage +
        </button>

        <button
          type="button"
          className="chip"
          onClick={handleArchiveToggle}
          title={isArchived ? "Unarchive" : "Archive"}
        >
          {isArchived ? "Unarchive" : "Archive"}
        </button>

        {(tNorm === "Agar" || tNorm === "LC") && (
          <button
            type="button"
            className="chip"
            onClick={handleStoreToggle}
            title={String(grow.status || "").toLowerCase() === "stored" ? "Unstore" : "Store"}
          >
            {String(grow.status || "").toLowerCase() === "stored" ? "Unstore" : "Store"}
          </button>
        )}

        <button
          type="button"
          className="rounded-full px-4 py-2 bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
          onClick={handleDeleteGrow}
          title="Delete grow"
        >
          Delete
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {ALLOWED.map((s) => (
          <button
            key={s}
            onClick={async () => {
              if (grow.stage === s || isArchived) return;
              if (!(await confirm(`Set stage to "${s}"?`))) return;

              if (s === "Harvested") {
                await archiveAndEnqueue(s);
              } else {
                await callUpdateGrow({ stage: s, [`stageDates.${s}`]: serverTimestamp() });
              }
            }}
            className={`px-3 py-1 rounded-full ${
              grow.stage === s ? "accent-chip" : "bg-zinc-200 dark:bg-zinc-700"
            }`}
            aria-pressed={grow.stage === s ? "true" : "false"}
          >
            {s}
          </button>
        ))}

        {TERMINAL_STAGES.map((s) => (
          <button
            key={s}
            onClick={async () => {
              if (grow.stage === s || isArchived) return;
              if (!(await confirm(`Set stage to "${s}"?`))) return;
              await callUpdateGrow({ stage: s, [`stageDates.${s}`]: serverTimestamp() });
            }}
            className={`px-3 py-1 rounded-full ${
              grow.stage === s ? "accent-chip" : "bg-zinc-200 dark:bg-zinc-700"
            }`}
            aria-pressed={grow.stage === s ? "true" : "false"}
            title="Terminal stage"
          >
            {s}
          </button>
        ))}
      </div>

      {isConsumable && !isArchived && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">📦 Remaining</h2>

          {total > 0 ? (
            <>
              <div className="text-sm opacity-80">
                {remaining} {amountUnit} left of {total} {amountUnit}
              </div>
              <div className="w-full max-w-md h-3 rounded-full bg-zinc-300/60 dark:bg-zinc-700/60 overflow-hidden">
                <div
                  className="h-full accent-bg"
                  style={{ width: `${pctRemaining}%` }}
                  aria-label={`Remaining ${pctRemaining.toFixed(0)}%`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  placeholder={`Use amount (${amountUnit})`}
                  value={useAmt}
                  onChange={(e) => setUseAmt(e.target.value)}
                  className="p-2 border rounded bg-white dark:bg-zinc-900"
                  aria-label="Amount to use"
                />
                <button
                  className="chip"
                  onClick={logUsage}
                  disabled={!useAmt || Number(useAmt) <= 0 || total <= 0}
                >
                  Log usage
                </button>
                <button
                  className="btn-outline"
                  onClick={async () => {
                    const nextTotal = await confirm.prompt({
                      title: "Edit total amount",
                      message: "Set the total amount available for this grow.",
                      inputLabel: `Total amount (${amountUnit || "ml"})`,
                      inputType: "number",
                      defaultValue: String(total),
                      min: 0,
                      step: 0.1,
                      confirmLabel: "Save",
                      validate: (value) => {
                        if (String(value).trim() === "") return "Enter a total amount.";
                        const parsed = Number(value);
                        if (!Number.isFinite(parsed)) return "Enter a valid number.";
                        if (parsed < 0) return "Total amount cannot be negative.";
                        return true;
                      },
                    });
                    if (nextTotal == null) return;

                    const nextUnit = await confirm.prompt({
                      title: "Edit unit",
                      message: "Set the unit used for this grow volume or amount.",
                      inputLabel: "Unit",
                      defaultValue: amountUnit || "ml",
                      inputPlaceholder: "ml, g, pcs",
                      confirmLabel: "Save",
                      validate: (value) => {
                        if (!String(value).trim()) return "Enter a unit such as ml, g, or pcs.";
                        return true;
                      },
                    });
                    if (nextUnit == null) return;

                    await saveAmountSettings(nextTotal, String(nextUnit || "ml").trim());
                  }}
                >
                  Edit total/unit
                </button>
              </div>

              {remaining === 0 && (
                <div className="text-sm opacity-70">Fully consumed. Archived automatically.</div>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                placeholder="Set total amount"
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    const t = Number(e.currentTarget.value);
                    if (Number.isFinite(t) && t > 0) {
                      await saveAmountSettings(t, amountUnit || "ml");
                    }
                  }
                }}
                className="p-2 border rounded bg-white dark:bg-zinc-900"
              />
              <select
                defaultValue={amountUnit || "ml"}
                onChange={async (e) => await saveAmountSettings(total, e.target.value)}
                className="p-2 border rounded bg-white dark:bg-zinc-900"
              >
                <option value="ml">ml</option>
                <option value="g">g</option>
                <option value="pcs">pcs</option>
              </select>
              <span className="text-sm opacity-70">Set a starting amount to enable the bar.</span>
            </div>
          )}
        </section>
      )}

      {tNorm === "Bulk" && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">📏 Size</h2>
          <div className="text-sm opacity-80">
            {String(grow.containerSize || grow.size || grow.container || grow.volume || "—")}
          </div>
        </section>
      )}

      {tNorm === "Bulk" && (
        <section className="space-y-2" data-testid="grow-harvest-section">
          <h2 className="text-lg font-semibold">🍄 Harvest</h2>

          <div className="text-sm opacity-80">
            Totals: <b>{Math.round(totals.wet * 10) / 10}g</b> wet ·{" "}
            <b>{Math.round(totals.dry * 10) / 10}g</b> dry
          </div>

          {(flushes || []).length === 0 && (
            <div className="text-sm opacity-70">No flushes yet.</div>
          )}

          <div className="space-y-3">
            {(flushes || []).map((f, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end border rounded p-2"
                data-testid="grow-flush-row"
              >
                <label className="block">
                  <div className="text-xs mb-1 opacity-70">Date</div>
                  <input
                    type="date"
                    value={toInputDate(f?.createdAt)}
                    disabled={!isHarvesting || isArchived}
                    onChange={(e) =>
                      updateFlushAt(idx, { createdAt: e.target.value || new Date().toISOString() })
                    }
                    className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <div className="text-xs mb-1 opacity-70">Wet (g)</div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    value={Number(f?.wet) || 0}
                    disabled={!isHarvesting || isArchived}
                    onChange={(e) =>
                      updateFlushAt(idx, {
                        wet: parseFloat(e.target.value || "0") || 0,
                      })
                    }
                    className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <div className="text-xs mb-1 opacity-70">Dry (g)</div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    value={Number(f?.dry) || 0}
                    disabled={!isHarvesting || isArchived}
                    onChange={(e) =>
                      updateFlushAt(idx, {
                        dry: parseFloat(e.target.value || "0") || 0,
                      })
                    }
                    className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-60"
                  />
                </label>
                <label className="block md:col-span-2">
                  <div className="text-xs mb-1 opacity-70">Notes</div>
                  <input
                    type="text"
                    value={f?.note || ""}
                    disabled={!isHarvesting || isArchived}
                    onChange={(e) => updateFlushAt(idx, { note: e.target.value })}
                    className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 disabled:opacity-60"
                    placeholder="Optional"
                  />
                </label>

                <div className="flex gap-2 justify-end">
                  <button
                    className="btn-outline"
                    disabled={!isHarvesting || isArchived}
                    onClick={() => updateFlushAt(idx, { wet: 0, dry: 0 })}
                    title="Reset weights"
                  >
                    Reset
                  </button>
                  <button
                    className="rounded-full px-4 py-2 bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                    disabled={!isHarvesting || isArchived}
                    onClick={() => deleteFlushAt(idx)}
                    title="Delete this flush"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {!isArchived && isHarvesting && (
            <div className="flex items-center gap-2">
              <button
                className="btn text-xs"
                onClick={addFlush}
                data-testid="grow-add-flush"
              >
                + Add flush
              </button>
              <div className="flex-1" />
              <button
                className="btn btn-accent text-xs"
                onClick={() => archiveAndEnqueue("Harvested")}
                title="Finish harvest & archive"
                data-testid="grow-finish-harvest"
              >
                Finish harvest &amp; Archive
              </button>
            </div>
          )}
        </section>
      )}

      {showPostProcessSection && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">🧪 Post Processing</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Harvest totals stay on the grow. Dry-material lots track what remains available for extraction
                and capsule work.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {canCreateDryLot ? (
                <button
                  onClick={handleCreateDryLot}
                  disabled={dryLotBusy}
                  className="btn btn-accent disabled:opacity-60 text-sm"
                >
                  {dryLotBusy ? "Creating..." : "Create Dry Lot"}
                </button>
              ) : null}

              <Link
                to={`/?tab=postprocess&ppgrow=${growId}`}
                className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm"
              >
                Open Post Processing
              </Link>
            </div>
          </div>

          {dryLotMessage ? (
            <div className="rounded-xl px-4 py-3 text-sm border border-[rgba(var(--_accent-rgb),0.35)] bg-[rgba(var(--_accent-rgb),0.10)]">
              {dryLotMessage}
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Dry harvested
              </div>
              <div className="mt-1 text-lg font-semibold">{formatQty(dryHarvestTotal, "g")}</div>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Lot status
              </div>
              <div className="mt-1 text-lg font-semibold capitalize">
                {dryLot ? dryLotStatus : canCreateDryLot ? "ready" : "pending"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Remaining
              </div>
              <div className="mt-1 text-lg font-semibold">
                {dryLot ? formatQty(dryLotRemaining, dryLot?.unit || "g") : "—"}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Allocated
              </div>
              <div className="mt-1 text-lg font-semibold">
                {dryLot ? formatQty(dryLotAllocated, dryLot?.unit || "g") : "—"}
              </div>
            </div>
          </div>

          {dryLot ? (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{dryLot?.name || "Dry Material Lot"}</div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">
                    This lot is the inventory bridge between harvest and future extraction or capsule work.
                  </div>
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  Initial: {formatQty(dryLotInitial, dryLot?.unit || "g")}
                </div>
              </div>

              <div className="mt-3 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full accent-bg"
                  style={{
                    width: `${dryLotInitial > 0 ? Math.max(0, Math.min(100, (dryLotRemaining / dryLotInitial) * 100)) : 0}%`,
                  }}
                />
              </div>

              <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                Remaining {formatQty(dryLotRemaining, dryLot?.unit || "g")} out of{" "}
                {formatQty(dryLotInitial, dryLot?.unit || "g")}.
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-sm text-zinc-600 dark:text-zinc-400">
              {canCreateDryLot
                ? "This harvested grow is ready to be converted into a dry-material lot."
                : "Once this grow is fully harvested and has dry weight recorded, you can intake it into post processing here."}
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold">📝 Notes</h2>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          className="w-full p-2 border rounded dark:bg-zinc-800 dark:text-white"
          placeholder="Add note…"
          aria-label="New note text"
        />

        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="number"
            inputMode="decimal"
            placeholder={`Temp (°${unit}) — optional`}
            value={noteTemp}
            onChange={(e) => setNoteTemp(e.target.value)}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
            aria-label={`Optional temperature in ${unit}`}
          />
          <input
            type="number"
            inputMode="decimal"
            placeholder="Humidity (%) — optional"
            value={noteRH}
            onChange={(e) => setNoteRH(e.target.value)}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
          <div className="flex">
            <button
              onClick={addNote}
              className="w-full accent-bg px-4 py-2 rounded disabled:opacity-60"
              disabled={!noteText.trim()}
            >
              ➕ Add Note
            </button>
          </div>
        </div>

        <ul className="mt-3 space-y-2 text-sm">
          {(grow?.notes || []).map((n, i) => (
            <li key={i} className="border rounded p-2">
              {editIdx === i ? (
                <div className="flex items-start gap-2">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="flex-1 p-2 border rounded dark:bg-zinc-800"
                    rows={2}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEditNote();
                      if (e.key === "Escape") cancelEditNote();
                    }}
                  />
                  <div className="flex gap-2">
                    <button className="chip" onClick={saveEditNote}>
                      Save
                    </button>
                    <button className="btn-outline" onClick={cancelEditNote}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="whitespace-pre-wrap">{n.text}</div>
                    <div className="text-xs text-zinc-500">
                      {fmtWhen(n.date)}
                      {n.editedAt ? ` · edited ${fmtWhen(n.editedAt)}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button className="chip" onClick={() => beginEditNote(i, n.text)}>
                      Edit
                    </button>
                    <button className="rounded-full px-4 py-2 bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400" onClick={() => deleteNoteAt(i)}>
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {(!grow?.notes || grow.notes.length === 0) && (
          <div className="text-sm opacity-70 mt-2">No notes yet.</div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">📸 Photos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
          <select
            value={upload.stage}
            onChange={(e) => setUpload({ ...upload, stage: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          >
            <option value="">Stage (optional)</option>
            {SELECT_STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <input
            type="file"
            accept="image/*"
            onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] || null })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />

          <input
            type="text"
            placeholder="Caption (optional)"
            value={upload.caption}
            onChange={(e) => setUpload({ ...upload, caption: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />

          <button
            className="px-3 py-2 rounded accent-bg disabled:opacity-60"
            onClick={doUploadPhoto}
            disabled={!upload.file}
          >
            Upload Photo
          </button>
        </div>

        {Array.isArray(photos) && photos.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {photos
              .slice()
              .sort((a, b) => String(b.timestamp || 0).localeCompare(String(a.timestamp || 0)))
              .map((p) => {
                const isCover = grow?.coverPhotoId && p.id === grow.coverPhotoId;

                return (
                  <figure
                    key={p.id || p.url}
                    className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800"
                  >
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block focus:outline-none focus:ring-2 focus:ring-[var(--accent-400)]"
                    >
                      <img src={p.url} alt={p.caption || "Grow photo"} className="w-full h-40 object-cover" />
                    </a>

                    <div className="absolute left-2 top-2 z-10 space-y-1">
                      {p.stage ? (
                        <span className="rounded bg-black/60 px-2 py-0.5 text-xs text-white block">
                          {p.stage}
                        </span>
                      ) : null}
                      {isCover ? (
                        <span className="rounded bg-amber-500/90 px-2 py-0.5 text-[11px] text-black font-semibold block">
                          Cover
                        </span>
                      ) : null}
                    </div>

                    <div className="absolute right-2 top-2 z-20 flex gap-2">
                      {!isCover && (
                        <button
                          onClick={() => handleSetCoverPhoto(p)}
                          className="rounded-md accent-bg px-2 py-1 text-xs text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--accent-400)]"
                          title="Set as cover photo"
                        >
                          Set Cover
                        </button>
                      )}
                      <button
                        onClick={() => handleDeletePhoto(p)}
                        className="rounded-md bg-red-600/90 px-2 py-1 text-xs text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400"
                        aria-label="Delete photo"
                        title="Delete photo"
                      >
                        Delete
                      </button>
                    </div>

                    <figcaption className="p-2 text-xs">
                      <div className="font-medium truncate">{p.caption || "—"}</div>
                      <div className="opacity-70">
                        {p.stage || "General"} · {fmtWhen(p.timestamp)}
                      </div>
                    </figcaption>
                  </figure>
                );
              })}
          </div>
        ) : (
          <div className="text-sm opacity-70">No photos yet.</div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">🌡️ Environment Log</h2>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select
            value={envInputs.stage}
            onChange={(e) => setEnvInputs({ ...envInputs, stage: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          >
            <option value="">Stage</option>
            {SELECT_STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder={`Temp (°${unit})`}
            value={envInputs.temperature}
            onChange={(e) => setEnvInputs({ ...envInputs, temperature: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
          <input
            type="number"
            placeholder="Humidity (%)"
            value={envInputs.humidity}
            onChange={(e) => setEnvInputs({ ...envInputs, humidity: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
          <input
            type="text"
            placeholder="Notes"
            value={envInputs.notes}
            onChange={(e) => setEnvInputs({ ...envInputs, notes: e.target.value })}
            className="p-2 border rounded bg-white dark:bg-zinc-900"
          />
        </div>

        <button
          onClick={saveEnvLog}
          className="mt-2 px-4 py-1 rounded accent-bg disabled:opacity-60"
          disabled={!envInputs.stage || envInputs.temperature === "" || envInputs.humidity === ""}
        >
          ➕ Save Log
        </button>

        {Array.isArray(logs) && logs.length > 0 ? (
          <div className="mt-4 space-y-2 text-sm">
            {logs.map((log) => (
              <div key={log.id} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded">
                {editLogId === log.id ? (
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-start">
                    <select
                      value={editLog.stage}
                      onChange={(e) => setEditLog({ ...editLog, stage: e.target.value })}
                      className="p-2 border rounded bg-white dark:bg-zinc-900"
                    >
                      {SELECT_STAGE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={editLog.temperature}
                      onChange={(e) => setEditLog({ ...editLog, temperature: e.target.value })}
                      placeholder={`Temp (°${unit})`}
                      className="p-2 border rounded bg-white dark:bg-zinc-900"
                    />
                    <input
                      type="number"
                      value={editLog.humidity}
                      onChange={(e) => setEditLog({ ...editLog, humidity: e.target.value })}
                      placeholder="Humidity (%)"
                      className="p-2 border rounded bg-white dark:bg-zinc-900"
                    />
                    <input
                      type="text"
                      value={editLog.notes}
                      onChange={(e) => setEditLog({ ...editLog, notes: e.target.value })}
                      placeholder="Notes"
                      className="p-2 border rounded bg-white dark:bg-zinc-900"
                    />
                    <div className="flex gap-2 justify-end">
                      <button className="chip" onClick={saveEditEnvLog}>
                        Save
                      </button>
                      <button className="btn-outline" onClick={cancelEditEnvLog}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <div className="font-semibold">
                        {log.stage} • {fmtWhen(log.timestamp)}
                      </div>
                      <div>
                        Temp: {log.temperature}°{unit} | RH: {log.humidity}%
                      </div>
                      {log.notes && <div className="italic text-xs">{log.notes}</div>}
                    </div>
                    <div className="flex gap-2 self-end md:self-auto">
                      <button className="chip" onClick={() => beginEditEnvLog(log)}>
                        Edit
                      </button>
                      <button className="rounded-full px-4 py-2 bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400" onClick={() => deleteEnvLog(log)}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm opacity-70 mt-3">No environment logs yet.</div>
        )}
      </section>
    </div>
  );
}