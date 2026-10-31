export type FactPattern = {
  /** Finds one statement of the fact. Matched against whole files, so `\s+`
   *  spans the line breaks JSX puts in the middle of a sentence. */
  re: RegExp
  /** What the text says. Default: the first capture group that matched. */
  stated?: (m: RegExpExecArray) => string
  /** What it should say. Default: the fact's value. */
  expected?: (m: RegExpExecArray) => string
  /** 'exact' (default): the stated value must equal the expected one.
   *  'retired': the wording also matches other people's figures, so only a value
   *  this fact used to have fails. */
  mode?: 'exact' | 'retired'
  /** Skip a match whose line matches this (a different fact with the same shape). */
  skipIf?: RegExp
}

export type Fact = {
  id: string
  /** Current value, as prose states it. */
  value: string
  /** The module that owns the value. */
  source: string
  /** Values this fact used to have. */
  retired?: string[]
  /** Only scan files whose path matches. */
  include?: RegExp
  /** Never scan files whose path matches. */
  exclude?: RegExp
  patterns: FactPattern[]
  /** How to fix a surface that disagrees. */
  fix: string
}

export type FactHit = { fact: string; line: number; stated: string; expected: string; retired: boolean; excerpt: string }

export function normaliseStated(value: string): string
export function scanForFacts(file: string, text: string, facts: Fact[]): FactHit[]
export function describeHit(file: string, hit: FactHit, facts: Fact[]): string
