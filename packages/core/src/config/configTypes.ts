import type { PolicyFile } from '../policy/policyTypes';

/**
 * Full codepol configuration.
 *
 * This is the schema for `codepol.toml`. Codepol rules live under `[[rules]]`,
 * while external analyzer executions live under top-level `tools`.
 *
 * External linters (ESLint, Biome, Ruff) are configured under `tools`:
 *
 * @example
 * ```toml
 * [[plugins]]
 * id = "@codepol/plugin"
 * source = { kind = "builtin" }
 *
 * [targets.typescript-src]
 * language = "typescript"
 * files = ["src/**\/*.ts"]
 *
 * [tools.eslint]
 * [[tools.eslint.runs]]
 * targets = ["typescript-src"]
 * configPath = "./eslint.config.mjs"
 * ```
 */
export type CodepolConfig = PolicyFile;

/**
 * Result of config file discovery and loading.
 */
export type ConfigFileResult = {
  /** The loaded and parsed configuration */
  config: CodepolConfig;
  /** Absolute path to the config file that was loaded */
  configPath: string;
};
