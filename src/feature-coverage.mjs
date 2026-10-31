// Feature coverage: every benefit is marketed and documented, and stays so.
//
// Three checks share these rules, and each runs locally as well as in CI:
//   - every impact-map area names a docs page and a marketing surface (the
//     project's guard test, with areaCoverageProblems);
//   - every change in the release notes, from a given day on, names the docs page
//     and the marketing surface that describe it, and both exist
//     (releaseCoverageProblems);
//   - every commit that touches an area carries a filled-in Cascade: verdict for
//     it (`cascade check-commits <range>`, before a push and over a release).

import { existsSync } from 'node:fs'
import path from 'node:path'
import config from './config.mjs'

const SURFACES = config.surfaces
const kindsWhere = (flag) => Object.entries(SURFACES.kinds).filter(([, k]) => k[flag]).map(([name]) => `${name}:`)
const MARKETING_KINDS = kindsWhere('marketing')
const DOCS_KINDS = kindsWhere('docs')

/** A marketing surface: a marketing kind (a FEATURES card), or a page or component on the website other than the legal pages. */
export function isMarketingSurface(surface) {
  if (MARKETING_KINDS.some((k) => surface.startsWith(k))) return true
  const file = surface.split('#')[0]
  return SURFACES.marketingRoots.some((r) => file.startsWith(r)) && !SURFACES.notMarketing.some((l) => file.startsWith(l))
}

export const isDocsSurface = (surface) => DOCS_KINDS.some((k) => surface.startsWith(k))

/**
 * Areas missing a docs page or a marketing surface, unless listed with a reason.
 * A MARKETING_PENDING entry whose area now has a marketing surface is a problem
 * too, so the list only ever shrinks.
 * @typedef {{ id: string, reason: string }} AreaException
 * @param {readonly { id: string, surfaces: readonly string[] }[]} areas
 * @param {{ notMarketed?: AreaException[], notDocumented?: AreaException[], pending?: AreaException[] }} [lists]
 */
export function areaCoverageProblems(areas, { notMarketed = [], notDocumented = [], pending = [] } = {}) {
  const problems = []
  const ids = new Set(areas.map((a) => a.id))
  const skipMarketing = new Set([...notMarketed, ...pending].map((e) => e.id))
  const skipDocs = new Set(notDocumented.map((e) => e.id))
  for (const list of [notMarketed, notDocumented, pending]) {
    for (const e of list) {
      if (!ids.has(e.id)) problems.push(`${e.id}: listed as an exception but there is no such area`)
      if (!(e.reason ?? '').trim()) problems.push(`${e.id}: an exception needs a reason`)
    }
  }
  for (const a of areas) {
    const marketed = a.surfaces.some(isMarketingSurface)
    if (!a.surfaces.some(isDocsSurface) && !skipDocs.has(a.id)) {
      problems.push(`${a.id}: no help-docs page describes it. Add a ${DOCS_KINDS[0]}<slug> surface (and the page), or list it in NOT_DOCUMENTED with a reason`)
    }
    if (!marketed && !skipMarketing.has(a.id)) {
      problems.push(`${a.id}: nothing on the website markets it. Add a ${MARKETING_KINDS[0]}<key> card or a ${SURFACES.marketingRoots[0]} page to its surfaces, or list it in NOT_MARKETED with a reason`)
    }
    if (marketed && pending.some((e) => e.id === a.id)) {
      problems.push(`${a.id}: now has a marketing surface. Remove it from MARKETING_PENDING`)
    }
  }
  return problems
}

// ── What exists ──────────────────────────────────────────────────────────────

/** Every help-docs page slug (cascade.config.mjs surfaces.docsKeys). */
export function docsSlugs(root = process.cwd()) {
  return SURFACES.docsKeys(root)
}

/** The marketing card keys (cascade.config.mjs surfaces.marketingKeys). */
export function featureKeys(root = process.cwd()) {
  return SURFACES.marketingKeys(root)
}

export function repoFacts(root = process.cwd()) {
  return { docsSlugs: docsSlugs(root), featureKeys: featureKeys(root), exists: (f) => existsSync(path.join(root, f)) }
}

// ── Release notes ────────────────────────────────────────────────────────────

const NONE = /^none:\s*\S/

/** Why a change's `docs` value is not a real help-docs page, or null. */
export function docsValueProblem(value, { docsSlugs }) {
  if (!value || !value.trim()) return 'names no docs page'
  if (NONE.test(value)) return null
  return docsSlugs.has(value) ? null : `docs: "${value}" is not a help-docs page slug`
}

/** Why a change's `marketing` value is not a real marketing surface, or null. */
export function marketingValueProblem(value, { featureKeys, exists }) {
  if (!value || !value.trim()) return 'names no marketing surface'
  if (NONE.test(value)) return null
  const kind = MARKETING_KINDS.find((k) => value.startsWith(k))
  if (kind) return featureKeys.has(value.slice(kind.length)) ? null : `marketing: "${value}" is not ${SURFACES.kinds[kind.slice(0, -1)].noun}`
  if (!isMarketingSurface(value)) return `marketing: "${value}" is not on the website (${MARKETING_KINDS.map((k) => `${k}<key>`).join(', ')}, or a path under ${SURFACES.marketingRoots.join(' or ')} other than ${SURFACES.notMarketingWords})`
  return exists(value.split('#')[0]) ? null : `marketing: "${value}" does not exist`
}

/**
 * Release-note changes from `from` on that don't name a real docs page and marketing
 * surface. The standard SECURITY_UPDATE and FIXES lines are exempt (`exempt`, by title).
 * @param {readonly { id: string, date: string, changes: readonly { title: string, docs?: string, marketing?: string }[] }[]} releases
 * @param {{ docsSlugs: Set<string>, featureKeys: Set<string>, exists: (file: string) => boolean }} facts
 * @param {{ from: string, exempt?: string[] }} options
 */
export function releaseCoverageProblems(releases, facts, { from, exempt = [] }) {
  const problems = []
  for (const r of releases) {
    if (r.date < from) continue
    for (const c of r.changes) {
      if (exempt.includes(c.title)) continue
      for (const p of [docsValueProblem(c.docs, facts), marketingValueProblem(c.marketing, facts)]) {
        if (p) problems.push(`${r.id} "${c.title}": ${p}`)
      }
    }
  }
  return problems
}

// ── Commits ──────────────────────────────────────────────────────────────────

const PLACEHOLDER = /<(?:which|decision|why)>/

/**
 * Why a commit message's Cascade: block does not cover the areas the commit touches,
 * as a list (empty when it does). One `- <area>: <verdict>` line per area, filled in.
 * With `journeyIds` (UAT-WALK, 2026-10-27), one `- journeys: <verdict>` line too,
 * naming each journey the change passes through by id and what was done about it
 * (its automated walk passes, walked on UAT, or pending with why).
 */
export function cascadeMessageProblems(message, areaIds, journeyIds = []) {
  if (!areaIds.length) return []
  const lines = message.split(/\r?\n/)
  const start = lines.findIndex((l) => /^Cascade:\s*$/.test(l.trim()))
  if (start < 0) return [`no Cascade: block (it touches ${areaIds.join(', ')}; run npx cascade impact)`]
  const block = []
  for (const l of lines.slice(start + 1)) {
    if (!l.trim()) break
    block.push(l.trim())
  }
  const problems = []
  for (const id of areaIds) {
    const line = block.find((l) => l.startsWith(`- ${id}:`))
    if (!line) problems.push(`Cascade: has no verdict for ${id}`)
    else if (PLACEHOLDER.test(line) || !line.slice(id.length + 3).trim()) problems.push(`Cascade: verdict for ${id} is not filled in`)
  }
  if (journeyIds.length) {
    const line = block.find((l) => l.startsWith('- journeys:'))
    if (!line) problems.push(`Cascade: has no journeys verdict (it passes through ${journeyIds.join(', ')})`)
    else if (PLACEHOLDER.test(line) || !line.slice('- journeys:'.length).trim()) problems.push('Cascade: journeys verdict is not filled in')
    else {
      const missing = journeyIds.filter((id) => !new RegExp(`\\b${id}\\b`).test(line))
      if (missing.length) problems.push(`Cascade: journeys verdict does not name ${missing.join(', ')}`)
    }
  }
  return problems
}
