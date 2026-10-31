/**
 * Checklist maintenance for the project's "what's next" checklist (config checklist).
 *
 * The checklist is read at the start of every session, so it must stay small
 * enough to read (hard caps: 256KB / ~25K tokens per Read; the session-start
 * hook warns at 240KB). Sessions keep appending completed-work detail, so this
 * script enforces the file's own footer policy ("one-liners here, full detail
 * in the LOG"):
 *
 *   cascade checklist status
 *       Size, token estimate, open/done counts, per-section weight, encoding
 *       damage, and the open items long enough to need condensing by hand.
 *
 *   cascade checklist archive [--write] [--cutoff=YYYY-MM-DD] [--collapse-days=N]
 *                                      [--min-lines=N] [--min-line-len=N] [--min-run=N]
 *       Dry-run by default. In order:
 *       0) Encoding repair: strips a BOM and undoes double-encoded UTF-8 (text
 *          saved as Windows-1252 and re-encoded, e.g. "▶" stored as "â–¶"; a
 *          PowerShell 5.1 round-trip did this to the whole file on 2026-07-24).
 *       1) Dated completed narrative blocks (bold "**2026-.. — ✅ ...**"
 *          paragraphs) older than --cutoff (default 6 days ago) move verbatim
 *          to the log, leaving their first line as a stub.
 *       2) Completed "- [x]" items (nested ones too) whose text runs past
 *          --min-line-len characters (default 200), or over three lines, are
 *          compressed to a ~160-character one-liner; the full text moves to the
 *          LOG. This includes lines that already end in a "detail → LOG" stub
 *          but were written long.
 *       3) Runs of --min-run (default 3) or more completed one-liners, all
 *          older than --collapse-days (default 30), collapse into one line
 *          listing their IDs ("- [x] **7 done** (…) → LOG: SEC-001 · …"); the
 *          lines move to the LOG. An undated item takes its section's date.
 *          Not applied to "Done" (already the summary) or "Ops" (sessions take
 *          the next migration number from its applied-migration lines).
 *       4) Runs of two or more archive stubs from pass 1 (with the blank and
 *          "---" lines between them) collapse into one pointer line.
 *
 * Open items are never touched: an open item ("[ ]" or "[~]") keeps its whole
 * extent, done sub-items included; blocks containing an open marker ("[ ]",
 * "[~]", "⏳") outside a code span never move; and the script aborts if any
 * open item or the heading list would change. In "▶ Next up" only "- [x]"
 * items move; its pointer text stays as written. Nothing is deleted: every
 * moved line lands in the LOG. Long open items are reported, not rewritten;
 * they need a human to split what is left from what was done.
 */
import fs from 'node:fs';
import path from 'node:path';
import config, { ROOT } from './config.mjs';

// The checklist and its log (config checklist). Without one, only the pure helpers work.
const CL = config.checklist ?? { file: 'CHECKLIST.md', log: 'LOG.md', warnAt: 240 * 1024 };
const CHECKLIST = path.join(ROOT, CL.file);
const LOG = path.join(ROOT, CL.log);
// The log as the checklist links it, and that link as a pattern.
const LOG_HREF = path.posix.relative(path.posix.dirname(CL.file), CL.log);
const LOG_HREF_RE = LOG_HREF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The session-start hook warns above this; aim well under it. */
export const BUDGET_BYTES = CL.warnAt;
/** Open items longer than this get flagged for condensing by hand. */
const LONG_OPEN_ITEM = 1500;

const OPEN_RE = /\[ \]|\[~\]|⏳/;
const OPEN_ITEM_LINE_RE = /^(?:>\s*)?(?:\s*(?:[-*]|\d+\.)\s+)?(?:\*\*)?\[( |~)\]/;
const DONE_WORD_RE = /(✅|🟢|\bDONE\b|\bCOMPLETE\b|\bFIXED\b|done & verified|shipped)/i;
const DATE_RE = /\b20\d{2}-\d{2}-\d{2}\b/g;
export const ARCHIVE_STUB = `*(archived → [LOG](${LOG_HREF}))*`;
export const DETAIL_STUB = `*(detail → [LOG](${LOG_HREF}))*`;
const LOG_LINK = `[LOG](${LOG_HREF})`;
// Never touched by any pass.
const EXCLUDED_SECTION_RE = /^## How sessions/;
// Already one line per entry: only over-long "- [x]" lines are compressed here.
const SUMMARY_SECTION_RE = /^## Done\b/;
// Sessions read the latest applied migration number here, so its done lines stay readable.
const NO_COLLAPSE_SECTION_RE = /^## Ops\b/;
// The pointer to what's due: only its "- [x]" items move, never its prose.
const NEXT_UP_SECTION_RE = /^## ▶ Next up/;

const DONE_ITEM_RE = /^(\s*)- \[x\]/i;
const DONE_SUMMARY_RE = new RegExp(
  `^- \\[x\\] \\*\\*(\\d+) done\\*\\*(?: \\((\\d{4}-\\d{2}-\\d{2})(?: to (\\d{4}-\\d{2}-\\d{2}))?\\))? → \\[LOG\\]\\(${LOG_HREF_RE}\\)(?:: (.*))?$`,
);
const STUB_SUMMARY_RE = new RegExp(
  `^\\*(\\d+) status notes(?: \\((\\d{4}-\\d{2}-\\d{2})(?: to (\\d{4}-\\d{2}-\\d{2}))?\\))? archived → \\[LOG\\]\\(${LOG_HREF_RE}\\)\\.\\*$`,
);
// "SEC-001", "F-PAY", "MKT-D9b", "HV-101", or a letter-and-number code ("A1", "AT1").
const ITEM_ID_RE = /^- \[[xX]\] \*\*(?:~~)?([A-Z][A-Z0-9]*(?:-[A-Z0-9][A-Za-z0-9.]*)+|[A-Z]{1,3}\d+[a-z]?)(?=[\s·*:,]|$)/;

// --- encoding repair ---------------------------------------------------------

// Windows-1252 characters for bytes 0x80-0x9F; every other byte maps to U+00XX.
const CP1252 = new Map(
  [
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
    [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
    [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
    [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
    [0x017e, 0x9e], [0x0178, 0x9f],
  ],
);
// A character that stands for a UTF-8 continuation byte (0x80-0xBF).
const CONT = `[\\u0080-\\u00bf${[...CP1252.keys()].map((c) => `\\u${c.toString(16).padStart(4, '0')}`).join('')}]`;
const MOJIBAKE_RUN_RE = new RegExp(
  `(?:[\\u00c2-\\u00df]${CONT}|[\\u00e0-\\u00ef]${CONT}{2}|[\\u00f0-\\u00f4]${CONT}{3})+`,
  'g',
);
// A lead byte, the continuation bytes it got before truncateLine cut it, then the "…".
const CUT_SEQUENCE_RE = new RegExp(
  `([\\u00c2-\\u00f4])(${CONT}*?)\\u2026(?=(?:\\*\\*)?(?:\`)? \\*\\((?:detail|archived) )`,
  'g',
);
const MOJIBAKE_SIGNATURE_RE = /(?:â€|â†|Â·|Ã—|ðŸ)/g;

function byteOf(ch) {
  const c = ch.codePointAt(0);
  if (CP1252.has(c)) return CP1252.get(c);
  return c <= 0xff ? c : -1;
}

function continuationsNeeded(lead) {
  const c = lead.codePointAt(0);
  return c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : 1;
}

/**
 * Undo double-encoded UTF-8 and drop a BOM. Only runs when the text carries
 * the tell-tale sequences, so clean text (including a legitimate "é…") is
 * left exactly as it is.
 */
export function repairEncoding(text) {
  let out = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const bom = out !== text;
  if ((out.match(MOJIBAKE_SIGNATURE_RE) ?? []).length < 3) return { text: out, repaired: 0, bom };
  // truncateLine() cut some sequences mid-character before adding "…"; drop the partial character.
  out = out.replace(CUT_SEQUENCE_RE, (m, lead, conts) =>
    [...conts].length < continuationsNeeded(lead) ? '…' : m,
  );
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let repaired = 0;
  out = out.replace(MOJIBAKE_RUN_RE, (m) => {
    const bytes = [...m].map(byteOf);
    if (bytes.includes(-1)) return m;
    try {
      const fixed = decoder.decode(Uint8Array.from(bytes));
      repaired++;
      return fixed;
    } catch {
      return m;
    }
  });
  return { text: out, repaired, bom };
}

// --- helpers -----------------------------------------------------------------

function countMatches(text, re) {
  return (text.match(re) ?? []).length;
}

function headings(text) {
  return text.split(/\r?\n/).filter((l) => /^#{1,6} /.test(l));
}

/** Open items: lines that start with an open checkbox (list, nested, numbered or quoted). */
function openItems(text) {
  return text.split(/\r?\n/).filter((l) => OPEN_ITEM_LINE_RE.test(l));
}

/**
 * Line indexes inside an open item's extent: the item line and every later
 * line indented deeper than it (blank lines between them included), up to the
 * next heading or the next line at the item's own depth or shallower.
 */
function openExtent(lines) {
  const inside = new Set();
  let depth = -1;
  lines.forEach((line, i) => {
    const blank = line.trim() === '';
    if (depth >= 0 && !blank && (/^#{1,6} /.test(line) || line.search(/\S/) <= depth)) depth = -1;
    if (OPEN_ITEM_LINE_RE.test(line)) depth = line.search(/\S/);
    if (depth >= 0) inside.add(i);
  });
  return inside;
}

/** Each open item's full text (its extent, trailing blanks dropped), for the no-change check. */
function openBlocks(text) {
  const lines = text.split(/\r?\n/);
  const inside = openExtent(lines);
  const blocks = [];
  lines.forEach((line, i) => {
    if (!inside.has(i)) return;
    if (OPEN_ITEM_LINE_RE.test(line) || !inside.has(i - 1)) blocks.push([line]);
    else blocks.at(-1).push(line);
  });
  return blocks.map((b) => b.join('\n').trimEnd());
}

/** An open marker outside code spans; "why still `[~]`" in prose describes history, not an open item. */
function hasOpenMarker(text) {
  return OPEN_RE.test(text.replace(/`[^`\n]*`/g, ''));
}

export function truncateLine(line, max = 170) {
  const chars = [...line];
  if (chars.length <= max) return line;
  let out = chars.slice(0, max - 1).join('').trimEnd() + '…';
  if (countMatches(out, /`/g) % 2 === 1) out += '`';
  if (countMatches(out, /\*\*/g) % 2 === 1) out += '**';
  return out;
}

/** Group lines into blocks: a heading line, a run of non-blank lines, or a run of blanks. */
function toBlocks(lines) {
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const blank = line.trim() === '';
    const heading = /^#{1,6} /.test(line);
    if (heading) {
      if (cur) blocks.push(cur);
      blocks.push({ kind: 'heading', lines: [line] });
      cur = null;
    } else if (blank) {
      if (cur?.kind === 'blank') cur.lines.push(line);
      else {
        if (cur) blocks.push(cur);
        cur = { kind: 'blank', lines: [line] };
      }
    } else {
      if (cur?.kind === 'text') cur.lines.push(line);
      else {
        if (cur) blocks.push(cur);
        cur = { kind: 'text', lines: [line] };
      }
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function latestDate(text) {
  const dates = text.match(DATE_RE);
  if (!dates) return null;
  return dates.sort().at(-1);
}

function withoutStub(text) {
  const t = text.trimEnd();
  return t.endsWith(DETAIL_STUB) ? t.slice(0, -DETAIL_STUB.length).trimEnd() : t;
}

function isoDaysAgo(days, now = Date.now()) {
  return new Date(now - days * 86400_000).toISOString().slice(0, 10);
}

// --- passes 1 and 2: narratives and long completed items ---------------------

function archiveBlocks(lines, { cutoff, minLines, minLineLen }, moved) {
  const out = [];
  const inOpenItem = openExtent(lines);
  let section = '(preamble)';
  let narratives = 0;
  let items = 0;
  let at = 0; // index in `lines` of the current block's first line

  for (const block of toBlocks(lines)) {
    const start = at;
    at += block.lines.length;
    if (block.kind === 'heading') {
      if (/^## /.test(block.lines[0])) section = block.lines[0];
      out.push(...block.lines);
      continue;
    }
    if (block.kind === 'blank' || EXCLUDED_SECTION_RE.test(section)) {
      out.push(...block.lines);
      continue;
    }

    const text = block.lines.join('\n');

    // Pass 1: whole completed narrative paragraphs, dated before the cutoff.
    // Everything under "Done" is complete by definition, and its header asks for one line each.
    if (
      !NEXT_UP_SECTION_RE.test(section) &&
      !block.lines.some((_, k) => inOpenItem.has(start + k)) &&
      block.lines[0].startsWith('**') &&
      block.lines.length >= minLines &&
      (SUMMARY_SECTION_RE.test(section) || DONE_WORD_RE.test(text)) &&
      !hasOpenMarker(text) &&
      !text.includes(ARCHIVE_STUB)
    ) {
      const date = latestDate(text);
      if (date && date < cutoff) {
        moved.push({ section, text });
        out.push(`${truncateLine(block.lines[0])} ${ARCHIVE_STUB}`);
        narratives++;
        continue;
      }
    }

    // Pass 2: completed items ("- [x] ..." plus its more-indented continuation
    // lines, at any nesting depth) that are long or run over several lines.
    // Done sub-items of an open item stay: they are part of that open item.
    let i = 0;
    while (i < block.lines.length) {
      const line = block.lines[i];
      const m = DONE_ITEM_RE.exec(line);
      if (!m || DONE_SUMMARY_RE.test(line) || inOpenItem.has(start + i)) {
        out.push(line);
        i++;
        continue;
      }
      const indent = m[1].length;
      let j = i + 1;
      while (j < block.lines.length && /^\s+\S/.test(block.lines[j]) && block.lines[j].search(/\S/) > indent) j++;
      const item = block.lines.slice(i, j);
      const itemText = item.join('\n');
      const flat = withoutStub(item.map((l, k) => (k ? l.trim() : l.trimEnd())).join(' '));
      const compressible = item.length >= 3 || flat.trim().length > minLineLen;
      if (compressible && !hasOpenMarker(itemText)) {
        moved.push({ section, text: itemText });
        out.push(`${m[1]}${truncateLine(flat.slice(indent), 160)} ${DETAIL_STUB}`);
        items++;
      } else {
        out.push(...item);
      }
      i = j;
    }
  }
  return { lines: out, narratives, items };
}

// --- pass 3: collapse aged runs of completed one-liners ----------------------

function parseDoneSummary(line) {
  const m = DONE_SUMMARY_RE.exec(line);
  if (!m) return null;
  const ids = [];
  let more = 0;
  for (const part of (m[4] ?? '').split(' · ').filter(Boolean)) {
    const extra = /^\+(\d+) more$/.exec(part);
    if (extra) more += Number(extra[1]);
    else ids.push(part);
  }
  return { count: Number(m[1]), dates: [m[2], m[3]].filter(Boolean), ids, more };
}

function doneSummaryLine(members) {
  const count = members.reduce((n, x) => n + x.count, 0);
  const dates = members.flatMap((x) => x.dates).sort();
  const ids = members.flatMap((x) => x.ids);
  const more = members.reduce((n, x) => n + x.more, 0);
  const range = dates.length ? ` (${dates[0]}${dates.at(-1) !== dates[0] ? ` to ${dates.at(-1)}` : ''})` : '';
  const list = ids.length ? `: ${[...ids, ...(more ? [`+${more} more`] : [])].join(' · ')}` : '';
  return `- [x] **${count} done**${range} → ${LOG_LINK}${list}`;
}

/** Shared run finder: members separated only by lines `gap` accepts. */
function collapseRuns(lines, { member, gap, minRun, render }, moved) {
  const out = [];
  let section = '(preamble)';
  let sectionDate = null;
  let collapsed = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^## /.test(line)) {
      section = line;
      sectionDate = latestDate(line);
    }
    const first = member(line, lines[i + 1], { section, sectionDate });
    if (!first) {
      out.push(line);
      i++;
      continue;
    }
    const members = [{ index: i, ...first }];
    let j = i + 1;
    let end = i + 1;
    while (j < lines.length) {
      if (gap(lines[j])) {
        j++;
        continue;
      }
      const next = member(lines[j], lines[j + 1], { section, sectionDate });
      if (!next) break;
      members.push({ index: j, ...next });
      j++;
      end = j;
    }
    const summaries = members.filter((x) => x.summary).length;
    if (members.length >= minRun || (summaries > 0 && members.length >= 2)) {
      for (const x of members) if (!x.summary) moved.push({ section, text: lines[x.index] });
      out.push(render(members));
      collapsed += members.length - summaries;
      i = end;
    } else {
      out.push(...lines.slice(i, end));
      i = end;
    }
  }
  return { lines: out, collapsed };
}

function collapseDoneRuns(lines, { collapseBefore, minRun }, moved) {
  const member = (line, next, { section, sectionDate }) => {
    if ([EXCLUDED_SECTION_RE, SUMMARY_SECTION_RE, NO_COLLAPSE_SECTION_RE].some((re) => re.test(section))) return null;
    const summary = parseDoneSummary(line);
    if (summary) return { summary: true, ...summary };
    if (!/^- \[x\]/i.test(line) || hasOpenMarker(line)) return null;
    if (next !== undefined && /^\s+\S/.test(next)) return null; // multi-line item
    const own = latestDate(line);
    const date = own ?? sectionDate;
    if (!date || date >= collapseBefore) return null;
    const id = ITEM_ID_RE.exec(line)?.[1];
    return { summary: false, count: 1, dates: own ? [own] : [], ids: id ? [id] : [], more: id ? 0 : 1 };
  };
  return collapseRuns(lines, { member, gap: (l) => l.trim() === '', minRun, render: doneSummaryLine }, moved);
}

// --- pass 4: collapse runs of archive stubs ----------------------------------

function collapseStubRuns(lines, moved) {
  const member = (line, _next, { section }) => {
    // "Done" keeps one line per entry, so its stubs stay one each.
    if ([EXCLUDED_SECTION_RE, NEXT_UP_SECTION_RE, SUMMARY_SECTION_RE].some((re) => re.test(section))) return null;
    const s = STUB_SUMMARY_RE.exec(line);
    if (s) return { summary: true, count: Number(s[1]), dates: [s[2], s[3]].filter(Boolean) };
    if (!line.trimEnd().endsWith(ARCHIVE_STUB)) return null;
    const date = latestDate(line);
    return { summary: false, count: 1, dates: date ? [date] : [] };
  };
  const render = (members) => {
    const count = members.reduce((n, x) => n + x.count, 0);
    const dates = members.flatMap((x) => x.dates).sort();
    const range = dates.length ? ` (${dates[0]}${dates.at(-1) !== dates[0] ? ` to ${dates.at(-1)}` : ''})` : '';
    return `*${count} status notes${range} archived → ${LOG_LINK}.*`;
  };
  const gap = (l) => l.trim() === '' || /^---\s*$/.test(l);
  return collapseRuns(lines, { member, gap, minRun: 2, render }, moved);
}

// --- the whole archive, as a pure function -----------------------------------

/**
 * Apply the repair and the four passes to the checklist text.
 * Returns the new text, what moved (for the LOG) and counts. Throws if an open
 * item or a heading would change.
 *
 * @param {string} raw
 * @param {{ now?: number, cutoff?: string, collapseBefore?: string, collapseDays?: number,
 *   minLines?: number, minLineLen?: number, minRun?: number }} [opts]
 */
export function archiveText(raw, opts = {}) {
  const now = opts.now ?? Date.now();
  const options = {
    cutoff: opts.cutoff ?? isoDaysAgo(6, now),
    collapseBefore: opts.collapseBefore ?? isoDaysAgo(opts.collapseDays ?? 30, now),
    minLines: opts.minLines ?? 4,
    minLineLen: opts.minLineLen ?? 200,
    minRun: opts.minRun ?? 3,
  };
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const { text: repairedText, repaired, bom } = repairEncoding(raw);
  const moved = [];

  const p12 = archiveBlocks(repairedText.split(/\r?\n/), options, moved);
  const p3 = collapseDoneRuns(p12.lines, options, moved);
  const p4 = collapseStubRuns(p3.lines, moved);
  const text = p4.lines.join(eol);

  const [openBefore, openAfter] = [openBlocks(repairedText), openBlocks(text)];
  if (openBefore.join('\n\0\n') !== openAfter.join('\n\0\n')) {
    const k = openBefore.findIndex((b, n) => b !== openAfter[n]);
    throw new Error(`open items would change (${openBefore.length} → ${openAfter.length}; first: ${openBefore[k]?.split('\n')[0].slice(0, 80)})`);
  }
  if (headings(repairedText).join('\n') !== headings(text).join('\n')) {
    throw new Error('heading structure would change');
  }
  return {
    text,
    moved,
    options,
    counts: { repaired, bom, narratives: p12.narratives, items: p12.items, collapsed: p3.collapsed, stubs: p4.collapsed },
  };
}

/** Open items long enough that a human should split what's left from what was done. */
export function longOpenItems(text, min = LONG_OPEN_ITEM) {
  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)- \[( |~)\]/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && /^\s+\S/.test(lines[j]) && lines[j].search(/\S/) > m[1].length) j++;
    const size = Buffer.byteLength(lines.slice(i, j).join('\n'), 'utf8');
    if (size >= min) found.push({ line: i + 1, size, head: lines[i].trim().slice(0, 90) });
  }
  return found.sort((a, z) => z.size - a.size);
}

// --- CLI ---------------------------------------------------------------------

function readChecklist() {
  return fs.readFileSync(CHECKLIST, 'utf8');
}

function printLongOpenItems(text, limit = 10) {
  const long = longOpenItems(text);
  if (!long.length) return;
  console.log(`\nopen items over ${LONG_OPEN_ITEM.toLocaleString()} bytes (condense by hand: keep what's left, move the rest to the LOG):`);
  for (const x of long.slice(0, limit)) {
    console.log(`  L${String(x.line).padEnd(5)} ${String(x.size.toLocaleString()).padStart(6)} B  ${x.head}`);
  }
  if (long.length > limit) console.log(`  … and ${long.length - limit} more`);
}

function status() {
  const raw = readChecklist();
  const lines = raw.split(/\r?\n/);
  const bytes = Buffer.byteLength(raw, 'utf8');
  const { repaired, bom } = repairEncoding(raw);
  console.log(`file      ${path.relative(ROOT, CHECKLIST)}`);
  console.log(`size      ${bytes.toLocaleString()} bytes (~${Math.round(bytes / 4 / 1000)}K tokens; budget ${BUDGET_BYTES.toLocaleString()}, Read caps 256KB / 25K tokens)`);
  console.log(`lines     ${lines.length}`);
  const open = openItems(raw);
  const wip = open.filter((l) => l.includes('[~]')).length;
  console.log(`open      ${open.length - wip} todo · ${wip} in-progress`);
  console.log(`done      ${countMatches(raw, /- \[x\]/gi)} ticked`);
  if (repaired || bom) {
    console.log(`encoding  ${repaired} double-encoded sequences${bom ? ' + a BOM' : ''} (archive repairs them)`);
  }
  console.log('\nweight by section:');
  let section = '(preamble)';
  let acc = 0;
  const rows = [];
  for (const line of lines) {
    if (/^## /.test(line)) {
      rows.push([acc, section]);
      section = line;
      acc = 0;
    }
    acc += Buffer.byteLength(line, 'utf8') + 1;
  }
  rows.push([acc, section]);
  for (const [b, s] of rows.sort((a, z) => z[0] - a[0])) {
    console.log(`  ${String(b.toLocaleString()).padStart(9)} B  ${s}`);
  }
  printLongOpenItems(raw);
}

function archive(argv) {
  const write = argv.includes('--write');
  const arg = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const num = (name) => (arg(name) === undefined ? undefined : Number(arg(name)));

  const raw = readChecklist();
  let result;
  try {
    result = archiveText(raw, {
      cutoff: arg('cutoff'),
      collapseDays: num('collapse-days'),
      minLines: num('min-lines'),
      minLineLen: num('min-line-len'),
      minRun: num('min-run'),
    });
  } catch (err) {
    console.error(`ABORT: ${err.message}.`);
    process.exit(1);
  }
  const { text: next, moved, options, counts } = result;
  const before = Buffer.byteLength(raw, 'utf8');
  const after = Buffer.byteLength(next, 'utf8');

  console.log(`cutoff    ${options.cutoff} (dated narratives strictly older move to the LOG)`);
  console.log(`collapse  done one-liners dated before ${options.collapseBefore}, in runs of ${options.minRun}+`);
  if (counts.repaired || counts.bom) {
    console.log(`encoding  ${counts.repaired} double-encoded sequences repaired${counts.bom ? ', BOM dropped' : ''}`);
  }
  console.log(
    `moves     ${counts.narratives} narrative blocks · ${counts.items} long completed items · ` +
      `${counts.collapsed} one-liners collapsed · ${counts.stubs} stubs collapsed`,
  );
  console.log(`size      ${before.toLocaleString()} → ${after.toLocaleString()} bytes (~${Math.round(after / 4 / 1000)}K tokens)`);
  if (after > BUDGET_BYTES) {
    console.log(`\nWARNING: still over the ${BUDGET_BYTES.toLocaleString()}-byte budget after archiving.`);
    printLongOpenItems(next);
  }

  if (!write) {
    console.log('\nDry run. Blocks that would move:');
    for (const m of moved.slice(0, 60)) {
      console.log(`  [${m.section.replace(/^#+ /, '').slice(0, 40)}] ${m.text.split('\n')[0].slice(0, 110)}`);
    }
    if (moved.length > 60) console.log(`  … and ${moved.length - 60} more`);
    console.log('\nRe-run with --write to apply.');
    return;
  }

  if (moved.length) {
    // Append the moved detail to the LOG, newest-first (after the preamble's first ---).
    let log = fs.readFileSync(LOG, 'utf8');
    const logEol = log.includes('\r\n') ? '\r\n' : '\n';
    const today = new Date().toISOString().slice(0, 10);
    const bySection = new Map();
    for (const m of moved) {
      if (!bySection.has(m.section)) bySection.set(m.section, []);
      bySection.get(m.section).push(m.text);
    }
    const chunk = [
      `## Checklist archive — ${today} size tidy`,
      '',
      `> Moved verbatim from \`${path.posix.basename(CL.file)}\` by \`cascade checklist archive\` (${counts.narratives} narrative blocks, ` +
        `${counts.items} long completed items, ${counts.collapsed} collapsed one-liners, ${counts.stubs} archive stubs). Grouped by source section.`,
      '',
      ...[...bySection.entries()].flatMap(([sec, texts]) => [
        `### From: ${sec.replace(/^#+ /, '')}`,
        '',
        ...texts.flatMap((t) => [t, '']),
      ]),
      '---',
      '',
    ].join(logEol);

    const sep = `${logEol}---${logEol}`;
    const at = log.indexOf(sep);
    if (at === -1) {
      log = log + logEol + chunk;
    } else {
      const insertAt = at + sep.length;
      log = log.slice(0, insertAt) + logEol + chunk + log.slice(insertAt);
    }
    fs.writeFileSync(LOG, log, 'utf8');
  }
  fs.writeFileSync(CHECKLIST, next, 'utf8');
  console.log(`\nWrote ${path.relative(ROOT, CHECKLIST)}${moved.length ? ` and archived detail into ${path.relative(ROOT, LOG)}` : ''}.`);
}

export function main(argv) {
  if (!config.checklist) throw new Error('cascade: no checklist section in cascade.config.mjs');
  const cmd = argv[0];
  if (cmd === 'status') status();
  else if (cmd === 'archive') archive(argv.slice(1));
  else {
    console.log(
      'usage: cascade checklist status | archive [--write] [--cutoff=YYYY-MM-DD] [--collapse-days=N] ' +
        '[--min-lines=N] [--min-line-len=N] [--min-run=N]',
    );
    process.exit(cmd ? 1 : 0);
  }
}
