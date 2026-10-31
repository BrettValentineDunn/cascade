export const RUN_EVERYTHING: RegExp[]
export function selectTests(
  changed: string[],
  tests: Record<string, string>,
  options?: { maxChanged?: number },
): { full: true; direct?: undefined; sources?: undefined } | { full: false; direct: string[]; sources: string[] }
export function main(argv: string[]): void
