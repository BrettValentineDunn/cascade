// The kit's guard tests, for a project's Vitest suite:
//
//   // tests/unit/cascade.test.ts
//   import { cascadeGuards } from 'cascade/vitest'
//   cascadeGuards()
//
// Each guard runs only when its config section is there.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import config, { fileOf, ROOT } from './config.mjs'
import { decisionProblems, indexShape, renderIndex, scanMarkers, testPins } from './decisions.mjs'

/** Every file and module the config names, repo-relative. */
export function configRefs(c = config) {
  const refs = []
  const add = (...xs) => refs.push(...xs.filter(Boolean))
  if (c.checklist) add(c.checklist.file, c.checklist.log)
  if (c.map) add(fileOf(c.map))
  if (c.journeys) add(fileOf(c.journeys))
  if (c.surfaces?.live) add(fileOf(c.surfaces.live))
  add(c.facts, ...(c.releaseNotes ?? []), c.api?.appDir)
  if (c.decisions) add(c.decisions.index, ...(c.decisions.roots ?? []), ...(c.decisions.tests ?? []))
  if (c.copyClaims) add(c.copyClaims.registry, ...(c.copyClaims.roots ?? []))
  if (c.mobile) {
    add(c.mobile.root, c.mobile.appConfig, c.mobile.divergences, c.mobile.uploadScript, ...(c.mobile.callers ?? []))
    if (c.mobile.shared) add(c.mobile.shared.from, c.mobile.shared.to, fileOf(c.mobile.shared.modules))
  }
  return [...new Set(refs)]
}

/** Registers the guards. `decisions: false` leaves the decisions guard to the project's own test. */
export function cascadeGuards({ decisions = true } = {}) {
  describe('cascade', () => {
    it('every file and module cascade.config.mjs names exists', () => {
      expect(configRefs().filter((r) => !existsSync(path.join(ROOT, r)))).toEqual([])
    })

    if (decisions && config.decisions.index) {
      it('every DECISION marker parses and is pinned by a test, and the index is current', () => {
        const scanned = scanMarkers(ROOT)
        const pins = testPins(ROOT)
        expect(decisionProblems(scanned, pins)).toEqual([])
        let current = ''
        try {
          current = readFileSync(path.join(ROOT, config.decisions.index), 'utf8')
        } catch { /* missing */ }
        expect(indexShape(current), `${config.decisions.index} is stale: run npx cascade decisions`).toBe(indexShape(renderIndex(scanned.markers, pins)))
      })
    }
  })
}
