// src/pages/Timeline.jsx
import React, { useEffect, useState } from "react";
import { auth, db } from "../firebase-config";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import GrowTimeline from "../components/Grow/GrowTimeline";

export default function TimelinePage() {
  const [grows, setGrows] = useState([]);

  // Live subscription to user's grows
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const colRef = collection(db, "users", uid, "grows");
    const unsub = onSnapshot(colRef, (snap) => {
      setGrows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  /** Change stage (no implicit date writes). */
  const onUpdateStage = async (growId, stage) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid, "grows", growId), { stage });
  };

  /** Advance stage and keep the user's typed date. */
  const onAdvanceStageWithDate = async (growId, stage, iso) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid, "grows", growId), {
      stage,
      [`stageDates.${stage}`]: iso || null,
    });
  };

  /** Update a single stage date. */
  const onUpdateStageDate = async (growId, stage, iso) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid, "grows", growId), {
      [`stageDates.${stage}`]: iso || null,
    });
  };

  /** Optional: keep abbreviation in sync when inoc date changes. */
  const onUpdateAbbreviation = async (growId, abbreviation) => {
    if (!abbreviation) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid, "grows", growId), { abbreviation });
  };

  /** Add a blank flush (wet now, dry later). */
  const onAddFlush = async (growId) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, "users", uid, "grows", growId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() || {};
      const existing = Array.isArray(data.flushes)
        ? data.flushes.slice()
        : Array.isArray(data?.harvest?.flushes)
        ? data.harvest.flushes.slice()
        : [];
      existing.push({ wet: 0, dry: 0, createdAt: serverTimestamp() });
      tx.update(ref, { flushes: existing });
    });
  };

  /** Update one flush by index (wet or dry). */
  const onUpdateFlush = async (growId, index, patch) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, "users", uid, "grows", growId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() || {};
      const arr = Array.isArray(data.flushes)
        ? data.flushes.slice()
        : Array.isArray(data?.harvest?.flushes)
        ? data.harvest.flushes.slice()
        : [];
      if (!arr[index]) arr[index] = { wet: 0, dry: 0 };
      arr[index] = { ...arr[index], ...patch };
      tx.update(ref, { flushes: arr });
    });
  };

  /** Finish harvest: archive the grow (keeps all flush data). */
  const onFinishHarvest = async (growId) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await updateDoc(doc(db, "users", uid, "grows", growId), {
      archived: true,
      status: "Archived",
    });
  };

  return (
    <div className="p-4 space-y-4">
      <GrowTimeline
        grows={grows}
        onUpdateStage={onUpdateStage}
        onAdvanceStageWithDate={onAdvanceStageWithDate}
        onUpdateStageDate={onUpdateStageDate}
        onUpdateAbbreviation={onUpdateAbbreviation}
        onAddFlush={onAddFlush}
        onUpdateFlush={onUpdateFlush}
        onFinishHarvest={onFinishHarvest}
      />
    </div>
  );
}
