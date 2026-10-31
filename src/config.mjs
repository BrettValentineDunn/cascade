// The one place the engine reads a project's settings: cascade.config.mjs at the
// project's root. The root is CASCADE_ROOT when set, otherwise the nearest folder
// at or above the working directory that holds the file.
//
// Every section is optional. A missing section turns its check off, and
// `cascade doctor` says which are off. Paths are repo-relative. A module
// reference is 'path/to/file.mjs', or 'path/to/file.mjs#EXPORT' for one export.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { withDefaults } from './defaults.mjs'

export const CONFIG_FILE = 'cascade.config.mjs'

/** The project root: where cascade.config.mjs is. Throws when there is none. */
export function findRoot(from = process.cwd()) {
  if (process.env.CASCADE_ROOT) return path.resolve(process.env.CASCADE_ROOT)
  let dir = path.resolve(from)
  for (;;) {
    if (existsSync(path.join(dir, CONFIG_FILE))) return dir
    const up = path.dirname(dir)
    if (up === dir) throw new Error(`cascade: no ${CONFIG_FILE} in ${from} or any folder above it`)
    dir = up
  }
}

export const ROOT = findRoot()

/** A module the config names ('path/to/file.mjs', or 'path/to/file.mjs#EXPORT'), loaded. */
export async function load(ref) {
  const [file, name] = ref.split('#')
  const mod = await import(pathToFileURL(path.join(ROOT, file)).href)
  return name ? mod[name] : mod
}

/** The file part of a module reference. */
export const fileOf = (ref) => ref.split('#')[0]

/** `a`, `a and b`, `a, b and c`. */
export function listWords(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

const config = withDefaults((await import(pathToFileURL(path.join(ROOT, CONFIG_FILE)).href)).default)

export default config
