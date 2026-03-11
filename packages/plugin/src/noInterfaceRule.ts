import type { CodepolPluginRule, FixProvider, FixProviderContext } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { noInterfaceCheck } from './noInterfaceCheck';
import { noInterfaceFix } from './noInterfaceFix';
import { readFileSync, writeFileSync } from 'node:fs';

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

export const noInterfaceRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-interface',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['typescript', 'tsx'],
      check: noInterfaceCheck,
    }),
    fixProvider: noInterfaceFixProvider,
  },
});
