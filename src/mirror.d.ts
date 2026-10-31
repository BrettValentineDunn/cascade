export function buildMirror(name: string, source: string): string
export function syncMirror(options?: { check?: boolean; modules?: string[] }): Promise<boolean>
export function main(argv: string[]): Promise<void>
