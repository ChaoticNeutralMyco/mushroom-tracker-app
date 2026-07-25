// src/components/recipes/SopWorkflowToolkit.jsx
// sop-v52-reconnect-workflow-toolkit
import React, { useMemo, useState } from "react";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileText,
  PlayCircle,
  PlusCircle,
  Printer,
  ShieldCheck,
  Sprout,
} from "lucide-react";
import {
  calculateCvgBatch,
  calculateGrainBatch,
  calculateLiquidCulture,
  calculatePopcornPcHydration,
  calculateSpawnRatio,
} from "../../lib/cultivationCalculators";
import { CLEAN_WORK_CHECKLISTS, WORKFLOW_TEMPLATES } from "../../lib/sopTemplates";
import { formatAmount } from "../../lib/units";
import { printElementBySelector } from "../../lib/sopPrint";

const CALCULATOR_OPTIONS = [
  {
    id: "grainBatch",
    label: "Grain batch",
    description: "Plan consistent finished jars or bags by target hydrated weight.",
  },
  {
    id: "popcorn",
    label: "Popcorn PC hydration",
    description: "Estimate hydrated yield from dry popcorn and target bag weight.",
  },
  {
    id: "lc",
    label: "LC recipe",
    description: "Scale broth volume, sugar percentage, and jar fill targets.",
  },
  {
    id: "cvg",
    label: "CVG substrate",
    description: "Scale dry substrate components and hydration target by final batch weight.",
  },
  {
    id: "spawnRatio",
    label: "Spawn ratio",
    description: "Compare spawn and substrate weight as a 1:x ratio.",
  },
];

const RUN_LOG_ROWS = [
  "Batch / session ID",
  "Culture source / parent grow",
  "Operator",
  "Start date / time",
  "Actual materials used",
  "Deviations from SOP",
  "QC observations",
  "Follow-up / quarantine notes",
];

function recipeScopeLabel(value = "") {
  return String(value || "").toLowerCase() === "post-production"
    ? "Post Production"
    : "Production";
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function cleanFileName(value = "sop") {
  return String(value || "sop")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "sop";
}

function downloadTextFile(filename, content) {
  if (typeof document === "undefined") return;

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 250);
}

function CalculatorResultCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/40 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>
      ) : null}
    </div>
  );
}

function getCalculatorRows(activeCalculator, result = {}) {
  if (activeCalculator === "lc") {
    return [
      ["Water / final volume", `${formatAmount(result.waterMl)} ml`, "Use as your target batch volume"],
      ["Sugar", `${formatAmount(result.sugarG)} g`, `${formatAmount(result.sugarPercent)}% of batch volume`],
      ["Optional nutrient", `${formatAmount(result.nutrientG)} g`, "Set to 0 when not used"],
      [
        "Per jar fill",
        `${formatAmount(result.perJarMl)} ml`,
        `Approx. ${formatAmount(result.estimatedJarCapacityMl)} ml jar at ${formatAmount(result.fillPercent)}% fill`,
      ],
    ];
  }

  if (activeCalculator === "popcorn") {
    return [
      ["Estimated hydrated weight", `${formatAmount(result.hydratedWeightG)} g`, "Dry grain plus expected absorbed water"],
      ["Water gain estimate", `${formatAmount(result.absorbedWaterEstimateG)} g`, "Planning estimate only"],
      ["Full target bags", `${formatAmount(result.estimatedFullBags)} bags`, `${formatAmount(result.targetBagWeightG)} g target weight`],
      [
        "Dry grain per target bag",
        `${formatAmount(result.dryGrainPerTargetBagG)} g`,
        `Approx. ${formatAmount(result.waterPerTargetBagG)} g water gain per bag`,
      ],
    ];
  }

  if (activeCalculator === "cvg") {
    return [
      ["Dry total", `${formatAmount(result.dryTotalG)} g`, "Total dry ingredients"],
      ["Water", `${formatAmount(result.waterMl)} ml`, `${formatAmount(result.dryHydrationMultiplier)}× dry weight`],
      ["Coir", `${formatAmount(result.coirG)} g`, `${formatAmount(result.coirPercent)}% of dry mix`],
      ["Vermiculite", `${formatAmount(result.vermiculiteG)} g`, `${formatAmount(result.vermiculitePercent)}% of dry mix`],
      ["Gypsum", `${formatAmount(result.gypsumG)} g`, `${formatAmount(result.gypsumPercent)}% of dry mix`],
    ];
  }

  if (activeCalculator === "spawnRatio") {
    return [
      ["Current ratio", `1:${formatAmount(result.currentRatio)}`, `${formatAmount(result.spawnPercent)}% spawn / ${formatAmount(result.substratePercent)}% substrate`],
      ["Total mixed weight", `${formatAmount(result.totalG)} g`, "Spawn plus substrate"],
      ["Substrate for target", `${formatAmount(result.targetSubstrateForSpawnG)} g`, `For current spawn at 1:${formatAmount(result.targetRatio)}`],
      ["Spawn for current substrate", `${formatAmount(result.targetSpawnForSubstrateG)} g`, `To hit 1:${formatAmount(result.targetRatio)} with current substrate`],
    ];
  }

  return [
    ["Hydrated target", `${formatAmount(result.hydratedTargetG)} g`, "Target finished grain weight"],
    ["With overage", `${formatAmount(result.hydratedTargetWithOverageG)} g`, `${formatAmount(result.overagePercent)}% buffer`],
    ["Dry grain estimate", `${formatAmount(result.dryGrainNeededG)} g`, "Back-calculated from hydration gain"],
    ["Water gain estimate", `${formatAmount(result.absorbedWaterEstimateG)} g`, "Expected absorbed weight"],
  ];
}

function buildWorkflowSopText(template, checklists, calculatorMeta, calculatorRows) {
  const tags = (template?.tags || []).join(", ") || "none";
  const checklistText = (checklists || [])
    .map(
      (section) =>
        `${section.title}\n${(section.items || []).map((item) => `- [ ] ${item}`).join("\n")}`
    )
    .join("\n\n");

  const calculatorText = (calculatorRows || [])
    .map(([label, value, hint]) => `- ${label}: ${value}${hint ? ` (${hint})` : ""}`)
    .join("\n");

  return [
    "CHAOTIC NEUTRAL MYCOLOGY SOP PACKET",
    `Generated: ${todayStamp()}`,
    "",
    `Title: ${template?.title || "Workflow SOP"}`,
    `Category: ${template?.category || "Workflow"}`,
    `Scope: ${recipeScopeLabel(template?.recipeScope)}`,
    `Default yield: ${formatAmount(template?.yield || 0)} ${template?.servingLabel || "units"}`,
    `Tags: ${tags}`,
    "",
    "SUMMARY",
    template?.summary || "",
    "",
    "WORKFLOW INSTRUCTIONS",
    template?.instructions || "No instructions saved.",
    "",
    "CLEAN-WORK CHECKLISTS",
    checklistText || "No checklist items saved.",
    "",
    "CURRENT CALCULATOR SNAPSHOT",
    `${calculatorMeta?.label || "Calculator"}: ${calculatorMeta?.description || ""}`,
    calculatorText || "No calculator output available.",
    "",
    "RUN LOG",
    ...RUN_LOG_ROWS.map((row) => `${row}: ________________________________________________`),
    "",
    "SIGNOFF",
    "Reviewed by: ____________________________",
    "Date: ____________________________",
    "",
  ].join("\n");
}

function SopPrintDocument({ template, checklists, calculatorMeta, calculatorRows }) {
  if (!template) return null;

  return (
    <section
      className="sop-print-document"
      aria-hidden="true"
      style={{ position: "fixed", left: "-10000px", top: 0, width: "8.5in", pointerEvents: "none" }}
    >
      <div className="sop-print-header">
        <div className="sop-print-kicker">Chaotic Neutral Mycology SOP Packet</div>
        <h1>{template.title}</h1>
        <p>{template.subtitle}</p>

        <div className="sop-print-meta-grid">
          <div>
            <strong>Category</strong>
            <span>{template.category || "Workflow"}</span>
          </div>
          <div>
            <strong>Scope</strong>
            <span>{recipeScopeLabel(template.recipeScope)}</span>
          </div>
          <div>
            <strong>Default yield</strong>
            <span>
              {formatAmount(template.yield)} {template.servingLabel || "units"}
            </span>
          </div>
          <div>
            <strong>Generated</strong>
            <span>{todayStamp()}</span>
          </div>
        </div>

        <div className="sop-print-badge-row">
          {(template.tags || []).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>

      <section className="sop-print-section sop-print-page-break-avoid">
        <h2>Summary</h2>
        <p>{template.summary}</p>
      </section>

      <section className="sop-print-section">
        <h2>Workflow Instructions</h2>
        <pre>{template.instructions || "No instructions saved."}</pre>
      </section>

      <section className="sop-print-section">
        <h2>Clean-Work Checklists</h2>
        <div className="sop-print-checklists">
          {(checklists || []).map((section) => (
            <div className="sop-print-checklist sop-print-page-break-avoid" key={section.id}>
              <h3>{section.title}</h3>
              <ul>
                {(section.items || []).map((item) => (
                  <li key={item}>☐ {item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="sop-print-section sop-print-page-break-avoid">
        <h2>Current Calculator Snapshot</h2>
        <p>
          <strong>{calculatorMeta?.label}</strong>: {calculatorMeta?.description}
        </p>
        <table className="sop-print-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {(calculatorRows || []).map(([label, value, hint]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{value}</td>
                <td>{hint || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sop-print-section sop-print-page-break-avoid">
        <h2>Run Log</h2>
        <table className="sop-print-table">
          <tbody>
            {RUN_LOG_ROWS.map((row) => (
              <tr key={row}>
                <th>{row}</th>
                <td className="sop-print-lines" />
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sop-print-section sop-print-page-break-avoid">
        <h2>Review / Signoff</h2>
        <div className="sop-print-signoff">
          <div>
            <strong>Reviewed by</strong>
            <span />
          </div>
          <div>
            <strong>Date</strong>
            <span />
          </div>
          <div>
            <strong>Version / revision</strong>
            <span />
          </div>
        </div>
      </section>

      <p className="sop-print-disclaimer">
        Planning and documentation tool only. Follow your validated equipment, sanitation,
        and applicable compliance procedures.
      </p>
    </section>
  );
}

export default function SopWorkflowToolkit({ onUseTemplate, onStartGrowFromTemplate }) {
  const [showSopToolkit, setShowSopToolkit] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(
    WORKFLOW_TEMPLATES[0]?.id || ""
  );
  const [activeCalculator, setActiveCalculator] = useState("grainBatch");
  const [calculatorInputs, setCalculatorInputs] = useState({
    lc: {
      batchVolumeMl: "500",
      sugarPercent: "4",
      nutrientPercent: "0",
      jarCount: "1",
      fillPercent: "70",
    },
    popcorn: {
      dryGrainG: "2000",
      hydrationGainPercent: "35",
      targetBagWeightG: "960",
    },
    grainBatch: {
      targetBags: "8",
      targetBagWeightG: "960",
      hydrationGainPercent: "35",
      overagePercent: "5",
    },
    cvg: {
      targetSubstrateG: "5000",
      dryHydrationMultiplier: "4",
      coirPercent: "70",
      vermiculitePercent: "25",
      gypsumPercent: "5",
    },
    spawnRatio: {
      spawnG: "1000",
      substrateG: "3000",
      targetRatio: "3",
    },
  });

  const selectedWorkflowTemplate = useMemo(() => {
    return (
      WORKFLOW_TEMPLATES.find((template) => template.id === selectedWorkflowId) ||
      WORKFLOW_TEMPLATES[0]
    );
  }, [selectedWorkflowId]);

  const activeCalculatorMeta = useMemo(() => {
    return (
      CALCULATOR_OPTIONS.find((option) => option.id === activeCalculator) ||
      CALCULATOR_OPTIONS[0]
    );
  }, [activeCalculator]);

  const activeCalculatorResult = useMemo(() => {
    if (activeCalculator === "lc") {
      return calculateLiquidCulture(calculatorInputs.lc);
    }
    if (activeCalculator === "popcorn") {
      return calculatePopcornPcHydration(calculatorInputs.popcorn);
    }
    if (activeCalculator === "cvg") {
      return calculateCvgBatch(calculatorInputs.cvg);
    }
    if (activeCalculator === "spawnRatio") {
      return calculateSpawnRatio(calculatorInputs.spawnRatio);
    }
    return calculateGrainBatch(calculatorInputs.grainBatch);
  }, [activeCalculator, calculatorInputs]);

  const activeCalculatorRows = useMemo(
    () => getCalculatorRows(activeCalculator, activeCalculatorResult),
    [activeCalculator, activeCalculatorResult]
  );

  const updateCalculatorInput = (group, field, value) => {
    setCalculatorInputs((prev) => ({
      ...prev,
      [group]: {
        ...(prev[group] || {}),
        [field]: value,
      },
    }));
  };

  const exportSelectedWorkflow = () => {
    if (!selectedWorkflowTemplate) return;

    downloadTextFile(
      `${cleanFileName(selectedWorkflowTemplate.title)}-${todayStamp()}.txt`,
      buildWorkflowSopText(
        selectedWorkflowTemplate,
        CLEAN_WORK_CHECKLISTS,
        activeCalculatorMeta,
        activeCalculatorRows
      )
    );
  };

  const printSelectedWorkflow = () => {
    if (!selectedWorkflowTemplate) return;
    printElementBySelector(
      ".sop-print-document",
      `${selectedWorkflowTemplate.title || "Workflow SOP"} - SOP Packet`
    );
  };

  const startGrowFromSelectedWorkflow = () => {
    if (!selectedWorkflowTemplate) return;
    onStartGrowFromTemplate?.(selectedWorkflowTemplate);
  };

  const renderCalculatorInput = (group, field, label, suffix = "") => (
    <label className="text-sm">
      <span className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={calculatorInputs[group]?.[field] ?? ""}
          onChange={(e) => updateCalculatorInput(group, field, e.target.value)}
          className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2"
        />
        {suffix ? <span className="text-xs opacity-70 min-w-fit">{suffix}</span> : null}
      </div>
    </label>
  );

  const renderCalculatorResults = () => (
    <div className={`grid grid-cols-1 sm:grid-cols-2 ${activeCalculator === "cvg" ? "xl:grid-cols-5" : "xl:grid-cols-4"} gap-3`}>
      {activeCalculatorRows.map(([label, value, hint]) => (
        <CalculatorResultCard key={label} label={label} value={value} hint={hint} />
      ))}
    </div>
  );

  const renderActiveCalculatorInputs = () => {
    if (activeCalculator === "lc") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {renderCalculatorInput("lc", "batchVolumeMl", "Batch volume", "ml")}
          {renderCalculatorInput("lc", "sugarPercent", "Sugar", "%")}
          {renderCalculatorInput("lc", "nutrientPercent", "Optional nutrient", "%")}
          {renderCalculatorInput("lc", "jarCount", "Jar count")}
          {renderCalculatorInput("lc", "fillPercent", "Fill target", "%")}
        </div>
      );
    }

    if (activeCalculator === "popcorn") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {renderCalculatorInput("popcorn", "dryGrainG", "Dry popcorn", "g")}
          {renderCalculatorInput("popcorn", "hydrationGainPercent", "Expected gain", "%")}
          {renderCalculatorInput("popcorn", "targetBagWeightG", "Target bag weight", "g")}
        </div>
      );
    }

    if (activeCalculator === "cvg") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {renderCalculatorInput("cvg", "targetSubstrateG", "Target hydrated batch", "g")}
          {renderCalculatorInput("cvg", "dryHydrationMultiplier", "Water multiplier", "× dry")}
          {renderCalculatorInput("cvg", "coirPercent", "Coir parts", "%")}
          {renderCalculatorInput("cvg", "vermiculitePercent", "Verm parts", "%")}
          {renderCalculatorInput("cvg", "gypsumPercent", "Gypsum parts", "%")}
        </div>
      );
    }

    if (activeCalculator === "spawnRatio") {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {renderCalculatorInput("spawnRatio", "spawnG", "Spawn", "g")}
          {renderCalculatorInput("spawnRatio", "substrateG", "Substrate", "g")}
          {renderCalculatorInput("spawnRatio", "targetRatio", "Target ratio", "1:x")}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {renderCalculatorInput("grainBatch", "targetBags", "Target bags")}
        {renderCalculatorInput("grainBatch", "targetBagWeightG", "Target bag weight", "g")}
        {renderCalculatorInput("grainBatch", "hydrationGainPercent", "Expected gain", "%")}
        {renderCalculatorInput("grainBatch", "overagePercent", "Batch overage", "%")}
      </div>
    );
  };

  return (
    <>
      <div data-testid="sop-workflow-toolkit" className="bg-white dark:bg-zinc-900 p-4 md:p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-4">
        <button
          type="button"
          data-testid="sop-toolkit-toggle"
          onClick={() => setShowSopToolkit((prev) => !prev)}
          className="w-full flex items-start justify-between gap-3 text-left"
        >
          <div>
            <div className="flex items-center gap-2">
              <Sprout size={20} className="accent-text" />
              <h3 className="text-xl font-semibold">Workflow / SOP Toolkit</h3>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 max-w-3xl">
              Additive planning tools for standardized cultivation recipes, clean-work habits,
              and batch calculations. These do not change grow lifecycle behavior.
            </p>
          </div>
          <span className="mt-1">
            {showSopToolkit ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          </span>
        </button>

        {showSopToolkit && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/30 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText size={18} className="accent-text" />
                  <div>
                    <h4 className="font-semibold">Workflow templates</h4>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Start a recipe or a new grow from a reusable SOP shell, then print a run packet.
                    </p>
                  </div>
                </div>
                <select
                  data-testid="sop-template-select"
                  value={selectedWorkflowId}
                  onChange={(e) => setSelectedWorkflowId(e.target.value)}
                  className="rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 text-sm"
                >
                  {WORKFLOW_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.title}
                    </option>
                  ))}
                </select>
              </div>

              {selectedWorkflowTemplate ? (
                <div className="space-y-3">
                  <div>
                    <div data-testid="sop-template-title" className="text-lg font-semibold">
                      {selectedWorkflowTemplate.title}
                    </div>
                    <p
                      data-testid="sop-template-summary"
                      className="text-sm text-zinc-600 dark:text-zinc-400 mt-1"
                    >
                      {selectedWorkflowTemplate.subtitle}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(selectedWorkflowTemplate.tags || []).map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm text-zinc-700 dark:text-zinc-200">
                    {selectedWorkflowTemplate.summary}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-2">
                      <div className="text-xs opacity-70">Category</div>
                      <div className="font-medium">{selectedWorkflowTemplate.category}</div>
                    </div>
                    <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-2">
                      <div className="text-xs opacity-70">Default yield</div>
                      <div className="font-medium">
                        {formatAmount(selectedWorkflowTemplate.yield)} {selectedWorkflowTemplate.servingLabel}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-2">
                      <div className="text-xs opacity-70">Scope</div>
                      <div className="font-medium">
                        {recipeScopeLabel(selectedWorkflowTemplate.recipeScope)}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onUseTemplate?.(selectedWorkflowTemplate)}
                      data-testid="sop-use-template-button"
                      className="btn btn-accent"
                    >
                      <PlusCircle size={16} />
                      Use Template in New Recipe
                    </button>
                    <button
                      type="button"
                      onClick={startGrowFromSelectedWorkflow}
                      data-testid="sop-start-grow-button"
                      className="btn"
                    >
                      <PlayCircle size={16} />
                      Start Grow from SOP
                    </button>
                    <button type="button" onClick={printSelectedWorkflow} data-testid="sop-print-button" className="btn">
                      <Printer size={16} />
                      Print SOP
                    </button>
                    <button type="button" onClick={exportSelectedWorkflow} data-testid="sop-export-button" className="btn">
                      <Download size={16} />
                      Export Text
                    </button>
                  </div>

                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-xs text-emerald-900 dark:text-emerald-100">
                    Print uses your browser print dialog. Choose “Save as PDF” there for a stable PDF without adding another app dependency.
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="accent-text" />
                <div>
                  <h4 className="font-semibold">SAB / FFU clean-work checklist</h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Session habits to reduce contamination and improve traceability.
                  </p>
                </div>
              </div>

              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {CLEAN_WORK_CHECKLISTS.map((section) => (
                  <div
                    key={section.id}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3"
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <ClipboardCheck size={16} className="accent-text" />
                      {section.title}
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
                      {(section.items || []).map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-current opacity-50 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div data-testid="sop-calculator-panel" className="xl:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/30 p-4 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Calculator size={18} className="accent-text" />
                  <div>
                    <h4 className="font-semibold">Cultivation calculators</h4>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Planning math only. Save finalized formulas as recipes when supplies are selected.
                    </p>
                  </div>
                </div>
                <select
                  value={activeCalculator}
                  onChange={(e) => setActiveCalculator(e.target.value)}
                  className="rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 text-sm"
                >
                  {CALCULATOR_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/20 p-3 text-sm text-blue-900 dark:text-blue-100">
                <div className="font-medium">{activeCalculatorMeta.label}</div>
                <div className="mt-1">{activeCalculatorMeta.description}</div>
              </div>

              {renderActiveCalculatorInputs()}
              {renderCalculatorResults()}

              <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-100">
                Calculator output is for planning and consistency tracking. Actual batch results should
                still be recorded from measured weights, observed hydration, and your validated equipment SOP.
              </div>
            </div>
          </div>
        )}
      </div>

      <SopPrintDocument
        template={selectedWorkflowTemplate}
        checklists={CLEAN_WORK_CHECKLISTS}
        calculatorMeta={activeCalculatorMeta}
        calculatorRows={activeCalculatorRows}
      />
    </>
  );
}
