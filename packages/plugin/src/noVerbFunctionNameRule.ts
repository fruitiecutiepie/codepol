import type {
  CodepolPluginRule,
  LintProvider,
  EslintProviderConfig,
} from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { eslintAdapter } from '@codepol/eslint-plugin';
import { noVerbFunctionNameCheck } from './noVerbFunctionNameCheck';

// Create the TreeCheckProvider using the factory
const noVerbFunctionNameTreeCheck = treeCheckProviderNew({
  languages: ['typescript', 'tsx'],
  check: noVerbFunctionNameCheck,
});

// Rule ID must NOT contain '/' - codepol uses '/' for namespacing.
// Your ID will be auto-prefixed: "no-verb-function-name" → "@scope/plugin/no-verb-function-name"
const ruleId = 'no-verb-function-name';

// Create rule plugin base for the adapter
const ruleBase = pluginRuleNew({
  id: ruleId,
  capabilities: { treeCheckProvider: noVerbFunctionNameTreeCheck },
});

// Generate ESLint rule from TreeCheckProvider
const eslintRule = eslintAdapter.adapt(ruleBase, {
  ruleName: 'no-verb-function-name',
});

const eslintConfig: EslintProviderConfig = {
  pluginName: 'codepol',
  rules: { 'no-verb-function-name': eslintRule },
  ruleOptions: (ctx) => ctx.ruleArgs,
};

const lintProvider: LintProvider = {
  platform: 'eslint',
  languages: ['typescript', 'tsx'],
  config: eslintConfig,
};

// Export the complete rule plugin
export const noVerbFunctionNameRule: CodepolPluginRule = pluginRuleNew({
  id: ruleId,
  capabilities: {
    treeCheckProvider: noVerbFunctionNameTreeCheck,
    lintProviders: [lintProvider],
  },
});
