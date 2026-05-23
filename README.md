<!-- README.md -->

# Chaotic Neutral Myco Tracker

**Current version:** v1.1.1  
**Latest feature milestone:** v1.1.0 SOP Workflow Operations  
**Status:** Web build, desktop build configuration, and Playwright regression coverage are active.

Chaotic Neutral Myco Tracker is a full-stack cultivation notebook for mushroom growers. It combines **grow tracking, SOP/workflow tools, inventory/COG, strain profiles, tasks, analytics, photos, contamination logging, printable SOPs, and backups** into one app built with React, Firebase, and a Tauri Windows client.

This repo powers both:

- The **web app** deployed from GitHub through Vercel.
- The **Windows desktop app** built with Tauri v2 and NSIS.

> **Compliance note:** This project is a recordkeeping, workflow, and inventory tool. Users are responsible for following all local, state, and federal laws that apply to their cultivation, research, business, or personal use.

---

## What changed in v1.1.x

The v1.1.x line completed the SOP/workflow operations milestone and cleaned up public project metadata.

### v1.1.1

- Aligned public version metadata across `package.json`, `package-lock.json`, and `src-tauri/tauri.conf.json`.
- Completed and refreshed the public README.
- Added a changelog for release history and public-facing notes.

### v1.1.0 SOP Workflow Operations

- Added SOP / Workflow Toolkit inside the existing Recipes area.
- Added Agar, LC, Grain, and Bulk workflow templates.
- Added SAB / FFU clean-work checklist support.
- Added LC, popcorn pressure-cook hydration, grain batch, CVG, and spawn-ratio calculators.
- Added printable SOP packets and browser print isolation fixes.
- Added strain-specific cultivation profile fields.
- Added environmental targets per stage and global defaults.
- Added structured lab notes tied to grows.
- Added contamination logging, cleanup checklist, and photo evidence support.
- Added contamination analytics and reporting.
- Added SOP-started grow creation.
- Added optional SOP task generation.
- Added per-grow SOP run checklist tracking.
- Added SOP workflow analytics.
- Added dedicated SOP Playwright regression coverage.

---

## Core Features

### Grow Management

- Multi-stage grow tracking:
  - Agar / LC / Grain: `Inoculated → Colonizing → Colonized`
  - Bulk: `Inoculated → Colonizing → Colonized → Fruiting → Harvesting → Harvested`
- Per-grow timeline with stage dates and history.
- Wet and dry yield tracking per flush.
- Lineage system for agar → LC → grain → bulk workflows.
- Parent cost roll-up for true cost from source material to harvest.
- Per-grow notes, structured lab notes, and exportable logbook context.
- Photo uploads and grow photo timeline.
- Contamination status, logs, cleanup tracking, and evidence photos.

### SOP / Workflow Toolkit

- Workflow templates for Agar, LC, Grain, and Bulk processes.
- Clean-work checklists for SAB / FFU style workflows.
- Recipe and SOP calculators for common workflow math.
- Printable SOP packets from workflow templates.
- Start new grows directly from SOP templates.
- Optional task generation from SOP templates.
- Per-grow SOP run checklist tracking.

### Tasks, Calendar, and Reminders

- Task manager for cultivation work.
- Due dates, status, recurring-task support, and basic reminders.
- SOP-generated task support.
- Calendar / timeline view combining grows and tasks.

### Cost of Goods and Inventory

- Supply inventory with quantity, unit, and cost tracking.
- Recipe builder using supplies.
- Automatic inventory deduction when recipes are used.
- Cost roll-up from parent grows.
- Inventory history and audit-style exports.
- COG analytics and CSV exports.

### Strain Library

- Strain records with notes, profile fields, genetics context, and aggregate stats.
- Strain-specific cultivation profiles.
- Workflow, grain, substrate, clean-work, timing, and environmental preferences.
- Photo and notes support per strain.

### Analytics and Reporting

- Stage distribution reporting.
- Yield analytics by grow and strain.
- Cost vs yield views.
- Contamination analytics and cleanup reporting.
- SOP workflow analytics and checklist completion summaries.
- CSV, JSON, and text-style exports where supported.

### Labels and Printing

- Avery-style label printing.
- Configurable grow label fields.
- SOP browser print support.
- Printable SOP packets without requiring a PDF dependency.

### Settings, Backups, and Offline Behavior

- Dark mode, theme/accent, and accessibility controls.
- Firebase backup/export/import support.
- Local cache tools.
- Delete grow-only data and delete-all-data reset tools.
- Desktop app designed to tolerate offline or flaky network use.

---

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, Recharts.
- **Backend:** Firebase Auth, Firestore, and Storage.
- **Desktop:** Tauri v2, WebView2, NSIS installer.
- **Testing:** Playwright E2E regression coverage.
- **Deployment:** GitHub main branch to Vercel production.

---

## Getting Started

### Prerequisites

- Node.js 20.x
- npm
- Git
- Rust toolchain and Cargo for desktop builds
- Tauri CLI for desktop builds
- Windows 10/11 with WebView2 runtime for the Windows desktop app

### Install dependencies

```bash
npm install
```

### Run the web app locally

```bash
npm run dev
```

The Vite dev server runs on:

```text
http://127.0.0.1:5173
```

### Build the web app

```bash
npm run build
```

### Preview the production build locally

```bash
npm run preview
```

### Run Playwright tests

Install browsers first if needed:

```bash
npm run test:e2e:install
```

Run the full regression suite:

```bash
npm run test:e2e:regression
```

Run individual suites:

```bash
npm run test:e2e:lifecycle
npm run test:e2e:sop
```

### Desktop development

```bash
npm run tauri:dev
```

### Desktop production build

```bash
npm run desktop:build
```

---

## Current Regression Coverage

The current regression suite includes:

- `tests/e2e/grow-lifecycle.spec.ts`
- `tests/e2e/sop-workflow.spec.ts`

The v1.1.0 baseline was verified with:

```bash
npm run build
npm run test:e2e:regression
```

---

## Deployment Notes

### Web

The web app is deployed through Vercel from the GitHub `main` branch.

Useful commands:

```bash
npm run build
npx vercel --prod --force
```

### Desktop

The desktop app uses Tauri v2 and reads desktop version metadata from:

```text
src-tauri/tauri.conf.json
```

The updater endpoint is configured to read the latest release metadata from GitHub Releases.

---

## Release History

See [`CHANGELOG.md`](./CHANGELOG.md).

---

## Repository

```text
ChaoticNeutralMyco/mushroom-tracker-app
```
