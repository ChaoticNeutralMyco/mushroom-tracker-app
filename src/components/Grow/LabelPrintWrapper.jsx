// src/components/Grow/LabelPrintWrapper.jsx
import React, { useEffect, useMemo, useState } from "react";
import { auth, db } from "../../firebase-config";
import { collection, onSnapshot } from "firebase/firestore";
import LabelPrint from "./LabelPrint";
import { isActiveGrow } from "../../lib/growFilters";

const LOCAL_KEY_TEMPLATE = "labels.template";

const templateMeta = {
  "5160": {
    title: "Avery 5160 / 8160",
    size: '2.625″ × 1″',
    note: "30-up · 3×10",
  },
  "5167": {
    title: "Avery 5167",
    size: '1.75″ × 0.5″',
    note: "80-up · 4×20 (mini)",
  },
};

function readTemplateId() {
  try {
    const val = localStorage.getItem(LOCAL_KEY_TEMPLATE);
    return val === "5167" ? "5167" : "5160";
  } catch {
    return "5160";
  }
}

/**
 * Wrapper: subscribes to grows and filters to ACTIVE only.
 * The toolbar, selection, watermark, template switching, printing, etc.
 * are all owned by <LabelPrint />. We only display a heading that mirrors
 * the current template from localStorage.
 */
export default function LabelPrintWrapper() {
  const [grows, setGrows] = useState([]);
  const [templateId, setTemplateId] = useState(readTemplateId);

  // Live template mirroring:
  // - storage event (cross-tab)
  // - lightweight polling (same-tab updates, since storage doesn't fire)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === LOCAL_KEY_TEMPLATE) setTemplateId(readTemplateId());
    };
    window.addEventListener("storage", onStorage);

    let prev = readTemplateId();
    const iv = window.setInterval(() => {
      const cur = readTemplateId();
      if (cur !== prev) {
        prev = cur;
        setTemplateId(cur);
      }
    }, 400);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(iv);
    };
  }, []);

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

  const activeGrows = useMemo(
    () => (Array.isArray(grows) ? grows.filter(isActiveGrow) : []),
    [grows]
  );

  const meta = templateMeta[templateId] || templateMeta["5160"];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">Labels — {meta.title}</div>
        <div className="text-xs opacity-70">
          {meta.title} — {meta.size} · {meta.note} · {activeGrows.length} labels
        </div>
      </div>

      {/* Pass the active list. LabelPrint owns UI + printing. */}
      <LabelPrint grows={activeGrows} />
    </div>
  );
}
