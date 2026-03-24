import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { forbiddenWordsCheck } from './forbiddenWordsCheck';

export const forbiddenWordsRule: CodepolPluginRule = pluginRuleNew({
  id: 'forbidden-words',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      check: forbiddenWordsCheck,
    }),
  },
});
