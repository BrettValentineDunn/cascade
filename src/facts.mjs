// The fact scanner: every value a project states in words on more than one surface,
// tied to the ONE constant that owns it. The registry is the project's (config
// facts; each fact imports its value from the module that owns it). This finds
// every statement on a surface that disagrees. Loads no config.
//
// A line that must keep a different value (history, or someone else's figure)
// carries `facts-ignore: <reason>` on that line or the line above it.

const NUMBER_WORDS = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
}

/** Lower-case, number words to digits, whitespace and thousands commas removed. */
export function normaliseStated(value) {
  return value
    .toLowerCase()
    .replace(/[a-z]+/g, (w) => NUMBER_WORDS[w] ?? w)
    .replace(/[\s,]/g, '')
}

const IGNORE = /facts-ignore:/

/** Every statement in `text` that disagrees with `facts`. `file` is the
 *  repo-relative POSIX path, used for each fact's include/exclude. */
export function scanForFacts(file, text, facts) {
  const lines = text.split('\n')
  const lineAt = (index) => text.slice(0, index).split('\n').length
  const hits = []
  for (const fact of facts) {
    if (fact.include && !fact.include.test(file)) continue
    if (fact.exclude?.test(file)) continue
    for (const p of fact.patterns) {
      const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`)
      for (const m of text.matchAll(re)) {
        const line = lineAt(m.index ?? 0)
        const lineText = lines[line - 1] ?? ''
        if (IGNORE.test(lineText) || IGNORE.test(lines[line - 2] ?? '')) continue
        if (p.skipIf?.test(lineText)) continue
        const raw = p.stated ? p.stated(m) : (m.slice(1).find((g) => g !== undefined) ?? '')
        if (!raw) continue
        const stated = normaliseStated(raw)
        const retired = (fact.retired ?? []).includes(stated)
        const expected = normaliseStated(p.expected ? p.expected(m) : fact.value)
        const wrong = p.mode === 'retired' ? retired : stated !== expected
        if (!wrong) continue
        hits.push({ fact: fact.id, line, stated, expected, retired, excerpt: m[0].replace(/\s+/g, ' ').trim() })
      }
    }
  }
  return hits
}

/** One readable line per hit, for a failing test. */
export function describeHit(file, hit, facts) {
  const fact = facts.find((f) => f.id === hit.fact)
  const was = hit.retired ? ' (a retired value)' : ''
  return `${hit.fact}: ${file}:${hit.line} says "${hit.excerpt}"${was}; current value is ${hit.expected} (source: ${fact?.source}). ${fact?.fix}`
}
