/**
 * @packageDocumentation
 * Architecture check that caps the size of any individual circular import
 * cycle. Complements `no-cycles`: when a codebase still has legitimate
 * legacy cycles, this rule lets teams hold the line by forbidding the
 * cycles from growing beyond a budget.
 *
 * One violation is emitted per offending cycle, anchored at the
 * alphabetically-first member with the remaining members exposed via
 * `relatedLocations` — same shape as `no-cycles` so editors and code
 * actions can treat both rules uniformly.
 */

import path from 'node:path';
import { minimatch } from 'minimatch';
import type {
  ArchitectureCheckContext,
  ArchitectureCheckFn,
  PolicyDiagnosticLocation,
  PolicyRule,
  PolicyViolation,
} from '@codepol/core';

/**
 * Configurable arguments for the `max-cycle-size` architecture rule.
 *
 * - `max`: required. Maximum permitted cycle size measured in unique
 *   files. A cycle whose size strictly exceeds `max` produces one
 *   violation. Must be a positive finite integer; values `< 2` are
 *   clamped to `2` since cycles smaller than that aren't cycles.
 * - `ignore`: optional globs (relative to the policy `cwd`) of files to
 *   exclude from each cycle before measuring. Useful for ignoring
 *   generated barrel files or test helpers that participate in legacy
 *   cycles but aren't worth refactoring.
 */
export type MaxCycleSizeArgs = {
  max: number;
  ignore?: string[];
};

function fileMatchesAny(globs: string[] | undefined, cwd: string, file: string): boolean {
  if (!globs || globs.length === 0) return false;
  const relative = path.relative(cwd, file);
  return globs.some((pattern) => minimatch(relative, pattern, { dot: true }));
}

function cycleLabelFormat(cycle: string[]): string {
  if (cycle.length === 0) return '';
  const basenames = cycle.map((file) => file.split(/[\\/]/).pop() ?? file);
  return `${basenames.join(' -> ')} -> ${basenames[0]}`;
}

function relatedLocationsBuild(cycleSorted: string[], anchor: string): PolicyDiagnosticLocation[] {
  const related: PolicyDiagnosticLocation[] = [];
  for (const file of cycleSorted) {
    if (file === anchor) continue;
    related.push({
      filePath: file,
      line: 1,
      column: 1,
      message: 'cycle member',
    });
  }
  return related;
}

/**
 * The check function. Reads cycles from the module graph, optionally
 * trims `ignore`d members, and emits one violation per cycle whose
 * remaining size exceeds `max`.
 */
export const maxCycleSizeCheck: ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): PolicyViolation[] => {
  const args = (context.ruleArgs as MaxCycleSizeArgs | undefined) ?? { max: Number.POSITIVE_INFINITY };
  const max = Number.isFinite(args.max) ? Math.max(2, Math.floor(args.max)) : 2;

  const allCycles = context.moduleGraph.moduleGraphCyclesGet();
  if (allCycles.length === 0) return [];

  const ruleId = rule.id || rule.ruleId;
  const violations: PolicyViolation[] = [];

  for (const rawCycle of allCycles) {
    const filtered = rawCycle.filter((file) => !fileMatchesAny(args.ignore, context.cwd, file));
    // After ignoring, anything below 2 isn't a cycle worth reporting.
    if (filtered.length < 2) continue;
    if (filtered.length <= max) continue;

    const sorted = [...filtered].sort();
    const anchor = sorted[0]!;
    violations.push({
      ruleId,
      filePath: anchor,
      message: `Circular import exceeds max-cycle-size budget (${filtered.length} > ${max}): ${cycleLabelFormat(filtered)}`,
      line: 1,
      column: 1,
      relatedLocations: relatedLocationsBuild(sorted, anchor),
    });
  }

  // Stable order across runs: sort by anchor file path.
  violations.sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0));
  return violations;
};
