import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { forbiddenPathWordsCheck } from './forbiddenPathWordsCheck';

export const forbiddenPathWordsRule: CodepolPluginRule = pluginRuleNew({
  id: 'forbidden-path-words',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx'],
      check: forbiddenPathWordsCheck,
    }),
  },
});
