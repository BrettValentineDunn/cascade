// Copy that states an outcome must be proven.
//
// Screens promise what the app never did: "Draft saved" when it was saved only on
// one device, "submits automatically" when it never retried. Each sentence is
// written once and never checked against behaviour.
//
// This finds user-facing sentences that state an outcome (sent, emailed, saved, made,
// generated, booked, submitted, delivered, created, "submits automatically", ...).
// The project's guard test holds them to its registry (config copyClaims.registry):
// a claim is either PROVEN (the test that shows it happens is named) or counted in
// its file's baseline of older, unproven claims, which may only go down.
//
//   cascade copy-claims             the unproven claims per file, against the registry
//   cascade copy-claims --baseline  rewrite the baseline counts to what is unproven now
//                                   (only ever to lower them: the guard refuses a rise)

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import config from './config.mjs'

export const CLAIM_ROOTS = config.copyClaims.roots
// Copy reviewed through the change cascade instead (config copyClaims.skip).
const SKIP = config.copyClaims.skip

const CLAIM = /\b(?:has been|have been|was|were|is|are|gets?)\s+(?:sent|emailed|saved|made|generated|booked|submitted|delivered|created)\b|\b(?:draft saved|submits? (?:itself )?automatically|will (?:sync|submit|send) automatically|emailed (?:it )?to|emails itself)\b/i

/** Source files the claims are read from, repo-relative with forward slashes. */
export function claimFiles(root = process.cwd()) {
  const out = []
  const walk = dir => {
    for (const name of readdirSync(path.join(root, dir))) {
      const rel = `${dir}/${name}`
      if (statSync(path.join(root, rel)).isDirectory()) { if (!SKIP.test(`/${rel}/`)) walk(rel) }
      else if (/\.(tsx?|mjs)$/.test(name) && !SKIP.test(`/${rel}`)) out.push(rel)
    }
  }
  for (const r of CLAIM_ROOTS) walk(r)
  return out.sort()
}

/**
 * The outcome-claiming sentences in one source text: string literals and JSX text that
 * read as user copy (a capital letter and a space) and match CLAIM. Comments are left
 * out: whole-line // comments and block comments that start a line (a "/*" inside a
 * string such as accept="image/*" is not a comment).
 */
export function claimsIn(source) {
  const src = source
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, m => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '')
  const found = []
  const consider = text => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (t.length < 8 || !/[A-Z]/.test(t) || !/\s/.test(t)) return
    if (CLAIM.test(t)) found.push(t)
  }
  for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) consider(m[2])
  for (const m of src.matchAll(/>([^<>{}]{8,})</g)) consider(m[1])
  return found
}

/** Every claim in the repo, by file. */
export function scanClaims(root = process.cwd()) {
  const byFile = {}
  for (const rel of claimFiles(root)) {
    const claims = claimsIn(readFileSync(path.join(root, rel), 'utf8'))
    if (claims.length) byFile[rel] = claims
  }
  return byFile
}

export function main(argv) {
  const FILE = config.copyClaims.registry
  if (!FILE) throw new Error('cascade: no copyClaims.registry in cascade.config.mjs')
  const registry = JSON.parse(readFileSync(FILE, 'utf8'))
  const byFile = scanClaims()
  const unproven = {}
  for (const [file, claims] of Object.entries(byFile)) {
    const proven = registry.proven.filter(p => p.file === file)
    const left = claims.filter(c => !proven.some(p => c.includes(p.claim)))
    if (left.length) unproven[file] = left
  }
  if (argv.includes('--baseline')) {
    registry.baseline = Object.fromEntries(Object.entries(unproven).map(([f, a]) => [f, a.length]))
    writeFileSync(FILE, `${JSON.stringify(registry, null, 2)}\n`)
    console.log(`Wrote ${FILE}: ${Object.keys(registry.baseline).length} files, ${Object.values(registry.baseline).reduce((a, b) => a + b, 0)} unproven claims.`)
  } else {
    for (const [file, claims] of Object.entries(unproven)) {
      console.log(file)
      for (const c of claims) console.log(`  - ${c}`)
    }
    console.log(`\n${Object.values(unproven).reduce((a, b) => a + b.length, 0)} unproven outcome claims in ${Object.keys(unproven).length} files; ${registry.proven.length} proven.`)
  }
}
