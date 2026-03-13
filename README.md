<!-- README.md -->

# Chaotic Neutral Myco Tracker

Chaotic Neutral Myco Tracker is a full-stack cultivation notebook for mushroom growers.  
It combines **grow tracking, inventory/COG, strain library, tasks, analytics, photos, and backups** into one desktop app, built with React, Firebase, and a Tauri Windows client.

This repo powers both:

- The **web app** (Vercel / browser).
- The **Windows desktop app** (Tauri v2 + NSIS installer with auto-updates).

---

## 🌱 Core Features

### Grow Management

- Multi-stage grow tracking:  
  _Inoculated → Colonizing → Colonized → Fruiting → Harvested → Archived / Contaminated_
- Per-grow timeline with stage dates and history.
- Wet & dry yield tracking per flush, with notes.
- Lineage system: link grows (agar → LC → grain → bulk) and see ancestry/descendants.
- Per-grow notes with timestamps and exportable logbook.
- Photo uploads per grow and a simple photo timeline.

### Tasks, Calendar & Reminders

- Task manager for cultivation work (shakes, transfers, harvests, etc.).
- Due dates, status, and basic reminders.
- Calendar / timeline view combining **grows + tasks** so you can see what’s coming up.

### Cost of Goods (COG) & Inventory

- Supply inventory: track quantities, units, and cost per unit.
- Recipe builder for agar, LC, grain, bulk, etc. using your supplies.
- Automatic inventory deduction when recipes are used for new grows.
- Cost roll-up from parent grows so you can see **true cost from spore to harvest**.
- COG analytics, audit views, and CSV exports.

### Strain Library & Labels

- Strain cards with metadata, notes, genetics info, and aggregate stats from archived grows.
- Photo + notes per strain.
- Label printing (Avery-style) with configurable fields (grow ID, strain, dates, etc.).

### Analytics & Reporting

- Stage distribution charts (how many grows make it to each stage).
- Yield analytics (wet vs dry) per grow and per strain.
- Cost vs yield views to estimate efficiency/profitability.
- CSV exports for grows, notes, yields, and inventory.

### Settings, Backups & Offline

- Dark mode, theme/accent, and font-size/accessibility controls.
- Backup/export + import using Firebase.
- “Danger Zone” tools:
  - Clear local cache.
  - Delete grow-only data.
  - Delete all data (intended for clean resets; backup first).
- Desktop app designed to behave well when offline / flaky network.

---

## 🧱 Tech Stack

- **Frontend:** React + Vite, Tailwind CSS, shadcn/ui, Recharts.
- **Backend:** Firebase (Auth, Firestore, Storage).
- **Desktop:** Tauri v2 (Windows, WebView2, NSIS installer).
- **Platform:** GitHub repo `ChaoticNeutralMyco/mushroom-tracker-app` with Vercel for the web build.

---

## 🚀 Getting Started (Dev)

### Prerequisites

- Node.js (LTS) and npm (or pnpm/yarn).
- Rust toolchain + Cargo.
- Tauri CLI (`cargo install tauri-cli`).
- Windows 10/11 with WebView2 runtime.

### Install dependencies

```bash
# Project root
npm install
