import type {
  CodepolPluginRule,
  FixProvider,
  FixProviderContext,
} from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { enforceCasingCheck } from './enforceCasingCheck';
import { policyFixApplyFromCheck } from './lib/checkBasedFixProvider';

const ENFORCE_CASING_LANGUAGES = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
] as const;

const enforceCasingFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    policyFixApplyFromCheck(context, {
      ruleIdSuffix: 'enforce-casing',
      supportedLanguages: ENFORCE_CASING_LANGUAGES,
      check: enforceCasingCheck,
    });
  },
};

export const enforceCasingRule: CodepolPluginRule = pluginRuleNew({
  id: 'enforce-casing',
  capabilities: {
    requiresProjectIndex: true,
    treeCheckProvider: treeCheckProviderNew({
      languages: [...ENFORCE_CASING_LANGUAGES],
      check: enforceCasingCheck,
    }),
    fixProvider: enforceCasingFixProvider,
  },
});
