export interface Journey { id: string; importance: number; name: string; areas: string[]; spec: string | null; [field: string]: unknown }
export const JOURNEYS: Journey[]
export function journeysForAreas<J extends Journey = Journey>(areaIds: string[], journeys?: J[]): J[]
export function alwaysWalked(journeys?: Journey[]): string[]
