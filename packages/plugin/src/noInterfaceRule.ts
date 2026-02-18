import type {
  CodepolPluginRule,
  LintProvider,
  EslintProviderConfig,
  FixProvider,
  FixProviderContext,
} from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { eslintAdapter } from '@codepol/eslint-plugin';
import { noInterfaceCheck } from './noInterfaceCheck';
import { noInterfaceFix } from './noInterfaceFix';
import { readFileSync, writeFileSync } from 'node:fs';

// Create the TreeCheckProvider using the factory
const noInterfaceTreeCheck = treeCheckProviderNew({
  languages: ['typescript', 'tsx'],
  check: noInterfaceCheck,
});

// Rule ID must NOT contain '/' - codepol uses '/' for namespacing.
// Your ID will be auto-prefixed: "no-interface" → "@scope/plugin/no-interface"
const ruleId = 'no-interface';

// Create rule plugin base for the adapter
const ruleBase = pluginRuleNew({
  id: ruleId,
  capabilities: { treeCheckProvider: noInterfaceTreeCheck },
});

// Generate ESLint rule from TreeCheckProvider
const eslintRule = eslintAdapter.adapt(ruleBase, {
  ruleName: 'no-interface',
});

const eslintConfig: EslintProviderConfig = {
  pluginName: 'codepol',
  rules: { 'no-interface': eslintRule },
};

const lintProvider: LintProvider = {
  platform: 'eslint',
  languages: ['typescript', 'tsx'],
  config: eslintConfig,
};

const noInterfaceFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    for (const filePath of context.files) {
      const source = readFileSync(filePath, 'utf8');
      const fixed = noInterfaceFix(source);
      if (fixed !== source) {
        writeFileSync(filePath, fixed);
      }
    }
  },
};

// Export the complete rule plugin
export const noInterfaceRule: CodepolPluginRule = pluginRuleNew({
  id: ruleId,
  capabilities: {
    treeCheckProvider: noInterfaceTreeCheck,
    lintProviders: [lintProvider],
    fixProvider: noInterfaceFixProvider,
  },
});
