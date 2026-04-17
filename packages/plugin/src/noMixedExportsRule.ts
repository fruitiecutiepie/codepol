import type {
  CodepolPluginRule,
  FixProvider,
  FixProviderContext,
} from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noMixedExportsCheck } from './noMixedExportsCheck';
import { policyFixApplyFromCheck } from './lib/checkBasedFixProvider';

const NO_MIXED_EXPORTS_LANGUAGES = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
] as const;

const noMixedExportsFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    if (!context.projectIndex) {
      return;
    }
    policyFixApplyFromCheck(context, {
      ruleIdSuffix: 'no-mixed-exports',
      supportedLanguages: NO_MIXED_EXPORTS_LANGUAGES,
      check: noMixedExportsCheck,
    });
  },
};

export const noMixedExportsRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-mixed-exports',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: [...NO_MIXED_EXPORTS_LANGUAGES],
      check: noMixedExportsCheck,
    }),
    /** Required for preferredStyle autofix (cross-file import updates). */
    requiresProjectIndex: true,
    fixProvider: noMixedExportsFixProvider,
  },
});
