# Changelog

## 0.1.3 (2026-11-01)

- `check-commits` reads a verdict wrapped over several lines: a line in the
  `Cascade:` block that does not start `- ` carries on the one above (a journeys
  verdict wrapped after its first line lost the ids on the next).
- Late verdicts: config `lateVerdicts` names a committed file recording the
  verdicts a pushed commit owes, by full sha, each with why it is late. A commit
  whose own message falls short passes when its message and its late verdict
  together cover it, and `check-commits` lists each one that does
  (`commitCascadeReport` returns them as `late`). A late verdict without a
  `Why late:` line is refused.

## 0.1.2 (2026-11-01)

- `decisions` and the surface walk list files in byte order, so the index comes out
  the same on every file system (NTFS and ext4 list a folder differently, and a
  decision anchored in two folders showed its files in a different order on a
  Linux runner).

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
