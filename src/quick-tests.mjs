// On a push to main, run the tests a change can affect instead of the whole
// suite. Releases, pull requests and a nightly run keep the full suite, so
// anything this misses is caught within a day and never reaches production.
//
//   cascade quick-tests --base SHA [--head SHA]
//     prints the selection as JSON: run `direct` as test files and `sources`
//     through `vitest related`; {"full":true} means run the whole suite.
//
// Picked:
// - changed test files themselves;
// - tests that import a changed source file (the caller runs `vitest related`);
// - tests that name a changed file's path (many read source files as text);
// - every test that scans folders or runs git (repo-wide guards), always.
// A change to the test setup, dependencies or build config runs everything
// (cascade.config.mjs quickTests).

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import config from './config.mjs'

const { runEverything, tests: TESTS, sources: SOURCES } = config.quickTests
export const RUN_EVERYTHING = runEverything
const SCANS = /readdirSync|globSync|fast-glob|execSync\(|execFileSync\(|spawnSync\(/
const READS = /readFileSync|readdirSync/
const CODE = /\.(ts|tsx|mts|mjs|js|jsx)$/

/**
 * changed: repo-relative paths changed since the base (deleted ones included).
 * tests: { '<quickTests.dir>/x.test.ts': fileContents } for every unit test file.
 * Returns { full } or { full: false, direct, sources }: run `direct` as test files
 * and `sources` through `vitest related`.
 */
export function selectTests(changed, tests, { maxChanged = 200 } = {}) {
  if (changed.length > maxChanged || changed.some(f => RUN_EVERYTHING.some(r => r.test(f)))) return { full: true }
  const direct = new Set()
  for (const [file, text] of Object.entries(tests)) {
    if (changed.includes(file)) { direct.add(file); continue }
    if (SCANS.test(text)) { direct.add(file); continue }
    if (READS.test(text) && changed.some(c => !c.startsWith(TESTS) && text.includes(c))) direct.add(file)
  }
  const sources = changed.filter(f => CODE.test(f) && !f.startsWith(TESTS) && SOURCES.some(r => f.startsWith(r)))
  return { full: false, direct: [...direct].sort(), sources }
}

export function main(argv) {
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
  const base = arg('--base')
  if (!base) { console.log(JSON.stringify({ full: true, reason: 'no base' })); return }
  const changed = execFileSync('git', ['diff', '--name-only', base, arg('--head') || 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  const tests = {}
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.posix.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.test\.(ts|tsx|mts|js)$/.test(e.name)) tests[p] = readFileSync(p, 'utf8')
    }
  }
  walk(config.quickTests.dir)
  // Only tests that still exist can be run; deleted files still count as changes.
  const result = selectTests(changed, tests)
  if (!result.full) result.sources = result.sources.filter(f => { try { readFileSync(f); return true } catch { return false } })
  console.log(JSON.stringify({ ...result, changed: changed.length }))
}
