# Changelog

## 0.1.1 (2026-10-31)

- Type declarations for `cascade/checklist`: `archiveText`, `repairEncoding` and
  `longOpenItems` return their real shapes, so strict TypeScript callers compile.

## 0.1.0 (2026-10-31)

The engine, moved out of the first project to use it with identical output.

- Commands: `impact`, `check-commits`, `decisions`, `checklist`, `sync-mobile`,
  `quick-tests`, `copy-claims`, `doctor`.
- Every config section is optional; a missing one turns its check off.
- Modules for a project's own guards: `cascade/impact`, `cascade/decisions`,
  `cascade/feature-coverage`, `cascade/journeys`, `cascade/surfaces`,
  `cascade/facts`, `cascade/mirror`, `cascade/glob`, `cascade/checklist`,
  `cascade/copy-claims`, `cascade/quick-tests`, and `cascade/vitest` with
  `cascadeGuards()`.
