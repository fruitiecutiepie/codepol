import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { loggerTreeCheckProvider } from './policyPluginLogger';
import { unusedExportsRule } from './unusedExportsRule';
import { unusedExportsCheck } from './unusedExportsCheck';
import { forbiddenWordsRule } from './forbiddenWordsRule';
import { forbiddenPathWordsRule } from './forbiddenPathWordsRule';
import { noInterfaceRule } from './noInterfaceRule';
import { noVerbFunctionNameRule } from './noVerbFunctionNameRule';
import { noDuplicateExportsRule } from './noDuplicateExportsRule';
import { noStarExportCollisionsRule } from './noStarExportCollisionsRule';

export { unusedExportsRule };
export { unusedExportsCheck };

export const loggerEnterExitRule: CodepolPluginRule = pluginRuleNew({
  id: 'require-logger-enter-exit',
  capabilities: {
    treeCheckProvider: loggerTreeCheckProvider,
  },
});

export default [
  loggerEnterExitRule,
  unusedExportsRule,
  forbiddenWordsRule,
  forbiddenPathWordsRule,
  noVerbFunctionNameRule,
  noInterfaceRule,
  noDuplicateExportsRule,
  noStarExportCollisionsRule,
];
