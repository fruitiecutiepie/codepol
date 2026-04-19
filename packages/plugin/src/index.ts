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
import { noCyclesRule } from './noCyclesRule';
import { deadModuleRule } from './deadModuleRule';
import { noLayerViolationRule } from './noLayerViolationRule';
import { noUndeclaredImplementerRule } from './noUndeclaredImplementerRule';
import {
  biomeBridgeRule,
  eslintBridgeRule,
  ruffBridgeRule,
} from './externalBridgeRules';

export {
  biomeBridgeRule,
  eslintBridgeRule,
  ruffBridgeRule,
} from './externalBridgeRules';

export { unusedExportsRule };
export { unusedExportsCheck };
export { enforceCasingRule } from './enforceCasingRule';
export { noMixedExportsRule } from './noMixedExportsRule';
export { noUnusedVarsRule } from './noUnusedVarsRule';
export { noCyclesRule } from './noCyclesRule';
export { noCyclesCheck, NO_CYCLES_DEFAULT_MAX } from './noCyclesCheck';
export type { NoCyclesArgs } from './noCyclesCheck';
export { deadModuleRule } from './deadModuleRule';
export { deadModuleCheck } from './deadModuleCheck';
export type { DeadModuleArgs } from './deadModuleCheck';
export { noLayerViolationRule } from './noLayerViolationRule';
export { noLayerViolationCheck } from './noLayerViolationCheck';
export type {
  NoLayerViolationArgs,
  NoLayerViolationLayerConfig,
} from './noLayerViolationCheck';
export { noUndeclaredImplementerRule } from './noUndeclaredImplementerRule';
export { noUndeclaredImplementerCheck } from './noUndeclaredImplementerCheck';
export type { NoUndeclaredImplementerArgs } from './noUndeclaredImplementerCheck';
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
  noCyclesRule,
  deadModuleRule,
  noLayerViolationRule,
  noUndeclaredImplementerRule,
  eslintBridgeRule,
  biomeBridgeRule,
  ruffBridgeRule,
];
