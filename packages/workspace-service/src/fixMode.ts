/**
 * Per-rule fix mode resolver.
 *
 * Decides, for each rule declared in a policy file, how auto-fixes for
 * that rule should be surfaced (`on-save`, `manual`, `never`).
 *
 * Rules:
 *
 * 1. An explicitly declared `rule.fix` wins.
 * 2. `severity === 'off'` forces `never`, regardless of `rule.fix`.
 * 3. A rule whose plugin declares neither a `fixProvider` nor any tree-check
 *    fix authoring capability is effectively `never` — there is no edit to
 *    produce.
 * 4. Otherwise the default is `manual`.
 *
 * The resolver is pure data — it performs no I/O and has no cache dependent
 * on runtime state.
 */

import {
  pluginGetForRule,
  type PolicyFile,
  type PolicyPluginsMap,
  type PolicyRuleFixMode,
} from '@codepol/core';

export type RuleFixMode = PolicyRuleFixMode;

export type RuleFixModeResolver = {
  /**
   * Resolve the effective fix mode for a rule id as declared in the policy.
   * The `ruleId` must match a `[[rules]].ruleId` declaration (long-form,
   * namespaced). Unknown rules resolve to `'never'`.
   */
  ruleFixModeGet(ruleId: string): RuleFixMode;
  /**
   * List the namespaced rule ids whose effective fix mode is `'on-save'`.
   * Order mirrors policy declaration order.
   */
  onSaveRuleIdsList(): readonly string[];
  /**
   * List the namespaced rule ids whose effective fix mode is `'on-save'`
   * or `'manual'` — i.e. rules eligible to contribute edits through any
   * fix surface at all.
   */
  fixEligibleRuleIdsList(): readonly string[];
};

function pluginHasFixSurface(
  policy: PolicyFile,
  pluginRulesMap: PolicyPluginsMap,
  ruleId: string,
): boolean {
  const lookup = pluginGetForRule(pluginRulesMap, ruleId);
  if (!lookup) {
    return false;
  }
  const capabilities = lookup.plugin.pluginRule.capabilities;
  if (capabilities.fixProvider) {
    return true;
  }
  // Tree-check providers can author fixes on their violations (`violation.fix`
  // or `violation.suggestions[].fix`). We cannot know ahead of time whether a
  // particular violation carries a fix, but the presence of the provider is
  // a necessary precondition. Treat it as eligible; the planner drops rules
  // that produce zero edits at runtime.
  if (capabilities.treeCheckProvider) {
    return true;
  }
  return false;
}

function ruleEffectiveModeResolve(
  policy: PolicyFile,
  pluginRulesMap: PolicyPluginsMap,
  ruleIndex: number,
): RuleFixMode {
  const rule = policy.rules[ruleIndex];
  if (!rule) {
    return 'never';
  }
  if (rule.severity === 'off') {
    return 'never';
  }
  if (!pluginHasFixSurface(policy, pluginRulesMap, rule.ruleId)) {
    return 'never';
  }
  return rule.fix ?? 'manual';
}

export function ruleFixModeResolverCreate(
  policy: PolicyFile,
  pluginRulesMap: PolicyPluginsMap,
): RuleFixModeResolver {
  const modeByRuleId = new Map<string, RuleFixMode>();
  const onSaveRuleIds: string[] = [];
  const fixEligibleRuleIds: string[] = [];

  policy.rules.forEach((rule, index) => {
    const mode = ruleEffectiveModeResolve(policy, pluginRulesMap, index);
    // Later declarations of the same ruleId win — matches how the existing
    // lint pipeline treats duplicate `[[rules]]` with the same ruleId.
    modeByRuleId.set(rule.ruleId, mode);
  });

  // Re-materialize ordered lists now that duplicates have been collapsed.
  for (const rule of policy.rules) {
    const mode = modeByRuleId.get(rule.ruleId) ?? 'never';
    if (mode === 'on-save' && !onSaveRuleIds.includes(rule.ruleId)) {
      onSaveRuleIds.push(rule.ruleId);
    }
    if (mode !== 'never' && !fixEligibleRuleIds.includes(rule.ruleId)) {
      fixEligibleRuleIds.push(rule.ruleId);
    }
  }

  return {
    ruleFixModeGet(ruleId: string): RuleFixMode {
      return modeByRuleId.get(ruleId) ?? 'never';
    },
    onSaveRuleIdsList(): readonly string[] {
      return onSaveRuleIds;
    },
    fixEligibleRuleIdsList(): readonly string[] {
      return fixEligibleRuleIds;
    },
  };
}
