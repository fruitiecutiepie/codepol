/**
 * @packageDocumentation
 * Architecture check that flags every circular import cycle in the
 * project as a {@link PolicyViolation}.
 *
 * Each cycle produces exactly one violation, anchored at the
 * alphabetically-first member so the report is deterministic across
 * runs. The remaining members appear in `relatedLocations` so editors
 * and code-action consumers can navigate the full cycle.
 */

import type {
  ArchitectureCheckContext,
  ArchitectureCheckFn,
  PolicyDiagnosticLocation,
  PolicyRule,
  PolicyViolation,
} from '@codepol/core';

/**
 * Configurable arguments for the `no-cycles` architecture rule.
 *
 * - `maxCycles`: hard cap on emitted violations. Cycles are sorted
 *   `(-size, alphabetical first member)` so the largest, most-impactful
 *   cycles win when truncation kicks in. When omitted, defaults to
 *   {@link NO_CYCLES_DEFAULT_MAX}. When the cap is reached one extra
 *   "summary" violation is emitted on the first reported cycle's anchor
 *   file describing how many cycles were omitted.
 * - `minSize`: ignore cycles strictly smaller than this size. Defaults
 *   to `2`; setting `1` includes self-imports.
 */
export type NoCyclesArgs = {
  maxCycles?: number;
  minSize?: number;
};

/**
 * Default cap on the number of cycles reported per run. Picked to
 * preserve signal in large legacy codebases where `moduleCyclesGet()`
 * can return thousands of SCCs.
 */
export const NO_CYCLES_DEFAULT_MAX = 50;

/**
 * Format a list of file paths as a short cycle label, using the basename
 * of each file. Output deliberately preserves the cycle's traversal
 * order so the message is readable as a directed loop.
 */
function cycleLabelFormat(cycle: string[]): string {
  if (cycle.length === 0) return '';
  const basenames = cycle.map((file) => file.split(/[\\/]/).pop() ?? file);
  return `${basenames.join(' -> ')} -> ${basenames[0]}`;
}

function cyclesOrderCompare(a: string[], b: string[]): number {
  if (a.length !== b.length) return b.length - a.length;
  const left = [...a].sort();
  const right = [...b].sort();
  for (let index = 0; index < left.length; index += 1) {
    const lv = left[index]!;
    const rv = right[index]!;
    if (lv !== rv) return lv < rv ? -1 : 1;
  }
  return 0;
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
 * The check function. Pulls cycles from the module graph, ranks them
 * deterministically, and emits one violation per cycle plus an optional
 * truncation summary.
 */
export const noCyclesCheck: ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): PolicyViolation[] => {
  const args = (context.ruleArgs as NoCyclesArgs | undefined) ?? {};
  const maxCycles =
    args.maxCycles !== undefined ? Math.max(0, Math.floor(args.maxCycles)) : NO_CYCLES_DEFAULT_MAX;
  const minSize = args.minSize !== undefined ? Math.max(1, Math.floor(args.minSize)) : 2;

  const allCycles = context.moduleGraph
    .moduleGraphCyclesGet()
    .filter((cycle) => cycle.length >= minSize);
  if (allCycles.length === 0) return [];

  const ranked = [...allCycles].sort(cyclesOrderCompare);
  const reported = ranked.slice(0, maxCycles);
  const truncatedCount = ranked.length - reported.length;

  const ruleId = rule.id || rule.ruleId;
  const violations: PolicyViolation[] = [];

  for (const cycle of reported) {
    const sorted = [...cycle].sort();
    const anchor = sorted[0]!;
    violations.push({
      ruleId,
      filePath: anchor,
      message: `Circular import (${cycle.length} files): ${cycleLabelFormat(cycle)}`,
      line: 1,
      column: 1,
      relatedLocations: relatedLocationsBuild(sorted, anchor),
    });
  }

  if (truncatedCount > 0 && violations.length > 0) {
    const summaryAnchor = violations[0]!.filePath;
    violations.push({
      ruleId,
      filePath: summaryAnchor,
      message: `${truncatedCount} additional circular import cycle${truncatedCount === 1 ? '' : 's'} omitted (maxCycles=${maxCycles}).`,
      line: 1,
      column: 1,
    });
  }

  return violations;
};
