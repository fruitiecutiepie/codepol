import type { CodepolPluginRule, FixProvider, FixProviderContext } from '@codepol/core';
import { pluginRuleNew, treeCheckProviderNew } from '@codepol/core';
import { unusedExportsCheck } from './unusedExportsCheck';
import { unusedExportsFix } from './unusedExportsFix';
import { readFileSync, writeFileSync } from 'node:fs';

const unusedExportsFixProvider: FixProvider = {
  apply: (context: FixProviderContext) => {
    const fileSources = context.files.map(filePath => ({
      filePath,
      source: readFileSync(filePath, 'utf8'),
    }));

    for (const [filePath, fixed] of unusedExportsFix(fileSources, context.cwd)) {
      writeFileSync(filePath, fixed);
    }
  },
};

export const unusedExportsRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-unused-exports',
  capabilities: {
    treeCheckProvider: treeCheckProviderNew({
      check: unusedExportsCheck,
    }),
    fixProvider: unusedExportsFixProvider,
    requiresProjectIndex: true,
  },
});
