// The native app's copy of the shared rules (config mobile.shared). Metro cannot
// reliably include files outside the Expo project root, so the single source lives
// in `from` and a committed copy is materialised in `to`. The project's guard test
// compares the two, so drift fails the gate.
//
//   cascade sync-mobile          rewrite the mirror
//   cascade sync-mobile --check  exit 1 if out of sync

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import config, { load, ROOT } from './config.mjs'

const SHARED = config.mobile?.shared ?? null

/** The mirror of one shared module: a do-not-edit header, then the source. */
export function buildMirror(name, source) {
  return (
    `// GENERATED — do not edit. Mirrored from ${SHARED.from}/${name} by\n` +
    `// ${SHARED.generator} (Metro can't watch outside the Expo\n` +
    `// project root). Edit the source, then rerun the script.\n\n` +
    source
  )
}

/**
 * Write the mirror, or with `check` only report what is out of sync. Returns true
 * when everything was in sync. `modules` defaults to config mobile.shared.modules.
 */
export async function syncMirror({ check = false, modules } = {}) {
  if (!SHARED) throw new Error('cascade: no mobile.shared section in cascade.config.mjs')
  const list = modules ?? (await load(SHARED.modules))
  let dirty = false
  mkdirSync(path.join(ROOT, SHARED.to), { recursive: true })
  for (const name of list) {
    const source = readFileSync(path.join(ROOT, SHARED.from, name), 'utf8')
    const target = path.join(ROOT, SHARED.to, name)
    const expected = buildMirror(name, source)
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (current === expected) {
      console.log(`in sync: ${SHARED.to}/${name}`)
      continue
    }
    dirty = true
    if (check) {
      console.error(`OUT OF SYNC: ${SHARED.to}/${name} (run: ${SHARED.run})`)
    } else {
      writeFileSync(target, expected)
      console.log(`wrote ${SHARED.to}/${name}`)
    }
  }
  return !dirty
}

export async function main(argv) {
  const check = argv.includes('--check')
  const ok = await syncMirror({ check })
  if (check && !ok) process.exit(1)
}
