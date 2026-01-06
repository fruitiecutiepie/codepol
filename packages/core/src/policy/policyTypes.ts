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
 * Either a built-in plugin name or a module specifier must be provided.
 */
export type PolicyPluginDeclaration = {
  /** Built-in plugin identifier (e.g., 'logger') */
  builtin?: string;
  /** Module specifier or path to import */
  module?: string;
  /** Named export to load from the module */
  export?: string;
  /** Optional rule-level configuration overrides */
  rules?: PolicyPluginRuleDeclaration[];
};

/**
 * Optional rule-level configuration for a plugin.
 */
export type PolicyPluginRuleDeclaration = {
  /** Rule identifier exported by the plugin */
  id: string;
  /** Enable or disable the rule (default: true) */
  enabled?: boolean;
  /** Rule-specific arguments passed to the rule provider */
  args?: unknown;
};

/**
 * A single policy rule that defines which files to check and how.
 *
 * @example
 * ```json
 * {
 *   "id": "function-logging",
 *   "semantics": {
 *     "description": "Ensure all exported functions have logger instrumentation"
 *   },
 *   "targets": [
 *     {
 *       "language": "typescript",
 *       "files": ["src/**\/*.ts"],
 *       "exclude": ["**\/*.spec.ts"]
 *     }
 *   ]
 * }
 * ```
 */
export type PolicyRuleSemantics = {
  /** Human-readable description of what this rule enforces */
  description: string;
  /** Plugin type to handle this rule (defaults to 'logger') */
  type?: string;
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

export type PolicyRule = {
  /** Unique identifier for this rule */
  id: string;
  /** Semantic meaning for this rule */
  semantics: PolicyRuleSemantics;
  /** Language-specific targets this rule should enforce */
  targets: PolicyRuleTarget[];
};

/**
 * The complete policy file structure.
 * This is the schema for policy.json files.
 *
 * @example
 * ```json
 * {
 *   "$schema": "./policy.schema.json",
 *   "rules": [...],
 *   "exclude": ["dist/**"],
 *   "plugins": [
 *     {
 *       "module": "@codepol/plugin",
 *       "rules": [
 *         {
 *           "id": "require-logger-enter-exit",
 *           "args": {
 *             "logger": {
 *               "identifier": "logger",
 *               "enterMethod": "enter",
 *               "exitMethod": "exit",
 *               "import": { "module": "@org/logger", "named": "logger" }
 *             }
 *           }
 *         }
 *       ]
 *     }
 *   ]
 * }
 * ```
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
 * Context provided to plugin initialization hooks.
 */
export type PolicyPluginInitContext = {
  /** Current working directory used for resolution */
  cwd: string;
  /** Loaded policy definition */
  policy: PolicyFile;
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
};

/**
 * Plugin struct for policy checks.
 */
export type TreeCheckProvider = {
  /** Stable plugin identifier */
  id: string;
  /** Plugin version */
  version: string;
  /** Supported languages */
  languages: string[];
  /** Optional initialization hook */
  init?: (context: PolicyPluginInitContext) => void | Promise<void>;
  /** Check a file against a rule */
  check: (rule: PolicyRule, context: PolicyCheckContext) => PolicyViolation[];
};

/**
 * Context passed to ESLint rule providers.
 */
export type EslintRuleProviderContext = {
  /** Current working directory */
  cwd: string;
  /** Loaded policy definition */
  policy: PolicyFile;
  /** Policy path used for loading */
  policyPath: string;
  /** Rule id associated with the provider (for rule-level plugins) */
  ruleId?: string;
  /** Rule-level arguments passed from the policy */
  ruleArgs?: unknown;
  /** Rule targets resolved from the policy */
  ruleTargets?: PolicyRuleTargetContext[];
};

/**
 * ESLint rule provider capability.
 */
export type EslintRuleProvider = {
  /** ESLint plugin name to register under */
  pluginName: string;
  /** ESLint rule map */
  rules: Record<string, unknown>;
  /** Optional ESLint config presets */
  configs?: Record<string, unknown>;
  /** Build ESLint rule configuration */
  rulesConfigGet: (context: EslintRuleProviderContext) => Record<string, unknown>;
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
  /** Optional ESLint rule provider */
  eslintRuleProvider?: EslintRuleProvider;
  /** Optional Tree-sitter check provider */
  treeCheckProvider?: TreeCheckProvider;
  /** Optional fix provider */
  fixProvider?: FixProvider;
};

/**
 * Codepol plugin definition with optional capabilities.
 */
export type CodepolPlugin = {
  /** Stable plugin identifier */
  id: string;
  /** Plugin version */
  version: string;
  /** Capability providers */
  capabilities: PolicyPluginCapabilities;
};

/**
 * Plugin struct for policy checks.
 */
export type PolicyPlugin = TreeCheckProvider & {
  /** Optional capability providers */
  capabilities?: PolicyPluginCapabilities;
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
  /** Semantic definition for the rule */
  semantics: PolicyRuleSemantics;
  /** Target definition */
  target: PolicyRuleTarget;
};
