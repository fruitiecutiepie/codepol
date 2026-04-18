import type { PolicyFile } from '../policy/policyTypes';

/**
 * Full codepol configuration.
 *
 * This is the schema for `codepol.toml`. All enforcement behavior is expressed
 * as policy rules; there are no top-level runtime flags.
 *
 * External linters (ESLint, Biome, Ruff) are enabled by referencing the
 * corresponding bridge rule from `@codepol/plugin` and configuring the tool
 * via its per-rule `args`:
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
 * [[rules]]
 * ruleId = "@codepol/plugin/eslint"
 * targets = ["typescript-src"]
 * args.configPath = "./eslint.config.mjs"
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
