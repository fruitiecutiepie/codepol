/**
 * @packageDocumentation
 * Rule definition for no-unused-exports.
 *
 * This rule detects exported symbols that are not imported by any other file
 * in the project. It demonstrates cross-file analysis using the semantic index.
 */

import type {
  CodepolPluginRule,
  LintProvider,
  EslintProviderConfig,
  LintProviderContext,
  FixProvider,
  FixProviderContext,
} from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { eslintAdapter } from '@codepol/eslint-plugin';
import { unusedExportsCheck } from './unusedExportsCheck';
import { unusedExportsFix } from './unusedExportsFix';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Tree-sitter check provider for unused exports detection.
 * Supports TypeScript and TSX files.
 */
const unusedExportsTreeCheck = treeCheckProviderNew({
  languages: ['typescript', 'tsx'],
  check: unusedExportsCheck,
});

/**
 * Rule ID for the unused exports rule.
 * Will be namespaced as "@codepol/plugin/no-unused-exports" when loaded.
 */
const ruleId = 'no-unused-exports';

/**
 * Base rule with just treeCheckProvider (used to create the adapted ESLint rule).
 */
const unusedExportsBaseRule: CodepolPluginRule = pluginRuleNew({
  id: ruleId,
  capabilities: {
    treeCheckProvider: unusedExportsTreeCheck,
    requiresProjectIndex: true,
  },
});

/**
 * ESLint rule created from the tree-check provider using the adapter.
 */
const unusedExportsEslintRule = eslintAdapter.adapt(unusedExportsBaseRule);

/**
 * ESLint provider configuration for the unused exports rule.
 */
const eslintProviderConfig: EslintProviderConfig = {
  rules: {
    [ruleId]: unusedExportsEslintRule,
  },
  ruleOptions: (ctx: LintProviderContext) => ({
    configPath: ctx.configPath,
    ruleTargets: ctx.ruleTargets,
    policyExclude: ctx.policy.exclude,
    ...(ctx.ruleArgs && typeof ctx.ruleArgs === 'object' ? ctx.ruleArgs : {}),
  }),
};

/**
 * ESLint lint provider for unused exports detection.
 */
const unusedExportsLintProvider: LintProvider = {
  platform: 'eslint',
  languages: ['typescript', 'tsx'],
  config: eslintProviderConfig,
};

/**
 * Plugin rule for detecting unused exports.
 *
 * Key capability: `requiresProjectIndex: true` tells the core to build
 * the semantic index before running this rule. The index is then available
 * via `context.projectIndex` in the check function.
 *
 * This rule provides both:
 * - Tree-sitter check via `treeCheckProvider` (for CLI/esbuild)
 * - ESLint rule via `lintProviders` (for ESLint integration)
 *
 * Example usage in codepol.config.ts:
 * - Add '@codepol/plugin' to plugins
 * - Create a rule with ruleId: '@codepol/plugin/no-unused-exports'
 * - Set requiresProjectIndex: true triggers index building automatically
 */
const unusedExportsFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    const fileSources = context.files.map(filePath => ({
      filePath,
      source: readFileSync(filePath, 'utf8'),
    }));

    for (const [filePath, fixed] of unusedExportsFix(fileSources, context.cwd)) {
      writeFileSync(filePath, fixed);
    }
  },
};

export const unusedExportsRule: CodepolPluginRule = pluginRuleNew({
  id: ruleId,
  capabilities: {
    treeCheckProvider: unusedExportsTreeCheck,
    lintProviders: [unusedExportsLintProvider],
    fixProvider: unusedExportsFixProvider,
    requiresProjectIndex: true,
  },
});
