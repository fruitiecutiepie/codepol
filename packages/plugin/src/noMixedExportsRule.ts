import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noMixedExportsCheck } from './noMixedExportsCheck';

export const noMixedExportsRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-mixed-exports',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx', 'javascript', 'jsx'],
      check: noMixedExportsCheck,
    }),
  },
});
