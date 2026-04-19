import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { entryPointAllowlistCheck } from './entryPointAllowlistCheck';

/**
 * Built-in architecture rule: only files matching declared entry-point
 * globs may have zero importers. See {@link EntryPointAllowlistArgs}.
 */
export const entryPointAllowlistRule: CodepolPluginRule = pluginRuleNew({
  id: 'entry-point-allowlist',
  capabilities: {
    architectureCheckProvider: {
      check: entryPointAllowlistCheck,
    },
  },
});
