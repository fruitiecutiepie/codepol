/**
 * @packageDocumentation
 * @codepol/eslint-plugin - ESLint plugin adapter for codepol plugins.
 */

import type { CodepolRulePlugin, EslintProviderConfig } from '@codepol/core';
import type { ESLint } from 'eslint';

// Re-export adapter
export {
  eslintAdapter,
  eslintAdapterInit,
  policyCacheClear,
  providerInitStateClear,
} from './eslintAdapter';

/**
 * ESLint rule map type.
 */
type EslintRuleMap = Record<string, unknown>;

/**
 * Normalizes rule plugins input to handle CommonJS/ESM interop.
 * When importing a CommonJS module with `export default` in ESM context,
 * Node.js may wrap the exports object, requiring unwrapping.
 *
 * TODO: Remove this workaround by publishing @codepol/plugin as dual ESM+CJS package.
 * This requires adding proper `exports` field in package.json with separate entry points.
 */
function rulePluginsNormalize(input: unknown): CodepolRulePlugin[] {
  if (Array.isArray(input)) {
    return input as CodepolRulePlugin[];
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    // Handle CommonJS interop: { __esModule: true, default: [...] }
    if (obj.__esModule && Array.isArray(obj.default)) {
      return obj.default as CodepolRulePlugin[];
    }
    // Handle { rulePlugins: [...] } format
    if (Array.isArray(obj.rulePlugins)) {
      return obj.rulePlugins as CodepolRulePlugin[];
    }
    // Handle nested default: { default: [...] }
    if (Array.isArray(obj.default)) {
      return obj.default as CodepolRulePlugin[];
    }
  }
  throw new Error(
    'eslintPluginCreate expects an array of CodepolRulePlugin. ' +
    'If importing from @codepol/plugin, ensure you are using the default export.'
  );
}

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
 * import rulePlugins from '@codepol/plugin';
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
export function eslintPluginCreate(rulePlugins: CodepolRulePlugin[] | unknown): ESLint.Plugin {
  const normalized = rulePluginsNormalize(rulePlugins);
  const rules = collectRules(normalized) as ESLint.Plugin['rules'];
  return { rules };
}
