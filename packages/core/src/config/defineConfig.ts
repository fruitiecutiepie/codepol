import type { CodepolConfig } from './configTypes';

/**
 * Type-safe helper for creating codepol configurations.
 * Provides autocomplete and type checking for config files.
 *
 * @param config - The codepol configuration object
 * @returns The same configuration object (identity function for type inference)
 *
 * @example
 * ```typescript
 * // codepol.config.ts
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
