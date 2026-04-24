/**
 * @packageDocumentation
 * External linter bridge rules.
 *
 * Legacy compatibility layer for the pre-`tools.*.runs` config surface.
 *
 * New configs should declare external analyzers under top-level `tools`
 * instead of referencing these trigger-only rules from `[[rules]]`. The
 * workspace-service still understands these bridge rules so existing configs
 * continue to work during migration.
 *
 * Once the `tools.*.runs` surface has fully replaced legacy bridge usage, this
 * module can be removed along with the compatibility readers in
 * `@codepol/workspace-service`.
 */

import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';

const JS_TS_LANGUAGES = ['javascript', 'typescript', 'jsx', 'tsx'] as const;

export const eslintBridgeRule: CodepolPluginRule = pluginRuleNew({
  id: 'eslint',
  capabilities: {
    lintProviders: [
      {
        platform: 'eslint',
        languages: [...JS_TS_LANGUAGES],
        config: { rules: {} },
      },
    ],
  },
});

export const biomeBridgeRule: CodepolPluginRule = pluginRuleNew({
  id: 'biome',
  capabilities: {
    lintProviders: [
      {
        platform: 'biome',
        languages: [...JS_TS_LANGUAGES],
        config: {},
      },
    ],
  },
});

export const ruffBridgeRule: CodepolPluginRule = pluginRuleNew({
  id: 'ruff',
  capabilities: {
    lintProviders: [
      {
        platform: 'ruff',
        languages: ['python'],
        config: {},
      },
    ],
  },
});
