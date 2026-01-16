import { Result } from '../result/result';

/**
 * Configuration for importing the logger module.
 *
 * @example
 * ```json
 * {
 *   "module": "@org/logger",
 *   "named": "logger"
 * }
 * ```
 */
export type LoggerImportConfig = {
  /** The module specifier to import from (e.g., '@org/logger') */
  module: string;
  /** The named export to import (e.g., 'logger') */
  named: string;
};

/**
 * Configuration for the logger instrumentation.
 * Defines the identifier, methods, and import details for logging.
 *
 * @example
 * ```json
 * {
 *   "identifier": "logger",
 *   "enterMethod": "enter",
 *   "exitMethod": "exit",
 *   "import": { "module": "@org/logger", "named": "logger" }
 * }
 * ```
 */
export type LoggerConfig = {
  /** The variable name used to reference the logger (e.g., 'logger') */
  identifier: string;
  /** The method name called on function entry (e.g., 'enter') */
  enterMethod: string;
  /** The method name called on function exit (e.g., 'exit') */
  exitMethod: string;
  /** Import configuration for the logger module */
  import: LoggerImportConfig;
};

/**
 * Declaration for loading a policy plugin.
 * Accepts either a module string directly or an object with a module property.
 * Plugins must use a default export containing an array of CodepolRulePlugin objects.
 *
 * @example
 * ```json
 * // String shorthand
 * "plugins": ["@codepol/plugin"]
 *
 * // Object format
 * "plugins": [{ "module": "@codepol/plugin" }]
 * ```
 */
export type PolicyPluginDeclaration = string | { module: string };

export type PolicyRuleTarget = {
  /** Target language adapter or parser identifier */
  language: string;
  /** Optional parser identifier override */
  parser?: string;
  /** Glob patterns for files to include */
  files: string[];
  /** Optional glob patterns for files to exclude */
  exclude?: string[];
};

/**
 * A single policy rule that defines which files to check and how.
 */
export type PolicyRule = {
  /** Unique identifier for this rule (optional, defaults to ruleId) */
  id?: string;
  /** The plugin rule identifier (namespaced, e.g. @org/plugin/rule-id) */
  ruleId: string;
  /** Human-readable description of what this rule enforces */
  description?: string;
  /** Rule-specific arguments passed to the rule provider */
  args?: unknown;
  /** Language-specific targets this rule should enforce */
  targets: PolicyRuleTarget[];
};

/**
 * The complete policy file structure.
 * This is the schema for policy.json files.
 */
export type PolicyFile = {
  /** Optional JSON schema reference */
  $schema?: string;
  /** Array of policy rules to enforce */
  rules: PolicyRule[];
  /** Global exclusion patterns applied to all rules */
  exclude?: string[];
  /** Plugin declarations used by this policy */
  plugins?: PolicyPluginDeclaration[];
};

/**
 * Context passed to plugin checks.
 */
export type PolicyCheckContext = {
  /** Absolute path to the file being checked */
  filePath: string;
  /** File contents */
  source: string;
  /** Loaded policy definition */
  policy: PolicyFile;
  /** Working directory used for resolution */
  dir: string;
  /** Target definition used to resolve this check */
  target: PolicyRuleTarget;
  /** Resolved arguments for the rule */
  ruleArgs?: unknown;
};

/**
 * Plugin struct for policy checks.
 */
export type TreeCheckProvider = {
  /** Supported languages */
  languages: string[];
  /** Check a file against a rule */
  check: (rule: PolicyRule, context: PolicyCheckContext) => Result<PolicyViolation[], string>;
};

/**
 * Context passed to lint providers.
 */
export type LintProviderContext = {
  /** Current working directory */
  cwd: string;
  /** Loaded policy definition */
  policy: PolicyFile;
  /** Policy path used for loading */
  policyPath: string;
  /** Rule id associated with the provider (for rule-level plugins) */
  ruleId: string;
  /** Rule-level arguments passed from the policy */
  ruleArgs?: unknown;
  /** Rule targets resolved from the policy */
  ruleTargets?: PolicyRuleTargetContext[];
};

/**
 * Generic lint provider capability.
 * Each platform (ESLint, Biome, Ruff, etc.) implements this interface.
 */
export type LintProvider<TConfig = unknown> = {
  /** Platform discriminator (e.g., 'eslint', 'biome', 'ruff') */
  platform: string;
  /** Languages this provider supports */
  languages: string[];
  /** Platform-specific configuration */
  config: TConfig;
};

/**
 * ESLint-specific provider configuration.
 */
export type EslintProviderConfig = {
  /** ESLint plugin name to register under */
  pluginName: string;
  /** ESLint rule map */
  rules: Record<string, unknown>;
  /** Optional ESLint config presets */
  configs?: Record<string, unknown>;
  /** Build ESLint rule configuration */
  rulesConfigGet: (context: LintProviderContext) => Record<string, unknown>;
};

/**
 * Context passed to fix providers.
 */
export type FixProviderContext = {
  /** Current working directory */
  cwd: string;
  /** Loaded policy definition */
  policy: PolicyFile;
  /** Policy path used for loading */
  policyPath: string;
  /** Files matched by policy rules */
  files: string[];
  /** Rule targets resolved from the policy */
  ruleTargets?: PolicyRuleTargetContext[];
};

/**
 * Fix provider capability.
 */
export type FixProvider = {
  /** Apply fixes for matched files */
  apply: (context: FixProviderContext) => void | Promise<void>;
};

/**
 * Plugin capability contract.
 */
export type PolicyPluginCapabilities = {
  /** Lint providers for different platforms */
  lintProviders?: LintProvider[];
  /** Optional Tree-sitter check provider */
  treeCheckProvider?: TreeCheckProvider;
  /** Optional fix provider */
  fixProvider?: FixProvider;
};

/**
 * Brand symbol for CodepolRulePlugin - ensures plugins are created via rulePluginCreate().
 * @internal
 */
declare const RulePluginBrand: unique symbol;

/**
 * Input configuration for creating a rule plugin.
 * Use rulePluginCreate() to convert this to a CodepolRulePlugin.
 */
export type RulePluginConfig = {
  /**
   * Rule identifier. Must NOT contain '/' - this character is reserved for namespacing.
   * Codepol will automatically namespace your ID (e.g., "my-rule" becomes "@scope/plugin/my-rule").
   */
  id: string;
  /** Capability bundle for this rule */
  capabilities: PolicyPluginCapabilities;
};

/**
 * Stable per-rule plugin interface for Codepol capabilities.
 * Must be created using rulePluginCreate() to ensure valid rule IDs.
 */
export type CodepolRulePlugin = RulePluginConfig & {
  /** @internal Brand to enforce creation via rulePluginCreate() */
  readonly [RulePluginBrand]: true;
};

/**
 * Creates a validated CodepolRulePlugin.
 * This is the only way to create a rule plugin - direct object literals won't type-check.
 *
 * @param config - Rule plugin configuration
 * @returns A branded CodepolRulePlugin
 * @throws Error if the rule ID contains '/'
 *
 * @example
 * ```typescript
 * import { rulePluginCreate } from '@codepol/core';
 *
 * export const myRule = rulePluginCreate({
 *   id: 'no-todo-comments',  // ✓ Valid - no '/'
 *   capabilities: {
 *     treeCheckProvider: myTreeCheckProvider,
 *   },
 * });
 *
 * export default [myRule];
 * ```
 */
export function rulePluginCreate(config: RulePluginConfig): CodepolRulePlugin {
  if (config.id.includes('/')) {
    throw new Error(
      `Rule plugin id "${config.id}" must not contain '/'. ` +
      `The '/' character is reserved for namespacing (e.g., "@scope/plugin/rule-id").`
    );
  }
  return config as CodepolRulePlugin;
}

/**
 * A resolved rule plugin.
 */
export type RulePlugin = {
  rulePlugin: CodepolRulePlugin;
};

/**
 * Represents a single policy violation found during checking.
 */
export type PolicyViolation = {
  /** The rule ID that was violated */
  ruleId: string;
  /** Absolute path to the file containing the violation */
  filePath: string;
  /** Human-readable message describing the violation */
  message: string;
  /** 1-based line number where the violation occurs */
  line: number;
  /** 1-based column number where the violation occurs */
  column: number;
};

/**
 * Internal type representing a rule matched to its target files.
 */
export type RuleMatch = {
  /** The policy rule */
  rule: PolicyRule;
  /** The policy target for this match */
  target: PolicyRuleTarget;
  /** Absolute paths to files matching this rule */
  files: string[];
};

/**
 * Target context for a policy rule and its semantics.
 */
export type PolicyRuleTargetContext = {
  /** Rule identifier */
  ruleId: string;
  /** Description for the rule */
  description?: string;
  /** Rule-specific arguments */
  args?: unknown;
  /** Target definition */
  target: PolicyRuleTarget;
};

// ============================================================================
// Tree-Check to Lint Provider Adapter Types
// ============================================================================

/**
 * Generic lint diagnostic that any lint provider can consume.
 * Platform-agnostic representation of a linting issue.
 */
export type LintDiagnostic = {
  /** Human-readable message describing the issue */
  message: string;
  /** 1-based line number where the issue occurs */
  line: number;
  /** 1-based column number where the issue occurs */
  column: number;
  /** Optional 1-based end line number */
  endLine?: number;
  /** Optional 1-based end column number */
  endColumn?: number;
  /** The rule ID that produced this diagnostic */
  ruleId: string;
  /** Severity level of the diagnostic */
  severity: 'error' | 'warning' | 'info';
};

/**
 * Options for adapting a TreeCheckProvider to a lint provider rule.
 */
export type TreeCheckAdapterOptions = {
  /** Rule name for the generated lint rule */
  ruleName?: string;
  /** URL to rule documentation */
  ruleUrl?: string;
  /** Default severity for violations (default: 'error') */
  severity?: 'error' | 'warning';
  /** Path to the policy.json file */
  policyPath?: string;
};

/**
 * Adapter contract for converting TreeCheckProvider to lint provider rules.
 * Each lint platform (ESLint, Biome, Ruff, etc.) implements this interface.
 *
 * @typeParam TRule - The platform-specific rule type produced by the adapter
 */
export type TreeCheckLintAdapter<TRule> = {
  /** Platform identifier (e.g., 'eslint', 'biome', 'ruff') */
  platform: string;
  /** Adapt a TreeCheckProvider to a platform-specific lint rule */
  adapt: (provider: CodepolRulePlugin, options?: TreeCheckAdapterOptions) => TRule;
};
