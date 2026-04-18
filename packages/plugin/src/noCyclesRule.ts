import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { noCyclesCheck } from './noCyclesCheck';

/**
 * Built-in architecture rule: forbid circular imports.
 *
 * Emits one violation per cycle (anchored at the alphabetically-first
 * member) plus an optional summary when truncated. See
 * {@link NoCyclesArgs} for configuration.
 */
export const noCyclesRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-cycles',
  capabilities: {
    architectureCheckProvider: {
      check: noCyclesCheck,
    },
  },
});
