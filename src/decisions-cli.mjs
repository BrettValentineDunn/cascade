// Decisions: the index of deliberate behaviours, and the lookup for a proposed
// change (the rules are in decisions.mjs).
//
//   cascade decisions                     write the index (config decisions.index) from the markers
//   cascade decisions --check             exit 1 if the index is stale or a marker or pin is wrong
//   cascade decisions --files <files...>  the decisions anchored in these files
//   cascade decisions --proposal <file>   verdict table for a proposed list of changes
//                                         (one per line: `<what changes> | <file>, <file>`;
//                                         `-` reads stdin). Fill in each verdict:
//                                         holds | conflicts with <ID> | incidental.
//   add --json for machine-readable output

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { analyseChange } from './impact.mjs'
import config, { fileOf } from './config.mjs'
import {
  byId,
  decisionProblems,
  decisionsInFiles,
  indexShape,
  INDEX_FILE,
  parseProposal,
  proposalLookup,
  renderIndex,
  scanMarkers,
  testPins,
} from './decisions.mjs'
import { journeysForAreas } from './journeys.mjs'

const cell = (s) => String(s).replace(/\|/g, '\\|')

/** The verdict table for a proposal, as markdown. */
export function proposalReport(changes, root = process.cwd()) {
  const { markers } = scanMarkers(root)
  const rows = proposalLookup(changes, markers, (files) => decisionsInFiles(files, root))
  const out = ['| # | Proposed change | Decision | Rule (why) | Verdict |', '|---|-----------------|----------|------------|---------|']
  const journeyLines = []
  rows.forEach((r, i) => {
    const n = i + 1
    // Decisions sharing a word with the change get a row each; the rest of a large
    // screen's decisions are listed together, incidental unless the change reaches them.
    const all = [...r.anchored.filter((m) => m.shared > 0).map((m) => ({ m, how: 'in its files' })), ...r.related.map((m) => ({ m, how: 'related rule' }))]
    const quiet = r.anchored.filter((m) => m.shared === 0)
    if (!all.length && !quiet.length) out.push(`| ${n} | ${cell(r.what)} | none anchored | | holds (no decision in ${r.files.length ? r.files.length : 'no'} file(s)) |`)
    for (const { m, how } of all) {
      out.push(`| ${n} | ${cell(r.what)} | ${cell(m.id)} (${how}, \`${m.file}:${m.line}\`) | ${cell(m.rule)} (${cell(m.why)}; ${cell(m.who)}, ${m.date}) | holds / conflicts with ${cell(m.id)} / incidental |`)
    }
    if (quiet.length) out.push(`| ${n} | ${cell(r.what)} | also in its files, no words shared: ${quiet.map((m) => cell(m.id)).join(', ')} | see ${INDEX_FILE} | incidental, unless the change reaches one (then a row of its own) |`)
    const areas = analyseChange({ files: r.files, root, mobileApi: [] }).areas.map((a) => a.id)
    const journeys = journeysForAreas(areas)
    journeyLines.push(`${n}. ${r.what}: areas ${areas.join(', ') || 'none'}; journeys ${journeys.map((j) => `${j.id} ${j.name}`).join('; ') || 'none'}`)
  })
  return [
    `Decisions check for ${rows.length} proposed change(s). Replace each Verdict with one of:`,
    '  holds                  the change keeps the rule;',
    `  conflicts with <ID>    it undoes or weakens the rule: drop or reshape the change, or ask the ${config.approver};`,
    '  incidental             the decision is in the same file but the change does not reach it.',
    '',
    ...out,
    '',
    ...(config.journeys ? [`Journeys each change passes through (${fileOf(config.journeys)}):`, ...journeyLines] : []),
  ].join('\n')
}

export function main(argv) {
  const root = process.cwd()
  const json = argv.includes('--json')
  const args = argv.filter((a) => a !== '--json')

  if (args[0] === '--proposal') {
    const src = args[1] ?? '-'
    const text = readFileSync(src === '-' ? 0 : path.resolve(src), 'utf8')
    const changes = parseProposal(text)
    if (json) {
      const { markers } = scanMarkers(root)
      console.log(JSON.stringify(proposalLookup(changes, markers, (files) => decisionsInFiles(files, root)), null, 2))
    } else console.log(proposalReport(changes, root))
    return
  }

  if (args[0] === '--files') {
    const found = [...byId(decisionsInFiles(args.slice(1), root)).values()].map((l) => l[0])
    if (json) console.log(JSON.stringify(found, null, 2))
    else if (!found.length) console.log('No decision is anchored in these files.')
    else for (const m of found) console.log(`DECISION(${m.id}) ${m.file}:${m.line}\n  ${m.rule} — ${m.why} (${m.who}, ${m.date})`)
    return
  }

  const scanned = scanMarkers(root)
  const pins = testPins(root)
  const index = renderIndex(scanned.markers, pins)
  const problems = decisionProblems(scanned, pins)
  if (args[0] === '--check') {
    let current = ''
    try {
      current = readFileSync(path.join(root, INDEX_FILE), 'utf8')
    } catch { /* missing */ }
    if (indexShape(current) !== indexShape(index)) problems.push(`${INDEX_FILE} is stale: run npx cascade decisions`)
    if (json) console.log(JSON.stringify(problems, null, 2))
    else if (!problems.length) console.log(`Decisions OK: ${byId(scanned.markers).size} decision(s), each pinned; ${INDEX_FILE} current.`)
    else console.error(problems.map((p) => `- ${p}`).join('\n'))
    process.exit(problems.length ? 1 : 0)
  }
  writeFileSync(path.join(root, INDEX_FILE), index)
  console.log(`Wrote ${INDEX_FILE}: ${byId(scanned.markers).size} decision(s), ${scanned.markers.length} marker(s).`)
  if (problems.length) {
    console.error(`\n${problems.length} problem(s) (the decisions guard test fails on these):`)
    console.error(problems.map((p) => `- ${p}`).join('\n'))
    process.exitCode = 1
  }
}
