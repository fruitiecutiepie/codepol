/**
 * @packageDocumentation
 * Check function for detecting name collisions across star-exported modules.
 *
 * When a file uses `export * from './a'` and `export * from './b'`, both
 * modules' exports are re-exported implicitly. If both modules export the
 * same name, the collision is silent at the declaration site but causes
 * runtime ambiguity (last one wins in JS). This check enumerates every
 * symbol exposed by each star export and flags any name that appears in
 * two or more source modules.
 */

import path from 'node:path';
import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
  ProjectIndex,
  ExportsRelation,
} from '@codepol/core';

/**
 * Rule arguments for configuring star export collision detection.
 */
export type NoStarExportCollisionsArgs = {
  /** If true, also flag collisions with the file's own named exports */
  includeLocalExports?: boolean;
};

/**
 * Convert a byte offset to line and column numbers.
 * Lines are 1-indexed, columns are 1-indexed.
 */
function byteOffsetToLineColumn(
  source: string,
  byteOffset: number,
): { line: number; column: number } {
  const safeOffset = Math.min(byteOffset, source.length);
  const textBefore = source.slice(0, safeOffset);
  const lines = textBefore.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

/**
 * Resolve a module specifier to an absolute file path.
 * Handles relative imports and strips quotes.
 */
function moduleSpecifierResolve(
  spec: string,
  fromFile: string,
): string | undefined {
  const cleanSpec = spec.replace(/^['"]|['"]$/g, '');
  if (!cleanSpec.startsWith('.')) {
    return undefined;
  }
  const fromDir = path.dirname(fromFile);
  return path.resolve(fromDir, cleanSpec);
}

/**
 * Check if a resolved import path matches the target file.
 * Tries direct match, common extensions, and index file variants.
 */
function resolvedPathMatchesFile(
  resolvedImport: string,
  targetFile: string,
): boolean {
  if (resolvedImport === targetFile) return true;

  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  for (const ext of extensions) {
    if (resolvedImport + ext === targetFile) return true;
  }

  const indexFiles = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
  for (const idx of indexFiles) {
    if (resolvedImport + idx === targetFile) return true;
  }

  return false;
}

/**
 * Resolve a source module specifier to an indexed file path.
 * Searches through all indexed files to find a match.
 */
function sourceModuleFileResolve(
  sourceModule: string,
  fromFile: string,
  indexedFiles: Set<string>,
): string | undefined {
  const resolved = moduleSpecifierResolve(sourceModule, fromFile);
  if (!resolved) return undefined;

  for (const candidate of indexedFiles) {
    if (resolvedPathMatchesFile(resolved, candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Collect the non-default, non-star exported names from a resolved module,
 * including names transitively re-exported via that module's own star exports.
 */
function moduleExportedNamesCollect(
  resolvedPath: string,
  projectIndex: ProjectIndex,
  indexedFiles: Set<string>,
  visited: Set<string>,
): string[] {
  if (visited.has(resolvedPath)) return [];
  visited.add(resolvedPath);

  const names: string[] = [];
  const exports = projectIndex.fileExportsGet(resolvedPath);

  for (const exp of exports) {
    if (exp.exportedName === 'default') continue;

    if (exp.exportedName === '*' && exp.sourceModule) {
      // Recurse into transitive star exports
      const nestedPath = sourceModuleFileResolve(
        exp.sourceModule,
        resolvedPath,
        indexedFiles,
      );
      if (nestedPath) {
        names.push(
          ...moduleExportedNamesCollect(nestedPath, projectIndex, indexedFiles, visited),
        );
      }
      continue;
    }

    if (exp.exportedName !== '*') {
      names.push(exp.exportedName);
    }
  }

  return names;
}

/**
 * Source module info: the specifier string, resolved path, and the
 * ExportsRelation entry (used for byte-range reporting).
 */
type StarExportSource = {
  specifier: string;
  resolvedPath: string;
  relation: ExportsRelation;
};

/**
 * Check for name collisions across star-exported modules.
 *
 * Algorithm:
 * 1. Get all ExportsRelation entries for the current file.
 * 2. Filter for star exports (`exportedName === '*'` with a `sourceModule`).
 * 3. For each star-export source module, collect its exported names
 *    (including transitive star re-exports).
 * 4. Build a map of `name -> sourceModules[]`.
 * 5. Emit a violation for every name that appears in two or more sources.
 * 6. Optionally (includeLocalExports), also flag collisions between
 *    star-exported names and the file's own named exports.
 *
 * @param rule - The policy rule configuration
 * @param context - The check context including source, file path, and projectIndex
 * @returns Array of violations for star export collisions
 */
export function noStarExportCollisionsCheck(
  rule: PolicyRule,
  context: PolicyCheckContext,
): PolicyViolation[] {
  const { projectIndex, source, filePath } = context;

  if (!projectIndex) {
    return [];
  }

  const args = (context.ruleArgs as NoStarExportCollisionsArgs) ?? {};
  const includeLocalExports = args.includeLocalExports ?? false;

  const violations: PolicyViolation[] = [];

  // Discover all indexed files for module resolution
  const allSymbols = projectIndex.symbolsGet();
  const indexedFiles = new Set(allSymbols.map((s) => s.file));

  // Get all exports from the current file
  const fileExports = projectIndex.fileExportsGet(filePath);

  // Identify star-export sources
  const starSources: StarExportSource[] = [];
  for (const exp of fileExports) {
    if (exp.exportedName === '*' && exp.sourceModule) {
      const resolvedPath = sourceModuleFileResolve(
        exp.sourceModule,
        filePath,
        indexedFiles,
      );
      if (resolvedPath) {
        starSources.push({
          specifier: exp.sourceModule,
          resolvedPath,
          relation: exp,
        });
      }
    }
  }

  if (starSources.length === 0) {
    return [];
  }

  // Collect exported names per source module
  // Map<name, StarExportSource[]>
  const nameToSources = new Map<string, StarExportSource[]>();

  for (const src of starSources) {
    const names = moduleExportedNamesCollect(
      src.resolvedPath,
      projectIndex,
      indexedFiles,
      new Set<string>(),
    );
    for (const name of names) {
      const existing = nameToSources.get(name) ?? [];
      existing.push(src);
      nameToSources.set(name, existing);
    }
  }

  // Detect collisions between star-exported modules
  const ruleId = rule.id || rule.ruleId;

  for (const [name, sources] of nameToSources) {
    if (sources.length < 2) continue;

    // De-duplicate by resolved path (same module listed twice shouldn't count)
    const uniquePaths = new Set(sources.map((s) => s.resolvedPath));
    if (uniquePaths.size < 2) continue;

    // Report on the second (and subsequent) star-export statement(s)
    const sortedSources = [...sources].sort((a, b) =>
      a.specifier.localeCompare(b.specifier),
    );
    const specifiers = sortedSources.map((s) => `'${s.specifier}'`);
    const message = `'${name}' is exported by ${specifiers.join(' and ')} via star exports`;

    // Point the violation at each star-export statement after the first
    for (let i = 1; i < sortedSources.length; i++) {
      const src = sortedSources[i];
      const { line, column } = byteOffsetToLineColumn(
        source,
        src.relation.byteRange.start,
      );
      violations.push({ ruleId, filePath, message, line, column });
    }
  }

  // Optionally flag collisions with the file's own named exports
  if (includeLocalExports) {
    const localExports = fileExports.filter(
      (exp) =>
        exp.exportedName !== '*' &&
        exp.exportedName !== 'default' &&
        !exp.sourceModule,
    );

    for (const local of localExports) {
      const conflictingSources = nameToSources.get(local.exportedName);
      if (!conflictingSources || conflictingSources.length === 0) continue;

      const specifiers = conflictingSources.map((s) => `'${s.specifier}'`);
      const uniqueSpecifiers = [...new Set(specifiers)];
      const message = `Local export '${local.exportedName}' collides with star export from ${uniqueSpecifiers.join(' and ')}`;

      const range = local.byteRange ?? { start: 0, end: 0 };
      const { line, column } = byteOffsetToLineColumn(source, range.start);
      violations.push({ ruleId, filePath, message, line, column });
    }
  }

  return violations;
}
