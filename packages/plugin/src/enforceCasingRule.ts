import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { enforceCasingCheck } from './enforceCasingCheck';

export const enforceCasingRule: CodepolPluginRule = pluginRuleNew({
  id: 'enforce-casing',
  capabilities: {
    requiresProjectIndex: true,
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx', 'javascript', 'jsx', 'python'],
      check: enforceCasingCheck,
    }),
  },
});
