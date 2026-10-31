// What a project's cascade.config.mjs imports. Loads no config itself, so the
// config file can import it without a cycle.

export { withDefaults } from './defaults.mjs'

/** Identity, so a config file can say what it is: `export default defineConfig({ ... })`. */
export function defineConfig(config) {
  return config
}
