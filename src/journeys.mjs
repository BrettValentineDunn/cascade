// The customer's-day journeys a change passes through. The project's list is data
// (config journeys: 'path/to/journeys.mjs#JOURNEYS'), each entry
//   { id, importance (1 daily core work, 2 regular, 3 occasional), name, areas, spec }
// where `areas` are impact-map area ids and `spec` the automated walk, or null.

import config, { load } from './config.mjs'

/** The project's journeys (config journeys), or none. */
export const JOURNEYS = config.journeys ? (await load(config.journeys)) ?? [] : []

/** The journeys a change passes through: every journey sharing an area with it, importance first. */
export function journeysForAreas(areaIds, journeys = JOURNEYS) {
  const set = new Set(areaIds)
  return journeys.filter((j) => j.areas.some((a) => set.has(a))).sort((a, b) => a.importance - b.importance || a.id.localeCompare(b.id))
}

/** The journeys every release walks whatever it changed: the importance-1 ones. */
export function alwaysWalked(journeys = JOURNEYS) {
  return journeys.filter((j) => j.importance === 1).map((j) => j.id)
}
