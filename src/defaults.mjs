// What each missing config section means: its check is off.

/** The config with every missing section filled with its "off" value. */
export function withDefaults(raw = {}) {
  const surfaces = raw.surfaces ?? {}
  const mobile = raw.mobile ?? null
  return {
    ...raw,
    checklist: raw.checklist ?? null,
    from: { ...(raw.from ?? {}) },
    approver: raw.approver ?? 'approver',
    design: { ...(raw.design ?? {}) },
    map: raw.map ?? null,
    journeys: raw.journeys ?? null,
    facts: raw.facts ?? null,
    releaseNotes: raw.releaseNotes ?? [],
    surfaces: {
      ...surfaces,
      kinds: surfaces.kinds ?? {},
      marketingRoots: surfaces.marketingRoots ?? [],
      notMarketing: surfaces.notMarketing ?? [],
      notMarketingWords: surfaces.notMarketingWords ?? '',
      docsKeys: surfaces.docsKeys ?? (() => new Set()),
      marketingKeys: surfaces.marketingKeys ?? (() => new Set()),
      live: surfaces.live ?? null,
    },
    api: raw.api ?? null,
    decisions: raw.decisions ? { tests: [], skip: [], ...raw.decisions } : { roots: [], tests: [], index: null, skip: [] },
    copyClaims: raw.copyClaims ? { roots: [], skip: /$^/, ...raw.copyClaims } : { roots: [], skip: /$^/, registry: null },
    quickTests: { runEverything: [], tests: 'tests/', dir: 'tests/unit', sources: [], ...(raw.quickTests ?? {}) },
    mobile: mobile && {
      callers: [],
      ...mobile,
      shared: mobile.shared ? { generator: 'npx cascade sync-mobile', run: 'npx cascade sync-mobile', ...mobile.shared } : null,
    },
  }
}
