import type {
  CodepolPluginRule,
  LintProvider,
  EslintProviderConfig,
} from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { eslintAdapter } from '@codepol/eslint-plugin';
import { forbiddenWordsCheck } from './forbiddenWordsCheck';

// Create the TreeCheckProvider using the factory
const forbiddenWordsTreeCheck = treeCheckProviderNew({
  languages: ['typescript', 'tsx'],
  check: forbiddenWordsCheck,
});

// Rule ID must NOT contain '/' - codepol uses '/' for namespacing.
// Your ID will be auto-prefixed: "forbidden-words" → "@scope/plugin/forbidden-words"
const ruleId = 'forbidden-words';

// Create rule plugin base for the adapter
const ruleBase = pluginRuleNew({
  id: ruleId,
  capabilities: { treeCheckProvider: forbiddenWordsTreeCheck },
});

// Generate ESLint rule from TreeCheckProvider
const eslintRule = eslintAdapter.adapt(ruleBase, {
  ruleName: 'forbidden-words',
});

const eslintConfig: EslintProviderConfig = {
  pluginName: 'codepol',
  rules: { 'forbidden-words': eslintRule },
  ruleOptions: (ctx) => ctx.ruleArgs,
};

const lintProvider: LintProvider = {
  platform: 'eslint',
  languages: ['typescript', 'tsx'],
  config: eslintConfig,
};

// Export the complete rule plugin
export const forbiddenWordsRule: CodepolPluginRule = pluginRuleNew({
  id: ruleId,
  capabilities: {
    treeCheckProvider: forbiddenWordsTreeCheck,
    lintProviders: [lintProvider],
  },
});
