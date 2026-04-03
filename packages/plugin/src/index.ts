import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { pythonDeadCodeRule } from '@codepol/plugin-vulture';
import { loggerTreeCheckProvider } from './policyPluginLogger';
import { unusedExportsRule } from './unusedExportsRule';
import { unusedExportsCheck } from './unusedExportsCheck';
import { forbiddenWordsRule } from './forbiddenWordsRule';
import { forbiddenPathWordsRule } from './forbiddenPathWordsRule';
import { noInterfaceRule } from './noInterfaceRule';
import { noVerbFunctionNameRule } from './noVerbFunctionNameRule';
import { noDuplicateExportsRule } from './noDuplicateExportsRule';
import { noStarExportCollisionsRule } from './noStarExportCollisionsRule';
import { enforceCasingRule } from './enforceCasingRule';
import { noMixedExportsRule } from './noMixedExportsRule';

export { unusedExportsRule };
export { unusedExportsCheck };
export { enforceCasingRule } from './enforceCasingRule';
export { noMixedExportsRule } from './noMixedExportsRule';
export { pythonDeadCodeRule } from '@codepol/plugin-vulture';

export const loggerEnterExitRule: CodepolPluginRule = pluginRuleNew({
  id: 'require-logger-enter-exit',
  capabilities: {
    treeCheckProvider: loggerTreeCheckProvider,
  },
});

export default [
  loggerEnterExitRule,
  unusedExportsRule,
  pythonDeadCodeRule,
  forbiddenWordsRule,
  forbiddenPathWordsRule,
  noVerbFunctionNameRule,
  noInterfaceRule,
  noDuplicateExportsRule,
  noStarExportCollisionsRule,
  enforceCasingRule,
  noMixedExportsRule,
];
