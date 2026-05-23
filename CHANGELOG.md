# Changelog

All notable public-facing changes for Chaotic Neutral Myco Tracker are tracked here.

## v1.1.1 - 2026-05-23

### Changed

- Completed and refreshed the public README so new users see accurate setup, feature, testing, deployment, and release information.
- Aligned app metadata to v1.1.1 in:
  - `package.json`
  - `package-lock.json`
  - `src-tauri/tauri.conf.json`
- Added this changelog for clearer release history.

### Notes

- This is a documentation and release-metadata cleanup on top of the v1.1.0 SOP/workflow milestone.
- No app behavior or cultivation logic was intentionally changed in this version.

## v1.1.0 - 2026-05-22

### Added

- SOP / Workflow Toolkit inside the existing Recipes area.
- Agar, LC, Grain, and Bulk workflow templates.
- SAB / FFU clean-work checklist support.
- LC, popcorn pressure-cook hydration, grain batch, CVG, and spawn-ratio calculators.
- Printable SOP packets and browser print isolation fixes.
- Strain-specific cultivation profile fields.
- Environmental targets per stage and global defaults.
- Structured lab notes tied to grows.
- Contamination logging tied to grows.
- Contamination cleanup checklist and photo evidence support.
- Contamination analytics and reporting.
- SOP-started grow creation.
- Optional SOP task generation.
- Per-grow SOP run checklist tracking.
- SOP workflow analytics.
- Dedicated SOP Playwright regression coverage.

### Testing

- `npm run build`
- `npm run test:e2e:lifecycle`
- `npm run test:e2e:sop`
- `npm run test:e2e:regression`

## v1.0.x

### Added

- Core grow tracking.
- Inventory and Cost of Goods tracking.
- Recipe management.
- Strain library.
- Grow notes and photo support.
- Analytics and exports.
- Backup/import/export tooling.
- Tauri desktop build configuration.
