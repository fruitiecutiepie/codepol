import fs from 'node:fs';
import {
  treeCheckProviderSupportsLanguage,
  type PolicyFile,
  type PolicyRule,
  type PolicyRuleTarget,
  type PolicyViolation,
  type PluginRule,
} from './policyTypes';
import { ruleMatchesGet } from './policyGet';
import { policyPluginsGet, pluginGetForRule, type PolicyPluginsMap } from './policyPluginsGet';
import { Result, Ok, Err, isErr } from '../result/result';
import type { ProjectIndex } from '../index/indexQuery';
import { projectIndexBuild } from '../index/indexBuilder';

function policyPluginGet(
  pluginsMap: PolicyPluginsMap,
  rule: PolicyRule,
  target: PolicyRuleTarget
): Result<PluginRule | null, string> {
  const ruleId = rule.ruleId;
  const lookup = pluginGetForRule(pluginsMap, ruleId);
  if (!lookup) {
    const error = `No plugin registered for rule type ${ruleId}.`;
    return Err(error);
  }
  const { plugin, resolvedId } = lookup;

  const treeCheckProvider = plugin.pluginRule.capabilities.treeCheckProvider;
  if (!treeCheckProvider) {
    return Ok(null);
  }

  if (!treeCheckProviderSupportsLanguage(treeCheckProvider, target.language)) {
    const error = `Plugin ${resolvedId} does not support language ${target.language} for rule ${rule.id || rule.ruleId}.`;
    return Err(error);
  }
  return Ok(plugin);
}

/**
 * Checks a single file for policy violations using the configured plugin.
 * @param filePath - Absolute path to the file to check
 * @param rule - The policy rule to check against
 * @param target - The target configuration for this check
 * @param policy - The complete policy file
 * @param pluginsMap - Map of loaded plugins
 * @param dir - Working directory
 * @param projectIndex - Optional project-wide semantic index for cross-file analysis
 * @returns Result containing violations array or an error message
 */
export function policyViolationsGetForFile(
  filePath: string,
  rule: PolicyRule,
  target: PolicyRuleTarget,
  policy: PolicyFile,
  pluginsMap: PolicyPluginsMap,
  dir: string,
  configPath?: string,
  projectIndex?: ProjectIndex,
  sourceOverride?: string,
): Result<PolicyViolation[], string> {
  if (rule.providers && rule.providers.length > 0 && !rule.providers.includes('tree-sitter')) {
    return Ok([]);
  }

  const pluginResult = policyPluginGet(pluginsMap, rule, target);
  if (isErr(pluginResult)) {
    return pluginResult;
  }
  const plugin = pluginResult.Ok;
  if (!plugin) {
    return Ok([]);
  }
  const treeCheckProvider = plugin.pluginRule.capabilities.treeCheckProvider!;

  const source = sourceOverride ?? fs.readFileSync(filePath, 'utf8');
  
  const checkResult = treeCheckProvider.check(rule, {
    filePath: filePath,
    source: source,
    policy: policy,
    dir: dir,
    configPath,
    target: target,
    ruleArgs: rule.args,
    projectIndex: projectIndex,
  });

  return checkResult;
}

/**
 * Check if any plugin in the map requires a project index.
 */
function pluginsRequireProjectIndex(pluginsMap: PolicyPluginsMap): boolean {
  for (const [, plugin] of pluginsMap) {
    if (plugin.pluginRule.capabilities.requiresProjectIndex) {
      return true;
    }
  }
  return false;
}

/**
 * Checks all files matching the policy rules for violations.
 * If any plugin requires a project-wide semantic index, it will be built
 * before running checks.
 * @returns Result containing all violations or an error message
 */
export async function policyViolationsGetFromDir(
  policy: PolicyFile,
  dir: string,
  options: {
    configPath?: string;
    sourceByFilePath?: ReadonlyMap<string, string>;
    projectIndex?: ProjectIndex;
  } = {}
): Promise<Result<PolicyViolation[], string>> {
  const pluginsMapResult = await policyPluginsGet(policy, dir, {
    configPath: options.configPath,
  });
  if (isErr(pluginsMapResult)) {
    return pluginsMapResult;
  }
  const pluginsMap = pluginsMapResult.Ok;
  const matches = await ruleMatchesGet(policy, dir);

  // Collect all files to be checked
  const allFiles = new Set<string>();
  for (const match of matches) {
    for (const filePath of match.files) {
      allFiles.add(filePath);
    }
  }

  // Build project index if any plugin requires it
  let projectIndex: ProjectIndex | undefined = options.projectIndex;
  if (!projectIndex && pluginsRequireProjectIndex(pluginsMap) && allFiles.size > 0) {
    try {
      const indexResult = await projectIndexBuild({
        files: Array.from(allFiles),
        dir,
      });
      projectIndex = indexResult.index;
    } catch (error) {
      // Log but don't fail - plugins should handle missing index gracefully
      console.warn(
        'Failed to build project index:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const violationsAll: PolicyViolation[] = [];
  for (const match of matches) {
    for (const filePath of match.files) {
      const violationsResult = policyViolationsGetForFile(
        filePath,
        match.rule,
        match.target,
        policy,
        pluginsMap,
        dir,
        options.configPath,
        projectIndex,
        options.sourceByFilePath?.get(filePath),
      );
      if (isErr(violationsResult)) {
        return violationsResult;
      }
      violationsAll.push(...violationsResult.Ok);
    }
  }
  return Ok(violationsAll);
}
