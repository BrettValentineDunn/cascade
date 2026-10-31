import type { CascadeConfig } from './index'
export const CONFIG_FILE: string
export const ROOT: string
export function findRoot(from?: string): string
export function load(ref: string): Promise<any>
export function fileOf(ref: string): string
export function listWords(items: string[]): string
declare const config: CascadeConfig
export default config
