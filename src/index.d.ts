export interface CascadeConfig { [section: string]: any }
export function defineConfig<T extends CascadeConfig>(config: T): T
export function withDefaults(raw?: CascadeConfig): CascadeConfig
