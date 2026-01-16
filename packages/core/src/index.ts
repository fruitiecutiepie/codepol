/**
 * @packageDocumentation
 * @codepol/core - Core policy loading, checking, and enforcement for codepol.
 *
 * This package provides the foundation for policy-driven code enforcement:
 * - Load and parse policy.json files
 * - Check TypeScript files using web-tree-sitter (WASM) for structural analysis
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
 * // Initialize the WASM parser before checking
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
  PolicyRuleTarget,
  PolicyRuleTargetContext,
  PolicyFile,
  TreeCheckProvider,
  LintProviderContext,
  LintProvider,
  EslintProviderConfig,
  FixProviderContext,
  FixProvider,
  PolicyPluginCapabilities,
  RulePluginConfig,
  CodepolRulePlugin,
  RulePlugin,
  PolicyPluginDeclaration,
  PolicyCheckContext,
  PolicyViolation,
  RuleMatch,
  // Adapter types
  LintDiagnostic,
  TreeCheckAdapterOptions,
  TreeCheckLintAdapter,
} from './types';

export { rulePluginCreate } from './types';

import type {
  CodepolRulePlugin,
  LintProvider,
  LintProviderContext,
  EslintProviderConfig,
} from './types';

/**
 * Factory for creating ESLint lint providers.
 */
export function eslintProviderCreate(config: {
  languages: string[];
  pluginName: string;
  rules: Record<string, unknown>;
  configs?: Record<string, unknown>;
  rulesConfigGet: (ctx: LintProviderContext) => Record<string, unknown>;
}): LintProvider {
  const eslintConfig: EslintProviderConfig = {
    pluginName: config.pluginName,
    rules: config.rules,
    configs: config.configs,
    rulesConfigGet: config.rulesConfigGet,
  };
  return {
    platform: 'eslint',
    languages: config.languages,
    config: eslintConfig,
  };
}

/**
 * Derive supported languages from all providers in a rule plugin.
 */
export function rulePluginLanguagesGet(plugin: CodepolRulePlugin): string[] {
  const languages = new Set<string>();
  const lintProviders = plugin.capabilities.lintProviders ?? [];
  for (const provider of lintProviders) {
    for (const lang of provider.languages) {
      languages.add(lang);
    }
  }
  const treeCheckProvider = plugin.capabilities.treeCheckProvider;
  if (treeCheckProvider) {
    for (const lang of treeCheckProvider.languages) {
      languages.add(lang);
    }
  }
  return Array.from(languages);
}

// Policy loading
export {
  policyFileGet,
  policyCacheClear,
  globPatternsGetMatchAny,
  policyFileGetChecked,
  ruleTargetMatchesLanguage,
  ruleMatchesGet,
} from './policy/policyGet';

// Tree-sitter checking
export { parserInit, parserGetForFile } from './parser/parserInit';
export {
  policyViolationsGetForFile,
  policyViolationsGetFromDir,
} from './policy/policyTreeCheck';

// Languages
export type { Lang } from './parser/parserLangs';
export { langAdd, langsGet, wasmPathGet } from './parser/parserLangs';

// Plugins
export type { PolicyPluginsMap } from './policy/policyPluginsGet';
export {
  policyPluginsGet,
  pluginGetForRule,
} from './policy/policyPluginsGet';

// Runner
export type {
  PolicyCheckOptions,
  PolicyCheckResult,
} from './policy/policyCheck';

export {
  policyCheck,
  policyViolationsGetOutputPretty,
} from './policy/policyCheck';

// Tree-check to lint provider adapters
export {
  violationToLintDiagnostic,
  violationsToLintDiagnostics,
} from './adapter/treeCheckAdapter';

// Result
export {
  Result,
  Ok,
  Err,
  isOk,
  isErr,
  resultFrom,
  resFrom,
  resultFromAsync,
  resFromAsync,
} from './result/result';
