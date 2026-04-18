/**
 * @packageDocumentation
 * Architecture check that flags modules unreachable from any declared
 * entry point as dead code.
 *
 * Reachability is computed via {@link moduleDeadModulesCompute} on the
 * forward import graph. Entry points may be declared as glob patterns in
 * `args.entries`; when omitted, the natural entry points reported by
 * {@link ModuleGraph.moduleGraphEntryPointsGet} are used.
 */

import path from 'node:path';
import { minimatch } from 'minimatch';
import type {
  ArchitectureCheckContext,
  ArchitectureCheckFn,
  PolicyRule,
  PolicyViolation,
} from '@codepol/core';
import { moduleDeadModulesCompute } from '@codepol/core';

/**
 * Configurable arguments for the `dead-module` architecture rule.
 *
 * - `entries`: glob patterns (relative to the policy `cwd`) selecting
 *   files to treat as entry points. When omitted or empty, the rule
 *   uses the module graph's natural entry points (files with no
 *   importers).
 * - `ignore`: glob patterns for files to exempt from the check. A file
 *   matching any `ignore` glob is never reported as dead, even if it
 *   is unreachable.
 */
export type DeadModuleArgs = {
  entries?: string[];
  ignore?: string[];
};

function fileMatchesAny(globs: string[] | undefined, cwd: string, file: string): boolean {
  if (!globs || globs.length === 0) return false;
  const relative = path.relative(cwd, file);
  return globs.some((pattern) => minimatch(relative, pattern, { dot: true }));
}

function entryPointsResolve(
  args: DeadModuleArgs,
  context: ArchitectureCheckContext,
): { entries: string[]; explicit: boolean } {
  if (!args.entries || args.entries.length === 0) {
    return { entries: [], explicit: false };
  }
  const allFiles = context.projectIndex.filesGet();
  const entries: string[] = [];
  for (const file of allFiles) {
    if (fileMatchesAny(args.entries, context.cwd, file)) {
      entries.push(file);
    }
  }
  return { entries, explicit: true };
}

/**
 * The check function. Computes unreachable modules and emits a
 * violation per file at line 1.
 */
export const deadModuleCheck: ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): PolicyViolation[] => {
  const args = (context.ruleArgs as DeadModuleArgs | undefined) ?? {};
  const { entries, explicit } = entryPointsResolve(args, context);

  // When the user passed an explicit `entries` glob that matched
  // nothing, treat the policy as misconfigured and emit zero
  // violations rather than reporting every file as dead. This avoids
  // accidental floods when an entry glob has a typo.
  if (explicit && entries.length === 0) return [];

  const result = moduleDeadModulesCompute(context.moduleGraph, {
    entryPoints: entries,
  });
  if (result.unreachable.length === 0) return [];

  const ruleId = rule.id || rule.ruleId;
  const violations: PolicyViolation[] = [];
  for (const file of result.unreachable) {
    if (fileMatchesAny(args.ignore, context.cwd, file)) continue;
    violations.push({
      ruleId,
      filePath: file,
      message: 'Module is unreachable from any declared entry point.',
      line: 1,
      column: 1,
    });
  }
  return violations;
};
