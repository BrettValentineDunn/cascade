#!/usr/bin/env node
// The cascade command. Each subcommand loads only its own module, so `help` and
// `version` work without a cascade.config.mjs.

import { readFileSync } from 'node:fs'

const [cmd, ...args] = process.argv.slice(2)
const run = (file, argv = args) => import(new URL(`../src/${file}`, import.meta.url)).then((m) => m.main(argv))

const COMMANDS = {
  impact: ['What else has to change: surfaces, facts, mobile, decisions, journeys, and the Cascade: block', () => run('impact.mjs')],
  'check-commits': ['Every commit in a range (default origin/main..HEAD) has its Cascade: verdicts', () => run('impact.mjs', ['--check-commits', ...args])],
  decisions: ['Write the decisions index; --check, --files <files...>, --proposal <file>', () => run('decisions-cli.mjs')],
  checklist: ['status | archive [--write]: keep the checklist small enough to read', () => run('checklist.mjs')],
  'sync-mobile': ['Regenerate the native app\'s copy of the shared rules; --check', () => run('mirror.mjs')],
  'quick-tests': ['--base <sha>: the tests a change can affect, as JSON', () => run('quick-tests.mjs')],
  'copy-claims': ['Outcome claims in user copy that no test proves; --baseline', () => run('copy-claims.mjs')],
  doctor: ['Where the config is, and which checks are on', () => run('doctor.mjs')],
}

const version = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
  console.log(version())
} else if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || !Object.hasOwn(COMMANDS, cmd)) {
  if (cmd && !['help', '--help', '-h'].includes(cmd)) console.error(`cascade: unknown command "${cmd}"\n`)
  console.log(`cascade ${version()}\n\nUsage: cascade <command> [options]\n`)
  for (const [name, [what]] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(14)} ${what}`)
  process.exit(cmd && !['help', '--help', '-h'].includes(cmd) ? 1 : 0)
} else {
  try {
    await COMMANDS[cmd][1]()
  } catch (e) {
    console.error(String(e?.message ?? e))
    process.exit(2)
  }
}
