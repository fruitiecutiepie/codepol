/**
 * @packageDocumentation
 * External linter bridge rules.
 *
 * Trigger-only rules that declare a `LintProvider` for each supported
 * external tool (ESLint, Biome, Ruff). Referencing a bridge rule from
 * `codepol.toml` causes `workspaceAnalysisRun` to invoke the corresponding
 * analyzer on matched files; the tool's own rule logic is resolved from
 * the tool's native config (`eslint.config.*`, `biome.json`, `ruff.toml`
 * or `pyproject.toml`).
 *
 * Policy `args` carry per-platform provider config overrides and are the
 * single consistent surface across all three bridges. See
 * `ruffProviderConfigResolve`, `biomeProviderConfigResolve`, and
 * `eslintBridgeConfigPathResolve` in `@codepol/workspace-service` for the
 * args-to-provider-config mapping.
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
