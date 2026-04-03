/**
 * Policy rule: Python dead code via Vulture + optional tree-sitter fixes.
 */

import type { CodepolPluginRule, FixProvider, FixProviderContext } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { readFileSync, writeFileSync } from 'node:fs';
import { pythonDeadCodeCheck } from './pythonDeadCodeCheck';
import { pythonDeadCodeFixApply } from './pythonDeadCodeFix';
import type { VultureProviderConfig } from './vultureTypes';

function pythonDeadCodeArgsGet(context: FixProviderContext): VultureProviderConfig | undefined {
  const rule = context.policy.rules.find(
    r =>
      r.ruleId === '@codepol/plugin-vulture/python-dead-code' ||
      r.ruleId.endsWith('/python-dead-code'),
  );
  return rule?.args as VultureProviderConfig | undefined;
}

const pythonDeadCodeFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    const cfg = pythonDeadCodeArgsGet(context);
    for (const filePath of context.files) {
      if (!filePath.endsWith('.py') && !filePath.endsWith('.pyw')) {
        continue;
      }
      const source = readFileSync(filePath, 'utf8');
      const fixed = pythonDeadCodeFixApply(filePath, source, cfg);
      if (fixed !== source) {
        writeFileSync(filePath, fixed);
      }
    }
  },
};

export const pythonDeadCodeRule: CodepolPluginRule = pluginRuleNew({
  id: 'python-dead-code',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      languages: ['python'],
      check: pythonDeadCodeCheck,
    }),
    fixProvider: pythonDeadCodeFixProvider,
  },
});
