export interface AreaException { id: string; reason: string }
export interface RepoFacts { docsSlugs: Set<string>; featureKeys: Set<string>; exists: (file: string) => boolean }
export function isMarketingSurface(surface: string): boolean
export function isDocsSurface(surface: string): boolean
export function areaCoverageProblems(
  areas: readonly { id: string; surfaces: readonly string[] }[],
  lists?: { notMarketed?: AreaException[]; notDocumented?: AreaException[]; pending?: AreaException[] },
): string[]
export function docsSlugs(root?: string): Set<string>
export function featureKeys(root?: string): Set<string>
export function repoFacts(root?: string): RepoFacts
export function docsValueProblem(value: string | undefined, facts: Pick<RepoFacts, 'docsSlugs'>): string | null
export function marketingValueProblem(value: string | undefined, facts: Pick<RepoFacts, 'featureKeys' | 'exists'>): string | null
export function releaseCoverageProblems(
  releases: readonly { id: string; date: string; changes: readonly { title: string; docs?: string; marketing?: string }[] }[],
  facts: RepoFacts,
  options: { from: string; exempt?: string[] },
): string[]
export function cascadeMessageProblems(message: string, areaIds: string[], journeyIds?: string[]): string[]
