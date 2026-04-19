import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { maxCycleSizeCheck } from './maxCycleSizeCheck';

/**
 * Built-in architecture rule: cap the size of any single circular
 * import cycle. Configured via {@link MaxCycleSizeArgs}.
 *
 * Pairs with `no-cycles`: keep this on while a codebase still has
 * legitimate legacy cycles, then graduate to `no-cycles` when the
 * remaining cycles are gone.
 */
export const maxCycleSizeRule: CodepolPluginRule = pluginRuleNew({
  id: 'max-cycle-size',
  capabilities: {
    architectureCheckProvider: {
      check: maxCycleSizeCheck,
    },
  },
});
