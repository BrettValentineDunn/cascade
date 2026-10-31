// The kit holds no product's data: no names, paths, ids or words that belong to one
// project. Each project's own values live in its cascade.config.mjs.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'

const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCT_WORDS = [
  /manifold|endcap|fieldproof/i,
  /\bfounder\b/i,
  /DEVELOPMENT_(?:CHECKLIST|LOG)/,
  /\b(?:gas|boiler|engineer|CP12|landlord)\b/i,
  /supabase|vercel/i,
  /\bUX-R8\b|\bREL-\d/,
  // A project's own folders; 'tests/' and 'tests/unit' are only the kit's defaults.
  /['"`](?:src|mobile|docs)\//,
]

it('the engine names nothing that belongs to one project', () => {
  const files = ['bin', 'src'].flatMap((d) => readdirSync(path.join(KIT, d)).map((f) => path.join(d, f)))
  const hits = files.flatMap((f) =>
    readFileSync(path.join(KIT, f), 'utf8').split('\n').flatMap((line, i) =>
      PRODUCT_WORDS.filter((re) => re.test(line)).map(() => `${f}:${i + 1}: ${line.trim()}`)),
  )
  assert.deepEqual(hits, [])
})
