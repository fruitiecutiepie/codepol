import type { CodepolConfig } from './configTypes';

/**
 * Type-safe helper for creating codepol configurations.
 * Provides autocomplete and type checking for legacy in-process config authoring.
 * `codepol.toml` is the runtime config format; this helper is still useful for
 * tests or advanced hosts that build config objects in code.
 *
 * @param config - The codepol configuration object
 * @returns The same configuration object (identity function for type inference)
 *
 * @example
 * ```typescript
 * // legacy config object helper
 * import { defineConfig } from '@codepol/core';
 *
 * export default defineConfig({
 *   plugins: ['@codepol/plugin'],
 *   targets: {
 *     'typescript-src': {
 *       language: 'typescript',
 *       files: ['src/**\/*.ts'],
 *     },
 *   },
 *   rules: [
 *     {
 *       ruleId: 'require-logger-enter-exit',
 *       targets: ['typescript-src'],
 *       args: {
 *         logger: {
 *           identifier: 'logger',
 *           enterMethod: 'enter',
 *           exitMethod: 'exit',
 *           import: { module: '@org/logger', named: 'logger' },
 *         },
 *       },
 *     },
 *   ],
 *   exclude: ['dist/**'],
 * });
 * ```
 */
export function defineConfig(config: CodepolConfig): CodepolConfig {
  return config;
}
