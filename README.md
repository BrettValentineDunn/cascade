# cascade

The change cascade, for any repository: no change ships alone.

- **impact**: what else has to change. A diff becomes the feature areas it touches,
  every docs page, marketing card, email and screen that describes them, the facts
  whose owning constant changed, web/native screens changed on one side only, the
  decisions next to each hunk and the journeys it passes through, then a
  `Cascade:` block to paste into the commit message.
- **check-commits**: every commit in a range that touches an area carries its
  filled-in verdicts. Run it before a push and over a release.
- **decisions**: `// DECISION(<ID>): <rule> — <why> (<who>, <YYYY-MM-DD>)` beside
  behaviour that is there on purpose, a test whose title names `DECISION(<ID>)`,
  and a generated index. A commit that rewords a marker must quote who approved it.
- **checklist**: keeps the "what's next" checklist small enough to read, moving
  finished detail to the log.
- **sync-mobile**, **quick-tests**, **copy-claims**: the shared-rule mirror for a
  native app, the tests a change can affect, and outcome claims no test proves.

## Install

```bash
npm i -D github:BrettValentineDunn/cascade#v0.1.2
```

Then add `cascade.config.mjs` at the repository root. Every section is optional:
a missing one turns its check off, and `npx cascade doctor` lists what is on.

```js
import { defineConfig } from 'cascade'

export default defineConfig({
  checklist: { file: 'docs/DEVELOPMENT_CHECKLIST.md', log: 'docs/DEVELOPMENT_LOG.md', warnAt: 240 * 1024 },
  // Commits before these days are never held to a rule that did not exist yet.
  from: { cascade: '2026-11-01', journeys: '2026-11-01', decisions: '2026-11-01' },
  approver: 'owner',
  map: 'scripts/impact-map.mjs',                 // AREAS, HUBS, SCREEN_PAIRS, NATIVE_BUILD_TRIGGERS
  journeys: 'scripts/journeys.mjs#JOURNEYS',
  decisions: { roots: ['src'], tests: ['tests'], index: 'docs/decisions.md' },
})
```

The full list of sections, with what each one turns on, is in
[`src/defaults.mjs`](src/defaults.mjs) and the doctor's output.

## Commands

```text
npx cascade impact [--staged | --base <ref> | <files...>] [--json]
npx cascade check-commits [<range>] [--json]
npx cascade decisions [--check | --files <files...> | --proposal <file>] [--json]
npx cascade checklist status | archive [--write]
npx cascade sync-mobile [--check]
npx cascade quick-tests --base <sha> [--head <sha>]
npx cascade copy-claims [--baseline]
npx cascade doctor
```

## Guard tests

In a Vitest suite:

```ts
// tests/unit/cascade.test.ts
import { cascadeGuards } from 'cascade/vitest'

cascadeGuards()
```

It checks that every path the config names exists and, with a `decisions`
section, that every marker parses and is pinned by a test and the index is current.
The engine's functions are importable too (`cascade/impact`, `cascade/decisions`,
`cascade/feature-coverage`, `cascade/facts`, `cascade/surfaces` and the rest) for a
project's own guards.

## The rule for this repository

It holds no product's data: no names, paths, ids or words that belong to one
project. `test/purity.test.mjs` enforces it, and the kit's own tests run on a
made-up fixture project (`test/fixture.mjs`). `npm test` runs them.
