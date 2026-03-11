/**
 * @packageDocumentation
 * @codepol/plugin-eslint - ESLint plugin adapter for codepol plugins.
 */

import type { CodepolPluginRule, EslintProviderConfig } from '@codepol/core';
import type { ESLint } from 'eslint';

import {
  eslintAdapter,
  policyCacheClear,
  projectIndexCacheClear,
} from './eslintAdapter';

// Re-export adapter utilities
export {
  eslintAdapter,
  policyCacheClear,
  projectIndexCacheClear,
};

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

/**
 * Checks if a plugin rule has an ESLint lint provider.
 */
function hasEslintLintProvider(pluginRule: CodepolPluginRule): boolean {
  const lintProviders = pluginRule.capabilities.lintProviders ?? [];
  return lintProviders.some(p => p.platform === 'eslint');
}

/**
 * Collects ESLint rules from plugin rules.
 *
 * For each plugin rule:
 * 1. Collects rules from ESLint lint providers (explicit ESLint rules)
 * 2. If no ESLint lint provider but has treeCheckProvider, auto-adapts
 *    the tree-check to an ESLint rule using eslintAdapter
 *
 * This allows plugin rules to provide either:
 * - Custom ESLint rules via lintProviders
 * - Tree-sitter checks that get auto-adapted to ESLint
 */
function collectRules(pluginRules: CodepolPluginRule[]): EslintRuleMap {
  const collectedRules: EslintRuleMap = {};

  for (const pluginRule of pluginRules) {
    // First, collect explicit ESLint rules from lintProviders
    const lintProviders = pluginRule.capabilities.lintProviders ?? [];
    for (const provider of lintProviders) {
      if (provider.platform === 'eslint') {
        const eslintConfig = provider.config as EslintProviderConfig;
        Object.assign(collectedRules, eslintConfig.rules);
      }
    }

    // If no ESLint lint provider but has treeCheckProvider, auto-adapt it
    if (!hasEslintLintProvider(pluginRule) && pluginRule.capabilities.treeCheckProvider) {
      const adaptedRule = eslintAdapter.adapt(pluginRule);
      collectedRules[pluginRule.id] = adaptedRule;
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
 * import { eslintPluginCreate } from '@codepol/plugin-eslint';
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
