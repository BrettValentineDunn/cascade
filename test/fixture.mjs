// A made-up project to run the kit against: a temporary git repository holding a
// cascade.config.mjs and whatever files a test gives it.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cascade.mjs')

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
}

/** A full project: checklist, map, journeys, decisions, a docs kind and a mobile app. */
export const FULL = {
  'cascade.config.mjs': `import { readdirSync } from 'node:fs'
export default {
  checklist: { file: 'docs/CHECKLIST.md', log: 'docs/LOG.md', warnAt: 1024 * 1024 },
  from: { cascade: '2000-01-01', journeys: '2000-01-01', decisions: '2000-01-01' },
  approver: 'owner',
  lateVerdicts: 'docs/late-verdicts.md',
  map: 'scripts/map.mjs',
  journeys: 'scripts/journeys.mjs#JOURNEYS',
  decisions: { roots: ['src'], tests: ['tests'], index: 'docs/decisions.md', skip: [] },
  surfaces: {
    kinds: { docs: { docs: true, describe: (key) => \`help page \${key}\` } },
    docsKeys: (root) => new Set(readdirSync(root + '/help').map((f) => f.replace(/\\.md$/, ''))),
  },
  mobile: {
    root: 'app', appConfig: 'app/app.json', callers: ['app/src'],
    shared: { from: 'src/shared', to: 'app/shared', modules: 'scripts/shared.mjs#MODULES' },
    publishTag: 'app-published-*', divergences: 'docs/parity.md', rule: 'PARITY',
    releaseStep: 'the release notes', uploadScript: 'scripts/upload.mjs',
  },
}
`,
  'scripts/map.mjs': `export const AREAS = [
  { id: 'billing', name: 'Billing', code: ['src/billing/**'], surfaces: ['docs:billing', 'web/pricing.html'] },
]
export const HUBS = []
export const SCREEN_PAIRS = [{ name: 'Pay screen', web: ['src/billing/pay.js'], native: ['app/src/pay.js'] }]
export const NATIVE_BUILD_TRIGGERS = ['app/app.json']
`,
  'scripts/journeys.mjs': `export const JOURNEYS = [
  { id: 'J-01', importance: 1, name: 'Pay an invoice', areas: ['billing'], spec: null },
]
`,
  'scripts/shared.mjs': `export const MODULES = ['money.js']\n`,
  'scripts/upload.mjs': '',
  'src/billing/price.js': `// DECISION(PRICE-1): prices are whole pounds — part-pound prices caused disputes (owner, 2026-01-01)
export const PRICE = 10
`,
  'src/billing/pay.js': 'export const pay = () => fetch(`/api/pay`)\n',
  'src/shared/money.js': 'export const pence = (p) => p * 100\n',
  'app/shared/money.js': '',
  'app/app.json': '{ "expo": { "version": "1.0.0" } }\n',
  'app/src/pay.js': "export const pay = () => fetch('/api/pay')\n",
  'tests/price.test.js': "it('DECISION(PRICE-1) keeps prices in whole pounds', () => {})\n",
  'help/billing.md': '# Billing\n',
  'web/pricing.html': '<p>Ten pounds</p>\n',
  'docs/CHECKLIST.md': '# Checklist\n\n## ▶ Next up\n\n- [ ] Build the pay screen\n\n---\n',
  'docs/LOG.md': '# Log\n\n---\n',
  'docs/parity.md': '# Parity\n',
}

/** A project that has only a checklist: every other check is off. */
export const MINIMAL = {
  'cascade.config.mjs': `export default { checklist: { file: 'CHECKLIST.md', log: 'LOG.md', warnAt: 1024 } }\n`,
  'CHECKLIST.md': '# Checklist\n\n## ▶ Next up\n\n- [ ] First thing\n',
  'LOG.md': '# Log\n\n---\n',
  'src/index.js': 'export {}\n',
}

/** Write `files` into a new git repository with one commit, and return helpers for it. */
export function project(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cascade-fixture-'))
  const write = (more) => {
    for (const [rel, text] of Object.entries(more)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
      writeFileSync(path.join(dir, rel), text)
    }
  }
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim()
  write(files)
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'start')
  /** Commit `more` with `message`, and return the commit's sha. */
  const commit = (more, message) => {
    write(more)
    git('add', '-A')
    git('commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  /** Run the cascade command in the project: { code, out, err }. */
  const cascade = (...args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CASCADE_ROOT: '' } })
    return { code: r.status, out: r.stdout, err: r.stderr }
  }
  return { dir, write, git, commit, cascade }
}
