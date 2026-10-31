export function liveSurfaces(lists: { roots: string[]; files?: string[]; skip?: string[]; classified?: string[]; docsRoot?: string }): {
  liveSurfaceFiles: (root?: string) => string[]
  isLiveSurface: (file: string) => boolean
  unclassifiedDocs: (root?: string) => string[]
}
