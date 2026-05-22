// src/lib/sopTemplates.js

export const WORKFLOW_TEMPLATES = [
  {
    id: "agar-plate",
    title: "Agar Plate Workflow",
    recipeName: "Agar Plate SOP",
    category: "Agar",
    subtitle: "Clean culture isolation, transfers, and observation workflow.",
    recipeScope: "production",
    yield: 20,
    servingLabel: "plates",
    growDefaults: {
      type: "Agar",
      stage: "Inoculated",
      status: "Active",
      parentSource: "Direct",
      amountTotal: 1,
      volumeUnit: "pcs",
      workflowStep: "Agar plate",
    },
    checklistItems: [
      {
        id: "agar-label-source",
        label: "Label plate and record culture source",
        stage: "Inoculated",
        category: "Setup",
        detail: "Record source culture, transfer number, date, and operator notes before the plate leaves clean work.",
      },
      {
        id: "agar-clean-transfer",
        label: "Complete clean transfer session",
        stage: "Inoculated",
        category: "Clean work",
        detail: "Confirm SAB/FFU prep, slow handling, and prompt sealing were completed.",
      },
      {
        id: "agar-recovery-check",
        label: "Check recovery and early growth",
        stage: "Colonizing",
        category: "Observation",
        detail: "Look for clean recovery, sectoring, discoloration, wet spots, or satellite growth.",
      },
      {
        id: "agar-parent-decision",
        label: "Decide transfer, isolate, or reject",
        stage: "Colonized",
        category: "Quality gate",
        detail: "Only promote clean, documented cultures to LC or grain parents.",
      },
    ],
    taskTemplates: [
      {
        id: "agar-recovery-check",
        title: "Inspect agar recovery",
        stage: "Colonizing",
        dueOffsetDays: 3,
        notes: "Check the SOP-started agar plate for clean recovery, satellite growth, wet spots, discoloration, and transfer readiness.",
      },
      {
        id: "agar-transfer-decision",
        title: "Review agar transfer decision",
        stage: "Colonized",
        dueOffsetDays: 7,
        notes: "Decide whether this agar plate should be transferred, isolated, used as a parent, or quarantined/rejected.",
      },
    ],
    tags: ["sop", "workflow", "agar", "clean-culture"],
    summary:
      "Use this as a repeatable plate workflow for clean transfers, isolation work, and strain library maintenance. Keep it generic enough to reuse across legal culinary and medicinal species.",
    instructions: `Purpose
Create a repeatable agar workflow for clean culture work, isolation, transfers, and culture observation.

Before you begin
- Confirm the workspace is clean, organized, and free of unnecessary airflow.
- Stage only the plates, culture source, tools, labels, and waste container needed for the session.
- Label plates before work begins so sterile handling is not interrupted.
- Record culture source, transfer number, date, and operator notes.

Clean-work flow
1. Prepare the still-air box or flow hood workflow before opening any sterile media.
2. Wipe down exterior surfaces of plates, tools, and containers before they enter the clean area.
3. Work slowly and deliberately. Avoid crossing hands, sleeves, or tools over exposed sterile media.
4. Open sterile media only as long as needed for the transfer.
5. Close and parafilm/seal plates promptly according to your normal lab standard.
6. Move finished plates to the incubation/observation area and record the location.

Quality-control checkpoints
- Plate label is readable and unique.
- Transfer source is documented.
- Growth pattern, sectoring, discoloration, wet spots, or satellite growth are logged.
- Questionable plates are isolated and marked for review instead of being used as parents.

Contamination prevention notes
- Do not rush transfers.
- Keep tools and hands out of the open-air path above media.
- Keep a separate reject/quarantine workflow for questionable plates.
- Photograph plates before discarding if they may help future contamination analysis.`,
  },
  {
    id: "lc-jar",
    title: "Liquid Culture Jar Workflow",
    recipeName: "Liquid Culture Jar SOP",
    category: "LC",
    subtitle: "Broth recipe tracking, inoculation notes, and quality-control checks.",
    recipeScope: "production",
    yield: 1,
    servingLabel: "jar",
    growDefaults: {
      type: "LC",
      stage: "Inoculated",
      status: "Active",
      parentSource: "grow",
      amountTotal: 500,
      volumeUnit: "ml",
      workflowStep: "LC jar",
    },
    checklistItems: [
      {
        id: "lc-source-verified",
        label: "Verify and document parent culture",
        stage: "Inoculated",
        category: "Quality gate",
        detail: "Record source grow/plate, amount used, broth formula, and why the source was trusted.",
      },
      {
        id: "lc-clean-inoculation",
        label: "Complete LC clean-work session",
        stage: "Inoculated",
        category: "Clean work",
        detail: "Confirm ports/lids/tools were handled cleanly and exterior surfaces were wiped down.",
      },
      {
        id: "lc-clarity-check",
        label: "Inspect clarity and growth pattern",
        stage: "Colonizing",
        category: "Observation",
        detail: "Log cloudiness, sediment, discoloration, unusual growth, or other quality concerns.",
      },
      {
        id: "lc-test-before-use",
        label: "Verify LC before grain use",
        stage: "Colonized",
        category: "Quality gate",
        detail: "Treat LC as unverified until it passes your lab's quality gate before becoming a parent.",
      },
    ],
    taskTemplates: [
      {
        id: "lc-clarity-check",
        title: "Inspect LC clarity",
        stage: "Colonizing",
        dueOffsetDays: 4,
        notes: "Check LC for expected growth pattern, clarity, sediment, discoloration, or other contamination warning signs.",
      },
      {
        id: "lc-verify-before-grain",
        title: "Verify LC before grain inoculation",
        stage: "Colonized",
        dueOffsetDays: 10,
        notes: "Complete your LC quality gate before using this culture as a parent for grain.",
      },
    ],
    tags: ["sop", "workflow", "lc", "liquid-culture"],
    summary:
      "Use this as a standard LC record so each jar has source culture, broth formula, clarity, test status, and downstream usage notes.",
    instructions: `Purpose
Create a repeatable liquid culture workflow with clear source tracking, broth formula notes, and quality-control gates before downstream use.

Before you begin
- Confirm the culture source is clean and documented.
- Record broth formula, target volume, container type, lid/filter type, and date.
- Label the jar before work begins.
- Stage sterile tools and the receiving jar so the clean-work session is short and organized.

Clean-work flow
1. Prepare the SAB or FFU workflow and let the workspace settle according to your standard practice.
2. Wipe down all exterior surfaces before they enter the clean area.
3. Handle ports, lids, syringes, needles, and tools deliberately to avoid contact contamination.
4. Inoculate from a documented clean source.
5. Record source culture, volume used, broth recipe, and operator notes.

Quality-control checkpoints
- Broth starts clear or matches expected recipe appearance.
- Growth pattern is documented over time.
- Cloudiness, sediment, discoloration, off odor, or unusual growth is logged as a possible issue.
- LC is tested or otherwise verified according to your lab standard before it becomes a parent for grain.

Contamination prevention notes
- Treat every LC as unverified until it passes your quality gate.
- Do not use questionable LC as a parent culture.
- Track every downstream grow that used the LC so contamination can be traced later.`,
  },
  {
    id: "grain-jar-bag",
    title: "Grain Jar / Bag Workflow",
    recipeName: "Grain Jar or Bag SOP",
    category: "Grain",
    subtitle: "Popcorn now, milo later: batch weights, hydration tracking, and parent use.",
    recipeScope: "production",
    yield: 8,
    servingLabel: "bags",
    growDefaults: {
      type: "Grain Jar",
      stage: "Inoculated",
      status: "Active",
      parentSource: "grow",
      amountTotal: 960,
      volumeUnit: "g",
      workflowStep: "Grain jar/bag",
    },
    checklistItems: [
      {
        id: "grain-batch-weights",
        label: "Record grain batch weights and prep method",
        stage: "Inoculated",
        category: "Batch prep",
        detail: "Capture grain type, dry weight, target finished weight, hydration method, and actual finished weight.",
      },
      {
        id: "grain-parent-linked",
        label: "Link clean parent culture and inoculation notes",
        stage: "Inoculated",
        category: "Lineage",
        detail: "Confirm parent grow ID, amount used, inoculation date, and clean-work notes are saved.",
      },
      {
        id: "grain-recovery-check",
        label: "Check recovery after inoculation",
        stage: "Colonizing",
        category: "Observation",
        detail: "Look for clean recovery, excess moisture, odor, stalled growth, or suspect kernels.",
      },
      {
        id: "grain-colonization-gate",
        label: "Confirm clean colonization before bulk",
        stage: "Colonized",
        category: "Quality gate",
        detail: "Only clean, fully ready grain should be used as a parent for bulk.",
      },
    ],
    taskTemplates: [
      {
        id: "grain-recovery-check",
        title: "Check grain recovery",
        stage: "Colonizing",
        dueOffsetDays: 5,
        notes: "Inspect grain recovery and log moisture, odor, stalled growth, or suspect signs.",
      },
      {
        id: "grain-shake-review",
        title: "Review grain shake/breakup timing",
        stage: "Colonizing",
        dueOffsetDays: 10,
        notes: "Check whether this grain jar/bag is ready for shake/breakup or should be left undisturbed.",
      },
      {
        id: "grain-bulk-readiness",
        title: "Confirm grain ready for bulk",
        stage: "Colonized",
        dueOffsetDays: 16,
        notes: "Confirm clean colonization before using this grain as a parent for bulk.",
      },
    ],
    tags: ["sop", "workflow", "grain", "popcorn", "hydration"],
    summary:
      "Use this as your grain-prep record for batch weights, hydrated target weights, parent culture, bag count, and clean inoculation checks.",
    instructions: `Purpose
Create repeatable grain batches with consistent finished weights, hydration notes, parent culture tracking, and clean inoculation records.

Before you begin
- Record grain type, dry weight, expected hydration gain, target finished container weight, and number of jars or bags.
- Record whether this batch used pressure-cook hydration, soak/simmer, or another validated prep style.
- Label each container with batch ID, grain type, date, and intended parent culture.

Batch tracking flow
1. Weigh dry grain before hydration.
2. Record hydration method, target finished weight, actual finished weight, and any variance.
3. Load containers consistently so each jar or bag is comparable in analytics.
4. Record sterilization cycle details according to your validated equipment SOP.
5. Let containers cool and confirm there are no obvious seal, filter, or moisture issues.

Clean inoculation flow
1. Prepare SAB or FFU workflow before opening or piercing any container.
2. Use only verified parent cultures.
3. Record parent grow ID, amount used, inoculation date, and operator notes.
4. Track recovery, colonization speed, shake/breakup dates, and any suspect signs.

Quality-control checkpoints
- Finished container weights are consistent.
- Grain is not visibly over-wet, pooled, burst-heavy, or dry.
- Parent culture is linked in the app.
- Suspect jars/bags are isolated and not used as parents until reviewed.

Contamination prevention notes
- Keep batch sizes consistent so problems are easier to compare.
- Record which grain, prep method, and parent culture were used.
- When a problem shows up, trace it back through grain batch, parent culture, and clean-work session.`,
  },
  {
    id: "bulk-tub-bag",
    title: "Bulk Tub / Bag Workflow",
    recipeName: "Bulk Tub or Bag SOP",
    category: "Bulk",
    subtitle: "Spawn ratio, substrate batch, fruiting targets, flushes, and archive flow.",
    recipeScope: "production",
    yield: 1,
    servingLabel: "tub or bag",
    growDefaults: {
      type: "Bulk",
      stage: "Inoculated",
      status: "Active",
      parentSource: "grow",
      bulkGrainParts: 1,
      bulkSubstrateParts: 3,
      bulkVolume: 4000,
      bulkVolumeUnit: "g",
      workflowStep: "Bulk tub/bag",
    },
    checklistItems: [
      {
        id: "bulk-parent-confirmed",
        label: "Confirm parent grain is clean",
        stage: "Inoculated",
        category: "Quality gate",
        detail: "Record parent grain, amount used, and why it was accepted for bulk.",
      },
      {
        id: "bulk-substrate-ratio-recorded",
        label: "Record substrate batch and spawn ratio",
        stage: "Inoculated",
        category: "Batch prep",
        detail: "Capture substrate recipe, hydrated weight, container type, and spawn-to-substrate ratio.",
      },
      {
        id: "bulk-colonization-check",
        label: "Check bulk colonization progress",
        stage: "Colonizing",
        category: "Observation",
        detail: "Track colonization progress, environment drift, and any suspect signs before fruiting.",
      },
      {
        id: "bulk-fruiting-targets",
        label: "Confirm fruiting targets and surface conditions",
        stage: "Fruiting",
        category: "Environment",
        detail: "Compare temperature/RH observations to strain/global targets and log surface condition notes.",
      },
      {
        id: "bulk-flushes-recorded",
        label: "Record flushes before archive",
        stage: "Harvesting",
        category: "Harvest",
        detail: "Record each flush with wet weight, dry weight when available, and harvest notes.",
      },
    ],
    taskTemplates: [
      {
        id: "bulk-colonization-check",
        title: "Check bulk colonization",
        stage: "Colonizing",
        dueOffsetDays: 5,
        notes: "Inspect bulk colonization progress, substrate condition, and any suspect contamination signs.",
      },
      {
        id: "bulk-fruiting-review",
        title: "Review fruiting readiness",
        stage: "Fruiting",
        dueOffsetDays: 12,
        notes: "Confirm whether this bulk grow is ready for fruiting conditions and environmental target tracking.",
      },
      {
        id: "bulk-harvest-check",
        title: "Harvest and flush check",
        stage: "Harvesting",
        dueOffsetDays: 20,
        notes: "Check for harvest timing, record flush weights, and update dry yield when available.",
      },
    ],
    tags: ["sop", "workflow", "bulk", "cvg", "spawn-ratio"],
    summary:
      "Use this as a bulk production SOP for spawn ratio, substrate batch, environmental targets, flush records, and archive notes.",
    instructions: `Purpose
Create a repeatable bulk workflow that connects parent grain, substrate recipe, spawn ratio, environmental targets, flushes, and final archive metrics.

Before you begin
- Confirm parent grain is clean, fully ready, and linked in the app.
- Record substrate recipe, target hydrated substrate weight, and container type.
- Choose and record spawn-to-substrate ratio before mixing.
- Record target fruiting environment for the strain or workflow.

Bulk setup flow
1. Record parent grain grow ID and amount used.
2. Record substrate batch, hydrated substrate weight, and total mixed weight.
3. Record spawn ratio and container details.
4. Label the tub or bag with grow ID, strain, date, and parent lineage.

Monitoring flow
1. Track colonization progress and any suspect signs.
2. Record stage changes in the app when moving from colonization to fruiting and harvest stages.
3. Log environmental observations, especially when conditions drift from target.
4. Record each flush with wet weight, dry weight when available, and notes.

Quality-control checkpoints
- Parent grain looked clean before use.
- Substrate field condition and weight were recorded.
- Fruiting targets are documented.
- Flushes are recorded before the grow is archived.

Contamination prevention notes
- Do not mix questionable parent grain into bulk.
- Track contamination by stage so future analytics can point to likely weak spots.
- Archive contaminated grows with notes instead of deleting them so the data remains useful.`,
  },
];

export const CLEAN_WORK_CHECKLISTS = [
  {
    id: "sab-prep",
    title: "Bella Bora SAB Clean-Work Checklist",
    items: [
      "Clear the room of avoidable airflow: fans off, doors closed, unnecessary movement stopped.",
      "Stage only the items needed for this session before starting.",
      "Wipe down the work surface and SAB interior/exterior according to your cleaning standard.",
      "Wipe exterior surfaces of jars, plates, bags, tools, and labels before they enter the SAB.",
      "Let the work area settle before opening sterile media or culture containers.",
      "Keep hands, sleeves, and tools from passing over exposed sterile media.",
      "Open containers only as long as needed, then close them promptly.",
      "Separate questionable cultures or containers from clean work immediately.",
      "Log the clean-work session notes, operator, source culture, and any deviations.",
    ],
  },
  {
    id: "ffu-prep",
    title: "Future FFU / Flow Workflow Checklist",
    items: [
      "Confirm the unit, filter face, table, and surrounding workspace are clean and unobstructed.",
      "Stage tools and media so sterile items stay in the clean airflow path.",
      "Keep hands and non-sterile objects from blocking clean airflow to open media.",
      "Work from clean to less-clean items and avoid reaching back across open sterile containers.",
      "Keep receiving containers open only as long as necessary.",
      "Log the session, source culture, target containers, and any unusual handling events.",
      "Clean down the workspace after the session and quarantine any questionable items.",
    ],
  },
  {
    id: "session-closeout",
    title: "Clean-Work Closeout Checklist",
    items: [
      "Confirm every plate, jar, bag, or tub has a readable label and date.",
      "Record parent-child links before memory gets fuzzy.",
      "Move finished items to the correct storage or incubation location.",
      "Mark questionable items for review instead of mixing them with clean inventory.",
      "Record what went well, what felt risky, and what should change next session.",
      "Clean and reset the workspace so the next session starts organized.",
    ],
  },
];
