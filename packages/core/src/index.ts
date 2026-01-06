/**
 * @packageDocumentation
 * @codepol/core - Core policy loading, scanning, and enforcement for codepol.
 *
 * This package provides the foundation for policy-driven code enforcement:
 * - Load and parse policy.json files
 * - Scan TypeScript files using web-tree-sitter (WASM) for structural analysis
 * - Detect missing logger instrumentation
 * - Format and report violations
 *
 * @example
 * ```typescript
 * import {
 *   parserInit,
 *   policyFileGet,
 *   policyViolationsGetFromDir,
 *   policyViolationsGetOutputPretty
 * } from '@codepol/core';
 *
 * // Initialize the WASM parser before scanning
 * await parserInit();
 *
 * const policy = policyFileGet('./policy.json');
 * const violations = await policyViolationsGetFromDir(policy, process.cwd());
 *
 * if (violations.length > 0) {
 *   console.log(policyViolationsGetOutputPretty(violations, process.cwd()));
 *   process.exit(1);
 * }
 * ```
 */

// Types
export type {
  LoggerImportConfig,
  LoggerConfig,
  PolicyRule,
  PolicyRuleSemantics,
  PolicyRuleTarget,
  PolicyRuleTargetContext,
  PolicyFile,
  TreeScanProvider,
  EslintRuleProviderContext,
  EslintRuleProvider,
  FixProviderContext,
  FixProvider,
  PolicyPluginCapabilities,
  CodepolRulePlugin,
  CodepolPlugin,
  PolicyPlugin,
  PolicyPluginDeclaration,
  PolicyPluginRuleDeclaration,
  PolicyPluginInitContext,
  PolicyScanContext,
  PolicyViolation,
  RuleMatch,
} from './types';

// Policy loading
export {
  policyFileGet,
  globPatternsGetMatchAny,
  policyFileGetChecked,
  ruleMatchesGet,
} from './policy/policyGet';

// Tree-sitter scanning
export { parserInit } from './parser/parserInit';
export {
  policyViolationsGetForFile,
  policyViolationsGetFromDir,
} from './policy/policyScan';

// Languages
export type { Lang } from './parser/parserLangs';
export { langAdd, langsGet, wasmPathGet } from './parser/parserLangs';

// Plugins
export type { PolicyPluginsMap } from './policy/policyPluginsGet';
export {
  defaultPluginType,
  policyPluginsGet,
} from './policy/policyPluginsGet';
export { policyPluginLogger } from './policy/policyPluginLogger';

// Runner
export type {
  PolicyCheckOptions,
  PolicyCheckResult,
} from './policy/policyCheck';

export {
  policyCheck,
  policyViolationsGetOutputPretty,
} from './policy/policyCheck';
