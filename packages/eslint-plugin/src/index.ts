/**
 * @packageDocumentation
 * @codepol/eslint-plugin - ESLint plugin adapter for codepol plugins.
 */

import type { CodepolRulePlugin, EslintProviderConfig } from '@codepol/core';

// Re-export adapter
export {
  eslintAdapter,
  eslintAdapterInit,
  policyCacheClear,
  clearPolicyCache,
  providerInitStateClear,
  clearProviderInitState,
} from './eslintAdapter';

/**
 * ESLint rule map type.
 */
type EslintRuleMap = Record<string, unknown>;

/**
 * ESLint plugin structure returned by the factory.
 */
export type EslintPlugin = {
  rules: EslintRuleMap;
};

function collectRules(rulePlugins: CodepolRulePlugin[]): EslintRuleMap {
  const collectedRules: EslintRuleMap = {};
  for (const rulePlugin of rulePlugins) {
    const lintProviders = rulePlugin.capabilities.lintProviders ?? [];
    for (const provider of lintProviders) {
      if (provider.platform === 'eslint') {
        const eslintConfig = provider.config as EslintProviderConfig;
        Object.assign(collectedRules, eslintConfig.rules);
      }
    }
  }
  return collectedRules;
}

/**
 * Creates an ESLint plugin from codepol rule plugins.
 *
 * Collects ESLint rules from each plugin's lintProviders (platform: 'eslint')
 * and returns a plugin object ready for use in ESLint configuration.
 *
 * @param rulePlugins - Array of codepol rule plugins to include
 * @returns ESLint plugin with collected rules
 *
 * @example
 * ```typescript
 * import { eslintPluginCreate } from '@codepol/eslint-plugin';
 * import type { CodepolRulePlugin } from '@codepol/core';
 * import { rulePlugins } from '@codepol/plugin';
 *
 * // Create plugin with built-in and custom plugins
 * const plugin = eslintPluginCreate([...rulePlugins, myCustomPlugin]);
 *
 * // Use in eslint.config.js
 * export default {
 *   plugins: { codepol: plugin },
 *   rules: { 'codepol/require-logger-enter-exit': 'error' }
 * };
 * ```
 */
export function eslintPluginCreate(rulePlugins: CodepolRulePlugin[]): EslintPlugin {
  return { rules: collectRules(rulePlugins) };
}

/** @deprecated Use eslintPluginCreate instead */
export const createEslintPlugin = eslintPluginCreate;
