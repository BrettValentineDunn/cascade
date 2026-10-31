// Tiny path-glob matcher for repo-relative POSIX paths, so the impact map needs
// no dependency. `**` matches any number of path segments (including none), `*`
// matches within one segment, `?` one character. Route-group parens and dynamic
// segment brackets are literal.

const cache = new Map()

export function globToRegExp(glob) {
  let re = cached(glob)
  if (re) return re
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      // "**/" matches zero or more whole segments; a trailing "**" matches the rest.
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (c === '*') {
      out += '[^/]*'
    } else if (c === '?') {
      out += '[^/]'
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  re = new RegExp(`^${out}$`)
  cache.set(glob, re)
  return re
}

function cached(glob) {
  return cache.get(glob)
}

export function matchesGlob(file, glob) {
  return globToRegExp(glob).test(file)
}

export function matchesAny(file, globs) {
  return globs.some((g) => matchesGlob(file, g))
}
