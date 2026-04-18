import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { deadModuleCheck } from './deadModuleCheck';

/**
 * Built-in architecture rule: forbid modules unreachable from any
 * declared entry point.
 *
 * Configure entry-point globs via `args.entries`. See
 * {@link DeadModuleArgs} for the full schema.
 */
export const deadModuleRule: CodepolPluginRule = pluginRuleNew({
  id: 'dead-module',
  capabilities: {
    architectureCheckProvider: {
      check: deadModuleCheck,
    },
  },
});
