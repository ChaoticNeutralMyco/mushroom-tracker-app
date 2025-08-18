// src/components/Grow/LabelPrintWrapper.jsx
import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebase-config";
import { collection, onSnapshot } from "firebase/firestore";
import LabelPrint from "./LabelPrint";
import { isActiveGrow } from "../../lib/growFilters";

/**
 * Wrapper: subscribes to grows and filters to ACTIVE only.
 * All label UI (start row/col, select all, watermark, printing) lives
 * inside <LabelPrint /> so there’s only one toolbar/source of truth.
 */
export default function LabelPrintWrapper() {
  const [grows, setGrows] = useState([]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const colRef = collection(db, "users", uid, "grows");
    const unsub = onSnapshot(colRef, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setGrows(items);
    });
    return unsub;
  }, []);

  // Only ACTIVE grows
  const activeGrows = useMemo(
    () => (Array.isArray(grows) ? grows.filter(isActiveGrow) : []),
    [grows]
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">Labels — Avery 5160 / 8160</div>
        <div className="text-xs opacity-70">
          Avery 5160 / 8160 — 2.625″ × 1″ · {activeGrows.length} labels
        </div>
      </div>

      {/* Pass the (possibly empty) active list. LabelPrint will NOT refetch. */}
      <LabelPrint grows={activeGrows} />
    </div>
  );
}
