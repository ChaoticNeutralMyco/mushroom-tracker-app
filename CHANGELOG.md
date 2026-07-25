<!-- CHANGELOG.md -->
# Changelog

All notable public-facing changes for Chaotic Neutral Myco Tracker are tracked here.

## Unreleased

### Added

- SOP-started grow creation now carries workflow metadata, optional generated tasks, and a per-grow SOP checklist.
- Added SOP workflow analytics and current lifecycle regression coverage.
- Added editable global environment targets by cultivation stage with Fahrenheit/Celsius display conversion.
- Added target comparison badges for environment logs.

### Changed

- Reconnected the SOP / Workflow Toolkit to Recipes and Grow creation.
- Normalized legacy recipe tag values so older string-based records no longer crash the Recipes screen.
- Corrected the Strain Library species field so normalization and menu closing share one blur handler.
- Hardened `.gitignore` and `.vercelignore` for local auth state, backups, patch folders, native artifacts, and generated output.
- Aligned `.env.example` with the Firebase emulator variable names used by the app.
- Updated PWA metadata for root deployment on Vercel.
- Added `npm run release:check` for the current build/test preflight.

### Removed

- Removed the diagnostic-only `/camera-probe` route and `src/CameraProbe.tsx`.
- Removed obsolete public diagnostic pages and local generated/backup artifacts during the cleanup audit.

### Testing

- `npm run build`
- `npm run test:e2e:list`
- `npm run test:subscription`
- Local verification currently discovers 6 Playwright tests and passes 34 subscription unit tests.

## v1.1.4 - 2026-05-23

### Changed

- Fixed Android release automation so missing signing secrets no longer fail the workflow.
- Android workflow now always builds and uploads a debug APK.
- Signed release APK/AAB builds now run only when Android keystore secrets are configured.
- Kept Node 24 and Java 21 workflow updates from v1.1.3.

### Notes

- Desktop installer automation was already validated in v1.1.3.
- No app behavior or cultivation logic was intentionally changed in this version.

## v1.1.3 - 2026-05-23

### Changed

- Refreshed GitHub Actions release automation for desktop and Android builds.
- Updated workflow Node setup to Node 24 while allowing local/project Node engines from Node 20 through Node 24.
- Fixed Tauri release automation by using a valid CI value instead of `CI=1`.
- Fixed Android CI by using Java 21 for Capacitor/Android source compatibility.
- Added Android release asset attachment to GitHub Releases when tag builds produce APK/AAB files.
- Moved E2E to manual workflow dispatch until the GitHub Actions Playwright hang is fully diagnosed.

### Notes

- This is a release automation maintenance update.
- No app behavior or cultivation logic was intentionally changed in this version.

## v1.1.2 - 2026-05-23

### Changed

- Added a release automation validation tag after the v1.1.1 public metadata cleanup.
- Confirmed release workflow issues that were fixed in v1.1.3.

### Notes

- No app behavior or cultivation logic was intentionally changed in this version.

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

