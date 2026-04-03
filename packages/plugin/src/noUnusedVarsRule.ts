import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noUnusedVarsCheck } from './noUnusedVarsCheck';

export const noUnusedVarsRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-unused-vars',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx', 'javascript', 'jsx'],
      check: noUnusedVarsCheck,
    }),
    requiresProjectIndex: true,
  },
});
