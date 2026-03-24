import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noVerbFunctionNameCheck } from './noVerbFunctionNameCheck';

export const noVerbFunctionNameRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-verb-function-name',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx', 'python'],
      check: noVerbFunctionNameCheck,
    }),
  },
});
