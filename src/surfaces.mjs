// Which files state things to customers, and so must stay true when a fact changes.
//
// A LIVE surface is anything a customer, prospect, crawler or counterparty reads:
// app and marketing code, docs content, email templates, and the docs that hold
// copy that is sent or signed. Everything else is history (what was true then) or
// internal working notes, and is never scanned. The lists are the project's data;
// this builds the three questions every check asks of them. Loads no config, so a
// project's surfaces module can import it.
//
// Every doc under `docsRoot` must be classified (in `classified`), so a new outreach
// script can't slip past unscanned just because nobody thought to add it.

import { readdirSync } from 'node:fs'
import path from 'node:path'

// Build output, dependencies and native projects are never surfaces.
const SKIP_DIRS = new Set(['node_modules', '.next', '.expo', 'dist', 'build', 'android', 'ios', 'coverage'])
const TEXT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|html|txt)$/

const toPosix = (p) => p.split(path.sep).join('/')

/**
 * @param {{ roots: string[], files?: string[], skip?: string[], classified?: string[], docsRoot?: string }} lists
 *   roots: folders whose text files are live; files: single live files outside them;
 *   skip: paths inside the roots that are not (generated copies, registries);
 *   classified: every doc under docsRoot, live or not.
 */
export function liveSurfaces({ roots, files = [], skip = [], classified = [], docsRoot = 'docs' }) {
  const skipPaths = new Set(skip)

  function walk(root, rel, out) {
    let entries
    try {
      entries = readdirSync(path.join(root, rel), { withFileTypes: true })
    } catch {
      return out
    }
    // Byte order, so every file system lists the same surfaces in the same order.
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const child = rel ? `${rel}/${e.name}` : e.name
      if (skipPaths.has(child)) continue
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(root, child, out)
      } else if (TEXT_FILE.test(e.name)) {
        out.push(child)
      }
    }
    return out
  }

  /** Every live surface, as repo-relative POSIX paths. */
  function liveSurfaceFiles(root = process.cwd()) {
    const out = []
    for (const r of roots) walk(root, r, out)
    return [...out, ...files].map(toPosix)
  }

  /** True when a repo-relative path is a live surface. */
  function isLiveSurface(file) {
    const f = toPosix(file)
    if (files.includes(f)) return true
    if (!TEXT_FILE.test(f)) return false
    if ([...skipPaths].some((s) => f === s || f.startsWith(`${s}/`))) return false
    if (f.split('/').some((seg) => SKIP_DIRS.has(seg))) return false
    return roots.some((r) => f.startsWith(`${r}/`))
  }

  /** Docs (*.md under docsRoot) that are not classified. */
  function unclassifiedDocs(root = process.cwd()) {
    const known = new Set(classified)
    return walk(root, docsRoot, [])
      .map(toPosix)
      .filter((f) => f.endsWith('.md') && !known.has(f))
  }

  return { liveSurfaceFiles, isLiveSurface, unclassifiedDocs }
}
