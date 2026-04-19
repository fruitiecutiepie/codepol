/**
 * @packageDocumentation
 * Shared helper for the {@link maxFanInCheck} and
 * {@link maxFanOutCheck} architecture rules.
 *
 * Both rules walk the project's indexed file set, count edges in one
 * direction (importers vs importees), and emit a violation per file
 * whose count strictly exceeds a configured budget. The shared helper
 * encapsulates the loop, glob filtering, and deterministic ordering so
 * the two rule modules stay focused on their direction of interest.
 */

import path from 'node:path';
import { minimatch } from 'minimatch';
import type {
  ArchitectureCheckContext,
  PolicyDiagnosticLocation,
  PolicyRule,
  PolicyViolation,
} from '@codepol/core';

/**
 * Shared argument shape for the two rules. Reused under the names
 * `MaxFanInArgs` and `MaxFanOutArgs` so plugin authors get rule-named
 * types without runtime duplication.
 */
export type MaxFanArgs = {
  /** Required maximum allowed neighbor count. Counts strictly greater than `max` produce a violation. */
  max: number;
  /** Optional globs (relative to `cwd`) limiting which files are budgeted. Defaults to all indexed files. */
  files?: string[];
  /** Optional globs (relative to `cwd`) for files to exempt from the budget. */
  ignore?: string[];
  /**
   * Optional cap on how many neighbor file paths are surfaced per
   * violation via `relatedLocations`. Default 5; pass `0` to omit.
   */
  topRelated?: number;
};

const TOP_RELATED_DEFAULT = 5;

function fileMatchesAny(globs: string[] | undefined, cwd: string, file: string): boolean {
  if (!globs || globs.length === 0) return false;
  const relative = path.relative(cwd, file);
  return globs.some((pattern) => minimatch(relative, pattern, { dot: true }));
}

function fileMatchesAll(
  includeGlobs: string[] | undefined,
  cwd: string,
  file: string,
): boolean {
  // Treat undefined / empty as "match every file"; matches existing
  // policy-target semantics in core.
  if (!includeGlobs || includeGlobs.length === 0) return true;
  const relative = path.relative(cwd, file);
  return includeGlobs.some((pattern) => minimatch(relative, pattern, { dot: true }));
}

export type MaxFanDirection = 'in' | 'out';

/**
 * Run the budgeted scan in either direction and return one
 * {@link PolicyViolation} per over-budget file.
 *
 * The caller passes a label (`importers` / `importees`) used in
 * messages and a neighbor lookup. Keeping the lookup external means
 * the helper itself never picks a direction — the `in` / `out`
 * decision lives in the rule module.
 */
export function maxFanViolationsCompute(
  rule: PolicyRule,
  context: ArchitectureCheckContext,
  options: {
    direction: MaxFanDirection;
    neighborsGet: (file: string) => string[];
  },
): PolicyViolation[] {
  const args = (context.ruleArgs as MaxFanArgs | undefined) ?? { max: Number.POSITIVE_INFINITY };
  const max = Number.isFinite(args.max) ? Math.max(0, Math.floor(args.max)) : 0;
  const topRelated =
    args.topRelated === undefined
      ? TOP_RELATED_DEFAULT
      : Math.max(0, Math.floor(args.topRelated));

  const allFiles = [...context.projectIndex.filesGet()].sort();
  const ruleId = rule.id || rule.ruleId;
  const direction = options.direction;
  const noun = direction === 'in' ? 'importers' : 'importees';
  const violations: PolicyViolation[] = [];

  for (const file of allFiles) {
    if (!fileMatchesAll(args.files, context.cwd, file)) continue;
    if (fileMatchesAny(args.ignore, context.cwd, file)) continue;

    const neighbors = options.neighborsGet(file);
    const count = neighbors.length;
    if (count <= max) continue;

    const sortedNeighbors = [...neighbors].sort();
    const relatedLocations: PolicyDiagnosticLocation[] = sortedNeighbors
      .slice(0, topRelated)
      .map((neighbor) => ({
        filePath: neighbor,
        line: 1,
        column: 1,
        message: noun.slice(0, -1), // 'importer' / 'importee'
      }));

    const overflow = count - relatedLocations.length;
    const overflowSuffix =
      overflow > 0 ? ` (+${overflow} more not shown)` : '';

    violations.push({
      ruleId,
      filePath: file,
      message: `File has ${count} ${noun}, exceeds max of ${max}${overflowSuffix}.`,
      line: 1,
      column: 1,
      relatedLocations: relatedLocations.length > 0 ? relatedLocations : undefined,
    });
  }

  return violations;
}
