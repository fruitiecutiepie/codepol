import { Result } from '../result/result';
import type { ProjectIndex } from '../index/indexQuery';
import type { ByteRange } from '../index/indexTypes';
import type { ModuleGraph } from '../index/moduleGraph';

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
 * Plugin resolution is transport-neutral: built-in plugins are registered
 * in-process, while external plugins can be invoked as subprocesses.
 *
 * @example
 * ```json
 * {
 *   "id": "@codepol/plugin",
 *   "source": { "kind": "builtin" }
 * }
 *
 * {
 *   "id": "acme/process-plugin",
 *   "source": {
 *     "kind": "process",
 *     "command": "python3",
 *     "args": ["./tools/codepol_plugin.py"]
 *   }
 * }
 * ```
 */
export type PolicyBuiltinPluginSource = {
  /** Resolve the plugin from the in-process builtin registry */
  kind: 'builtin';
};

export type PolicyProcessPluginSource = {
  /** Invoke the plugin executable using the process protocol */
  kind: 'process';
  /** Executable or script to launch */
  command: string;
  /** Optional command arguments */
  args?: string[];
  /**
   * Optional working directory for process execution.
   * Relative paths resolve from the config file directory when available.
   */
  cwd?: string;
  /** Optional extra environment variables for the plugin process */
  env?: Record<string, string>;
  /** Optional request timeout in milliseconds */
  timeoutMs?: number;
};

export type PolicyPluginSource = PolicyBuiltinPluginSource | PolicyProcessPluginSource;

export type PolicyPluginDeclaration = {
  /** Stable plugin identifier used for rule namespacing */
  id: string;
  /** Transport-specific plugin source configuration */
  source: PolicyPluginSource;
};

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
 * Named target definitions that rules can reference.
 * Keys are target names, values are target definitions.
 */
export type PolicyTargetMap = Record<string, PolicyRuleTarget>;

/** Lint severity level */
export type LintSeverity = 'error' | 'warn' | 'off';

/**
 * Fix application policy for a rule.
 *
 * - `on-save`: the rule participates in `source.fixAll.codepol` code actions
 *   and is applied automatically when editors trigger `editor.codeActionsOnSave`.
 * - `manual`: fixes are exposed only as per-diagnostic quickfixes; nothing
 *   runs automatically.
 * - `never`: no fix surface at all — no quickfix, no on-save participation.
 */
export type PolicyRuleFixMode = 'on-save' | 'manual' | 'never';

/**
 * A single policy rule that defines which files to check and how.
 * References named targets defined in the top-level `targets` map.
 */
export type PolicyRule = {
  /** Unique identifier for this rule (optional, defaults to ruleId) */
  id?: string;
  /** The plugin rule identifier (namespaced, e.g. @org/plugin/rule-id) */
  ruleId: string;
  /** Human-readable description of what this rule enforces */
  description?: string;
  /** Lint severity level (default: 'error') */
  severity?: LintSeverity;
  /** Providers to apply this rule to (default: all providers). e.g., ['eslint', 'tree-sitter'] */
  providers?: string[];
  /** Rule-specific arguments passed to the rule provider */
  args?: unknown;
  /** Array of target names referencing entries in top-level targets */
  targets: string[];
  /**
   * How autofixes for this rule should be surfaced.
   *
   * When omitted the effective mode is `manual`. When `severity = "off"` the
   * effective mode is forced to `never` regardless of the declared value.
   */
  fix?: PolicyRuleFixMode;
};

/**
 * The complete policy file structure.
 * This is the schema for `codepol.toml`.
 */
export type PolicyFile = {
  /** Named target definitions that rules reference by name */
  targets: PolicyTargetMap;
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
  /** Absolute path to the loaded config file, when available */
  configPath?: string;
  /** Target definition used to resolve this check */
  target: PolicyRuleTarget;
  /** Resolved arguments for the rule */
  ruleArgs?: unknown;
  /**
   * Optional project-wide semantic index for cross-file analysis.
   * Only available when at least one plugin declares `requiresProjectIndex: true`.
   * Plugins should check for existence before using.
   */
  projectIndex?: ProjectIndex;
  /**
   * Diagnostics handle scoped to this check invocation. Optional for
   * backwards compatibility — callers that omit it will have plugins fall
   * back to the process-wide runtime diagnostics. Plugins should always
   * prefer this field over reading env vars directly.
   */
  diag?: import('../diagnostics/diagnosticsTypes').Diagnostics;
};

/**
 * Plugin struct for policy checks.
 */
export type TreeCheckProvider = {
  /** Supported languages. Omit to support all target languages. */
  languages?: string[];
  /** Check a file against a rule */
  check: (rule: PolicyRule, context: PolicyCheckContext) => Result<PolicyViolation[], string>;
};

export function treeCheckProviderSupportsLanguage(
  provider: TreeCheckProvider,
  language: string
): boolean {
  return provider.languages === undefined || provider.languages.includes(language);
}

/**
 * Context passed to architecture-level checks.
 *
 * Architecture checks operate on the entire project graph rather than a
 * single file. They run once per matched rule and have access to the
 * fully-built {@link ProjectIndex} and {@link ModuleGraph}; they never
 * receive per-file source text because their concern is cross-file
 * structure (cycles, layering, reachability), not in-file syntax.
 */
export type ArchitectureCheckContext = {
  /** Working directory used to resolve any policy-relative paths */
  cwd: string;
  /** Loaded policy definition */
  policy: PolicyFile;
  /** Absolute path to the loaded config file, when available */
  configPath?: string;
  /** Project-wide semantic index (always present for architecture checks) */
  projectIndex: ProjectIndex;
  /** Module graph derived from the project index */
  moduleGraph: ModuleGraph;
  /** Resolved arguments for the rule */
  ruleArgs?: unknown;
  /** Resolved targets for the rule (for file-membership / layer queries) */
  ruleTargets?: PolicyRuleTargetContext[];
};

/**
 * Function signature for architecture checks. Returns violations
 * synchronously; runners wrap thrown exceptions into errors.
 */
export type ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
) => PolicyViolation[];

/**
 * Plugin capability for project-wide architecture rules.
 *
 * Architecture providers do not run per-file. The runner invokes
 * {@link ArchitectureCheckProvider.check} once per matched rule with the
 * full {@link ProjectIndex} and {@link ModuleGraph}. Declaring an
 * `architectureCheckProvider` implicitly requires the project index, so
 * authors do not need to also set `requiresProjectIndex`.
 */
export type ArchitectureCheckProvider = {
  /**
   * Optional language gate. Architecture rules are typically
   * language-agnostic; when specified the runner applies the rule only
   * when at least one of the rule's resolved targets matches one of these
   * languages.
   */
  languages?: string[];
  /** Run the architecture check */
  check: ArchitectureCheckFn;
};

/**
 * Returns true when the architecture check provider supports a given
 * target language. Architecture rules without an explicit `languages`
 * gate apply to every language (mirrors `treeCheckProviderSupportsLanguage`).
 */
export function architectureCheckProviderSupportsLanguage(
  provider: ArchitectureCheckProvider,
  language: string,
): boolean {
  return provider.languages === undefined || provider.languages.includes(language);
}

/**
 * Context passed to lint providers.
 */
export type LintProviderContext = {
  /** Current working directory */
  cwd: string;
  /** Loaded policy definition */
  policy: PolicyFile;
  /** Path to the config file that was loaded */
  configPath: string;
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
  /** ESLint plugin name to register under (default: 'codepol') */
  pluginName?: string;
  /** ESLint rule map */
  rules: Record<string, unknown>;
  /** Optional ESLint config presets */
  configs?: Record<string, unknown>;
  /** Options to pass to the ESLint rule. If not provided, defaults to {}. */
  ruleOptions?: (context: LintProviderContext) => unknown;
};

/**
 * Biome-specific provider configuration.
 */
export type BiomeProviderConfig = {
  /** Path to the biome binary (default: 'biome') */
  biomeBin?: string;
  /** Path to biome.json or biome.jsonc */
  configPath?: string;
  /** Extra CLI arguments */
  extraArgs?: string[];
};

/**
 * Ruff-specific provider configuration.
 */
export type RuffProviderConfig = {
  /** Path to the ruff binary (default: 'ruff') */
  ruffBin?: string;
  /** Ruff rule codes to enable (e.g., ['E', 'F', 'I']) */
  select?: string[];
  /** Ruff rule codes to ignore */
  ignore?: string[];
  /** Path to ruff.toml or pyproject.toml */
  configPath?: string;
  /** Fixable rule codes */
  fixable?: string[];
  /** Extra CLI arguments */
  extraArgs?: string[];
};

/**
 * Context passed to fix providers.
 */
export type FixProviderContext = {
  /** Current working directory */
  cwd: string;
  /** Loaded policy definition */
  policy: PolicyFile;
  /** Path to the config file that was loaded */
  configPath: string;
  /** Files matched by policy rules */
  files: string[];
  /** Rule targets resolved from the policy */
  ruleTargets?: PolicyRuleTargetContext[];
  /**
   * Optional project-wide semantic index for cross-file analysis.
   * Only available when at least one matched rule declares `requiresProjectIndex: true`.
   * Providers should check for existence before using.
   */
  projectIndex?: ProjectIndex;
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
  /**
   * Optional architecture check provider. Architecture providers operate
   * on the entire project graph (cycles, layer rules, dead modules) and
   * implicitly require the project index — authors do not need to also
   * set {@link PolicyPluginCapabilities.requiresProjectIndex}.
   */
  architectureCheckProvider?: ArchitectureCheckProvider;
  /** Optional fix provider */
  fixProvider?: FixProvider;
  /**
   * Declare that this plugin requires project-wide semantic index.
   * When true, the core will build the index before running checks
   * and pass it via `context.projectIndex`.
   */
  requiresProjectIndex?: boolean;
};

/**
 * Returns true when the plugin capabilities require a project-wide
 * semantic index. Architecture check providers always require it; other
 * capabilities opt in via {@link PolicyPluginCapabilities.requiresProjectIndex}.
 */
export function pluginCapabilitiesRequireProjectIndex(
  capabilities: PolicyPluginCapabilities,
): boolean {
  if (capabilities.requiresProjectIndex) return true;
  if (capabilities.architectureCheckProvider) return true;
  return false;
}

/**
 * Brand symbol for CodepolPluginRule - ensures plugins are created via pluginRuleNew().
 * @internal
 */
declare const PluginRuleBrand: unique symbol;

/**
 * Input configuration for creating a rule plugin.
 * Use pluginRuleNew() to convert this to a CodepolPluginRule.
 */
export type PluginRuleConfig = {
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
 * Must be created using pluginRuleNew() to ensure valid rule IDs.
 */
export type CodepolPluginRule = PluginRuleConfig & {
  /** @internal Brand to enforce creation via pluginRuleNew() */
  readonly [PluginRuleBrand]: true;
};

/**
 * Creates a validated CodepolPluginRule.
 * This is the only way to create a rule plugin - direct object literals won't type-check.
 *
 * @param config - Rule plugin configuration
 * @returns A branded CodepolPluginRule
 * @throws Error if the rule ID contains '/'
 *
 * @example
 * ```typescript
 * import { pluginRuleNew } from '@codepol/core';
 *
 * export const myRule = pluginRuleNew({
 *   id: 'no-todo-comments',  // ✓ Valid - no '/'
 *   capabilities: {
 *     treeCheckProvider: myTreeCheckProvider,
 *   },
 * });
 *
 * export default [myRule];
 * ```
 */
export function pluginRuleNew(config: PluginRuleConfig): CodepolPluginRule {
  if (config.id.includes('/')) {
    throw new Error(
      `Rule plugin id "${config.id}" must not contain '/'. ` +
      `The '/' character is reserved for namespacing (e.g., "@scope/plugin/rule-id").`
    );
  }
  return config as CodepolPluginRule;
}

/**
 * A resolved rule plugin.
 */
export type PluginRule = {
  pluginRule: CodepolPluginRule;
};

/**
 * Fix data for an auto-fixable violation.
 * Provides the byte range and replacement text for ESLint/IDE inline fixes.
 */
export type PolicyViolationFix = {
  /** Byte offset range [start, end) in the source text to replace */
  byteRange: ByteRange;
  /** Replacement text (can be empty to delete the range) */
  text: string;
  /**
   * Optional workspace edits for multi-file fixes.
   * The primary `byteRange`/`text` pair remains the single-file edit used by
   * inline consumers such as ESLint; CLI-style consumers may apply `edits`
   * instead when present.
   */
  edits?: PolicyWorkspaceEdit[];
};

/**
 * A text edit against a specific file in the workspace.
 */
export type PolicyWorkspaceEdit = {
  /** Absolute path to the file containing the edit */
  filePath: string;
  /** Byte offset range [start, end) in that file */
  byteRange: ByteRange;
  /** Replacement text (can be empty to delete the range) */
  text: string;
};

/**
 * A single alternative fix (e.g. ESLint "suggest") when multiple valid replacements exist.
 */
export type PolicyFixSuggestion = {
  /** Short label shown in the IDE (e.g. "Rename to camelCase: fooBar") */
  message: string;
  fix: PolicyViolationFix;
};

/**
 * A file span for diagnostics. Used for optional end range and related locations.
 */
export type PolicyDiagnosticLocation = {
  /** Absolute path to the file */
  filePath: string;
  /** 1-based start line */
  line: number;
  /** 1-based start column */
  column: number;
  /** Optional 1-based end line (inclusive span semantics match primary violation) */
  endLine?: number;
  /** Optional 1-based end column */
  endColumn?: number;
  /** Optional short note for related locations */
  message?: string;
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
  /** Optional 1-based end line for the primary diagnostic range */
  endLine?: number;
  /** Optional 1-based end column for the primary diagnostic range */
  endColumn?: number;
  /** Additional spans (e.g. other export sites); consumers may degrade to extra reports */
  relatedLocations?: PolicyDiagnosticLocation[];
  /** Optional fix data for auto-fixable violations (inline ESLint/IDE fixes) */
  fix?: PolicyViolationFix;
  /** Optional alternative fixes when more than one valid replacement exists */
  suggestions?: PolicyFixSuggestion[];
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
  /** Additional spans (same semantics as PolicyViolation.relatedLocations) */
  relatedLocations?: PolicyDiagnosticLocation[];
  /** Optional fix data for auto-fixable diagnostics */
  fix?: PolicyViolationFix;
  /** Optional alternative fixes (e.g. ESLint suggestions) */
  suggestions?: PolicyFixSuggestion[];
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
  adapt: (provider: CodepolPluginRule, options?: TreeCheckAdapterOptions) => TRule;
};
