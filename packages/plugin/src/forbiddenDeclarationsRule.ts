import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { forbiddenDeclarationsCheck } from './forbiddenDeclarationsCheck';

export const forbiddenDeclarationsRule: CodepolPluginRule = pluginRuleNew({
  id: 'forbidden-declarations',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx', 'javascript', 'jsx'],
      check: forbiddenDeclarationsCheck,
    }),
  },
});
