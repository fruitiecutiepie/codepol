import type { CodepolPluginRule } from '@codepol/core';
import { eslintProviderCreate, pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { eslintAdapter } from '@codepol/plugin-eslint';
import { noUnusedVarsCheck } from './noUnusedVarsCheck';

const noUnusedVarsLanguages = ['typescript', 'tsx', 'javascript', 'jsx'] as const;

const noUnusedVarsRuleNativeBase: CodepolPluginRule = pluginRuleNew({
  id: 'no-unused-vars',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: [...noUnusedVarsLanguages],
      check: noUnusedVarsCheck,
    }),
    requiresProjectIndex: true,
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
