/**
 * @packageDocumentation
 * Architecture check that forbids monorepo packages from importing each
 * other's internal files. Cross-package imports must hit the importee
 * package's declared public entry point (typically `src/index.ts`),
 * not deep paths into its tree.
 *
 * Discovery uses {@link workspacePackageRecordsDiscover} so the rule
 * works on pnpm / npm / yarn workspaces without extra configuration.
 * Files outside any workspace package are ignored — the rule has no
 * opinion on loose root-level scripts.
 */

import path from 'node:path';
import { minimatch } from 'minimatch';
import type {
  ArchitectureCheckContext,
  ArchitectureCheckFn,
  PolicyDiagnosticLocation,
  PolicyRule,
  PolicyViolation,
  WorkspacePackageRecord,
} from '@codepol/core';
import { workspacePackageRecordsDiscover } from '@codepol/core';

/**
 * Configurable arguments for the `no-cross-package-internal-import`
 * architecture rule.
 *
 * - `allow`: optional globs (relative to the policy `cwd`) of files
 *   that, in addition to each package's declared entry point, are also
 *   considered public. Useful when a package exposes more than one
 *   public surface (e.g. `src/cli/index.ts` for CLI consumers).
 * - `ignorePackages`: optional list of package names whose internals
 *   should not be policed. Edges into these packages never produce a
 *   violation regardless of which file is imported.
 */
export type NoCrossPackageInternalImportArgs = {
  allow?: string[];
  ignorePackages?: string[];
};

type PackageOwnership = {
  name: string;
  packageDir: string;
  entryPointPath: string;
};

function fileMatchesAny(globs: string[] | undefined, cwd: string, file: string): boolean {
  if (!globs || globs.length === 0) return false;
  const relative = path.relative(cwd, file);
  return globs.some((pattern) => minimatch(relative, pattern, { dot: true }));
}

/**
 * Build a per-file ownership map. A file belongs to a package when its
 * absolute path is within the package's directory. When two packages'
 * directories are nested (uncommon but possible), the longest matching
 * directory wins so that a nested package shadows its parent.
 */
function fileOwnershipMapBuild(
  files: string[],
  records: WorkspacePackageRecord[],
): Map<string, PackageOwnership> {
  const ownerships: PackageOwnership[] = records.map((record) => ({
    name: record.name,
    packageDir: path.dirname(record.packageJsonPath),
    entryPointPath: record.entryPointPath,
  }));
  // Longest packageDir first so nested packages win.
  ownerships.sort((a, b) => b.packageDir.length - a.packageDir.length);

  const result = new Map<string, PackageOwnership>();
  for (const file of files) {
    for (const owner of ownerships) {
      const prefix = owner.packageDir.endsWith(path.sep)
        ? owner.packageDir
        : owner.packageDir + path.sep;
      if (file === owner.packageDir || file.startsWith(prefix)) {
        result.set(file, owner);
        break;
      }
    }
  }
  return result;
}

/**
 * The check function.
 */
export const noCrossPackageInternalImportCheck: ArchitectureCheckFn = (
  rule: PolicyRule,
  context: ArchitectureCheckContext,
): PolicyViolation[] => {
  const args = (context.ruleArgs as NoCrossPackageInternalImportArgs | undefined) ?? {};

  const records = workspacePackageRecordsDiscover(context.cwd);
  if (records.length === 0) return [];

  const ignoredPackages = new Set(args.ignorePackages ?? []);
  const allFiles = context.projectIndex.filesGet();
  const ownership = fileOwnershipMapBuild(allFiles, records);
  if (ownership.size === 0) return [];

  const ruleId = rule.id || rule.ruleId;
  const violations: PolicyViolation[] = [];

  for (const [fromFile, fromOwner] of ownership) {
    const importees = context.moduleGraph.moduleGraphImporteesGet(fromFile);
    for (const toFile of importees) {
      const toOwner = ownership.get(toFile);
      if (!toOwner) continue; // edge to file outside any package — out of scope
      if (toOwner.name === fromOwner.name) continue; // intra-package edge — always allowed
      if (ignoredPackages.has(toOwner.name)) continue;
      if (toFile === toOwner.entryPointPath) continue; // public entry — allowed
      if (fileMatchesAny(args.allow, context.cwd, toFile)) continue;

      const related: PolicyDiagnosticLocation[] = [
        {
          filePath: toOwner.entryPointPath,
          line: 1,
          column: 1,
          message: `public entry point of '${toOwner.name}'`,
        },
      ];
      violations.push({
        ruleId,
        filePath: fromFile,
        message:
          `Package '${fromOwner.name}' imports an internal file of '${toOwner.name}'. ` +
          `Cross-package imports must hit the public entry (${path.relative(
            context.cwd,
            toOwner.entryPointPath,
          )}).`,
        line: 1,
        column: 1,
        relatedLocations: related,
      });
    }
  }

  // Stable order across runs.
  violations.sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
  return violations;
};
