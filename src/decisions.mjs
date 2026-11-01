// Decisions: "is anything we are about to change there on purpose?"
//
// A deliberate behaviour carries a marker comment right above the code that
// implements it, in the web app, the native app, shared rules or a migration:
//
//   // DECISION(<ID>): <the rule> — <why> (<who>, <YYYY-MM-DD>)
//
// The ID is the existing one where there is one (a rule or ticket id); the same
// decision anchored in several places shares its ID. A
// marker may run over several comment lines; it ends at the `(<who>, <date>)`.
// `--` (SQL) and JSX `{/* */}` comments work the same way.
//
// Four things read the markers, all through this module:
//   - `cascade decisions` writes the index (config decisions.index);
//   - the project's guard test: every marker has a test whose title names it as
//     DECISION(<ID>), every such title has a marker, the index is current;
//   - `cascade impact` (and --staged, check-commits) lists the markers in or next
//     to each changed hunk, and the commit's Cascade: block says `- decisions: kept
//     <IDs>` or `changed <ID> (<approver>, <date>: "<words>")`;
//   - `cascade decisions --proposal <file>` looks up a proposed change before any
//     code is written.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import config, { listWords } from './config.mjs'
import { cascadeBlock } from './feature-coverage.mjs'

export const DECISION_ROOTS = config.decisions.roots
export const TEST_ROOTS = config.decisions.tests
export const INDEX_FILE = config.decisions.index
/** Commits from this day carry a `- decisions:` line when they change marked code. */
export const DECISIONS_FROM = config.from.decisions ?? null
const APPROVER = config.approver
/** A marker this many lines above a hunk (or 3 below it) is "next to" the change. */
export const NEAR_ABOVE = 20
export const NEAR_BELOW = 3

// Generated copies (cascade.config.mjs decisions.skip) would duplicate their source's markers.
const SKIP_DIRS = new Set(['node_modules', '.next', '.expo', 'dist', 'build', 'android', 'ios', 'coverage'])
const SKIP_PATHS = new Set(config.decisions.skip)
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|sql)$/

const toPosix = (p) => p.split(path.sep).join('/')

/** True when a repo-relative path is scanned for markers. */
export function isDecisionFile(file) {
  const f = toPosix(file)
  if (!CODE.test(f)) return false
  if ([...SKIP_PATHS].some((s) => f === s || f.startsWith(`${s}/`))) return false
  if (f.split('/').some((seg) => SKIP_DIRS.has(seg))) return false
  return DECISION_ROOTS.some((r) => f.startsWith(`${r}/`))
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const START = /DECISION\(([^()\n]+)\):/
const TAIL = /\(([^(),]+),\s*(\d{4}-\d{2}-\d{2})\)\s*$/
const MAX_LINES = 8

/** A comment line's text with its comment syntax removed, or null when it isn't a comment. */
function commentText(line) {
  const m = line.match(/^\s*(?:\{\s*)?(?:\/\/+|\/\*+|\*+(?!\/)|--)\s?(.*)$/)
  if (!m) return null
  return m[1].replace(/\s*\*\/\s*\}?\s*$/, '').trimEnd()
}

/**
 * The markers in one file's text, with 1-based line numbers, and the lines that
 * start a marker but don't parse (so a typo can't drop a decision silently).
 * @returns {{ markers: Marker[], malformed: { file: string, line: number, text: string, problem: string }[] }}
 * @typedef {{ id: string, rule: string, why: string, who: string, date: string, file: string, line: number }} Marker
 */
export function parseMarkers(text, file = '') {
  const lines = text.split(/\r?\n/)
  const markers = []
  const malformed = []
  for (let i = 0; i < lines.length; i++) {
    const first = commentText(lines[i])
    if (first == null || !START.test(first)) continue
    const parts = [first.slice(first.search(START))]
    let j = i
    while (!TAIL.test(parts.join(' ')) && j + 1 < lines.length && j - i < MAX_LINES) {
      const next = commentText(lines[j + 1])
      if (next == null || START.test(next)) break
      parts.push(next.trim())
      j++
    }
    const whole = parts.join(' ').replace(/\s+/g, ' ').trim()
    const id = whole.match(START)[1].trim()
    const tail = whole.match(TAIL)
    const body = whole.slice(whole.indexOf(':', whole.indexOf(')')) + 1, tail ? tail.index : undefined).trim()
    const sep = body.indexOf(' — ')
    let problem = null
    if (!tail) problem = 'does not end with (<who>, <YYYY-MM-DD>)'
    else if (sep < 0) problem = 'has no " — " between the rule and why'
    else if (!body.slice(0, sep).trim() || !body.slice(sep + 3).trim()) problem = 'has an empty rule or why'
    if (problem) {
      malformed.push({ file, line: i + 1, text: whole, problem })
      continue
    }
    markers.push({
      id,
      rule: body.slice(0, sep).trim(),
      why: body.slice(sep + 3).trim(),
      who: tail[1].trim(),
      date: tail[2],
      file,
      line: i + 1,
    })
    i = j
  }
  return { markers, malformed }
}

// ── The tree ─────────────────────────────────────────────────────────────────

// Byte order, not locale or the file system's: NTFS and ext4 list a folder differently, and the
// index must come out the same on Windows and on a Linux runner.
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function walk(root, rel, test, out = []) {
  let entries
  try {
    entries = readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries.sort((a, b) => byPath(a.name, b.name))) {
    const child = `${rel}/${e.name}`
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !SKIP_PATHS.has(child)) walk(root, child, test, out)
    } else if (test(child)) out.push(child)
  }
  return out
}

/** Every marker in the tree (and the malformed ones), sorted by file and line. */
export function scanMarkers(root = process.cwd(), read = (f) => readFileSync(path.join(root, f), 'utf8')) {
  const markers = []
  const malformed = []
  for (const r of DECISION_ROOTS) {
    for (const f of walk(root, r, isDecisionFile)) {
      const text = read(f)
      if (!text.includes('DECISION(')) continue
      const parsed = parseMarkers(text, f)
      markers.push(...parsed.markers)
      malformed.push(...parsed.malformed)
    }
  }
  const order = (a, b) => byPath(a.file, b.file) || a.line - b.line
  return { markers: markers.sort(order), malformed: malformed.sort(order) }
}

const TITLE = /\b(?:it|test)(?:\.(?:skip|only|todo|concurrent|fails))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
const NAMED = /DECISION\(([^()\n]+)\)/g

/** Decision IDs named in test titles as DECISION(<ID>), as id -> [{ file, line, title }]. */
export function testPins(root = process.cwd(), read = (f) => readFileSync(path.join(root, f), 'utf8')) {
  const pins = new Map()
  for (const r of TEST_ROOTS) {
    for (const f of walk(root, r, (c) => /\.(test|spec)\.(ts|tsx|mjs|js)$/.test(c))) {
      const text = read(f)
      if (!text.includes('DECISION(')) continue
      for (const m of text.matchAll(TITLE)) {
        for (const n of m[2].matchAll(NAMED)) {
          const id = n[1].trim()
          const line = text.slice(0, m.index).split('\n').length
          pins.set(id, [...(pins.get(id) ?? []), { file: f, line, title: m[2] }])
        }
      }
    }
  }
  return pins
}

/** Group markers by ID, keeping first-seen order. */
export function byId(markers) {
  const out = new Map()
  for (const m of markers) out.set(m.id, [...(out.get(m.id) ?? []), m])
  return out
}

/** Every way the markers and their pins disagree, as sentences. */
export function decisionProblems({ markers, malformed }, pins) {
  const problems = malformed.map((m) => `${m.file}:${m.line}: a DECISION marker ${m.problem}: ${m.text}`)
  const ids = byId(markers)
  for (const [id, anchors] of ids) {
    if (!pins.has(id)) problems.push(`DECISION(${id}) at ${anchors.map((a) => `${a.file}:${a.line}`).join(', ')} has no test: name it in a test title as DECISION(${id})`)
  }
  for (const [id, where] of pins) {
    if (!ids.has(id)) problems.push(`${where.map((w) => `${w.file}:${w.line}`).join(', ')} names DECISION(${id}) but no code carries that marker`)
  }
  return problems
}

/** The message a pin fails with: why the behaviour is there on purpose. */
export function deliberateMessage(id, markers) {
  const m = markers.find((x) => x.id === id)
  return m ? `deliberate: see DECISION ${id}, ${m.why} (${m.who}, ${m.date}; ${INDEX_FILE})` : `deliberate: see DECISION ${id} (no marker found)`
}

// ── The index ────────────────────────────────────────────────────────────────

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

/** The index (cascade.config.mjs decisions.index) for these markers and pins. */
export function renderIndex(markers, pins) {
  const ids = byId(markers)
  const out = [
    '# Decisions',
    '',
    `Generated by \`npx cascade decisions\` from the \`DECISION(<ID>)\` markers in ${listWords(DECISION_ROOTS.map((r) => `\`${r}/\``))}.`,
    'Do not edit: change the marker and regenerate.',
    `Each behaviour here is there on purpose; changing one needs the ${APPROVER}'s word and a`,
    `\`- decisions: changed <ID> (${APPROVER}, <date>: "<words>")\` line in the commit's \`Cascade:\``,
    config.design.decisions ? `block (${config.design.decisions}).` : 'block.',
    '',
    `${ids.size} decision(s), ${markers.length} marker(s).`,
    '',
    '| ID | Rule | Why | Who, date | Where | Pinned by |',
    '|----|------|-----|-----------|-------|-----------|',
  ]
  const sorted = [...ids.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
  for (const [id, anchors] of sorted) {
    const first = anchors[0]
    const rules = [...new Set(anchors.map((a) => a.rule))]
    const where = anchors.map((a) => `\`${a.file}:${a.line}\``).join('<br>')
    const pinned = (pins.get(id) ?? []).map((p) => `\`${p.file}:${p.line}\``).join('<br>') || '**none**'
    out.push(`| ${cell(id)} | ${cell(rules.join(' / '))} | ${cell(first.why)} | ${cell(`${first.who}, ${first.date}`)} | ${where} | ${pinned} |`)
  }
  return `${out.join('\n')}\n`
}

/** The index with line numbers removed: what must match for the index to be current. */
export const indexShape = (text) => text.replace(/\r\n/g, '\n').replace(/(`[^`:\s]+):\d+`/g, '$1`')

// ── Diffs ────────────────────────────────────────────────────────────────────

/**
 * Changed line ranges per file from a `-U0` unified diff, on both sides:
 * { file: { old: [[from, to]], new: [[from, to]], oldPath } }. A pure deletion has
 * an empty new range anchored at the line before it (and the reverse for an insertion).
 * @param {string | null | undefined} diffText
 * @returns {Record<string, Hunks>}
 * @typedef {{ old: number[][], new: number[][], oldPath: string | null }} Hunks
 */
export function parseHunks(diffText) {
  /** @type {Record<string, Hunks>} */
  const out = {}
  let cur = null
  let oldPath = null
  for (const line of (diffText ?? '').split('\n')) {
    if (line.startsWith('--- ')) {
      oldPath = line.slice(4).replace(/^a\//, '').trim()
      continue
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim()
      const file = p === '/dev/null' ? oldPath : p.replace(/^b\//, '')
      cur = out[file] ??= { old: [], new: [], oldPath: oldPath === '/dev/null' ? null : oldPath }
      continue
    }
    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (h && cur) {
      const [os, oc, ns, nc] = [Number(h[1]), h[2] === undefined ? 1 : Number(h[2]), Number(h[3]), h[4] === undefined ? 1 : Number(h[4])]
      cur.old.push(oc ? [os, os + oc - 1] : [os, os])
      cur.new.push(nc ? [ns, ns + nc - 1] : [ns, ns])
    }
  }
  return out
}

const near = (line, ranges) => ranges.some(([from, to]) => line >= from - NEAR_ABOVE && line <= to + NEAR_BELOW)

/**
 * The decisions a change touches. `files` are { file, old, new, hunks } where old/new
 * are the file's text before and after (null when absent) and hunks its changed
 * ranges (null: the whole file, as for a proposal or a file list).
 * Returns { touched: Marker[], removed: Marker[], added: Marker[] }:
 *   touched  markers in or next to a hunk, on either side;
 *   removed  markers on the old side whose ID and rule no longer appear anywhere in
 *            the new side of the change (deleted or reworded: only `changed` covers it);
 *   added    markers new to the change (a decision being recorded).
 */
export function decisionsInChange(files) {
  const touched = []
  const before = []
  const after = []
  for (const f of files) {
    const oldM = f.old != null ? parseMarkers(f.old, f.oldPath ?? f.file).markers : []
    const newM = f.new != null ? parseMarkers(f.new, f.file).markers : []
    before.push(...oldM)
    after.push(...newM)
    if (!f.hunks) touched.push(...newM, ...oldM)
    else {
      touched.push(...newM.filter((m) => near(m.line, f.hunks.new)), ...oldM.filter((m) => near(m.line, f.hunks.old)))
    }
  }
  const key = (m) => `${m.id}\u0000${m.rule}`
  const afterKeys = new Set(after.map(key))
  const beforeKeys = new Set(before.map(key))
  const uniq = (list) => [...new Map(list.map((m) => [key(m), m])).values()]
  return {
    touched: uniq(touched),
    removed: uniq(before.filter((m) => !afterKeys.has(key(m)))),
    added: uniq(after.filter((m) => !beforeKeys.has(key(m)))),
  }
}

// ── Git ──────────────────────────────────────────────────────────────────────

function git(args, root) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

/** Files among `files` that hold a marker at `rev` (one git call). */
function filesWithMarkers(rev, files, root) {
  if (!files.length) return new Set()
  const out = git(['grep', '-l', '-F', 'DECISION(', rev, '--', ...files], root) ?? ''
  return new Set(out.split('\n').filter(Boolean).map((l) => l.slice(l.indexOf(':') + 1)))
}

/**
 * The decisions touched between two commits (`from` null: everything in `to` is new).
 * Reads only the files that hold a marker on either side, so a release's worth of
 * commits stays quick.
 */
export function decisionsBetween(from, to, root = process.cwd()) {
  const diff = (from ? git(['diff', '-U0', '--no-renames', from, to, '--'], root) : git(['show', '-U0', '--no-renames', '--format=', to], root)) ?? ''
  const hunks = parseHunks(diff)
  const files = Object.keys(hunks).filter(isDecisionFile)
  const oldHas = from ? filesWithMarkers(from, files, root) : new Set()
  const newHas = filesWithMarkers(to, files, root)
  const list = files.filter((f) => oldHas.has(f) || newHas.has(f)).map((f) => ({
    file: f,
    old: oldHas.has(f) ? git(['show', `${from}:${f}`], root) : null,
    new: newHas.has(f) ? git(['show', `${to}:${f}`], root) : null,
    hunks: hunks[f],
  }))
  return decisionsInChange(list)
}

/** The decisions a commit touches (against its first parent). */
export function decisionsInCommit(sha, root = process.cwd()) {
  const parent = git(['rev-parse', '--verify', '--quiet', `${sha}^`], root)?.trim() || null
  return decisionsBetween(parent, sha, root)
}

/**
 * The decisions an uncommitted change touches: `staged` compares the index with
 * HEAD, otherwise the working tree (untracked files included) with HEAD.
 */
export function decisionsInWorktree({ staged = false, root = process.cwd() } = {}) {
  const diff = git(['diff', '-U0', '--no-renames', ...(staged ? ['--cached'] : ['HEAD']), '--'], root) ?? ''
  const hunks = parseHunks(diff)
  if (!staged) {
    const untracked = (git(['ls-files', '--others', '--exclude-standard'], root) ?? '').split('\n').filter(Boolean)
    for (const f of untracked) hunks[f] ??= { old: [], new: [[1, Number.MAX_SAFE_INTEGER]], oldPath: null }
  }
  const files = Object.keys(hunks).filter(isDecisionFile)
  const readNew = (f) => (staged ? git(['show', `:${f}`], root) : (() => {
    try {
      return readFileSync(path.join(root, f), 'utf8')
    } catch {
      return null
    }
  })())
  return decisionsInChange(files.map((f) => ({ file: f, old: git(['show', `HEAD:${f}`], root), new: readNew(f), hunks: hunks[f] })))
}

/** The decisions anchored anywhere in these files as they are now (a file list, or a proposal). */
export function decisionsInFiles(files, root = process.cwd()) {
  const list = files.map(toPosix).filter(isDecisionFile).map((f) => {
    let text = null
    try {
      text = readFileSync(path.join(root, f), 'utf8')
    } catch { /* a file the proposal would create */ }
    return { file: f, old: text, new: text, hunks: null }
  })
  return decisionsInChange(list).touched
}

// ── The Cascade: line ────────────────────────────────────────────────────────

const PLACEHOLDER = /<(?:IDs?|date|words|why)>/
const APPROVAL = /^\s*\(\s*[^,()]+,\s*\d{4}-\d{2}-\d{2}\s*:\s*"[^"]+"\s*\)/

/** Where `id` appears in `line` as a whole ID (not a prefix of a longer one), or -1. */
function findId(line, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(?<![A-Za-z0-9-])${esc}(?![A-Za-z0-9])`).exec(line)
  return m ? m.index : -1
}

/**
 * Why a commit message does not account for the decisions its change touches
 * (empty when it does). The Cascade: block needs one `- decisions:` line naming
 * every touched ID as `kept <ID>` (or `added <ID>` for a marker being recorded),
 * or `changed <ID> (<who>, <YYYY-MM-DD>: "<their words>")`. A decision whose marker
 * the change removes or rewords can only be `changed`.
 * @param {string} message
 * @param {{ touched: { id: string }[], removed?: { id: string }[] }} change
 */
export function decisionMessageProblems(message, { touched, removed = [] }) {
  const ids = [...new Set([...touched, ...removed].map((m) => m.id))]
  if (!ids.length) return []
  const block = cascadeBlock(message)
  if (!block) return [`no Cascade: block (it changes code marked DECISION ${ids.join(', ')}; run npx cascade impact)`]
  const line = block.find((l) => l.startsWith('- decisions:'))
  if (!line) return [`Cascade: has no decisions verdict (it changes code marked DECISION ${ids.join(', ')})`]
  if (PLACEHOLDER.test(line)) return ['Cascade: decisions verdict is not filled in']
  const removedIds = new Set(removed.map((m) => m.id))
  const problems = []
  for (const id of ids) {
    const at = findId(line, id)
    if (at < 0) {
      problems.push(`Cascade: decisions verdict does not name ${id}`)
      continue
    }
    const before = line.slice(0, at)
    const verb = [...before.matchAll(/\b(kept|added|changed)\b/g)].pop()?.[1]
    if (!verb) problems.push(`Cascade: decisions verdict names ${id} without kept, added or changed`)
    else if (verb === 'changed' && !APPROVAL.test(line.slice(at + id.length))) {
      problems.push(`Cascade: changed ${id} needs who approved it, when and their words: changed ${id} (${APPROVER}, <YYYY-MM-DD>: "<words>")`)
    } else if (verb !== 'changed' && removedIds.has(id)) {
      problems.push(`Cascade: this change removes or rewords the DECISION(${id}) marker, so it is not kept: changed ${id} (${APPROVER}, <YYYY-MM-DD>: "<words>")`)
    }
  }
  return problems
}

/**
 * The `- decisions:` line to paste, for a change.
 * @param {{ touched: { id: string }[], removed?: { id: string }[], added?: { id: string }[] }} change
 */
export function decisionsTemplate({ touched, removed = [], added = [] }) {
  const removedIds = new Set(removed.map((m) => m.id))
  const addedIds = new Set(added.map((m) => m.id))
  const ids = [...new Set([...touched, ...removed].map((m) => m.id))]
  if (!ids.length) return null
  const kept = ids.filter((id) => !removedIds.has(id) && !addedIds.has(id))
  const add = ids.filter((id) => addedIds.has(id) && !removedIds.has(id))
  const parts = []
  if (kept.length) parts.push(`kept ${kept.join(', ')}`)
  if (add.length) parts.push(`added ${add.join(', ')}`)
  for (const id of ids.filter((x) => removedIds.has(x))) parts.push(`changed ${id} (${APPROVER}, <date>: "<words>")`)
  return `- decisions: ${parts.join('; ')}`
}

// ── Proposals ────────────────────────────────────────────────────────────────

const STOP = new Set('a an and are as at be by for from in into is it its never no not of on or that the this to with when without every each must only one'.split(' '))
const terms = (s) => new Set(s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length >= 4 && !STOP.has(w)) ?? [])

/**
 * Parse a proposal: one change per line, `<what changes> | <file>, <file>`.
 * Blank lines, `#` comments and markdown list markers are ignored.
 */
export function parseProposal(text) {
  return text.split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [what, files = ''] = l.split('|')
      return { what: what.trim(), files: files.split(',').map((f) => toPosix(f.trim())).filter(Boolean) }
    })
}

/**
 * For each proposed change: the decisions anchored in its files, most words shared
 * with the change first (`shared`: how many; a large screen anchors many decisions a
 * change never reaches), and those elsewhere whose rule or why shares two or more
 * words with the change ("related").
 * @param {{ what: string, files: string[] }[]} changes
 * @param {Marker[]} markers
 * @param {(files: string[]) => Marker[]} [anchoredIn]
 * @returns {{ what: string, files: string[], anchored: (Marker & { shared: number })[], related: (Marker & { shared: number })[] }[]}
 */
export function proposalLookup(changes, markers, anchoredIn = (files) => markers.filter((m) => files.includes(m.file))) {
  return changes.map((c) => {
    const want = terms(c.what)
    /** @param {Marker[]} list */
    const scored = (list) => [...byId(list).values()].map((ms) => {
      const t = terms(ms.map((m) => `${m.id} ${m.rule} ${m.why}`).join(' '))
      return { ...ms[0], shared: [...want].filter((w) => t.has(w)).length }
    })
    const anchored = scored(anchoredIn(c.files)).sort((a, b) => b.shared - a.shared)
    const anchoredIds = new Set(anchored.map((m) => m.id))
    const related = scored(markers).filter((m) => !anchoredIds.has(m.id) && m.shared >= 2).sort((a, b) => b.shared - a.shared)
    return { ...c, anchored, related }
  })
}
