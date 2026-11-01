// `cascade doctor`: where the config is, and which checks it turns on.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import config, { CONFIG_FILE, ROOT } from './config.mjs'

const CHECKS = [
  ['checklist', 'checklist status and archive', (c) => c.checklist],
  ['cascade', 'Cascade: block on every commit (check-commits)', (c) => c.from.cascade && c.map],
  ['map', 'impact map: areas and surfaces to review', (c) => c.map],
  ['journeys', 'journeys a change passes through', (c) => c.journeys && c.from.journeys],
  ['decisions', 'DECISION markers, index and pins', (c) => c.decisions.index],
  ['facts', 'facts whose owning constant changed', (c) => c.facts],
  ['surfaces', 'marketing and docs surface kinds', (c) => Object.keys(c.surfaces.kinds).length],
  ['copyClaims', 'outcome claims in user copy', (c) => c.copyClaims.registry],
  ['quickTests', 'quick test selection', (c) => c.quickTests.sources.length],
  ['mobile', 'web/native parity, shared-rule mirror, OTA or build', (c) => c.mobile],
  ['lateVerdicts', 'late verdicts for commits already pushed', (c) => c.lateVerdicts],
]

export function main() {
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  console.log(`cascade ${version}\nconfig  ${path.join(ROOT, CONFIG_FILE)}\n`)
  for (const [name, what, on] of CHECKS) console.log(`  ${on(config) ? 'on ' : 'off'}  ${name.padEnd(11)} ${what}`)
  console.log('\nA check is off when its section (or its `from` date) is missing from the config.')
}
