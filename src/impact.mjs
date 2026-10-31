// What else has to change? Turns a diff into the list of surfaces to review.
//
//   cascade impact              working tree vs HEAD (incl. untracked)
//   cascade impact --staged     what's staged for the next commit
//   cascade impact --base main  this branch vs main
//   cascade impact <files...>   just these files
//   cascade check-commits <range>
//                               every commit in the range (from config from.cascade on)
//                               that touches an area has a filled-in Cascade: verdict for
//                               it; exits 1 if not (before a push, and over a release)
//   add --json for machine-readable output
//
// It prints, for the change:
//   1. the feature areas it touches (config map), and every docs page, marketing
//      card, email, page and screen that describes them (ticked when in the diff);
//   2. registered facts whose owning constant changed (config facts);
//   3. mobile (config mobile): web/native screen pairs changed on one side only,
//      shared rules whose mirror needs regenerating, API routes installed apps call,
//      and whether the change needs an OTA update or a new native build, plus how
//      many mobile commits haven't reached phones since the last publish;
//   4. the DECISION markers in or next to a changed hunk: behaviour that is there on
//      purpose (decisions.mjs, config decisions.index);
//   5. a Cascade: block to fill in and paste into the commit message.
// Nothing here blocks a commit. check-commits refuses a commit without its block.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { matchesAny } from './glob.mjs'
import {
  decisionMessageProblems,
  decisionsBetween,
  decisionsInCommit,
  decisionsInFiles,
  decisionsInWorktree,
  decisionsTemplate,
  DECISIONS_FROM,
} from './decisions.mjs'
import config, { fileOf, load } from './config.mjs'
import { cascadeMessageProblems } from './feature-coverage.mjs'
import { journeysForAreas } from './journeys.mjs'

// The project's map, live surfaces and shared modules (cascade.config.mjs); each optional.
const { AREAS = [], HUBS = [], NATIVE_BUILD_TRIGGERS = [], SCREEN_PAIRS = [] } = config.map ? await load(config.map) : {}
const isLiveSurface = config.surfaces.live ? await load(config.surfaces.live) : () => false
const MOBILE = config.mobile
const SHARED = MOBILE?.shared ?? null
const SHARED_MODULES = SHARED ? await load(SHARED.modules) : []
const KINDS = config.surfaces.kinds
// The mirror of the shared modules is generated, so walks never read it.
const MIRROR_DIR = SHARED ? path.posix.basename(SHARED.to) : null

const toPosix = (p) => p.split(path.sep).join('/')
/** The kind of a `<kind>:<key>` surface (cascade.config.mjs surfaces.kinds), or null for a file. */
const kindOf = (s) => {
  const kind = s.slice(0, s.indexOf(':'))
  return Object.hasOwn(KINDS, kind) ? kind : null
}

// ── Mobile API surface ───────────────────────────────────────────────────────

function walkFiles(root, rel, test, out = []) {
  let entries
  try {
    entries = readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const child = `${rel}/${e.name}`
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== MIRROR_DIR) walkFiles(root, child, test, out)
    } else if (test(child)) out.push(child)
  }
  return out
}

/** `/api/...` paths the native app calls, with template expressions as `:param`
 *  and any query-string suffix dropped. Derived from source on every run. */
export function apiPathsCalledByMobile(root = process.cwd()) {
  const files = (MOBILE?.callers ?? [])
    .flatMap((d) => walkFiles(root, d, (f) => /\.(ts|tsx)$/.test(f)))
  const paths = new Set()
  for (const f of files) {
    const text = readFileSync(path.join(root, f), 'utf8')
    for (const m of text.matchAll(/[`'"](\/api\/[^`'"\s]*)/g)) {
      let p = m[1]
        .replace(/\$\{[^}]*\}$/, '') // trailing ${qs}: a query string
        .replace(/\$\{[^}]*\}/g, ':param')
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
      if (p.includes('*') || p === '/api') continue // prose in a comment
      paths.add(p)
    }
  }
  return [...paths].sort()
}

/** Every route handler under the app's api folder, as { file, segments }. */
export function apiRoutes(root = process.cwd()) {
  if (!config.api) return []
  const app = config.api.appDir
  return walkFiles(root, `${app}/api`, (f) => /\/route\.(ts|tsx|js)$/.test(f)).map((file) => ({
    file,
    segments: file.slice(app.length + 1).replace(/\/route\.(ts|tsx|js)$/, '').split('/'),
  }))
}

/** The route file that serves an `/api/...` path the app calls, or null. */
export function routeForApiPath(apiPath, routes) {
  const want = apiPath.replace(/^\//, '').split('/')
  const score = (segs) => {
    if (segs.length !== want.length && !segs.some((s) => s.startsWith('[...'))) return -1
    let exact = 0
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]
      if (s.startsWith('[...')) return exact
      const w = want[i]
      if (w === undefined) return -1
      if (s.startsWith('[')) continue
      if (w === ':param' || s !== w) return -1
      exact++
    }
    return exact
  }
  let best = null
  let bestScore = -1
  for (const r of routes) {
    const s = score(r.segments)
    if (s > bestScore) {
      best = r
      bestScore = s
    }
  }
  return best ? best.file : null
}

// ── Analysis ─────────────────────────────────────────────────────────────────

/** Facts whose owning module changed, read from the registry's `source` fields. */
export function factSources(root = process.cwd()) {
  const out = new Map()
  if (!config.facts) return out
  const text = readFileSync(path.join(root, config.facts), 'utf8')
  const re = /id:\s*'([^']+)'[\s\S]*?source:\s*'([^' ]+\/[^' ]+)/g
  for (const m of text.matchAll(re)) {
    const list = out.get(m[2]) ?? []
    list.push(m[1])
    out.set(m[2], list)
  }
  return out
}

function hubAreas(hub, diffText) {
  const changed = (diffText ?? '')
    .split('\n')
    .filter((l) => /^[+-](?![+-])/.test(l) || l.startsWith('@@'))
    .join('\n')
  const hit = new Set()
  for (const [symbol, areas] of Object.entries(hub.symbols)) {
    if (new RegExp(`\\b${symbol}\\b`).test(changed)) areas.forEach((a) => hit.add(a))
  }
  return hit.size ? [...hit] : hub.fallback
}

/**
 * The cascade for a change. `files` are repo-relative paths; `hubDiffs` maps a hub
 * file to its unified diff text (so a certflow.ts change can be narrowed to the
 * symbols it touches). Pure apart from reading the repo for mobile API paths.
 * @param {{ files: string[], hubDiffs?: Record<string, string>, root?: string, mobileApi?: string[] }} options
 */
export function analyseChange({ files, hubDiffs = {}, root = process.cwd(), mobileApi }) {
  const changed = [...new Set(files.map(toPosix))]
  const inDiff = new Set(changed)

  // 1. Areas.
  const areaReasons = new Map()
  const note = (id, why) => {
    const list = areaReasons.get(id) ?? []
    if (!list.includes(why)) list.push(why)
    areaReasons.set(id, list)
  }
  for (const f of changed) {
    const hub = HUBS.find((h) => h.file === f)
    if (hub) {
      for (const a of hubAreas(hub, hubDiffs[f])) note(a, `${f} (shared module)`)
      continue
    }
    for (const area of AREAS) if (matchesAny(f, area.code)) note(area.id, f)
  }
  const areas = AREAS.filter((a) => areaReasons.has(a.id)).map((a) => ({
    id: a.id,
    name: a.name,
    because: areaReasons.get(a.id),
    surfaces: a.surfaces.map((s) => {
      const file = kindOf(s) ? null : s.split('#')[0]
      return { surface: s, inDiff: file ? inDiff.has(file) : false }
    }),
  }))

  // 2. Facts.
  const sources = factSources(root)
  const facts = changed.flatMap((f) => (sources.get(f) ?? []).map((id) => ({ id, source: f })))

  // 3. Mobile.
  const pairs = []
  for (const pair of SCREEN_PAIRS) {
    const webHit = changed.filter((f) => matchesAny(f, pair.web))
    const nativeHit = changed.filter((f) => matchesAny(f, pair.native))
    if (webHit.length && !nativeHit.length) pairs.push({ name: pair.name, changed: 'web', missing: pair.native, files: webHit })
    if (nativeHit.length && !webHit.length) pairs.push({ name: pair.name, changed: 'native', missing: pair.web, files: nativeHit })
  }
  const { from, to } = SHARED ?? {}
  const sharedSources = SHARED ? changed.filter((f) => SHARED_MODULES.some((m) => f === `${from}/${m}`)) : []
  const mirrorsInDiff = sharedSources.filter((f) => inDiff.has(`${to}/${f.slice(from.length + 1)}`))
  const apiPaths = mobileApi ?? apiPathsCalledByMobile(root)
  const routes = apiRoutes(root)
  const calledRoutes = new Map()
  for (const p of apiPaths) {
    const r = routeForApiPath(p, routes)
    if (r) calledRoutes.set(r, [...(calledRoutes.get(r) ?? []), p])
  }
  const apiChanges = changed.filter((f) => calledRoutes.has(f)).map((f) => ({ route: f, calledAs: calledRoutes.get(f) }))
  const mobileFiles = MOBILE ? changed.filter((f) => f.startsWith(`${MOBILE.root}/`)) : []
  const release = mobileFiles.length
    ? (changed.some((f) => matchesAny(f, NATIVE_BUILD_TRIGGERS)) ? 'native-build' : 'ota-update')
    : null

  return {
    files: changed,
    areas,
    facts,
    mobile: {
      pairs,
      sharedSources: sharedSources.map((f) => ({ source: f, mirrorInDiff: mirrorsInDiff.includes(f) })),
      apiChanges,
      release,
    },
    liveSurfacesEdited: changed.filter((f) => isLiveSurface(f)),
  }
}

// ── Output ───────────────────────────────────────────────────────────────────

const describeSurface = (s) => {
  const kind = kindOf(s)
  return kind ? KINDS[kind].describe(s.slice(kind.length + 1)) : s
}

export function formatReport(report, releaseStatus) {
  const out = []
  if (!report.files.length) return 'No changes.'
  out.push(`Change cascade for ${report.files.length} file(s)\n`)

  if (report.areas.length) {
    out.push('SURFACES TO REVIEW (edit each, or confirm it is still true)')
    for (const a of report.areas) {
      out.push(`\n  ${a.name} [${a.id}]  <- ${a.because.slice(0, 3).join(', ')}${a.because.length > 3 ? ', ...' : ''}`)
      for (const s of a.surfaces) out.push(`    [${s.inDiff ? 'x' : ' '}] ${describeSurface(s.surface)}`)
    }
    out.push('\n  A new feature or a new benefit is not "still true": it ships with its help-docs page and its')
    out.push('  marketing surface updated in the same change, and its release note names both (docs, marketing).')
  } else {
    out.push('No feature area touched (tooling, content or docs only).')
  }

  if (report.facts.length) {
    out.push(`\nFACTS: an owning constant changed. ${config.factsCheck ?? 'The fact scan'} names every surface that disagrees:`)
    for (const f of report.facts) out.push(`  - ${f.id} (${f.source})`)
  }

  const m = report.mobile
  const mobileLines = []
  for (const p of m.pairs) {
    mobileLines.push(`  - ${p.name}: ${p.changed} side changed only (${p.files.slice(0, 2).join(', ')}). Mirror it in ${p.changed === 'web' ? `${MOBILE.root}/` : 'the web app'}, or record the divergence as deliberate in ${MOBILE.divergences} (${MOBILE.rule}).`)
  }
  for (const s of m.sharedSources) {
    mobileLines.push(`  - ${s.source} is shared with the native app: ${s.mirrorInDiff ? 'mirror regenerated.' : `run \`${SHARED.run}\` and commit ${SHARED.to}.`}`)
  }
  for (const a of m.apiChanges) {
    mobileLines.push(`  - ${a.route} is called by installed apps (${a.calledAs.join(', ')}). Keep it backward compatible: phones run older builds for weeks.`)
  }
  if (m.release === 'ota-update') mobileLines.push(`  - Release: JavaScript-only mobile change. Publish an OTA update after the web deploy (${MOBILE.releaseStep}).`)
  if (m.release === 'native-build') mobileLines.push(`  - Release: native config or dependencies changed. Needs a new build plus ${MOBILE.uploadScript} (${MOBILE.releaseStep}).`)
  if (mobileLines.length) {
    out.push('\nMOBILE')
    out.push(...mobileLines)
  }
  const decisions = report.decisions ?? { touched: [], removed: [], added: [] }
  const decided = [...new Map([...decisions.touched, ...decisions.removed].map((d) => [`${d.id}|${d.file}|${d.rule}`, d])).values()]
  if (decided.length) {
    const removed = new Set(decisions.removed.map((d) => d.id))
    out.push(`\nDECISIONS: this change is in or next to behaviour that is there on purpose (${config.decisions.index}).`)
    out.push(`  Keep each, or change it only with the ${config.approver}'s word, quoted in the Cascade: line.`)
    for (const d of decided) {
      out.push(`  DECISION(${d.id}) ${d.file}:${d.line}${removed.has(d.id) ? '  [marker removed or reworded]' : ''}`)
      out.push(`    ${d.rule} — ${d.why} (${d.who}, ${d.date})`)
    }
  }
  const journeys = journeysForAreas(report.areas.map((a) => a.id))
  if (journeys.length) {
    out.push(`\nJOURNEYS THIS CHANGE PASSES THROUGH (${fileOf(config.journeys)}): run each automated walk, or walk it on UAT before release`)
    for (const j of journeys) out.push(`  ${j.id} (importance ${j.importance}) ${j.name}${j.spec ? `  [automated: ${j.spec}]` : '  [walk on UAT]'}`)
  }
  if (releaseStatus) out.push(`\n${releaseStatus}`)

  out.push('\nPaste into the commit message, one verdict per area (name any surface updated or left pending):')
  out.push('  Cascade:')
  for (const a of report.areas) {
    const open = a.surfaces.filter((s) => !s.inDiff).length
    out.push(`  - ${a.id}: ${open ? `reviewed ${open} surface(s), still true` : 'all surfaces edited in this diff'} | updated: <which> | pending: <which> (<decision>)`)
  }
  for (const p of m.pairs) out.push(`  - mobile "${p.name}": mirrored | deliberate, recorded in ${MOBILE.divergences}`)
  if (journeys.length) out.push(`  - journeys: ${journeys.map((j) => j.id).join(', ')}: automated walks pass | walked on UAT | pending (<why>)`)
  if (m.release) out.push(`  - mobile release: ${m.release === 'ota-update' ? 'OTA update published' : 'new build uploaded'} | pending (<why>)`)
  const decisionsLine = decisionsTemplate(decisions)
  if (decisionsLine) out.push(`  ${decisionsLine}`)
  if (!report.areas.length && !m.pairs.length && !m.release && !decisionsLine) out.push('  - none')
  return out.join('\n')
}

// ── Git and CLI ──────────────────────────────────────────────────────────────

function git(args, root) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function changedFiles(mode, base, root) {
  const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)
  if (mode === 'staged') return lines(git(['diff', '--cached', '--name-only'], root))
  if (mode === 'base') return lines(git(['diff', '--name-only', `${base}...HEAD`], root))
  return [...new Set([...lines(git(['diff', '--name-only', 'HEAD'], root)), ...lines(git(['ls-files', '--others', '--exclude-standard'], root))])]
}

function hubDiffsFor(files, mode, base, root) {
  const out = {}
  for (const hub of HUBS) {
    if (!files.includes(hub.file)) continue
    const args = mode === 'staged' ? ['diff', '--cached', '-U0', '--', hub.file]
      : mode === 'base' ? ['diff', '-U0', `${base}...HEAD`, '--', hub.file]
        : ['diff', '-U0', 'HEAD', '--', hub.file]
    out[hub.file] = git(args, root)
  }
  return out
}

/** How many commits touching mobile/ haven't reached phones since the last publish tag. */
export function mobileReleaseStatus(root = process.cwd()) {
  if (!MOBILE) return null
  const tag = git(['describe', '--tags', '--abbrev=0', '--match', MOBILE.publishTag], root)
  const version = (() => {
    try {
      return JSON.parse(readFileSync(path.join(root, MOBILE.appConfig), 'utf8')).expo?.version ?? '?'
    } catch {
      return '?'
    }
  })()
  if (tag) {
    const n = Number(git(['rev-list', '--count', `${tag}..HEAD`, '--', `${MOBILE.root}/`], root) || 0)
    return n
      ? `MOBILE RELEASE: ${n} commit(s) touching ${MOBILE.root}/ since ${tag} have not reached phones.`
      : `MOBILE RELEASE: phones are current as of ${tag}.`
  }
  const since = git(['log', '-1', '--format=%h %ad', '--date=short', '--', MOBILE.appConfig], root)
  const n = since ? Number(git(['rev-list', '--count', `${since.split(' ')[0]}..HEAD`, '--', `${MOBILE.root}/`], root) || 0) : 0
  return `MOBILE RELEASE: no publish recorded (no ${MOBILE.publishTag} tag). Native build ${version} (${path.posix.basename(MOBILE.appConfig)}, ${since || 'unknown'}); ${n} commit(s) have touched ${MOBILE.root}/ since, with no record that they reached phones.`
}

// Commits before this day predate the check (config from.cascade; none: the check is off).
export const CASCADE_FROM = config.from.cascade ?? null
/** Commits from this day name the journeys they pass through (config from.journeys). */
export const JOURNEYS_FROM = config.from.journeys ?? null
const RELEASE_NOTES_DATA = config.releaseNotes

/**
 * Commits in `range` (git revision range, merges skipped) committed on or after
 * CASCADE_FROM whose message does not cover the areas they touch, as
 * [{ sha, subject, problems }].
 */
export function commitCascadeProblems(range, root = process.cwd(), from = CASCADE_FROM) {
  if (!from) return []
  // Not git(): an unknown range must fail loudly, never pass as "no commits".
  const shas = execFileSync('git', ['log', '--no-merges', '--reverse', `--since=${from}T00:00:00`, '--format=%H', range, '--'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n').map((l) => l.trim()).filter(Boolean)
  const out = []
  for (const sha of shas) {
    const files = git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha], root).split('\n').filter(Boolean)
    const hubDiffs = {}
    for (const hub of HUBS) if (files.includes(hub.file)) hubDiffs[hub.file] = git(['show', '-U0', '--format=', sha, '--', hub.file], root)
    const report = analyseChange({ files, hubDiffs, root, mobileApi: [] })
    // Writing the release notes is the releases area's own job, not a change to it.
    const areas = report.areas.filter((a) => !a.because.every((f) => RELEASE_NOTES_DATA.includes(f)))
    const day = git(['log', '-1', '--format=%cs', sha], root)
    const journeyIds = JOURNEYS_FROM && day >= JOURNEYS_FROM ? journeysForAreas(areas.map((a) => a.id)).map((j) => j.id) : []
    const message = git(['log', '-1', '--format=%B', sha], root)
    const problems = cascadeMessageProblems(message, areas.map((a) => a.id), journeyIds)
    // A commit that changes marked code says it kept each decision, or quotes who
    // changed it (decisions.mjs).
    if (DECISIONS_FROM && day >= DECISIONS_FROM) problems.push(...decisionMessageProblems(message, decisionsInCommit(sha, root)))
    if (problems.length) out.push({ sha, subject: git(['log', '-1', '--format=%s', sha], root), problems })
  }
  return out
}

export function main(argv) {
  const root = process.cwd()
  const json = argv.includes('--json')
  const args = argv.filter((a) => a !== '--json')
  if (args[0] === '--check-commits') {
    const range = args[1] ?? 'origin/main..HEAD'
    let bad
    try {
      bad = commitCascadeProblems(range, root)
    } catch (e) {
      console.error(`Cannot read the commits in ${range}: ${String(e.stderr || e.message).trim()}`)
      process.exit(2)
    }
    if (json) console.log(JSON.stringify(bad, null, 2))
    else if (!bad.length) console.log(`Cascade OK: every commit in ${range} that touches an area has its verdict.`)
    else {
      console.error(`Cascade missing in ${bad.length} commit(s) of ${range} (reword before pushing; run npx cascade impact <files> for the block):`)
      for (const b of bad) console.error(`  ${b.sha.slice(0, 7)} ${b.subject}\n    - ${b.problems.join('\n    - ')}`)
    }
    process.exit(bad.length ? 1 : 0)
  }
  let mode = 'worktree'
  let base = null
  let files
  if (args[0] === '--staged') mode = 'staged'
  else if (args[0] === '--base') {
    mode = 'base'
    base = args[1] ?? 'main'
  } else if (args.length) files = args.map(toPosix)
  files ??= changedFiles(mode, base, root)
  const hubDiffs = files ? hubDiffsFor(files, mode, base, root) : {}
  const report = analyseChange({ files, hubDiffs, root })
  // A file list has no hunks: every decision anchored in those files is in play.
  report.decisions = args.length && mode === 'worktree' ? { touched: decisionsInFiles(files, root), removed: [], added: [] }
    : mode === 'base' ? decisionsBetween(git(['merge-base', base, 'HEAD'], root), 'HEAD', root)
      : decisionsInWorktree({ staged: mode === 'staged', root })
  const touchesMobile = Boolean(MOBILE) && (report.files.some((f) => f.startsWith(`${MOBILE.root}/`)) || report.mobile.sharedSources.length > 0)
  const status = touchesMobile || !report.files.length ? mobileReleaseStatus(root) : null
  if (json) console.log(JSON.stringify({ ...report, mobileReleaseStatus: status }, null, 2))
  else console.log(formatReport(report, status))
}

