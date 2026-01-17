/**
 * @packageDocumentation
 * @codepol/eslint-plugin - ESLint plugin adapter for codepol plugins.
 */

import type { CodepolPluginRule, EslintProviderConfig } from '@codepol/core';
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
function pluginRulesNormalize(input: unknown): CodepolPluginRule[] {
  if (Array.isArray(input)) {
    return input as CodepolPluginRule[];
  }
  if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    // Handle CommonJS interop: { __esModule: true, default: [...] }
    if (obj.__esModule && Array.isArray(obj.default)) {
      return obj.default as CodepolPluginRule[];
    }
    // Handle { pluginRules: [...] } format
    if (Array.isArray(obj.pluginRules)) {
      return obj.pluginRules as CodepolPluginRule[];
    }
    // Handle nested default: { default: [...] }
    if (Array.isArray(obj.default)) {
      return obj.default as CodepolPluginRule[];
    }
  }
  throw new Error(
    'eslintPluginCreate expects an array of CodepolPluginRule. ' +
    'If importing from @codepol/plugin, ensure you are using the default export.'
  );
}

function collectRules(pluginRules: CodepolPluginRule[]): EslintRuleMap {
  const collectedRules: EslintRuleMap = {};
  for (const pluginRule of pluginRules) {
    const lintProviders = pluginRule.capabilities.lintProviders ?? [];
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
 * @param pluginRules - Array of codepol rule plugins to include
 * @returns ESLint plugin with collected rules
 *
 * @example
 * ```typescript
 * import { eslintPluginCreate } from '@codepol/eslint-plugin';
 * import type { CodepolPluginRule } from '@codepol/core';
 * import pluginRules from '@codepol/plugin';
 *
 * // Create plugin with built-in and custom plugins
 * const plugin = eslintPluginCreate([...pluginRules, myCustomPlugin]);
 *
 * // Use in eslint.config.js
 * export default {
 *   plugins: { codepol: plugin },
 *   rules: { 'codepol/require-logger-enter-exit': 'error' }
 * };
 * ```
 */
export function eslintPluginCreate(pluginRules: CodepolPluginRule[] | unknown): ESLint.Plugin {
  const normalized = pluginRulesNormalize(pluginRules);
  const rules = collectRules(normalized) as ESLint.Plugin['rules'];
  return { rules };
}
