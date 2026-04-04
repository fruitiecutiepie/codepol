import type { CodepolPluginRule, LintProvider } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noUnusedVarsCheck } from './noUnusedVarsCheck';

// TODO: I don't know what this is for
const biomeProvider: LintProvider = {
  platform: 'biome',
  languages: ['typescript', 'tsx', 'javascript', 'jsx'],
  config: {},
};

export const noUnusedVarsRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-unused-vars',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx', 'javascript', 'jsx'],
      check: noUnusedVarsCheck,
    }),
    lintProviders: [biomeProvider],
    requiresProjectIndex: true,
  },
});
