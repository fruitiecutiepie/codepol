/**
 * @packageDocumentation
 * Runner for {@link ArchitectureCheckProvider} rules.
 *
 * Architecture rules differ from tree-sitter rules in two ways:
 *
 * - they run **once per matched rule**, not once per file
 * - their inputs are the project-wide {@link ProjectIndex} and
 *   {@link ModuleGraph}, never per-file source text
 *
 * The runner mirrors {@link policyViolationsGetFromDir} (see
 * `policyTreeCheck.ts`) so consumers can call both pipelines from
 * `policyCheck` and concatenate the results.
 */

import {
  architectureCheckProviderSupportsLanguage,
  type ArchitectureCheckContext,
  type ArchitectureCheckProvider,
  type PolicyFile,
  type PolicyRule,
  type PolicyRuleTarget,
  type PolicyRuleTargetContext,
  type PolicyViolation,
} from './policyTypes';
import { ruleMatchesGet, policyRuleTargetsResolve } from './policyGet';
import { policyPluginsGet, pluginGetForRule, type PolicyPluginsMap } from './policyPluginsGet';
import { Result, Ok, Err, isErr, resultFrom, resultFromAsync } from '../result/result';
import { projectIndexBuild } from '../index/indexBuilder';
import type { ProjectIndex } from '../index/indexQuery';
import type { ModuleGraph } from '../index/moduleGraph';

// ============================================================================
// ProjectIndex → ModuleGraph adapter
// ============================================================================

/**
 * Build a {@link ModuleGraph} view backed by an existing
 * {@link ProjectIndex}. The adapter is a thin pass-through; it does not
 * compute any new graph data.
 *
 * Architecture checks receive the graph this way (rather than constructing
 * it directly from `IndexStore`) so that plugin authors stay on the public
 * `ProjectIndex` surface and never reach into store internals.
 */
export function moduleGraphFromProjectIndex(projectIndex: ProjectIndex): ModuleGraph {
  return {
    moduleGraphImportersGet(file) {
      return projectIndex.moduleImportersGet(file);
    },
    moduleGraphImporteesGet(file) {
      return projectIndex.moduleImporteesGet(file);
    },
    moduleGraphDependencyOrderGet() {
      return projectIndex.moduleDependencyOrderGet();
    },
    moduleGraphCyclesGet() {
      return projectIndex.moduleCyclesGet();
    },
    moduleGraphEntryPointsGet() {
      return projectIndex.moduleEntryPointsGet();
    },
  };
}

// ============================================================================
// Runner
// ============================================================================

function architectureProviderGet(
  pluginsMap: PolicyPluginsMap,
  rule: PolicyRule,
  targets: PolicyRuleTarget[],
): Result<{ provider: ArchitectureCheckProvider; resolvedId: string } | null, string> {
  const lookup = pluginGetForRule(pluginsMap, rule.ruleId);
  if (!lookup) {
    return Err(`No plugin registered for rule type ${rule.ruleId}.`);
  }
  const { plugin, resolvedId } = lookup;
  const provider = plugin.pluginRule.capabilities.architectureCheckProvider;
  if (!provider) {
    return Ok(null);
  }

  if (provider.languages !== undefined && targets.length > 0) {
    const supportsAny = targets.some((target) =>
      architectureCheckProviderSupportsLanguage(provider, target.language),
    );
    if (!supportsAny) {
      return Err(
        `Plugin ${resolvedId} architecture check does not support any target language for rule ${rule.id || rule.ruleId}.`,
      );
    }
  }

  return Ok({ provider, resolvedId });
}

/**
 * Returns true when any plugin in the map declares an architecture check
 * provider. Used by `policyCheck` to decide whether to run the runner.
 */
export function pluginsMapHasArchitectureProvider(pluginsMap: PolicyPluginsMap): boolean {
  for (const [, plugin] of pluginsMap) {
    if (plugin.pluginRule.capabilities.architectureCheckProvider) return true;
  }
  return false;
}

/**
 * Returns true when any plugin requires the project index. Architecture
 * providers always do; tree-check providers opt in via
 * `requiresProjectIndex`.
 */
function pluginsMapRequiresProjectIndex(pluginsMap: PolicyPluginsMap): boolean {
  for (const [, plugin] of pluginsMap) {
    const caps = plugin.pluginRule.capabilities;
    if (caps.requiresProjectIndex) return true;
    if (caps.architectureCheckProvider) return true;
  }
  return false;
}

function ruleTargetsContextCollect(
  rule: PolicyRule,
  policy: PolicyFile
): Result<PolicyRuleTargetContext[], string> {
  const resolvedR = policyRuleTargetsResolve(rule, policy);
  if (isErr(resolvedR)) {
    return Err(resolvedR.Err.message);
  }
  return Ok(
    resolvedR.Ok.map((target) => ({
      ruleId: rule.id || rule.ruleId,
      description: rule.description,
      args: rule.args,
      target,
    })),
  );
}

/**
 * Run a single architecture check provider for a rule and return its
 * violations, wrapping thrown exceptions as a `Result.Err`.
 */
function architectureCheckRunOne(
  provider: ArchitectureCheckProvider,
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): Result<PolicyViolation[], string> {
  return resultFrom(() => provider.check(rule, context));
}

/**
 * Run all architecture check providers declared by the policy.
 *
 * Caller may pass a pre-built {@link ProjectIndex}; otherwise the runner
 * builds one from every file matched by any rule in the policy. This
 * matches the behaviour of `policyViolationsGetFromDir` and lets the LSP
 * / workspace-service share a single index across both pipelines.
 *
 * Returns an empty array when no rule declares an architecture provider.
 */
export async function policyArchitectureViolationsGetFromDir(
  policy: PolicyFile,
  dir: string,
  options: {
    configPath?: string;
    projectIndex?: ProjectIndex;
    pluginsMap?: PolicyPluginsMap;
  } = {},
): Promise<Result<PolicyViolation[], string>> {
  let pluginsMap = options.pluginsMap;
  if (!pluginsMap) {
    const pluginsResult = await policyPluginsGet(policy, dir, {
      configPath: options.configPath,
    });
    if (isErr(pluginsResult)) {
      return pluginsResult;
    }
    pluginsMap = pluginsResult.Ok;
  }

  if (!pluginsMapHasArchitectureProvider(pluginsMap)) {
    return Ok([]);
  }

  const matchesR = await ruleMatchesGet(policy, dir);
  if (isErr(matchesR)) {
    return Err(matchesR.Err.message);
  }
  const matches = matchesR.Ok;
  const allFiles = new Set<string>();
  for (const match of matches) {
    for (const filePath of match.files) {
      allFiles.add(filePath);
    }
  }

  let projectIndex = options.projectIndex;
  if (!projectIndex && pluginsMapRequiresProjectIndex(pluginsMap) && allFiles.size > 0) {
    const indexR = await resultFromAsync(() =>
      projectIndexBuild({
        files: Array.from(allFiles),
        dir,
      })
    );
    if (isErr(indexR)) {
      return Err(
        `Failed to build project index for architecture checks: ${
          indexR.Err instanceof Error ? indexR.Err.message : String(indexR.Err)
        }`,
      );
    }
    projectIndex = indexR.Ok.index;
  }

  if (!projectIndex) {
    return Ok([]);
  }

  const moduleGraph = moduleGraphFromProjectIndex(projectIndex);

  // Architecture rules run once per (rule, ruleId) pair. We dedupe by
  // rule reference to avoid running the same rule twice when multiple
  // targets are declared — architecture rules are project-wide.
  const seenRules = new Set<PolicyRule>();
  const violations: PolicyViolation[] = [];

  for (const rule of policy.rules) {
    if (seenRules.has(rule)) continue;
    seenRules.add(rule);

    if (rule.providers && rule.providers.length > 0 && !rule.providers.includes('architecture')) {
      continue;
    }

    const targetsR = policyRuleTargetsResolve(rule, policy);
    if (isErr(targetsR)) {
      return Err(targetsR.Err.message);
    }
    const targets = targetsR.Ok;
    const providerResult = architectureProviderGet(pluginsMap, rule, targets);
    if (isErr(providerResult)) {
      return providerResult;
    }
    const entry = providerResult.Ok;
    if (!entry) continue;

    const ruleTargetsR = ruleTargetsContextCollect(rule, policy);
    if (isErr(ruleTargetsR)) {
      return ruleTargetsR;
    }
    const ruleTargets = ruleTargetsR.Ok;
    const context: ArchitectureCheckContext = {
      cwd: dir,
      policy,
      configPath: options.configPath,
      projectIndex,
      moduleGraph,
      ruleArgs: rule.args,
      ruleTargets,
    };

    const checkResult = architectureCheckRunOne(entry.provider, rule, context);
    if (isErr(checkResult)) {
      return Err(
        `Architecture check ${entry.resolvedId} failed: ${checkResult.Err}`,
      );
    }
    violations.push(...checkResult.Ok);
  }

  return Ok(violations);
}

/**
 * Helper used by `policyTreeCheck` so the two runners stay in sync about
 * whether the project index needs to be built.
 */
export { pluginsMapRequiresProjectIndex };

/**
 * Single-rule entry point for unit tests and any consumer that wants to
 * run an individual architecture rule against a known {@link ProjectIndex}.
 *
 * Throws-as-Err is preserved so that callers can decide whether to bubble
 * up or keep going.
 */
export function policyArchitectureViolationsGetForRule(
  rule: PolicyRule,
  provider: ArchitectureCheckProvider,
  context: ArchitectureCheckContext,
): Result<PolicyViolation[], string> {
  return architectureCheckRunOne(provider, rule, context);
}

/**
 * Re-export for the typed `Result` wrapper so consumers don't need to
 * import from `../result/result` separately.
 */
export type { ArchitectureCheckContext, ArchitectureCheckProvider } from './policyTypes';
