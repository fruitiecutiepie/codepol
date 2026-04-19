/**
 * @packageDocumentation
 * Architecture check that ensures only declared roots are entry points.
 *
 * A file is treated as an entry point when nothing else in the indexed
 * project imports it. Without this rule, a forgotten experiment file or
 * an orphan after a refactor sits silently with zero importers — never
 * dead enough for `dead-module` (it might be a CLI bin) but never
 * intentionally a root either. The allowlist forces every entry point
 * to be deliberate.
 */

import path from 'node:path';
import { minimatch } from 'minimatch';
import type {
  ArchitectureCheckContext,
  ArchitectureCheckFn,
  PolicyRule,
  PolicyViolation,
} from '@codepol/core';

/**
 * Configurable arguments for the `entry-point-allowlist` architecture
 * rule.
 *
 * - `entries`: required globs (relative to the policy `cwd`) of files
 *   allowed to be entry points. A file with zero importers that does
 *   not match any glob produces a violation. Pass `[]` to enforce "no
 *   orphan files allowed at all".
 * - `ignore`: optional globs of files to skip — never reported even
 *   when they have no importers (typical for test files, fixtures,
 *   `.d.ts` declarations).
 */
export type EntryPointAllowlistArgs = {
  entries: string[];
  ignore?: string[];
};

function fileMatchesAny(globs: string[] | undefined, cwd: string, file: string): boolean {
  if (!globs || globs.length === 0) return false;
  const relative = path.relative(cwd, file);
  return globs.some((pattern) => minimatch(relative, pattern, { dot: true }));
}

/**
 * The check function. Walks the indexed file set, computes "is this an
 * entry point?" via importer count, and reports any orphan that is not
 * declared in the allowlist.
 */
export const entryPointAllowlistCheck: ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): PolicyViolation[] => {
  const args = (context.ruleArgs as EntryPointAllowlistArgs | undefined) ?? { entries: [] };
  const entryGlobs = Array.isArray(args.entries) ? args.entries : [];

  const ruleId = rule.id || rule.ruleId;
  const allFiles = [...context.projectIndex.filesGet()].sort();
  const violations: PolicyViolation[] = [];

  for (const file of allFiles) {
    if (fileMatchesAny(args.ignore, context.cwd, file)) continue;

    const importers = context.moduleGraph.moduleGraphImportersGet(file);
    if (importers.length > 0) continue; // not an entry point

    if (fileMatchesAny(entryGlobs, context.cwd, file)) continue;

    violations.push({
      ruleId,
      filePath: file,
      message:
        'File has no importers but is not declared in the entry-point allowlist. ' +
        'Add it to `args.entries` or import it from a declared root.',
      line: 1,
      column: 1,
    });
  }

  return violations;
};
