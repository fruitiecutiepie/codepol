import type {
  CodepolPluginRule,
  FixProvider,
  FixProviderContext,
} from '@codepol/core';
import { eslintProviderCreate, pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { eslintAdapter } from '@codepol/plugin-eslint';
import { noUnusedVarsCheck } from './noUnusedVarsCheck';
import { policyFixApplyFromCheck } from './lib/checkBasedFixProvider';

const noUnusedVarsLanguages = ['typescript', 'tsx', 'javascript', 'jsx'] as const;

const noUnusedVarsFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    policyFixApplyFromCheck(context, {
      ruleIdSuffix: 'no-unused-vars',
      supportedLanguages: noUnusedVarsLanguages,
      check: noUnusedVarsCheck,
    });
  },
};

const noUnusedVarsRuleNativeBase: CodepolPluginRule = pluginRuleNew({
  id: 'no-unused-vars',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: [...noUnusedVarsLanguages],
      check: noUnusedVarsCheck,
    }),
    requiresProjectIndex: true,
    fixProvider: noUnusedVarsFixProvider,
  },
});

const noUnusedVarsEslintRule = eslintAdapter.adapt(noUnusedVarsRuleNativeBase, {
  ruleName: 'no-unused-vars',
});

export const noUnusedVarsRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-unused-vars',
  capabilities: {
    ...noUnusedVarsRuleNativeBase.capabilities,
    lintProviders: [
      eslintProviderCreate({
        languages: [...noUnusedVarsLanguages],
        rules: {
          'no-unused-vars': noUnusedVarsEslintRule,
        },
        ruleOptions: (context) => ({
          configPath: context.configPath,
          ruleTargets: context.ruleTargets,
          policyExclude: context.policy.exclude ?? [],
        }),
      }),
    ],
  },
});
