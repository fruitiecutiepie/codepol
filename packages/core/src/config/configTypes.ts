import type { PolicyFile } from '../policy/policyTypes';

/**
 * Runtime configuration options for codepol.
 * These options control how codepol runs, separate from policy rules.
 */
export type CodepolConfigOptions = {
  /**
   * Path to ESLint config file.
   * If not specified, auto-detected from common locations.
   * @example './eslint.config.ts'
   */
  eslintConfigPath?: string;
};

/**
 * Full codepol configuration combining policy definition and runtime options.
 * This is the schema for codepol.config.ts files.
 *
 * @example
 * ```typescript
 * // codepol.config.ts
 * import { defineConfig } from '@codepol/core';
 *
 * export default defineConfig({
 *   eslintConfigPath: './eslint.config.ts',
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
 *     },
 *   ],
 * });
 * ```
 */
export type CodepolConfig = PolicyFile & CodepolConfigOptions;

/**
 * Result of config file discovery and loading.
 */
export type ConfigFileResult = {
  /** The loaded and parsed configuration */
  config: CodepolConfig;
  /** Absolute path to the config file that was loaded */
  configPath: string;
};
