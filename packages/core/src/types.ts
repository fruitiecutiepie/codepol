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
export interface LoggerImportConfig {
  /** The module specifier to import from (e.g., '@org/logger') */
  module: string;
  /** The named export to import (e.g., 'logger') */
  named: string;
}

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
export interface LoggerConfig {
  /** The variable name used to reference the logger (e.g., 'logger') */
  identifier: string;
  /** The method name called on function entry (e.g., 'enter') */
  enterMethod: string;
  /** The method name called on function exit (e.g., 'exit') */
  exitMethod: string;
  /** Import configuration for the logger module */
  import: LoggerImportConfig;
}

/**
 * Metadata about policy plugins and their configuration.
 */
export interface PolicyPlugins {
  /** Module specifiers or local paths to load policy plugins from. */
  plugins?: string[];
  /** Plugin-specific configuration keyed by plugin type. */
  pluginConfig?: Record<string, unknown>;
}

/**
 * A single policy rule that defines which files to check and how.
 *
 * @example
 * ```json
 * {
 *   "id": "function-logging",
 *   "description": "Ensure all exported functions have logger instrumentation",
 *   "language": "typescript",
 *   "files": ["src/**\/*.ts"],
 *   "exclude": ["**\/*.spec.ts"],
 *   "type": "logger",
 *   "config": {}
 * }
 * ```
 */
export interface PolicyRule {
  /** Unique identifier for this rule */
  id: string;
  /** Human-readable description of what this rule enforces */
  description: string;
  /** Target language: 'typescript' for .ts files, 'tsx' for .tsx only */
  language: 'typescript' | 'tsx';
  /** Glob patterns for files to include */
  files: string[];
  /** Optional glob patterns for files to exclude */
  exclude?: string[];
  /** Plugin type to execute for this rule */
  type: string;
  /** Plugin-specific rule configuration */
  config: Record<string, unknown>;
}

/**
 * The complete policy file structure.
 * This is the schema for policy.json files.
 *
 * @example
 * ```json
 * {
 *   "$schema": "./policy.schema.json",
 *   "plugins": ["@codepol/plugin-logger"],
 *   "pluginConfig": {
 *     "logger": {
 *       "identifier": "logger",
 *       "enterMethod": "enter",
 *       "exitMethod": "exit",
 *       "import": { "module": "@org/logger", "named": "logger" }
 *     }
 *   },
 *   "rules": [...],
 *   "exclude": ["dist/**"]
 * }
 * ```
 */
export interface PolicyFile extends PolicyPlugins {
  /** Optional JSON schema reference */
  $schema?: string;
  /** Array of policy rules to enforce */
  rules: PolicyRule[];
  /** Global exclusion patterns applied to all rules */
  exclude?: string[];
}

/**
 * Represents a single policy violation found during scanning.
 */
export interface PolicyViolation {
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
}

/**
 * Internal type representing a rule matched to its target files.
 */
export interface RuleMatch {
  /** The policy rule */
  rule: PolicyRule;
  /** Absolute paths to files matching this rule */
  files: string[];
}
