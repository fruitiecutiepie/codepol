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
  LintSeverity,
  PolicyRule,
  PolicyRuleTarget,
  PolicyTargetMap,
  PolicyRuleTargetContext,
  PolicyFile,
  TreeCheckProvider,
  LintProviderContext,
  LintProvider,
  EslintProviderConfig,
  FixProviderContext,
  FixProvider,
  PolicyPluginCapabilities,
  PluginRuleConfig,
  CodepolPluginRule,
  PluginRule,
  PolicyPluginDeclaration,
  PolicyCheckContext,
  PolicyViolation,
  PolicyViolationFix,
  RuleMatch,
  // Adapter types
  LintDiagnostic,
  TreeCheckAdapterOptions,
  TreeCheckLintAdapter,
} from './types';

export { pluginRuleNew } from './types';

/** Default ESLint plugin name for codepol rules */
export const ESLINT_PLUGIN_NAME_DEFAULT = 'codepol';

import type {
  CodepolPluginRule,
  LintProvider,
  LintProviderContext,
  EslintProviderConfig,
  TreeCheckProvider,
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
  PolicyFile,
  PolicyRuleTargetContext,
  LintSeverity,
} from './types';

import { resultFrom, isErr } from './result/result';
import { policyRuleTargetsResolve } from './policy/policyGet';
import { policyPluginsGet, pluginGetForRule } from './policy/policyPluginsGet';
import { configGet, configGetFromPath } from './config/configDiscover';

/**
 * Consumer-facing check function type.
 * Returns plain violations array; errors are thrown as exceptions.
 */
export type TreeCheckFn = (
  rule: PolicyRule,
  context: PolicyCheckContext
) => PolicyViolation[];

/**
 * Factory for creating ESLint lint providers.
 */
export function eslintProviderCreate(config: {
  languages: string[];
  pluginName?: string;
  rules: Record<string, unknown>;
  configs?: Record<string, unknown>;
  ruleOptions?: (ctx: LintProviderContext) => unknown;
}): LintProvider {
  const eslintConfig: EslintProviderConfig = {
    pluginName: config.pluginName ?? ESLINT_PLUGIN_NAME_DEFAULT,
    rules: config.rules,
    configs: config.configs,
    ruleOptions: config.ruleOptions,
  };
  return {
    platform: 'eslint',
    languages: config.languages,
    config: eslintConfig,
  };
}

/**
 * Factory for creating TreeCheckProvider from a plain check function.
 * Wraps the check function with resultFrom to convert exceptions to Result.Err.
 *
 * @example
 * ```typescript
 * function myCheck(rule: PolicyRule, context: PolicyCheckContext): PolicyViolation[] {
 *   const violations: PolicyViolation[] = [];
 *   // ... check logic ...
 *   return violations;
 * }
 *
 * export const myProvider = treeCheckProviderNew({
 *   languages: ['typescript', 'tsx'],
 *   check: myCheck,
 * });
 * ```
 */
export function treeCheckProviderNew(config: {
  languages: string[];
  check: TreeCheckFn;
}): TreeCheckProvider {
  return {
    languages: config.languages,
    check: (rule, ctx) => resultFrom(() => config.check(rule, ctx)),
  };
}

/**
 * Derive supported languages from all providers in a rule plugin.
 */
export function rulePluginLanguagesGet(plugin: CodepolPluginRule): string[] {
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

/**
 * Generates lint provider rules config from codepol config.
 * Users spread this into their lint config (e.g., eslint.config.js).
 *
 * @param provider - The lint provider platform ('eslint')
 * @param configPath - Path to config file (auto-discovered if not specified)
 * @returns Rules config for the lint provider
 *
 * @example
 * ```javascript
 * // eslint.config.js
 * import { providerRulesConfigGet } from '@codepol/core';
 *
 * export default [{
 *   plugins: { codepol },
 *   rules: {
 *     ...await providerRulesConfigGet('eslint'),
 *   },
 * }];
 * ```
 */
export async function providerRulesConfigGet(
  provider: 'eslint',
  configPath?: string
): Promise<Record<string, unknown>> {
  const cwd = process.cwd();
  
  // Load config: explicit path or auto-discover
  const { config, configPath: resolvedConfigPath } = configPath
    ? await configGetFromPath(configPath)
    : await configGet(cwd);
  const policy = config;
  
  const pluginsResult = await policyPluginsGet(policy, cwd);
  if (isErr(pluginsResult)) {
    throw new Error(pluginsResult.Err);
  }
  const pluginsMap = pluginsResult.Ok;

  // Build rule targets context
  const ruleTargets: PolicyRuleTargetContext[] = [];
  for (const rule of policy.rules) {
    const resolvedTargets = policyRuleTargetsResolve(rule, policy);
    for (const target of resolvedTargets) {
      ruleTargets.push({
        ruleId: rule.ruleId,
        description: rule.description,
        args: rule.args,
        target,
      });
    }
  }

  const rules: Record<string, unknown> = {};

  for (const rule of policy.rules) {
    // Skip if rule specifies providers and this provider is not included
    if (rule.providers && rule.providers.length > 0 && !rule.providers.includes(provider)) {
      continue;
    }

    const lookup = pluginGetForRule(pluginsMap, rule.ruleId);
    if (!lookup) {
      throw new Error(`No plugin registered for rule ${rule.ruleId}`);
    }
    const { plugin, resolvedId } = lookup;

    // Find ESLint lint provider
    const lintProviders = plugin.pluginRule.capabilities.lintProviders ?? [];
    const eslintProvider = lintProviders.find(p => p.platform === provider);
    if (!eslintProvider) {
      continue; // Rule doesn't have this provider, skip
    }

    const eslintConfig = eslintProvider.config as EslintProviderConfig;
    
    // Extract short rule name
    const lastSlashIndex = resolvedId.lastIndexOf('/');
    const ruleNameShort = lastSlashIndex !== -1 ? resolvedId.slice(lastSlashIndex + 1) : resolvedId;
    
    const pluginName = eslintConfig.pluginName ?? ESLINT_PLUGIN_NAME_DEFAULT;
    const configKey = `${pluginName}/${ruleNameShort}`;

    if (rules[configKey]) {
      throw new Error(`Duplicate rule configuration: ${configKey}`);
    }

    // Get options from provider
    const options = eslintConfig.ruleOptions?.({
      cwd,
      policy,
      configPath: resolvedConfigPath,
      ruleId: resolvedId,
      ruleArgs: rule.args,
      ruleTargets,
    }) ?? {};

    // Use severity from policy.json, default to 'error'
    const severity: LintSeverity = rule.severity ?? 'error';
    rules[configKey] = [severity, options];
  }

  return rules;
}

// Policy loading
export {
  policyFileGet,
  policyCacheClear,
  policyRuleTargetsResolve,
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

// Config (unified config file support)
export type {
  CodepolConfig,
  CodepolConfigOptions,
  ConfigFileResult,
} from './config/configTypes';
export { defineConfig } from './config/defineConfig';
export {
  configGet,
  configGetSync,
  configGetFromPath,
  configGetFromPathSync,
  configFileDiscover,
  configCacheClear,
} from './config/configDiscover';
