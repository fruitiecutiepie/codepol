import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { noCrossPackageInternalImportCheck } from './noCrossPackageInternalImportCheck';

/**
 * Built-in architecture rule: in a workspace with multiple packages,
 * forbid imports that reach into another package's internals instead of
 * its declared public entry point. See {@link NoCrossPackageInternalImportArgs}.
 */
export const noCrossPackageInternalImportRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-cross-package-internal-import',
  capabilities: {
    architectureCheckProvider: {
      check: noCrossPackageInternalImportCheck,
    },
  },
});
