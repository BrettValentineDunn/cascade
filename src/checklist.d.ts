export const BUDGET_BYTES: number
export const ARCHIVE_STUB: string
export const DETAIL_STUB: string
export function repairEncoding(text: string): { text: string; repaired: number; bom: boolean }
export function truncateLine(line: string, max?: number): string
export interface ArchiveOptions { now?: number; cutoff?: string; collapseBefore?: string; collapseDays?: number; minLines?: number; minLineLen?: number; minRun?: number }
export function archiveText(
  raw: string,
  opts?: ArchiveOptions,
): {
  text: string
  moved: { section: string; text: string }[]
  options: { cutoff: string; collapseBefore: string; minLines: number; minLineLen: number; minRun: number }
  counts: { repaired: number; bom: boolean; narratives: number; items: number; collapsed: number; stubs: number }
}
export function longOpenItems(text: string, min?: number): { line: number; size: number; head: string }[]
export function main(argv: string[]): void
