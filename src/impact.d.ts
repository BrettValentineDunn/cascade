export interface AreaReport { id: string; name: string; because: string[]; surfaces: { surface: string; inDiff: boolean }[] }
export interface ChangeReport {
  files: string[]
  areas: AreaReport[]
  facts: { id: string; source: string }[]
  mobile: {
    pairs: { name: string; changed: 'web' | 'native'; missing: string[]; files: string[] }[]
    sharedSources: { source: string; mirrorInDiff: boolean }[]
    apiChanges: { route: string; calledAs: string[] }[]
    release: 'ota-update' | 'native-build' | null
  }
  liveSurfacesEdited: string[]
  decisions?: { touched: any[]; removed: any[]; added: any[] }
}
export function apiPathsCalledByMobile(root?: string): string[]
export function apiRoutes(root?: string): { file: string; segments: string[] }[]
export function routeForApiPath(apiPath: string, routes: { file: string; segments: string[] }[]): string | null
export function factSources(root?: string): Map<string, string[]>
export function analyseChange(options: { files: string[]; hubDiffs?: Record<string, string>; root?: string; mobileApi?: string[] }): ChangeReport
export function formatReport(report: ChangeReport, releaseStatus?: string | null): string
export function mobileReleaseStatus(root?: string): string | null
export const CASCADE_FROM: string | null
export const JOURNEYS_FROM: string | null
export function commitCascadeProblems(range: string, root?: string, from?: string | null): { sha: string; subject: string; problems: string[] }[]
export function main(argv: string[]): void
