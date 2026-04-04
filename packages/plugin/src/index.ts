import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { pythonDeadCodeRule } from '@codepol/plugin-vulture';
import { loggerTreeCheckProvider } from './policyPluginLogger';
import { unusedExportsRule } from './unusedExportsRule';
import { unusedExportsCheck } from './unusedExportsCheck';
import { forbiddenWordsRule } from './forbiddenWordsRule';
import { forbiddenDeclarationsRule } from './forbiddenDeclarationsRule';
import { forbiddenPathWordsRule } from './forbiddenPathWordsRule';
import { noInterfaceRule } from './noInterfaceRule';
import { noVerbFunctionNameRule } from './noVerbFunctionNameRule';
import { noDuplicateExportsRule } from './noDuplicateExportsRule';
import { noStarExportCollisionsRule } from './noStarExportCollisionsRule';
import { enforceCasingRule } from './enforceCasingRule';
import { noMixedExportsRule } from './noMixedExportsRule';
import { noUnusedVarsRule } from './noUnusedVarsRule';

export { unusedExportsRule };
export { unusedExportsCheck };
export { enforceCasingRule } from './enforceCasingRule';
export { noMixedExportsRule } from './noMixedExportsRule';
export { noUnusedVarsRule } from './noUnusedVarsRule';
export { forbiddenDeclarationsRule } from './forbiddenDeclarationsRule';
export type {
  ForbiddenDeclarationsArgs,
  ForbiddenDeclarationBindingKind,
  ForbiddenDeclarationSymbolKind,
  ForbiddenDeclarationSyntaxKind,
} from './forbiddenDeclarationsCheck';
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
  forbiddenDeclarationsRule,
  forbiddenWordsRule,
  forbiddenPathWordsRule,
  noVerbFunctionNameRule,
  noInterfaceRule,
  noDuplicateExportsRule,
  noStarExportCollisionsRule,
  enforceCasingRule,
  noMixedExportsRule,
  noUnusedVarsRule,
];
