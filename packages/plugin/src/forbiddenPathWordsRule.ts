import type {
  CodepolPluginRule,
  LintProvider,
  EslintProviderConfig,
} from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { eslintAdapter } from '@codepol/eslint-plugin';
import { forbiddenPathWordsCheck } from './forbiddenPathWordsCheck';

// Create the TreeCheckProvider using the factory
export const forbiddenPathWordsTreeCheck = treeCheckProviderNew({
  languages: ['typescript', 'tsx'],
  check: forbiddenPathWordsCheck,
});

// Rule ID must NOT contain '/' - codepol uses '/' for namespacing.
// Your ID will be auto-prefixed: "forbidden-path-words" → "@scope/plugin/forbidden-path-words"
const ruleId = 'forbidden-path-words';

// Create rule plugin base for the adapter
const ruleBase = pluginRuleNew({
  id: ruleId,
  capabilities: { treeCheckProvider: forbiddenPathWordsTreeCheck },
});

// Generate ESLint rule from TreeCheckProvider
const eslintRule = eslintAdapter.adapt(ruleBase, {
  ruleName: 'forbidden-path-words',
});

const eslintConfig: EslintProviderConfig = {
  pluginName: 'codepol',
  rules: { 'forbidden-path-words': eslintRule },
  ruleOptions: (ctx) => ctx.ruleArgs,
};

const lintProvider: LintProvider = {
  platform: 'eslint',
  languages: ['typescript', 'tsx'],
  config: eslintConfig,
};

// Export the complete rule plugin
export const forbiddenPathWordsRule: CodepolPluginRule = pluginRuleNew({
  id: ruleId,
  capabilities: {
    treeCheckProvider: forbiddenPathWordsTreeCheck,
    lintProviders: [lintProvider],
  },
});
