/**
 * @packageDocumentation
 * @codepol/core - Core policy loading, scanning, and enforcement for codepol.
 *
 * This package provides the foundation for policy-driven code enforcement:
 * - Load and parse policy.json files
 * - Scan TypeScript files using Tree-sitter for structural analysis
 * - Detect missing logger instrumentation
 * - Format and report violations
 *
 * @example
 * ```typescript
 * import {
 *   loadPolicy,
 *   scanWithPolicy,
 *   formatTreeViolations
 * } from '@codepol/core';
 *
 * const policy = loadPolicy('./policy.json');
 * const violations = await scanWithPolicy(policy, process.cwd());
 *
 * if (violations.length > 0) {
 *   console.log(formatTreeViolations(violations, process.cwd()));
 *   process.exit(1);
 * }
 * ```
 */

// Types
export type {
  LoggerImportConfig,
  LoggerConfig,
  PolicyRule,
  PolicyFile,
  PolicyViolation,
  RuleMatch,
} from './types';

// Policy loading
export {
  loadPolicy,
  clearPolicyCache,
  matchesAny,
  isFileCovered,
  collectRuleMatches,
} from './policy-loader';

// Tree-sitter scanning
export {
  scanFileForViolations,
  scanWithPolicy,
} from './scanner';

// Runner
export type {
  PolicyRunOptions,
  PolicyRunResult,
} from './runner';

export {
  runPolicyChecks,
  formatTreeViolations,
} from './runner';
