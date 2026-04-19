import type { CodepolPluginRule } from '@codepol/core';
import { pluginRuleNew } from '@codepol/core';
import { noUndeclaredImplementerCheck } from './noUndeclaredImplementerCheck';

/**
 * Built-in architecture rule: forbid classes from satisfying an
 * interface only by structural shape.
 *
 * Phase 9.5 / Gap 3 — uses
 * `subTypesGet(id, { confidence: 'all' })` to surface implementers
 * the cross-file shape-match pass found, then flags any whose
 * relationship is *not* also expressed via a declared `implements`
 * clause. Default `subTypesGet` behavior is unchanged; only this rule
 * (and any other caller that opts in) sees the structural-shape edges.
 *
 * Configure via `args.interfaces` / `args.ignore` / `args.ignoreImplementers`.
 * See {@link NoUndeclaredImplementerArgs} for the schema.
 */
export const noUndeclaredImplementerRule: CodepolPluginRule = pluginRuleNew({
  id: 'no-undeclared-implementer',
  capabilities: {
    architectureCheckProvider: {
      check: noUndeclaredImplementerCheck,
    },
  },
});
