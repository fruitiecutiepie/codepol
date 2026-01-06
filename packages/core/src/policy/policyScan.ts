import fs from 'node:fs';
import type { PolicyFile, PolicyRule, PolicyRuleTarget, PolicyViolation, PolicyPlugin } from './policyTypes';
import { ruleMatchesGet } from './policyGet';
import { policyPluginsGet, defaultPluginType, type PolicyPluginsMap } from './policyPluginsGet';
import { Result, Ok, Err, isErr } from '../result/result';

function policyPluginGet(
  pluginsMap: PolicyPluginsMap,
  rule: PolicyRule,
  target: PolicyRuleTarget
): Result<PolicyPlugin, string> {
  let ruleType = defaultPluginType;
  if (rule.semantics.type != null) {
    ruleType = rule.semantics.type;
  }
  const plugin = pluginsMap.get(ruleType);
  if (!plugin) {
    const error = `No plugin registered for rule type ${ruleType}.`;
    console.error(error);
    return Err(error);
  }
  if (!plugin.languages.includes(target.language)) {
    const error = `Plugin ${plugin.id} does not support language ${target.language} for rule ${rule.id}.`;
    console.error(error);
    return Err(error);
  }
  return Ok(plugin);
}

/**
 * Scans a single file for policy violations using the configured plugin.
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
  const source = fs.readFileSync(filePath, 'utf8');
  return Ok(plugin.scan(rule, {
    filePath: filePath,
    source: source,
    policy: policy,
    dir: dir,
    target: target,
  }));
}

/**
 * Scans all files matching the policy rules for violations.
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
