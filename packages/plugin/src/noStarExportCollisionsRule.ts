import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noStarExportCollisionsCheck } from './noStarExportCollisionsCheck';

export const noStarExportCollisionsRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-star-export-collisions',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx'],
      check: noStarExportCollisionsCheck,
    }),
    requiresProjectIndex: true,
  },
});
