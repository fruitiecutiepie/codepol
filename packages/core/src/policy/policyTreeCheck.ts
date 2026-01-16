import fs from 'node:fs';
import type { PolicyFile, PolicyRule, PolicyRuleTarget, PolicyViolation, RulePlugin } from './policyTypes';
import { ruleMatchesGet } from './policyGet';
import { policyPluginsGet, pluginGetForRule, type PolicyPluginsMap } from './policyPluginsGet';
import { Result, Ok, Err, isErr } from '../result/result';

function policyPluginGet(
  pluginsMap: PolicyPluginsMap,
  rule: PolicyRule,
  target: PolicyRuleTarget
): Result<RulePlugin, string> {
  const ruleId = rule.ruleId;
  const lookup = pluginGetForRule(pluginsMap, ruleId);
  if (!lookup) {
    const error = `No plugin registered for rule type ${ruleId}.`;
    return Err(error);
  }
  const { plugin, resolvedId } = lookup;

  const treeCheckProvider = plugin.rulePlugin.capabilities.treeCheckProvider;
  if (!treeCheckProvider) {
    const error = `Plugin ${resolvedId} does not support tree checks (missing treeCheckProvider).`;
    return Err(error);
  }

  if (!treeCheckProvider.languages.includes(target.language)) {
    const error = `Plugin ${resolvedId} does not support language ${target.language} for rule ${rule.id || rule.ruleId}.`;
    return Err(error);
  }
  return Ok(plugin);
}

/**
 * Checks a single file for policy violations using the configured plugin.
 * @returns Result containing violations array or an error message
 */
export function policyViolationsGetForFile(
  filePath: string,
  rule: PolicyRule,
  target: PolicyRuleTarget,
  policy: PolicyFile,
  pluginsMap: PolicyPluginsMap,
  dir: string
): Result<PolicyViolation[], string> {
  const pluginResult = policyPluginGet(pluginsMap, rule, target);
  if (isErr(pluginResult)) {
    return pluginResult;
  }
  const plugin = pluginResult.Ok;
  const treeCheckProvider = plugin.rulePlugin.capabilities.treeCheckProvider!;

  const source = fs.readFileSync(filePath, 'utf8');
  
  const checkResult = treeCheckProvider.check(rule, {
    filePath: filePath,
    source: source,
    policy: policy,
    dir: dir,
    target: target,
    ruleArgs: rule.args,
  });

  return checkResult;
}

/**
 * Checks all files matching the policy rules for violations.
 * @returns Result containing all violations or an error message
 */
export async function policyViolationsGetFromDir(
  policy: PolicyFile,
  dir: string
): Promise<Result<PolicyViolation[], string>> {
  const pluginsMapResult = await policyPluginsGet(policy, dir);
  if (isErr(pluginsMapResult)) {
    return pluginsMapResult;
  }
  const pluginsMap = pluginsMapResult.Ok;
  const matches = await ruleMatchesGet(policy, dir);
  const violationsAll: PolicyViolation[] = [];
  for (const match of matches) {
    for (const filePath of match.files) {
      const violationsResult = policyViolationsGetForFile(
        filePath,
        match.rule,
        match.target,
        policy,
        pluginsMap,
        dir
      );
      if (isErr(violationsResult)) {
        return violationsResult;
      }
      violationsAll.push(...violationsResult.Ok);
    }
  }
  return Ok(violationsAll);
}
