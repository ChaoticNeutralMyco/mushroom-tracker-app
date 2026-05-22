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
  compareToRange,
  formatTargetRange,
  getStageEnvironmentTarget,
  targetStatusClass,
} from "../../lib/environmentTargets";
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

const LAB_NOTE_CATEGORY_OPTIONS = [
  "Observation",
  "Clean work",
  "Agar / LC transfer",
  "Grain prep",
  "Spawn-to-bulk",
  "Environment",
  "Contamination watch",
  "Recipe deviation",
  "Harvest / post-process",
  "Task / follow-up",
  "Other",
];

const LAB_NOTE_WORKFLOW_OPTIONS = [
  "",
  "Agar plate",
  "Liquid culture",
  "Grain jar / bag",
  "Bulk tub / bag",
  "Fruiting chamber",
  "Harvest / drying",
  "Post-processing",
  "Cleaning / reset",
  "Other",
];

const LAB_NOTE_CLEAN_WORK_OPTIONS = [
  "",
  "Bella Bora SAB",
  "FFU / flow hood",
  "Pressure cooker cycle",
  "Still-air cleanup",
  "Open-air risk noted",
  "Other",
];

const CONTAMINATION_SEVERITY_OPTIONS = [
  "Suspected",
  "Confirmed - mild",
  "Confirmed - moderate",
  "Confirmed - severe",
];

const CONTAMINATION_CAUSE_OPTIONS = [
  "",
  "Unknown / investigating",
  "Agar culture issue",
  "LC culture issue",
  "Grain hydration issue",
  "Incomplete sterilization",
  "Bag / jar seal issue",
  "SAB technique issue",
  "Transfer exposure",
  "Spawn-to-bulk exposure",
  "Environmental issue",
  "Pest issue",
  "Other",
];

const CONTAMINATION_ACTION_OPTIONS = [
  "",
  "Monitoring",
  "Quarantined / isolated",
  "Removed from grow area",
  "Disposed",
  "Cleaned area and tools",
  "Retested culture",
  "Transferred clean section",
  "Other",
];

const CONTAMINATION_OUTCOME_OPTIONS = [
  "",
  "Monitoring",
  "Recovered",
  "Disposed",
  "Archived",
  "Needs follow-up",
];

const CONTAMINATION_CLEANUP_CHECKLIST = [
  { id: "isolated-grow", label: "Isolated affected grow away from clean work and active cultures." },
  { id: "documented-photos", label: "Documented visual evidence before disposal or cleanup." },
  { id: "bagged-disposed", label: "Bagged or contained contaminated material before moving it." },
  { id: "removed-consumables", label: "Removed exposed consumables, liners, gloves, wipes, or single-use tools." },
  { id: "sanitized-tools", label: "Sanitized reusable tools, racks, tubs, lids, or work surfaces." },
  { id: "reset-workspace", label: "Reset SAB/FFU/workspace before the next clean-work session." },
  { id: "reviewed-source", label: "Reviewed parent culture, grain batch, recipe, and handling notes for likely source." },
  { id: "updated-prevention", label: "Added a prevention note or SOP change for next time." },
];

const CONTAMINATION_DISPOSAL_OPTIONS = [
  "",
  "Not disposed / monitoring",
  "Sealed and discarded",
  "Quarantined for observation",
  "Transferred clean section only",
  "Composted outside grow area",
  "Other",
];

const CONTAMINATION_SANITATION_OPTIONS = [
  "",
  "Wiped with alcohol",
  "Bleach solution reset",
  "Soap/water then sanitizer",
  "PC/heat cycle for reusable item",
  "SAB full reset",
  "FFU/workbench reset",
  "Other",
];

const makeDefaultContaminationForm = (stage = "") => ({
  stage: stage || "General",
  observedAt: toLocalYYYYMMDD(new Date()),
  severity: "Suspected",
  suspectedCause: "Unknown / investigating",
  visualSigns: "",
  actionTaken: "Quarantined / isolated",
  outcome: "Monitoring",
  notes: "",
  cleanupChecklist: [],
  quarantineLocation: "",
  disposalMethod: "",
  sanitationMethod: "",
  cleanupNotes: "",
  clearedForReuse: false,
  clearedForReuseDate: "",
  followUpRequired: false,
  followUpDate: "",
  evidencePhotoIds: [],
  markGrowContaminated: false,
});

function contaminationSortTime(log = {}) {
  const raw = log.observedAt || log.timestamp || log.createdAt || log.updatedAt;
  const d = parseAnyDate(raw);
  return d ? d.getTime() : 0;
}

function sortContaminationLogs(list = []) {
  return [...(Array.isArray(list) ? list : [])].sort(
    (a, b) => contaminationSortTime(b) - contaminationSortTime(a)
  );
}

function buildContaminationSummary(list = []) {
  const sorted = sortContaminationLogs(list);
  const last = sorted[0] || null;

  return {
    contaminationLogCount: sorted.length,
    contaminationLastAt: last?.observedAt || last?.timestamp || null,
    contaminationLastStage: last?.stage || null,
    contaminationLastSeverity: last?.severity || null,
    contaminationLastCause: last?.suspectedCause || null,
    contaminationStatus: sorted.length > 0 ? "Logged" : "Clear",
    contaminationOpenCleanupCount: sorted.filter((log) => (log?.followUpRequired || normalizeIdArray(log?.cleanupChecklist).length > 0) && !log?.clearedForReuse).length,
    contaminationEvidencePhotoCount: sorted.reduce((sum, log) => sum + normalizeIdArray(log?.evidencePhotoIds).length, 0),
    contaminationUpdatedAt: serverTimestamp(),
  };
}

function normalizeIdArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, checked]) => !!checked)
      .map(([key]) => String(key || "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function toggleId(list, id, checked) {
  const cleanId = String(id || "").trim();
  if (!cleanId) return normalizeIdArray(list);
  const current = new Set(normalizeIdArray(list));
  if (checked) current.add(cleanId);
  else current.delete(cleanId);
  return Array.from(current);
}

function getCleanupLabel(id) {
  return CONTAMINATION_CLEANUP_CHECKLIST.find((item) => item.id === id)?.label || id;
}

function buildEvidencePhotoSnapshots(photoIds = [], photos = []) {
  const selected = new Set(normalizeIdArray(photoIds));
  return (Array.isArray(photos) ? photos : [])
    .filter((photo) => selected.has(String(photo?.id || "")))
    .map((photo) => ({
      id: photo.id || "",
      url: photo.url || "",
      caption: photo.caption || "",
      stage: photo.stage || "",
      timestamp: photo.timestamp || photo.createdAt || "",
    }));
}

function getEvidencePhotos(log = {}, photos = []) {
  const selectedIds = new Set(normalizeIdArray(log.evidencePhotoIds));
  const livePhotos = (Array.isArray(photos) ? photos : []).filter((photo) => selectedIds.has(String(photo?.id || "")));
  const liveIds = new Set(livePhotos.map((photo) => String(photo?.id || "")));
  const snapshots = Array.isArray(log.evidencePhotos)
    ? log.evidencePhotos.filter((photo) => photo?.id && !liveIds.has(String(photo.id)))
    : [];
  return [...livePhotos, ...snapshots];
}

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

function normalizeLookup(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fahrenheitToC(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return ((n - 32) * 5 / 9).toFixed(1).replace(/\.0$/, "");
}

function convertTargetTempForUnit(value, unit = "F") {
  if (value === null || value === undefined || value === "") return "";
  return String(unit).toUpperCase() === "C" ? fahrenheitToC(value) : String(value);
}

function makeDefaultLabNoteForm(stage = "") {
  return {
    text: "",
    category: "Observation",
    stage: stage || "General",
    workflowStep: "",
    cleanWork: "",
    temperature: "",
    humidity: "",
    needsFollowUp: false,
    followUpDate: "",
  };
}

function getNoteTemperatureForUnit(note = {}, unit = "F") {
  const useC = String(unit).toUpperCase() === "C";

  if (useC) {
    if (note.temperatureC !== null && note.temperatureC !== undefined && note.temperatureC !== "") {
      return String(note.temperatureC);
    }
    if (note.temperatureF !== null && note.temperatureF !== undefined && note.temperatureF !== "") {
      return fahrenheitToC(note.temperatureF);
    }
    return "";
  }

  if (note.temperatureF !== null && note.temperatureF !== undefined && note.temperatureF !== "") {
    return String(note.temperatureF);
  }
  if (note.temperatureC !== null && note.temperatureC !== undefined && note.temperatureC !== "") {
    const n = Number(note.temperatureC);
    if (Number.isFinite(n)) return ((n * 9) / 5 + 32).toFixed(1).replace(/\.0$/, "");
  }
  return "";
}

function getNoteHumidity(note = {}) {
  if (note.humidityPct !== null && note.humidityPct !== undefined && note.humidityPct !== "") {
    return String(note.humidityPct);
  }
  if (note.humidity !== null && note.humidity !== undefined && note.humidity !== "") {
    return String(note.humidity);
  }
  return "";
}

function buildLabNoteDraft(note = {}, stage = "General", unit = "F") {
  return {
    text: note?.text || "",
    category: note?.category || note?.noteCategory || "Observation",
    stage: note?.stage || stage || "General",
    workflowStep: note?.workflowStep || note?.workflow || "",
    cleanWork: note?.cleanWork || note?.cleanWorkspace || "",
    temperature: getNoteTemperatureForUnit(note, unit),
    humidity: getNoteHumidity(note),
    needsFollowUp: !!note?.needsFollowUp || !!note?.followUpDate,
    followUpDate: typeof note?.followUpDate === "string" ? note.followUpDate.slice(0, 10) : "",
  };
}

function buildLabNotePayload(form = {}, unit = "F") {
  const payload = {
    text: String(form.text || "").trim(),
    category: String(form.category || "Observation").trim() || "Observation",
    stage: String(form.stage || "General").trim() || "General",
    noteKind: "lab",
  };

  const workflowStep = String(form.workflowStep || "").trim();
  if (workflowStep) payload.workflowStep = workflowStep;

  const cleanWork = String(form.cleanWork || "").trim();
  if (cleanWork) payload.cleanWork = cleanWork;

  const temp = Number(form.temperature);
  if (Number.isFinite(temp)) {
    if (String(unit).toUpperCase() === "C") payload.temperatureC = temp;
    else payload.temperatureF = temp;
  }

  const humidity = Number(form.humidity);
  if (Number.isFinite(humidity)) payload.humidityPct = humidity;

  if (form.needsFollowUp || form.followUpDate) payload.needsFollowUp = !!form.needsFollowUp || !!form.followUpDate;
  if (form.followUpDate) payload.followUpDate = String(form.followUpDate).slice(0, 10);

  return payload;
}

function normalizeLabNote(note = {}, index = 0, unit = "F") {
  const safe = note && typeof note === "object" ? note : { text: String(note || "") };
  const category = safe.category || safe.noteCategory || "Observation";
  const stage = safe.stage || "General";
  const workflowStep = safe.workflowStep || safe.workflow || "";
  const cleanWork = safe.cleanWork || safe.cleanWorkspace || "";
  const temperature = getNoteTemperatureForUnit(safe, unit);
  const humidity = getNoteHumidity(safe);
  const when = safe.date || safe.timestamp || safe.createdAt || safe.updatedAt || "";

  return {
    ...safe,
    index,
    text: safe.text || "",
    category,
    stage,
    workflowStep,
    cleanWork,
    temperature,
    humidity,
    when,
    needsFollowUp: !!safe.needsFollowUp || !!safe.followUpDate,
    followUpDate: typeof safe.followUpDate === "string" ? safe.followUpDate.slice(0, 10) : "",
  };
}

function formatLabNoteMeta(note = {}, unit = "F") {
  const parts = [];
  if (note.category) parts.push(note.category);
  if (note.stage) parts.push(note.stage);
  if (note.workflowStep) parts.push(note.workflowStep);
  if (note.cleanWork) parts.push(note.cleanWork);
  if (note.temperature !== "" && note.temperature !== null && note.temperature !== undefined) {
    parts.push(`${note.temperature}°${unit}`);
  }
  if (note.humidity !== "" && note.humidity !== null && note.humidity !== undefined) {
    parts.push(`${note.humidity}% RH`);
  }
  if (note.followUpDate) parts.push(`Follow-up ${note.followUpDate}`);
  else if (note.needsFollowUp) parts.push("Follow-up needed");
  return parts.filter(Boolean).join(" · ");
}

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


function getSopWorkflowMeta(grow = {}) {
  const templateId = String(grow?.workflowTemplateId || grow?.sopTemplateId || "").trim();
  const title = String(
    grow?.workflowTemplateTitle ||
      grow?.sopTemplateTitle ||
      grow?.workflowTitle ||
      ""
  ).trim();
  const category = String(
    grow?.workflowTemplateCategory ||
      grow?.sopTemplateCategory ||
      grow?.workflowCategory ||
      ""
  ).trim();
  const step = String(grow?.workflowStep || category || "").trim();
  const source = String(grow?.workflowSource || grow?.sopSource || "").trim();
  const summary = String(grow?.workflowTemplateSummary || grow?.sopTemplateSummary || "").trim();

  return {
    hasWorkflow: !!(templateId || title || category || step || source),
    templateId,
    title: title || "Workflow SOP",
    category,
    step,
    source: source || (templateId || title ? "sop-template" : ""),
    summary,
  };
}

function formatWorkflowSource(source = "") {
  const clean = String(source || "").trim();
  if (!clean) return "Workflow";
  if (clean === "sop-template") return "SOP template";
  return clean
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeSopChecklistForDisplay(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && String(item.label || item.title || "").trim())
    .map((item, index) => {
      const rawStatus = String(item.status || "").toLowerCase();
      const completed = item.completed === true || rawStatus === "done" || rawStatus === "complete" || rawStatus === "completed";
      const skipped = item.skipped === true || rawStatus === "skipped";
      const status = skipped ? "skipped" : completed ? "done" : "pending";
      return {
        id: String(item.id || `sop-check-${index + 1}`),
        label: String(item.label || item.title || `SOP checkpoint ${index + 1}`).trim(),
        detail: String(item.detail || item.description || item.notes || "").trim(),
        category: String(item.category || "Workflow").trim(),
        stage: String(item.stage || "General").trim(),
        status,
        completed: status === "done",
        skipped: status === "skipped",
        createdAt: item.createdAt || "",
        updatedAt: item.updatedAt || "",
        completedAt: item.completedAt || "",
        skippedAt: item.skippedAt || "",
      };
    });
}

function summarizeSopChecklist(items = []) {
  const total = items.length;
  const done = items.filter((item) => item.status === "done").length;
  const skipped = items.filter((item) => item.status === "skipped").length;
  const pending = Math.max(0, total - done - skipped);
  const actionable = Math.max(0, total - skipped);
  const pct = actionable > 0 ? Math.round((done / actionable) * 100) : total > 0 ? 100 : 0;
  return { total, done, skipped, pending, actionable, pct };
}

function sopChecklistStatusClass(status = "pending") {
  if (status === "done") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200";
  if (status === "skipped") return "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300";
  return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200";
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

  const workflowMeta = useMemo(() => getSopWorkflowMeta(grow || growFromProps || {}), [grow, growFromProps]);
  const sopChecklistItems = useMemo(
    () => normalizeSopChecklistForDisplay((grow || growFromProps || {})?.sopChecklist || []),
    [grow, growFromProps]
  );
  const sopChecklistStats = useMemo(() => summarizeSopChecklist(sopChecklistItems), [sopChecklistItems]);

  const unit = (prefs?.temperatureUnit || "F").toUpperCase() === "C" ? "C" : "F";
  const [noteText, setNoteText] = useState("");
  const [noteCategory, setNoteCategory] = useState("Observation");
  const [noteStage, setNoteStage] = useState(growFromProps?.stage || "General");
  const [noteWorkflowStep, setNoteWorkflowStep] = useState("");
  const [noteCleanWork, setNoteCleanWork] = useState("");
  const [noteTemp, setNoteTemp] = useState("");
  const [noteRH, setNoteRH] = useState("");
  const [noteNeedsFollowUp, setNoteNeedsFollowUp] = useState(false);
  const [noteFollowUpDate, setNoteFollowUpDate] = useState("");
  const [noteFilter, setNoteFilter] = useState("All");

  const [editIdx, setEditIdx] = useState(null);
  const [editNoteDraft, setEditNoteDraft] = useState(() =>
    makeDefaultLabNoteForm(growFromProps?.stage || "General")
  );

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
  const [contaminationLogs, setContaminationLogs] = useState([]);
  const [contaminationForm, setContaminationForm] = useState(() =>
    makeDefaultContaminationForm(growFromProps?.stage || "")
  );
  const [editContaminationLogId, setEditContaminationLogId] = useState(null);
  const [editContaminationForm, setEditContaminationForm] = useState(() =>
    makeDefaultContaminationForm(growFromProps?.stage || "")
  );
  const [contaminationBusy, setContaminationBusy] = useState(false);
  const [strainCultivationProfile, setStrainCultivationProfile] = useState(null);

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
    setNoteStage((prev) => prev || grow?.stage || "General");
  }, [grow?.stage]);
  useEffect(() => {
    let cancelled = false;

    const loadStrainProfile = async () => {
      const user = auth.currentUser;
      const strainId = String(grow?.strainId || "").trim();
      const strainName = String(grow?.strain || grow?.strainName || "").trim();

      if (!user?.uid || (!strainId && !strainName)) {
        setStrainCultivationProfile(null);
        return;
      }

      try {
        let match = null;

        if (strainId) {
          const snap = await getDoc(doc(db, "users", user.uid, "strains", strainId));
          if (snap.exists()) match = { id: snap.id, ...snap.data() };
        }

        if (!match && strainName) {
          const snap = await getDocs(collection(db, "users", user.uid, "strains"));
          const target = normalizeLookup(strainName);
          match = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .find((row) => normalizeLookup(row.name || row.strain || row.strainName) === target);
        }

        if (!cancelled) {
          setStrainCultivationProfile(match?.cultivationProfile || match?.profile || null);
        }
      } catch (error) {
        console.warn("Failed to load strain cultivation profile:", error?.message || error);
        if (!cancelled) setStrainCultivationProfile(null);
      }
    };

    loadStrainProfile();

    return () => {
      cancelled = true;
    };
  }, [grow?.strain, grow?.strainId, grow?.strainName]);


  useEffect(() => {
    if (Array.isArray(photosArrFromProps)) setPhotos(photosArrFromProps);
  }, [photosArrFromProps]);

  useEffect(() => {
    setContaminationForm((prev) => {
      if (!prev || prev.stage) return prev;
      return { ...prev, stage: grow?.stage || "General" };
    });
  }, [grow?.stage]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user?.uid || !growId) {
      setContaminationLogs([]);
      return undefined;
    }

    const qContam = query(
      collection(db, `users/${user.uid}/grows/${growId}/contaminationLogs`),
      orderBy("observedAt", "desc")
    );

    const unsub = onSnapshot(
      qContam,
      (snap) => {
        setContaminationLogs(
          sortContaminationLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        );
      },
      (error) => {
        console.warn("Contamination log subscription failed:", error?.message || error);
        setContaminationLogs([]);
      }
    );

    return () => unsub();
  }, [growId]);

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

  const handleUpdateSopChecklistStatus = async (itemId, nextStatus) => {
    const cleanStatus = nextStatus === "done" || nextStatus === "skipped" ? nextStatus : "pending";
    const now = new Date().toISOString();
    const nextItems = sopChecklistItems.map((item) => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        status: cleanStatus,
        completed: cleanStatus === "done",
        skipped: cleanStatus === "skipped",
        updatedAt: now,
        completedAt: cleanStatus === "done" ? now : "",
        skippedAt: cleanStatus === "skipped" ? now : "",
      };
    });
    const nextStats = summarizeSopChecklist(nextItems);
    await callUpdateGrow({
      sopChecklist: nextItems,
      sopChecklistUpdatedAt: now,
      sopChecklistProgressPct: nextStats.pct,
      sopChecklistStatus: nextStats.total && nextStats.pending === 0 ? "complete" : "active",
    });
  };

  const handleResetSopChecklist = async () => {
    if (!sopChecklistItems.length) return;
    if (!(await confirm("Reset this SOP checklist back to pending?"))) return;
    const now = new Date().toISOString();
    const nextItems = sopChecklistItems.map((item) => ({
      ...item,
      status: "pending",
      completed: false,
      skipped: false,
      updatedAt: now,
      completedAt: "",
      skippedAt: "",
    }));
    await callUpdateGrow({
      sopChecklist: nextItems,
      sopChecklistUpdatedAt: now,
      sopChecklistProgressPct: 0,
      sopChecklistStatus: "active",
    });
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
    const payload = buildLabNotePayload(
      {
        text: noteText,
        category: noteCategory,
        stage: noteStage || grow?.stage || "General",
        workflowStep: noteWorkflowStep,
        cleanWork: noteCleanWork,
        temperature: noteTemp,
        humidity: noteRH,
        needsFollowUp: noteNeedsFollowUp,
        followUpDate: noteFollowUpDate,
      },
      unit
    );

    if (!payload.text) return;

    const note = {
      ...payload,
      date: new Date().toISOString(),
    };

    await onAddNote?.(growId, payload.stage, payload.text, payload);

    const nextList = [...(Array.isArray(grow?.notes) ? grow.notes : []), note];
    setGrow((prev) => ({ ...prev, notes: nextList }));
    await callUpdateGrow({ notes: nextList });

    setNoteText("");
    setNoteCategory("Observation");
    setNoteStage(grow?.stage || "General");
    setNoteWorkflowStep("");
    setNoteCleanWork("");
    setNoteTemp("");
    setNoteRH("");
    setNoteNeedsFollowUp(false);
    setNoteFollowUpDate("");
  };

  const beginEditNote = (idx, currentNote) => {
    setEditIdx(idx);
    setEditNoteDraft(buildLabNoteDraft(currentNote || {}, grow?.stage || "General", unit));
  };

  const cancelEditNote = () => {
    setEditIdx(null);
    setEditNoteDraft(makeDefaultLabNoteForm(grow?.stage || "General"));
  };

  const saveEditNote = async () => {
    if (editIdx == null) return;

    const payload = buildLabNotePayload(editNoteDraft, unit);
    if (!payload.text) return;

    const nextList = (Array.isArray(grow?.notes) ? grow.notes : []).map((n, i) =>
      i === editIdx ? { ...n, ...payload, editedAt: new Date().toISOString() } : n
    );

    setGrow((prev) => ({ ...prev, notes: nextList }));
    await callUpdateGrow({ notes: nextList });
    cancelEditNote();
  };

  const deleteNoteAt = async (idx) => {
    if (!(await confirm("Delete this lab note?"))) return;
    const next = (Array.isArray(grow?.notes) ? grow.notes : []).filter((_, i) => i !== idx);
    setGrow((prev) => ({ ...prev, notes: next }));
    await callUpdateGrow({ notes: next });
  };

  const exportLabNotes = () => {
    const items = (Array.isArray(grow?.notes) ? grow.notes : []).map((note, index) =>
      normalizeLabNote(note, index, unit)
    );

    const title = grow?.subName || grow?.abbreviation || grow?.strain || grow?.strainName || "Grow";
    const lines = [
      `${title} — Lab Notes`,
      `Grow ID: ${grow?.id || growId || ""}`,
      `Stage: ${grow?.stage || ""}`,
      `Exported: ${new Date().toLocaleString()}`,
      "",
    ];

    if (items.length === 0) {
      lines.push("No lab notes saved yet.");
    } else {
      items.forEach((note, idx) => {
        lines.push(`## ${idx + 1}. ${note.category || "Observation"} — ${note.stage || "General"}`);
        if (note.when) lines.push(`When: ${fmtWhen(note.when)}`);
        const meta = formatLabNoteMeta(note, unit);
        if (meta) lines.push(`Meta: ${meta}`);
        lines.push(note.text || "");
        lines.push("");
      });
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = String(title || "grow").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
    a.href = url;
    a.download = `${safeName || "grow"}-lab-notes.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  const normalizeContaminationPayload = (form = {}) => {
    const evidencePhotoIds = normalizeIdArray(form.evidencePhotoIds);

    return {
      stage: form.stage || grow?.stage || "General",
      observedAt: form.observedAt || toLocalYYYYMMDD(new Date()),
      severity: form.severity || "Suspected",
      suspectedCause: (form.suspectedCause || "Unknown / investigating").trim(),
      visualSigns: (form.visualSigns || "").trim(),
      actionTaken: (form.actionTaken || "Monitoring").trim(),
      outcome: (form.outcome || "Monitoring").trim(),
      notes: (form.notes || "").trim(),
      cleanupChecklist: normalizeIdArray(form.cleanupChecklist),
      quarantineLocation: (form.quarantineLocation || "").trim(),
      disposalMethod: (form.disposalMethod || "").trim(),
      sanitationMethod: (form.sanitationMethod || "").trim(),
      cleanupNotes: (form.cleanupNotes || "").trim(),
      clearedForReuse: !!form.clearedForReuse,
      clearedForReuseDate: form.clearedForReuseDate || "",
      followUpRequired: !!form.followUpRequired,
      followUpDate: form.followUpDate || "",
      evidencePhotoIds,
      evidencePhotos: buildEvidencePhotoSnapshots(evidencePhotoIds, photos),
    };
  };

  const saveContaminationSummary = async (nextLogs) => {
    await callUpdateGrow(buildContaminationSummary(nextLogs));
  };

  const saveContaminationLog = async () => {
    const user = auth.currentUser;
    if (!user || !growId || contaminationBusy) return;

    const payload = normalizeContaminationPayload(contaminationForm);
    if (!payload.visualSigns && !payload.notes && !payload.suspectedCause) {
      setPageNotice({
        tone: "error",
        message: "Add at least a sign, suspected cause, or note before saving a contamination log.",
      });
      return;
    }

    setContaminationBusy(true);

    const newLog = {
      ...payload,
      timestamp: new Date().toISOString(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const localLog = { ...newLog, id: `local-contam-${Date.now()}`, createdAt: new Date().toISOString() };
    const nextLogs = sortContaminationLogs([localLog, ...contaminationLogs]);

    try {
      setContaminationLogs(nextLogs);
      setContaminationForm(makeDefaultContaminationForm(grow?.stage || ""));

      await addDoc(collection(db, `users/${user.uid}/grows/${growId}/contaminationLogs`), newLog);

      const growPatch = {
        ...buildContaminationSummary(nextLogs),
      };

      if (contaminationForm.markGrowContaminated) {
        growPatch.stage = "Contaminated";
        growPatch["stageDates.Contaminated"] = payload.observedAt || serverTimestamp();
        growPatch.status = "Archived";
        growPatch.archived = true;
        growPatch.archivedAt = serverTimestamp();
        growPatch.contaminatedAt = serverTimestamp();
      }

      await callUpdateGrow(growPatch);

      setPageNotice({
        tone: "success",
        message: contaminationForm.markGrowContaminated
          ? "Contamination logged and grow marked Contaminated."
          : "Contamination log saved.",
      });
    } catch (error) {
      setPageNotice({ tone: "error", message: error?.message || "Failed to save contamination log." });
    } finally {
      setContaminationBusy(false);
    }
  };

  const beginEditContaminationLog = (log) => {
    setEditContaminationLogId(log.id);
    setEditContaminationForm({
      ...makeDefaultContaminationForm(grow?.stage || ""),
      stage: log.stage || grow?.stage || "General",
      observedAt: log.observedAt || toLocalYYYYMMDD(new Date()),
      severity: log.severity || "Suspected",
      suspectedCause: log.suspectedCause || "Unknown / investigating",
      visualSigns: log.visualSigns || "",
      actionTaken: log.actionTaken || "Monitoring",
      outcome: log.outcome || "Monitoring",
      notes: log.notes || "",
      cleanupChecklist: normalizeIdArray(log.cleanupChecklist),
      quarantineLocation: log.quarantineLocation || "",
      disposalMethod: log.disposalMethod || "",
      sanitationMethod: log.sanitationMethod || "",
      cleanupNotes: log.cleanupNotes || "",
      clearedForReuse: !!log.clearedForReuse,
      clearedForReuseDate: log.clearedForReuseDate || "",
      followUpRequired: !!log.followUpRequired,
      followUpDate: log.followUpDate || "",
      evidencePhotoIds: normalizeIdArray(log.evidencePhotoIds),
      markGrowContaminated: false,
    });
  };

  const cancelEditContaminationLog = () => {
    setEditContaminationLogId(null);
    setEditContaminationForm(makeDefaultContaminationForm(grow?.stage || ""));
  };

  const saveEditContaminationLog = async () => {
    const user = auth.currentUser;
    if (!user || !growId || !editContaminationLogId || contaminationBusy) return;

    const patch = {
      ...normalizeContaminationPayload(editContaminationForm),
      updatedAt: serverTimestamp(),
      editedAt: new Date().toISOString(),
    };

    const nextLogs = sortContaminationLogs(
      contaminationLogs.map((log) =>
        log.id === editContaminationLogId ? { ...log, ...patch } : log
      )
    );

    setContaminationBusy(true);

    try {
      setContaminationLogs(nextLogs);
      await updateDoc(
        doc(db, `users/${user.uid}/grows/${growId}/contaminationLogs/${editContaminationLogId}`),
        patch
      );
      await saveContaminationSummary(nextLogs);
      cancelEditContaminationLog();
      setPageNotice({ tone: "success", message: "Contamination log updated." });
    } catch (error) {
      setPageNotice({ tone: "error", message: error?.message || "Failed to update contamination log." });
    } finally {
      setContaminationBusy(false);
    }
  };

  const deleteContaminationLog = async (log) => {
    if (!log?.id || contaminationBusy) return;
    if (!(await confirm("Delete this contamination log?"))) return;

    const isLocal = String(log.id).startsWith("local-contam-");
    const user = auth.currentUser;
    const nextLogs = contaminationLogs.filter((item) => item.id !== log.id);

    setContaminationBusy(true);

    try {
      setContaminationLogs(nextLogs);
      if (!isLocal && user && growId) {
        await deleteDoc(doc(db, `users/${user.uid}/grows/${growId}/contaminationLogs/${log.id}`));
      }
      await saveContaminationSummary(nextLogs);
      setPageNotice({ tone: "success", message: "Contamination log deleted." });
    } catch (error) {
      setPageNotice({ tone: "error", message: error?.message || "Failed to delete contamination log." });
    } finally {
      setContaminationBusy(false);
    }
  };

  const headerCoverUrl = useMemo(
    () => pickCoverUrl(grow, photos),
    [grow, photos]
  );

  const selectedEnvironmentStage = envInputs.stage || grow?.stage || "General";


  const getDisplayEnvironmentTarget = useCallback(
    (stage = "General") => {
      const info = getStageEnvironmentTarget({ prefs, stage, cultivationProfile: strainCultivationProfile });
      const target = info.target || {};
      const displayTarget = {
        ...target,
        tempMin: convertTargetTempForUnit(target.tempMinF, unit),
        tempMax: convertTargetTempForUnit(target.tempMaxF, unit),
      };
      return { ...info, displayTarget };
    },
    [prefs, strainCultivationProfile, unit]
  );

  const currentDisplayTarget = useMemo(
    () => getDisplayEnvironmentTarget(selectedEnvironmentStage),
    [getDisplayEnvironmentTarget, selectedEnvironmentStage]
  );

  const labNoteItems = useMemo(
    () => (Array.isArray(grow?.notes) ? grow.notes : []).map((note, index) => normalizeLabNote(note, index, unit)),
    [grow?.notes, unit]
  );

  const filteredLabNoteItems = useMemo(() => {
    if (noteFilter === "All") return labNoteItems;
    if (noteFilter === "Follow-up") return labNoteItems.filter((note) => note.needsFollowUp || note.followUpDate);
    return labNoteItems.filter((note) => note.category === noteFilter);
  }, [labNoteItems, noteFilter]);

  const labNoteCounts = useMemo(() => {
    const counts = { All: labNoteItems.length, "Follow-up": 0 };
    labNoteItems.forEach((note) => {
      counts[note.category] = (counts[note.category] || 0) + 1;
      if (note.needsFollowUp || note.followUpDate) counts["Follow-up"] += 1;
    });
    return counts;
  }, [labNoteItems]);

  if (!grow) return <div className="p-6">Loading grow…</div>;

  const SELECT_STAGE_OPTIONS = [...ALLOWED, "Consumed", ...TERMINAL_STAGES];
  const NOTE_STAGE_OPTIONS = Array.from(new Set(["General", ...ALLOWED, "Consumed", ...TERMINAL_STAGES]));
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


      {workflowMeta.hasWorkflow && (
        <section data-testid="grow-sop-origin" className="rounded-2xl border border-indigo-200 bg-indigo-50/80 p-4 text-indigo-950 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20 dark:text-indigo-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                SOP / Workflow Origin
              </div>
              <h2 className="mt-1 text-lg font-semibold">
                {workflowMeta.title}
              </h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-indigo-200 bg-white/70 px-2 py-1 dark:border-indigo-800 dark:bg-indigo-950/40">
                  {formatWorkflowSource(workflowMeta.source)}
                </span>
                {workflowMeta.category ? (
                  <span className="rounded-full border border-indigo-200 bg-white/70 px-2 py-1 dark:border-indigo-800 dark:bg-indigo-950/40">
                    {workflowMeta.category}
                  </span>
                ) : null}
                {workflowMeta.step ? (
                  <span className="rounded-full border border-indigo-200 bg-white/70 px-2 py-1 dark:border-indigo-800 dark:bg-indigo-950/40">
                    {workflowMeta.step}
                  </span>
                ) : null}
                {workflowMeta.templateId ? (
                  <span className="rounded-full border border-indigo-200 bg-white/70 px-2 py-1 font-mono dark:border-indigo-800 dark:bg-indigo-950/40">
                    {workflowMeta.templateId}
                  </span>
                ) : null}
              </div>
            </div>
            <Link
              to="/"
              className="chip"
              title="Open the Recipes tab to review or print the source SOP"
              onClick={() => {
                try {
                  sessionStorage.setItem("cnmPreferredTab", "recipes");
                } catch {}
              }}
            >
              Review SOP
            </Link>
          </div>
          {workflowMeta.summary ? (
            <p className="mt-3 text-sm opacity-85">{workflowMeta.summary}</p>
          ) : (
            <p className="mt-3 text-sm opacity-75">
              This grow was started from a workflow template. Use this section to connect outcomes, lab notes,
              contamination events, and yield data back to the SOP that created it.
            </p>
          )}

          {sopChecklistItems.length > 0 ? (
            <div data-testid="grow-sop-checklist" className="mt-4 rounded-2xl border border-indigo-200 bg-white/75 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">SOP run checklist</h3>
                  <p className="text-xs opacity-75">
                    Track this grow against the SOP checkpoints that created it.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span data-testid="grow-sop-checklist-progress" className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 font-semibold text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-100">
                    {sopChecklistStats.pct}% complete
                  </span>
                  <span className="rounded-full border border-zinc-200 bg-white/80 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900/70">
                    {sopChecklistStats.done}/{sopChecklistStats.actionable || sopChecklistStats.total} done
                  </span>
                  <button type="button" className="btn-outline text-xs" onClick={handleResetSopChecklist}>
                    Reset
                  </button>
                </div>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-indigo-100 dark:bg-indigo-950">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, sopChecklistStats.pct))}%` }}
                />
              </div>

              <div className="mt-3 space-y-2">
                {sopChecklistItems.map((item) => (
                  <div
                    key={item.id}
                    data-testid="grow-sop-checklist-item"
                    className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/80"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{item.label}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${sopChecklistStatusClass(item.status)}`}>
                            {item.status === "done" ? "Done" : item.status === "skipped" ? "Skipped" : "Pending"}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                          {item.stage ? <span>{item.stage}</span> : null}
                          {item.category ? <span>• {item.category}</span> : null}
                        </div>
                        {item.detail ? (
                          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{item.detail}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {[
                          ["pending", "Pending"],
                          ["done", "Done"],
                          ["skipped", "Skip"],
                        ].map(([status, label]) => (
                          <button
                            key={status}
                            type="button"
                            className={item.status === status ? "chip chip--active text-xs" : "chip text-xs"}
                            aria-pressed={item.status === status ? "true" : "false"}
                            onClick={() => handleUpdateSopChecklistStatus(item.id, status)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-indigo-200 bg-white/60 p-3 text-sm opacity-75 dark:border-indigo-900/60 dark:bg-indigo-950/10">
              No SOP run checklist is attached to this grow yet. New SOP-started grows can attach one from GrowForm.
            </div>
          )}
        </section>
      )}

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

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">📝 Lab Notes</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Structured grow notes for clean work, transfers, environment observations, recipe deviations, and follow-up tasks.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1">
              {labNoteCounts.All || 0} total
            </span>
            <span className="rounded-full border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-1 text-amber-800 dark:text-amber-200">
              {labNoteCounts["Follow-up"] || 0} follow-up
            </span>
            <button type="button" className="btn-outline text-xs" onClick={exportLabNotes} disabled={labNoteItems.length === 0}>
              Export notes
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Category</span>
              <select
                value={noteCategory}
                onChange={(e) => setNoteCategory(e.target.value)}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              >
                {LAB_NOTE_CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Stage</span>
              <select
                value={noteStage || "General"}
                onChange={(e) => setNoteStage(e.target.value)}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              >
                {NOTE_STAGE_OPTIONS.map((stage) => (
                  <option key={stage} value={stage}>{stage}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Workflow step</span>
              <select
                value={noteWorkflowStep}
                onChange={(e) => setNoteWorkflowStep(e.target.value)}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              >
                {LAB_NOTE_WORKFLOW_OPTIONS.map((option) => (
                  <option key={option || "blank"} value={option}>{option || "Not specific"}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-1 text-sm block">
            <span className="font-medium">Note</span>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="w-full p-2 border rounded dark:bg-zinc-800 dark:text-white"
              placeholder="Record what happened, what changed, what looked clean or suspicious, and what you want future-you to remember…"
              aria-label="New lab note text"
              rows={3}
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Clean-work setup</span>
              <select
                value={noteCleanWork}
                onChange={(e) => setNoteCleanWork(e.target.value)}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              >
                {LAB_NOTE_CLEAN_WORK_OPTIONS.map((option) => (
                  <option key={option || "blank"} value={option}>{option || "Not logged"}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Temp</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder={`°${unit}`}
                value={noteTemp}
                onChange={(e) => setNoteTemp(e.target.value)}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                aria-label={`Optional temperature in ${unit}`}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Humidity</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="% RH"
                value={noteRH}
                onChange={(e) => setNoteRH(e.target.value)}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Follow-up date</span>
              <input
                type="date"
                value={noteFollowUpDate}
                onChange={(e) => {
                  setNoteFollowUpDate(e.target.value);
                  if (e.target.value) setNoteNeedsFollowUp(true);
                }}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={noteNeedsFollowUp}
                onChange={(e) => setNoteNeedsFollowUp(e.target.checked)}
              />
              Needs follow-up
            </label>
            <button
              type="button"
              onClick={addNote}
              className="accent-bg px-4 py-2 rounded disabled:opacity-60"
              disabled={!noteText.trim()}
            >
              ➕ Add Lab Note
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {["All", ...LAB_NOTE_CATEGORY_OPTIONS, "Follow-up"].map((option) => {
            const count = labNoteCounts[option] || 0;
            if (option !== "All" && option !== "Follow-up" && count === 0) return null;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setNoteFilter(option)}
                className={`${noteFilter === option ? "accent-bg" : "btn-outline"} text-xs`}
              >
                {option} {count ? `(${count})` : ""}
              </button>
            );
          })}
        </div>

        <ul className="space-y-3 text-sm">
          {filteredLabNoteItems.map((n) => (
            <li key={`${n.index}-${n.when || "note"}`} className="border border-zinc-200 dark:border-zinc-800 rounded-2xl p-3 bg-white dark:bg-zinc-950/40">
              {editIdx === n.index ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Category</span>
                      <select
                        value={editNoteDraft.category}
                        onChange={(e) => setEditNoteDraft({ ...editNoteDraft, category: e.target.value })}
                        className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                      >
                        {LAB_NOTE_CATEGORY_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Stage</span>
                      <select
                        value={editNoteDraft.stage || "General"}
                        onChange={(e) => setEditNoteDraft({ ...editNoteDraft, stage: e.target.value })}
                        className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                      >
                        {NOTE_STAGE_OPTIONS.map((stage) => (
                          <option key={stage} value={stage}>{stage}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Workflow step</span>
                      <select
                        value={editNoteDraft.workflowStep}
                        onChange={(e) => setEditNoteDraft({ ...editNoteDraft, workflowStep: e.target.value })}
                        className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                      >
                        {LAB_NOTE_WORKFLOW_OPTIONS.map((option) => (
                          <option key={option || "blank"} value={option}>{option || "Not specific"}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <textarea
                    value={editNoteDraft.text}
                    onChange={(e) => setEditNoteDraft({ ...editNoteDraft, text: e.target.value })}
                    className="w-full p-2 border rounded dark:bg-zinc-800"
                    rows={3}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEditNote();
                      if (e.key === "Escape") cancelEditNote();
                    }}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Clean-work setup</span>
                      <select
                        value={editNoteDraft.cleanWork}
                        onChange={(e) => setEditNoteDraft({ ...editNoteDraft, cleanWork: e.target.value })}
                        className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                      >
                        {LAB_NOTE_CLEAN_WORK_OPTIONS.map((option) => (
                          <option key={option || "blank"} value={option}>{option || "Not logged"}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Temp</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={editNoteDraft.temperature}
                        onChange={(e) => setEditNoteDraft({ ...editNoteDraft, temperature: e.target.value })}
                        className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                        placeholder={`°${unit}`}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Humidity</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={editNoteDraft.humidity}
                        onChange={(e) => setEditNoteDraft({ ...editNoteDraft, humidity: e.target.value })}
                        className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                        placeholder="% RH"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-medium">Follow-up date</span>
                      <input
                        type="date"
                        value={editNoteDraft.followUpDate}
                        onChange={(e) => setEditNoteDraft({ ...editNoteDraft, followUpDate: e.target.value, needsFollowUp: !!e.target.value || editNoteDraft.needsFollowUp })}
                        className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!editNoteDraft.needsFollowUp}
                        onChange={(e) => setEditNoteDraft({ ...editNoteDraft, needsFollowUp: e.target.checked })}
                      />
                      Needs follow-up
                    </label>
                    <div className="flex gap-2">
                      <button type="button" className="chip" onClick={saveEditNote} disabled={!editNoteDraft.text.trim()}>
                        Save
                      </button>
                      <button type="button" className="btn-outline" onClick={cancelEditNote}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-xs font-medium">
                        {n.category || "Observation"}
                      </span>
                      <span className="rounded-full border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-xs">
                        {n.stage || "General"}
                      </span>
                      {n.needsFollowUp || n.followUpDate ? (
                        <span className="rounded-full border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
                          {n.followUpDate ? `Follow-up ${n.followUpDate}` : "Follow-up needed"}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">{n.text}</div>
                    <div className="mt-2 text-xs text-zinc-500 space-y-1">
                      <div>
                        {fmtWhen(n.when)}
                        {n.editedAt ? ` · edited ${fmtWhen(n.editedAt)}` : ""}
                      </div>
                      {formatLabNoteMeta(n, unit) ? <div>{formatLabNoteMeta(n, unit)}</div> : null}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" className="chip" onClick={() => beginEditNote(n.index, n)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded-full px-4 py-2 bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                      onClick={() => deleteNoteAt(n.index)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {labNoteItems.length === 0 ? (
          <div className="text-sm opacity-70">No lab notes yet.</div>
        ) : filteredLabNoteItems.length === 0 ? (
          <div className="text-sm opacity-70">No notes match this filter.</div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">🧫 Contamination Log</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Track suspected or confirmed contamination without changing the grow status unless you choose to mark it contaminated.
            </p>
          </div>
          <div className="rounded-full border border-amber-300 dark:border-amber-800 px-3 py-1 text-xs font-semibold text-amber-900 dark:text-amber-100">
            {contaminationLogs.length} logged
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Stage discovered</span>
            <select
              value={contaminationForm.stage}
              onChange={(e) => setContaminationForm({ ...contaminationForm, stage: e.target.value })}
              className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
            >
              <option value="General">General</option>
              {SELECT_STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Observed date</span>
            <input
              type="date"
              value={(contaminationForm.observedAt || "").toString().slice(0, 10)}
              onChange={(e) => setContaminationForm({ ...contaminationForm, observedAt: e.target.value })}
              className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Severity</span>
            <select
              value={contaminationForm.severity}
              onChange={(e) => setContaminationForm({ ...contaminationForm, severity: e.target.value })}
              className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
            >
              {CONTAMINATION_SEVERITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Suspected cause</span>
            <select
              value={contaminationForm.suspectedCause}
              onChange={(e) => setContaminationForm({ ...contaminationForm, suspectedCause: e.target.value })}
              className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
            >
              {CONTAMINATION_CAUSE_OPTIONS.map((option) => (
                <option key={option || "blank"} value={option}>
                  {option || "Choose cause"}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Action taken</span>
            <select
              value={contaminationForm.actionTaken}
              onChange={(e) => setContaminationForm({ ...contaminationForm, actionTaken: e.target.value })}
              className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
            >
              {CONTAMINATION_ACTION_OPTIONS.map((option) => (
                <option key={option || "blank"} value={option}>
                  {option || "Choose action"}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Outcome</span>
            <select
              value={contaminationForm.outcome}
              onChange={(e) => setContaminationForm({ ...contaminationForm, outcome: e.target.value })}
              className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
            >
              {CONTAMINATION_OUTCOME_OPTIONS.map((option) => (
                <option key={option || "blank"} value={option}>
                  {option || "Choose outcome"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Visual signs</span>
          <input
            type="text"
            value={contaminationForm.visualSigns}
            onChange={(e) => setContaminationForm({ ...contaminationForm, visualSigns: e.target.value })}
            placeholder="Example: green spot near injection port, sour smell, stalled growth"
            className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="font-medium">Prevention / follow-up notes</span>
          <textarea
            value={contaminationForm.notes}
            onChange={(e) => setContaminationForm({ ...contaminationForm, notes: e.target.value })}
            placeholder="What changed, what you suspect, and what to do differently next time."
            rows={3}
            className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
          />
        </label>

        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-white/80 dark:bg-zinc-950/40 p-3 space-y-3">
          <div>
            <h3 className="font-semibold">Cleanup checklist</h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Track isolation, disposal, sanitation, and workspace reset steps for this contamination event.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {CONTAMINATION_CLEANUP_CHECKLIST.map((item) => (
              <label
                key={item.id}
                className="flex items-start gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={normalizeIdArray(contaminationForm.cleanupChecklist).includes(item.id)}
                  onChange={(e) =>
                    setContaminationForm({
                      ...contaminationForm,
                      cleanupChecklist: toggleId(contaminationForm.cleanupChecklist, item.id, e.target.checked),
                    })
                  }
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Quarantine / location</span>
              <input
                type="text"
                value={contaminationForm.quarantineLocation}
                onChange={(e) => setContaminationForm({ ...contaminationForm, quarantineLocation: e.target.value })}
                placeholder="Example: isolated shelf, trash staged outside"
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Disposal / handling</span>
              <select
                value={contaminationForm.disposalMethod}
                onChange={(e) => setContaminationForm({ ...contaminationForm, disposalMethod: e.target.value })}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              >
                {CONTAMINATION_DISPOSAL_OPTIONS.map((option) => (
                  <option key={option || "blank"} value={option}>
                    {option || "Choose disposal"}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Sanitation method</span>
              <select
                value={contaminationForm.sanitationMethod}
                onChange={(e) => setContaminationForm({ ...contaminationForm, sanitationMethod: e.target.value })}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              >
                {CONTAMINATION_SANITATION_OPTIONS.map((option) => (
                  <option key={option || "blank"} value={option}>
                    {option || "Choose sanitation"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Cleanup notes</span>
            <textarea
              value={contaminationForm.cleanupNotes}
              onChange={(e) => setContaminationForm({ ...contaminationForm, cleanupNotes: e.target.value })}
              placeholder="What was cleaned, what was discarded, what should be checked before the next session."
              rows={2}
              className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex items-start gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={!!contaminationForm.clearedForReuse}
                onChange={(e) =>
                  setContaminationForm({
                    ...contaminationForm,
                    clearedForReuse: e.target.checked,
                    clearedForReuseDate: e.target.checked
                      ? contaminationForm.clearedForReuseDate || toLocalYYYYMMDD(new Date())
                      : "",
                  })
                }
              />
              <span>
                <span className="font-semibold">Area/tools cleared for reuse</span>
                <span className="block text-zinc-600 dark:text-zinc-400">Only check this after cleanup and reset are complete.</span>
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Cleared date</span>
              <input
                type="date"
                value={(contaminationForm.clearedForReuseDate || "").toString().slice(0, 10)}
                onChange={(e) => setContaminationForm({ ...contaminationForm, clearedForReuseDate: e.target.value })}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              />
            </label>
            <label className="flex items-start gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={!!contaminationForm.followUpRequired}
                onChange={(e) => setContaminationForm({ ...contaminationForm, followUpRequired: e.target.checked })}
              />
              <span>
                <span className="font-semibold">Needs follow-up</span>
                <span className="block text-zinc-600 dark:text-zinc-400">Use this when a culture, tool, or room reset needs a later check.</span>
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Follow-up date</span>
              <input
                type="date"
                value={(contaminationForm.followUpDate || "").toString().slice(0, 10)}
                onChange={(e) => setContaminationForm({ ...contaminationForm, followUpDate: e.target.value })}
                className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/40 p-3 space-y-3">
          <div>
            <h3 className="font-semibold">Photo evidence</h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Select existing grow photos to attach to this contamination log. Upload photos in the Photos section first if needed.
            </p>
          </div>
          {Array.isArray(photos) && photos.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {photos
                .slice()
                .sort((a, b) => String(b.timestamp || 0).localeCompare(String(a.timestamp || 0)))
                .map((photo) => (
                  <label
                    key={photo.id || photo.url}
                    className="flex gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={normalizeIdArray(contaminationForm.evidencePhotoIds).includes(String(photo.id || ""))}
                      disabled={!photo.id}
                      onChange={(e) =>
                        setContaminationForm({
                          ...contaminationForm,
                          evidencePhotoIds: toggleId(contaminationForm.evidencePhotoIds, photo.id, e.target.checked),
                        })
                      }
                    />
                    <img
                      src={photo.url}
                      alt={photo.caption || "Evidence photo"}
                      className="h-14 w-14 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{photo.caption || "Untitled photo"}</span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {photo.stage || "General"} · {fmtWhen(photo.timestamp)}
                      </span>
                    </span>
                  </label>
                ))}
            </div>
          ) : (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">No grow photos available yet.</div>
          )}
        </div>

        <label className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-white/80 dark:bg-zinc-950/40 p-3 text-sm">
          <input
            type="checkbox"
            checked={!!contaminationForm.markGrowContaminated}
            onChange={(e) =>
              setContaminationForm({ ...contaminationForm, markGrowContaminated: e.target.checked })
            }
            className="mt-1"
          />
          <span>
            <span className="font-semibold">Mark this grow as Contaminated and archive it.</span>
            <span className="block text-zinc-600 dark:text-zinc-400">
              Leave unchecked for a warning/watch log that does not change the grow lifecycle.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveContaminationLog}
            disabled={contaminationBusy}
            className="accent-bg px-4 py-2 rounded disabled:opacity-60"
          >
            ➕ Save Contamination Log
          </button>
          <button
            type="button"
            onClick={() => setContaminationForm(makeDefaultContaminationForm(grow?.stage || ""))}
            className="btn-outline"
            disabled={contaminationBusy}
          >
            Reset
          </button>
        </div>

        {contaminationLogs.length > 0 ? (
          <div className="space-y-3">
            {contaminationLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-white dark:bg-zinc-900 p-3"
              >
                {editContaminationLogId === log.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <select
                        value={editContaminationForm.stage}
                        onChange={(e) =>
                          setEditContaminationForm({ ...editContaminationForm, stage: e.target.value })
                        }
                        className="p-2 border rounded bg-white dark:bg-zinc-900"
                      >
                        <option value="General">General</option>
                        {SELECT_STAGE_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={(editContaminationForm.observedAt || "").toString().slice(0, 10)}
                        onChange={(e) =>
                          setEditContaminationForm({ ...editContaminationForm, observedAt: e.target.value })
                        }
                        className="p-2 border rounded bg-white dark:bg-zinc-900"
                      />
                      <select
                        value={editContaminationForm.severity}
                        onChange={(e) =>
                          setEditContaminationForm({ ...editContaminationForm, severity: e.target.value })
                        }
                        className="p-2 border rounded bg-white dark:bg-zinc-900"
                      >
                        {CONTAMINATION_SEVERITY_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <select
                        value={editContaminationForm.suspectedCause}
                        onChange={(e) =>
                          setEditContaminationForm({ ...editContaminationForm, suspectedCause: e.target.value })
                        }
                        className="p-2 border rounded bg-white dark:bg-zinc-900"
                      >
                        {CONTAMINATION_CAUSE_OPTIONS.map((option) => (
                          <option key={option || "blank"} value={option}>
                            {option || "Choose cause"}
                          </option>
                        ))}
                      </select>
                      <select
                        value={editContaminationForm.actionTaken}
                        onChange={(e) =>
                          setEditContaminationForm({ ...editContaminationForm, actionTaken: e.target.value })
                        }
                        className="p-2 border rounded bg-white dark:bg-zinc-900"
                      >
                        {CONTAMINATION_ACTION_OPTIONS.map((option) => (
                          <option key={option || "blank"} value={option}>
                            {option || "Choose action"}
                          </option>
                        ))}
                      </select>
                      <select
                        value={editContaminationForm.outcome}
                        onChange={(e) =>
                          setEditContaminationForm({ ...editContaminationForm, outcome: e.target.value })
                        }
                        className="p-2 border rounded bg-white dark:bg-zinc-900"
                      >
                        {CONTAMINATION_OUTCOME_OPTIONS.map((option) => (
                          <option key={option || "blank"} value={option}>
                            {option || "Choose outcome"}
                          </option>
                        ))}
                      </select>
                    </div>

                    <input
                      type="text"
                      value={editContaminationForm.visualSigns}
                      onChange={(e) =>
                        setEditContaminationForm({ ...editContaminationForm, visualSigns: e.target.value })
                      }
                      placeholder="Visual signs"
                      className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                    />

                    <textarea
                      value={editContaminationForm.notes}
                      onChange={(e) =>
                        setEditContaminationForm({ ...editContaminationForm, notes: e.target.value })
                      }
                      placeholder="Prevention / follow-up notes"
                      rows={3}
                      className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                    />

                    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-3">
                      <div className="font-semibold">Cleanup checklist</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {CONTAMINATION_CLEANUP_CHECKLIST.map((item) => (
                          <label key={item.id} className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={normalizeIdArray(editContaminationForm.cleanupChecklist).includes(item.id)}
                              onChange={(e) =>
                                setEditContaminationForm({
                                  ...editContaminationForm,
                                  cleanupChecklist: toggleId(editContaminationForm.cleanupChecklist, item.id, e.target.checked),
                                })
                              }
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={editContaminationForm.quarantineLocation}
                          onChange={(e) =>
                            setEditContaminationForm({ ...editContaminationForm, quarantineLocation: e.target.value })
                          }
                          placeholder="Quarantine / location"
                          className="p-2 border rounded bg-white dark:bg-zinc-900"
                        />
                        <select
                          value={editContaminationForm.disposalMethod}
                          onChange={(e) =>
                            setEditContaminationForm({ ...editContaminationForm, disposalMethod: e.target.value })
                          }
                          className="p-2 border rounded bg-white dark:bg-zinc-900"
                        >
                          {CONTAMINATION_DISPOSAL_OPTIONS.map((option) => (
                            <option key={option || "blank"} value={option}>{option || "Choose disposal"}</option>
                          ))}
                        </select>
                        <select
                          value={editContaminationForm.sanitationMethod}
                          onChange={(e) =>
                            setEditContaminationForm({ ...editContaminationForm, sanitationMethod: e.target.value })
                          }
                          className="p-2 border rounded bg-white dark:bg-zinc-900"
                        >
                          {CONTAMINATION_SANITATION_OPTIONS.map((option) => (
                            <option key={option || "blank"} value={option}>{option || "Choose sanitation"}</option>
                          ))}
                        </select>
                      </div>

                      <textarea
                        value={editContaminationForm.cleanupNotes}
                        onChange={(e) =>
                          setEditContaminationForm({ ...editContaminationForm, cleanupNotes: e.target.value })
                        }
                        placeholder="Cleanup notes"
                        rows={2}
                        className="w-full p-2 border rounded bg-white dark:bg-zinc-900"
                      />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={!!editContaminationForm.clearedForReuse}
                            onChange={(e) =>
                              setEditContaminationForm({
                                ...editContaminationForm,
                                clearedForReuse: e.target.checked,
                                clearedForReuseDate: e.target.checked
                                  ? editContaminationForm.clearedForReuseDate || toLocalYYYYMMDD(new Date())
                                  : "",
                              })
                            }
                          />
                          Area/tools cleared for reuse
                        </label>
                        <input
                          type="date"
                          value={(editContaminationForm.clearedForReuseDate || "").toString().slice(0, 10)}
                          onChange={(e) =>
                            setEditContaminationForm({ ...editContaminationForm, clearedForReuseDate: e.target.value })
                          }
                          className="p-2 border rounded bg-white dark:bg-zinc-900"
                        />
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={!!editContaminationForm.followUpRequired}
                            onChange={(e) =>
                              setEditContaminationForm({ ...editContaminationForm, followUpRequired: e.target.checked })
                            }
                          />
                          Needs follow-up
                        </label>
                        <input
                          type="date"
                          value={(editContaminationForm.followUpDate || "").toString().slice(0, 10)}
                          onChange={(e) =>
                            setEditContaminationForm({ ...editContaminationForm, followUpDate: e.target.value })
                          }
                          className="p-2 border rounded bg-white dark:bg-zinc-900"
                        />
                      </div>
                    </div>

                    {Array.isArray(photos) && photos.length > 0 ? (
                      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 p-3 space-y-2">
                        <div className="font-semibold">Photo evidence</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                          {photos
                            .slice()
                            .sort((a, b) => String(b.timestamp || 0).localeCompare(String(a.timestamp || 0)))
                            .map((photo) => (
                              <label key={photo.id || photo.url} className="flex gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 text-sm">
                                <input
                                  type="checkbox"
                                  className="mt-1"
                                  checked={normalizeIdArray(editContaminationForm.evidencePhotoIds).includes(String(photo.id || ""))}
                                  disabled={!photo.id}
                                  onChange={(e) =>
                                    setEditContaminationForm({
                                      ...editContaminationForm,
                                      evidencePhotoIds: toggleId(editContaminationForm.evidencePhotoIds, photo.id, e.target.checked),
                                    })
                                  }
                                />
                                <img src={photo.url} alt={photo.caption || "Evidence photo"} className="h-12 w-12 rounded-lg object-cover" />
                                <span className="min-w-0">
                                  <span className="block truncate font-medium">{photo.caption || "Untitled photo"}</span>
                                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{photo.stage || "General"}</span>
                                </span>
                              </label>
                            ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2 justify-end">
                      <button className="chip" onClick={saveEditContaminationLog} disabled={contaminationBusy}>
                        Save
                      </button>
                      <button className="btn-outline" onClick={cancelEditContaminationLog} disabled={contaminationBusy}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1 text-sm">
                      <div className="font-semibold text-amber-950 dark:text-amber-100">
                        {log.stage || "General"} • {log.severity || "Suspected"} •{" "}
                        {(log.observedAt || "").toString().slice(0, 10) || fmtWhen(log.timestamp)}
                      </div>
                      <div>
                        <span className="font-medium">Cause:</span> {log.suspectedCause || "Unknown / investigating"}
                      </div>
                      {log.visualSigns ? (
                        <div>
                          <span className="font-medium">Signs:</span> {log.visualSigns}
                        </div>
                      ) : null}
                      <div>
                        <span className="font-medium">Action:</span> {log.actionTaken || "Monitoring"}
                        {log.outcome ? <> · <span className="font-medium">Outcome:</span> {log.outcome}</> : null}
                      </div>
                      {log.notes ? <div className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{log.notes}</div> : null}

                      {(normalizeIdArray(log.cleanupChecklist).length > 0 || log.cleanupNotes || log.quarantineLocation || log.disposalMethod || log.sanitationMethod || log.clearedForReuse || log.followUpRequired) ? (
                        <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-2">
                          <div className="font-semibold">Cleanup / reset</div>
                          {normalizeIdArray(log.cleanupChecklist).length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {normalizeIdArray(log.cleanupChecklist).map((itemId) => (
                                <span key={itemId} className="rounded-full border border-amber-300 dark:border-amber-800 px-2 py-1 text-xs">
                                  {getCleanupLabel(itemId)}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                            {log.quarantineLocation ? <div><span className="font-medium">Location:</span> {log.quarantineLocation}</div> : null}
                            {log.disposalMethod ? <div><span className="font-medium">Disposal:</span> {log.disposalMethod}</div> : null}
                            {log.sanitationMethod ? <div><span className="font-medium">Sanitation:</span> {log.sanitationMethod}</div> : null}
                          </div>
                          {log.cleanupNotes ? <div className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{log.cleanupNotes}</div> : null}
                          <div className="flex flex-wrap gap-2 text-xs">
                            {log.clearedForReuse ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                                Cleared for reuse {log.clearedForReuseDate ? `· ${String(log.clearedForReuseDate).slice(0, 10)}` : ""}
                              </span>
                            ) : null}
                            {log.followUpRequired ? (
                              <span className="rounded-full border border-amber-300 dark:border-amber-800 px-2 py-1 text-amber-900 dark:text-amber-100">
                                Follow-up needed {log.followUpDate ? `· ${String(log.followUpDate).slice(0, 10)}` : ""}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {getEvidencePhotos(log, photos).length > 0 ? (
                        <div className="mt-3 space-y-2">
                          <div className="font-semibold">Photo evidence</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {getEvidencePhotos(log, photos).map((photo) => (
                              <a key={photo.id || photo.url} href={photo.url} target="_blank" rel="noreferrer" className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50 dark:bg-zinc-950/40">
                                <img src={photo.url} alt={photo.caption || "Contamination evidence"} className="h-24 w-full object-cover" />
                                <span className="block truncate px-2 py-1 text-xs">{photo.caption || photo.stage || "Evidence photo"}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {log.editedAt ? <div className="text-xs opacity-60">Edited {fmtWhen(log.editedAt)}</div> : null}
                    </div>

                    <div className="flex gap-2 self-end md:self-start">
                      <button className="chip" onClick={() => beginEditContaminationLog(log)} disabled={contaminationBusy}>
                        Edit
                      </button>
                      <button
                        className="rounded-full px-4 py-2 bg-red-600 text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                        onClick={() => deleteContaminationLog(log)}
                        disabled={contaminationBusy}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            No contamination logs yet. Use this section for suspected issues, confirmed contamination, and prevention notes.
          </div>
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

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">🌡️ Environment Log</h2>
            <p className="text-sm opacity-70">
              Compare each environment reading against your global stage targets and strain profile overrides.
            </p>
          </div>
          <span className="inline-flex w-fit rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            Target source: {currentDisplayTarget.source}
          </span>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white/75 p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Active target for {currentDisplayTarget.stage}
              </div>
              <div className="mt-1 text-base font-semibold">
                Temp {formatTargetRange(currentDisplayTarget.displayTarget.tempMin, currentDisplayTarget.displayTarget.tempMax, `°${unit}`)} · RH {formatTargetRange(currentDisplayTarget.target.humidityMin, currentDisplayTarget.target.humidityMax, "%")}
              </div>
              {currentDisplayTarget.target.notes ? (
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{currentDisplayTarget.target.notes}</p>
              ) : (
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">No notes saved for this target yet.</p>
              )}
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <div className="font-semibold">Strain override</div>
              <div>{currentDisplayTarget.hasProfileOverride ? "Using saved strain profile targets." : "Using global Settings defaults."}</div>
            </div>
          </div>
        </div>

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
            {logs.map((log) => {
              const logTarget = getDisplayEnvironmentTarget(log.stage || "General");
              const tempStatus = compareToRange(
                log.temperature,
                logTarget.displayTarget.tempMin,
                logTarget.displayTarget.tempMax
              );
              const humidityStatus = compareToRange(
                log.humidity,
                logTarget.target.humidityMin,
                logTarget.target.humidityMax
              );

              return (
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
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                        <span className={`rounded-full border px-2 py-0.5 ${targetStatusClass(tempStatus.status)}`}>
                          Temp: {tempStatus.label}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 ${targetStatusClass(humidityStatus.status)}`}>
                          RH: {humidityStatus.label}
                        </span>
                        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                          Target: {formatTargetRange(logTarget.displayTarget.tempMin, logTarget.displayTarget.tempMax, `°${unit}`)} · {formatTargetRange(logTarget.target.humidityMin, logTarget.target.humidityMax, "%")}
                        </span>
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
              );
            })}
          </div>
        ) : (
          <div className="text-sm opacity-70 mt-3">No environment logs yet.</div>
        )}
      </section>
    </div>
  );
}