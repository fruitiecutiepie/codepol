/**
 * @packageDocumentation
 * Rule definition for no-star-export-collisions.
 *
 * When a file uses `export *` from multiple modules, this rule enumerates
 * every symbol each star export exposes and flags any name that appears in
 * two or more source modules. Uses the semantic index for cross-file
 * resolution of transitive star re-exports.
 */

import type {
  CodepolPluginRule,
  LintProvider,
  EslintProviderConfig,
  LintProviderContext,
} from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { eslintAdapter } from '@codepol/eslint-plugin';
import { noStarExportCollisionsCheck } from './noStarExportCollisionsCheck';

/**
 * Tree-sitter check provider for star-export collision detection.
 * Supports TypeScript and TSX files.
 */
const noStarExportCollisionsTreeCheck = treeCheckProviderNew({
  languages: ['typescript', 'tsx'],
  check: noStarExportCollisionsCheck,
});

/**
 * Rule ID for the star export collisions rule.
 * Will be namespaced as "@codepol/plugin/no-star-export-collisions" when loaded.
 */
const ruleId = 'no-star-export-collisions';

/**
 * Base rule with just treeCheckProvider (used to create the adapted ESLint rule).
 */
const noStarExportCollisionsBaseRule: CodepolPluginRule = pluginRuleNew({
  id: ruleId,
  capabilities: {
    treeCheckProvider: noStarExportCollisionsTreeCheck,
    requiresProjectIndex: true,
  },
});

/**
 * ESLint rule created from the tree-check provider using the adapter.
 */
const noStarExportCollisionsEslintRule = eslintAdapter.adapt(
  noStarExportCollisionsBaseRule,
);

/**
 * ESLint provider configuration for the star export collisions rule.
 */
const eslintProviderConfig: EslintProviderConfig = {
  rules: {
    [ruleId]: noStarExportCollisionsEslintRule,
  },
  ruleOptions: (ctx: LintProviderContext) => ({
    configPath: ctx.configPath,
    ruleTargets: ctx.ruleTargets,
    policyExclude: ctx.policy.exclude,
    ...(ctx.ruleArgs && typeof ctx.ruleArgs === 'object' ? ctx.ruleArgs : {}),
  }),
};

/**
 * ESLint lint provider for star export collision detection.
 */
const noStarExportCollisionsLintProvider: LintProvider = {
  platform: 'eslint',
  languages: ['typescript', 'tsx'],
  config: eslintProviderConfig,
};

/**
 * Plugin rule for detecting name collisions across star-exported modules.
 *
 * Key capability: `requiresProjectIndex: true` tells the core to build
 * the semantic index before running this rule. The index provides the
 * export maps needed to enumerate what each star-exported module exposes.
 *
 * Provides both:
 * - Tree-sitter check via `treeCheckProvider` (for CLI/esbuild)
 * - ESLint rule via `lintProviders` (for ESLint integration)
 */
export const noStarExportCollisionsRule: CodepolPluginRule = pluginRuleNew({
  id: ruleId,
  capabilities: {
    treeCheckProvider: noStarExportCollisionsTreeCheck,
    lintProviders: [noStarExportCollisionsLintProvider],
    requiresProjectIndex: true,
  },
});
