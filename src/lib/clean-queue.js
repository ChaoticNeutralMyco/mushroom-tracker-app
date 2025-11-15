// src/lib/clean-queue.js
import { db } from "../firebase-config";
import {
  doc,
  setDoc,
  updateDoc,
  increment,
  getDoc,
  getDocs,
  serverTimestamp,
  collection,
  runTransaction,
} from "firebase/firestore";
// Use the same archived predicate as the Archive screen
import { isArchivedish as _isArchivedish } from "./growFilters";

/* ======================= queue doc helpers ======================= */

async function ensureQueueDoc(uid, supplyId, meta = {}) {
  const ref = doc(db, "users", uid, "clean_queue", supplyId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      supplyId,
      pending: 0,
      updatedAt: serverTimestamp(),
      name: meta.name || "",
      unit: meta.unit || "",
      // NOTE: we intentionally do not rely on lastGrowId for gating anymore.
      lastGrowId: meta.growId || "",
    });
    return 0;
  }

  const data = snap.data() || {};
  const numeric = Number(data.pending);
  if (!Number.isFinite(numeric)) {
    await setDoc(
      ref,
      {
        pending: 0,
        updatedAt: serverTimestamp(),
        ...(meta.name ? { name: meta.name } : {}),
        ...(meta.unit ? { unit: meta.unit } : {}),
        ...(meta.growId ? { lastGrowId: meta.growId } : {}),
      },
      { merge: true }
    );
    return 0;
  }

  // Merge any metadata we learned along the way
  if (meta && (meta.name || meta.unit || meta.growId)) {
    await setDoc(
      ref,
      {
        updatedAt: serverTimestamp(),
        ...(meta.name ? { name: meta.name } : {}),
        ...(meta.unit ? { unit: meta.unit } : {}),
        ...(meta.growId ? { lastGrowId: meta.growId } : {}),
      },
      { merge: true }
    );
  }

  return numeric;
}

export async function incrementCleanPending(uid, supplyId, delta, meta = {}) {
  if (!uid || !supplyId || !Number.isFinite(delta) || delta === 0) return;
  const ref = doc(db, "users", uid, "clean_queue", supplyId);

  if (delta > 0) {
    await ensureQueueDoc(uid, supplyId, meta);
    await updateDoc(ref, {
      pending: increment(delta),
      updatedAt: serverTimestamp(),
      ...(meta.name ? { name: meta.name } : {}),
      ...(meta.unit ? { unit: meta.unit } : {}),
      ...(meta.growId ? { lastGrowId: meta.growId } : {}),
    });
    return;
  }

  await decrementCleanPending(uid, supplyId, Math.abs(delta));
}

export async function decrementCleanPending(uid, supplyId, delta) {
  if (!uid || !supplyId || !Number.isFinite(delta) || delta <= 0) return;

  const ref = doc(db, "users", uid, "clean_queue", supplyId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    let current = 0;

    if (snap.exists()) {
      const raw = snap.data()?.pending;
      current = Number(raw);
      if (!Number.isFinite(current)) current = 0;
    } else {
      tx.set(ref, { pending: 0, updatedAt: serverTimestamp() }, { merge: true });
    }

    const next = Math.max(0, current - delta);
    tx.set(ref, { pending: next, updatedAt: serverTimestamp() }, { merge: true });
  });
}

/* ======================= type & unit helpers ======================= */

const norm = (v) => String(v || "").trim().toLowerCase();

function isReusableType(type) {
  const t = norm(type);
  return t === "container" || t === "containers" || t === "tool" || t === "tools";
}
function isCountUnit(unit) {
  const u = norm(unit);
  return [
    "count","pc","pcs","piece","pieces","each","ea","unit","units",
    "item","items","jar","jars","dish","dishes","plate","plates",
    "tray","trays","tub","tubs"
  ].includes(u);
}
// Tolerant name check so slight metadata drift doesn't block enqueues
function looksLikeReusableByName(name) {
  const s = norm(name);
  return /(jar|dish|plate|tray|tub|bottle|flask)/i.test(s);
}

function toInt(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function batchCountOf(g) { return toInt(g?.batchCount ?? g?.batch ?? g?.children ?? 1, 1) || 1; }

// Unified archived predicate: prefer growFilters.isArchivedish, fallback to a strict check
function isArchivedEligible(g) {
  try {
    if (typeof _isArchivedish === "function") return _isArchivedish(g);
  } catch {}
  const status = norm(g?.status);
  return (
    g?.archived === true ||
    g?.isArchived === true ||
    !!g?.archivedAt || !!g?.archived_on || !!g?.archivedOn ||
    status === "archived" ||
    g?.inArchive === true
  );
}

/* ======================= main: enqueue & scan ======================= */

/**
 * Enqueue COUNT-based reusable supplies for a single archived grow.
 * Stamps { cleanQueued: true } ONLY if something was enqueued.
 */
export async function enqueueReusablesForGrow(uid, growOrId) {
  if (!uid || !growOrId) return { enqueued: 0, stamped: false };

  // Resolve grow
  let grow;
  if (typeof growOrId === "object" && growOrId.id) {
    grow = growOrId;
  } else {
    const ref = doc(db, "users", uid, "grows", String(growOrId));
    const snap = await getDoc(ref);
    if (!snap.exists()) return { enqueued: 0, stamped: false };
    grow = { id: snap.id, ...snap.data() };
  }

  // ⛔ Authoritative gate
  if (grow.cleanQueued === true) return { enqueued: 0, stamped: true };

  if (!isArchivedEligible(grow)) return { enqueued: 0, stamped: false };

  const rId = grow.recipeId || grow.recipeRef || "";
  if (!rId) return { enqueued: 0, stamped: false };

  const rSnap = await getDoc(doc(db, "users", uid, "recipes", rId));
  if (!rSnap.exists()) return { enqueued: 0, stamped: false };

  const recipe = rSnap.data();
  const items = Array.isArray(recipe?.items) ? recipe.items : [];

  const batches = Math.max(1, batchCountOf(grow));
  let enqueued = 0;

  for (const it of items) {
    const supplyId = it?.supplyId || it?.supplyRef || it?.supply || it?.id || it?.ref;
    if (!supplyId) continue;

    const sSnap = await getDoc(doc(db, "users", uid, "supplies", supplyId));
    if (!sSnap.exists()) continue;

    const sup = sSnap.data();
    const reusable =
      isReusableType(sup?.type) || looksLikeReusableByName(sup?.name);
    const countish =
      isCountUnit(sup?.unit) || looksLikeReusableByName(sup?.name);

    if (!reusable || !countish) continue;

    const perChild =
      toInt(it?.perChild, NaN) ??
      toInt(it?.per_item, NaN) ??
      toInt(it?.perItem, NaN);

    const qty = Number.isFinite(perChild)
      ? Math.max(0, Math.round(perChild * batches))
      : Math.max(0, Math.round(1 * batches));

    if (qty <= 0) continue;

    await incrementCleanPending(uid, supplyId, qty, {
      name: sup?.name || "",
      unit: sup?.unit || "count",
      growId: grow.id,
    });
    enqueued += qty;
  }

  if (enqueued > 0) {
    await updateDoc(doc(db, "users", uid, "grows", grow.id), { cleanQueued: true, cleanQueuedAt: serverTimestamp() });
    return { enqueued, stamped: true };
  }
  return { enqueued, stamped: false };
}

/**
 * Scan all grows and enqueue returns for archived grows that have not yet been enqueued.
 * - Eligibility uses growFilters.isArchivedish (same as Archive view)
 * - ⛔ Authoritative skip: if g.cleanQueued === true, do not enqueue again
 * - Stamps `cleanQueued: true` only when items were actually enqueued
 * - Writes a concise breakdown to console for debugging
 *
 * @returns {{ scanned:number, enqueuedCount:number, affectedGrows:number }}
 */
export async function scanArchivesForDirty(uid, { limit = 2000 } = {}) {
  if (!uid) return { scanned: 0, enqueuedCount: 0, affectedGrows: 0 };

  const growsCol = collection(db, "users", uid, "grows");
  const snap = await getDocs(growsCol);
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, limit);

  let scanned = 0;
  let enqueuedCount = 0;
  let affectedGrows = 0;

  // diagnostics
  const diag = {
    archivedish: 0, nonArchivedish: 0,
    skippedAlreadyQueued: 0,
    noRecipe: 0, recipeMissing: 0,
    skippedNotReusable: 0, skippedNotCountish: 0, qtyZero: 0,
    enqGrows: [], enqSupplies: 0
  };

  for (const g of all) {
    scanned++;

    if (!isArchivedEligible(g)) { diag.nonArchivedish++; continue; }
    diag.archivedish++;

    // ⛔ Authoritative skip
    if (g?.cleanQueued === true) { diag.skippedAlreadyQueued++; continue; }

    const rId = g.recipeId || g.recipeRef || "";
    if (!rId) { diag.noRecipe++; continue; }

    const rSnap = await getDoc(doc(db, "users", uid, "recipes", rId));
    if (!rSnap.exists()) { diag.recipeMissing++; continue; }

    const recipe = rSnap.data();
    const items = Array.isArray(recipe?.items) ? recipe.items : [];
    const batches = Math.max(1, batchCountOf(g));

    let queuedSomething = false;

    for (const it of items) {
      const supplyId =
        it?.supplyId || it?.supplyRef || it?.supply || it?.id || it?.ref;
      if (!supplyId) continue;

      const sSnap = await getDoc(doc(db, "users", uid, "supplies", supplyId));
      if (!sSnap.exists()) continue;

      const sup = sSnap.data();
      const reusable =
        isReusableType(sup?.type) || looksLikeReusableByName(sup?.name);
      const countish =
        isCountUnit(sup?.unit) || looksLikeReusableByName(sup?.name);

      if (!reusable) { diag.skippedNotReusable++; continue; }
      if (!countish) { diag.skippedNotCountish++; continue; }

      const perChild =
        toInt(it?.perChild, NaN) ??
        toInt(it?.per_item, NaN) ??
        toInt(it?.perItem, NaN);

      const qty = Number.isFinite(perChild)
        ? Math.max(0, Math.round(perChild * batches))
        : Math.max(0, Math.round(1 * batches));

      if (qty <= 0) { diag.qtyZero++; continue; }

      await incrementCleanPending(uid, supplyId, qty, {
        name: sup?.name || "",
        unit: sup?.unit || "count",
        growId: g.id,
      });
      queuedSomething = true;
      enqueuedCount += qty;
      diag.enqSupplies += qty;
    }

    if (queuedSomething) {
      await updateDoc(doc(db, "users", uid, "grows", g.id), { cleanQueued: true, cleanQueuedAt: serverTimestamp() });
      affectedGrows++;
      diag.enqGrows.push(g.id);
    }
  }

  try { console.info("[clean-queue] scan breakdown:", diag); } catch {}

  return { scanned, enqueuedCount, affectedGrows };
}

// Back-compat alias
export async function scanBackfillForCleaning(uid, opts) {
  return scanArchivesForDirty(uid, opts);
}

/**
 * Optional utility: clear the cleanQueued flag for a specific grow so it can be re-queued.
 * Use sparingly and only when you know you need to re-enqueue.
 */
export async function resetCleanQueued(uid, growId) {
  if (!uid || !growId) return;
  await updateDoc(doc(db, "users", uid, "grows", String(growId)), {
    cleanQueued: false,
  });
}
