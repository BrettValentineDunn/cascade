export interface Marker { id: string; rule: string; why: string; who: string; date: string; file: string; line: number }
export interface Malformed { file: string; line: number; text: string; problem: string }
export interface Hunks { old: number[][]; new: number[][]; oldPath: string | null }
export interface Pin { file: string; line: number; title: string }
export interface DecisionChange { touched: Marker[]; removed: Marker[]; added: Marker[] }
export const DECISION_ROOTS: string[]
export const TEST_ROOTS: string[]
export const INDEX_FILE: string
export const DECISIONS_FROM: string | null
export const NEAR_ABOVE: number
export const NEAR_BELOW: number
export function isDecisionFile(file: string): boolean
export function parseMarkers(text: string, file?: string): { markers: Marker[]; malformed: Malformed[] }
export function scanMarkers(root?: string, read?: (file: string) => string): { markers: Marker[]; malformed: Malformed[] }
export function testPins(root?: string, read?: (file: string) => string): Map<string, Pin[]>
export function byId(markers: Marker[]): Map<string, Marker[]>
export function decisionProblems(scanned: { markers: Marker[]; malformed: Malformed[] }, pins: Map<string, Pin[]>): string[]
export function deliberateMessage(id: string, markers: Marker[]): string
export function renderIndex(markers: Marker[], pins: Map<string, Pin[]>): string
export function indexShape(text: string): string
export function parseHunks(diffText: string | null | undefined): Record<string, Hunks>
export function decisionsInChange(
  files: { file: string; old: string | null; new: string | null; hunks: Hunks | null; oldPath?: string | null }[],
): DecisionChange
export function decisionsBetween(from: string | null, to: string, root?: string): DecisionChange
export function decisionsInCommit(sha: string, root?: string): DecisionChange
export function decisionsInWorktree(options?: { staged?: boolean; root?: string }): DecisionChange
export function decisionsInFiles(files: string[], root?: string): Marker[]
export function decisionMessageProblems(message: string, change: { touched: { id: string }[]; removed?: { id: string }[] }): string[]
export function decisionsTemplate(change: { touched: { id: string }[]; removed?: { id: string }[]; added?: { id: string }[] }): string | null
export function parseProposal(text: string): { what: string; files: string[] }[]
export function proposalLookup(
  changes: { what: string; files: string[] }[],
  markers: Marker[],
  anchoredIn?: (files: string[]) => Marker[],
): { what: string; files: string[]; anchored: (Marker & { shared: number })[]; related: (Marker & { shared: number })[] }[]
