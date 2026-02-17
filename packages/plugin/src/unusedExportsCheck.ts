/**
 * @packageDocumentation
 * Check function for detecting unused exports using cross-file semantic index.
 *
 * This rule detects exported symbols that are not imported by any other file in the project.
 * Uses the ImportBinding relations to precisely identify which exported names are imported.
 */

import path from 'node:path';
import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
  PolicyViolationFix,
  ProjectIndex,
} from '@codepol/core';
import { workspacePackageMapDiscover } from '@codepol/core';

/**
 * Rule arguments for configuring unused exports detection.
 */
type UnusedExportsArgs = {
  /** Glob patterns for files to skip */
  ignorePatterns?: string[];
  /** Skip files that are package entry points (resolved from package.json exports/main) */
  ignorePackageEntryPoints?: boolean;
};

/**
 * Convert a byte offset to line and column numbers.
 * Lines are 1-indexed, columns are 1-indexed.
 */
function byteOffsetToLineColumn(
  source: string,
  byteOffset: number
): { line: number; column: number } {
  // Ensure we don't go past the source
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
function resolveModuleSpecifier(spec: string, fromFile: string): string | undefined {
  // Strip quotes from the specifier
  const cleanSpec = spec.replace(/^['"]|['"]$/g, '');
  
  // Only handle relative imports for now
  if (!cleanSpec.startsWith('.')) {
    return undefined;
  }
  
  const fromDir = path.dirname(fromFile);
  return path.resolve(fromDir, cleanSpec);
}

/**
 * Check if a resolved import path matches the target file.
 */
function importMatchesFile(resolvedImport: string, targetFile: string): boolean {
  // Direct match
  if (resolvedImport === targetFile) return true;
  
  // Match with common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  for (const ext of extensions) {
    if (resolvedImport + ext === targetFile) return true;
  }
  
  // Match index files
  const indexFiles = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
  for (const idx of indexFiles) {
    if (resolvedImport + idx === targetFile) return true;
  }
  
  return false;
}

/**
 * Get all exported names that are imported from a target file by other files.
 * 
 * Uses the ImportBinding relations which provide:
 * - importedName: the actual name being imported ("foo", "default", "*")
 * - moduleSpec: the module specifier
 * - resolvedModulePath: already resolved path (if available)
 * 
 * Returns the set of imported names (e.g., "foo", "default", "bar")
 */
function getImportedExportNames(
  projectIndex: ProjectIndex,
  targetFile: string
): Set<string> {
  const importedNames = new Set<string>();
  
  // Get all unique files from the index
  const allSymbols = projectIndex.symbolsGet();
  const files = new Set(allSymbols.map(s => s.file));
  
  // Check each file's import bindings
  for (const file of files) {
    if (file === targetFile) continue; // Skip self
    
    // Use the proper ImportBinding API
    const bindings = projectIndex.importBindingsGet(file);
    
    for (const binding of bindings) {
      // Check if this import points to our target file
      // Option 1: Use resolvedModulePath if available (from cross-file resolution)
      if (binding.resolvedModulePath === targetFile) {
        importedNames.add(binding.importedName);
        continue;
      }
      
      // Option 2: Resolve manually if not already resolved
      const resolved = resolveModuleSpecifier(binding.moduleSpec, file);
      if (resolved && importMatchesFile(resolved, targetFile)) {
        importedNames.add(binding.importedName);
      }
    }
  }
  
  return importedNames;
}

/**
 * Matches an inline export declaration: `export [async] function|const|let|…`
 * Captures: [1] leading whitespace, [2] "export " (keyword + trailing space)
 */
const INLINE_EXPORT_RE =
  /^(\s*)(export\s+)(?:async\s+)?(?:function|const|let|var|type|interface|class|enum|abstract\s+class)\b/;

/**
 * Build fix data that removes the `export ` keyword from an inline declaration.
 * Returns undefined for default exports, re-exports, and `export { … }` forms
 * where stripping the keyword would produce invalid syntax.
 */
function exportKeywordRemovalFix(
  source: string,
  rangeStart: number,
  exportedName: string,
): PolicyViolationFix | undefined {
  if (exportedName === 'default') return undefined;

  const lineStart = source.lastIndexOf('\n', rangeStart - 1) + 1;
  const lineEnd = source.indexOf('\n', lineStart);
  const lineText = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);

  const m = INLINE_EXPORT_RE.exec(lineText);
  if (!m) return undefined;

  const indentLen = m[1]!.length;
  const exportLen = m[2]!.length; // "export " including trailing whitespace

  return {
    byteRange: {
      start: lineStart + indentLen,
      end: lineStart + indentLen + exportLen,
    },
    text: '',
  };
}

/**
 * Check for unused exports in a file using the project-wide semantic index.
 *
 * This function:
 * 1. Gets all exports from the current file (via ExportsRelation)
 * 2. For each export, checks if its exportedName is imported by any other file
 * 3. Reports violations for exports with no external imports
 *
 * Uses ImportBinding relations for precise matching of imported names to exported names.
 * Handles named exports, default exports, and aliased exports correctly.
 *
 * @param rule - The policy rule configuration
 * @param context - The check context including source, file path, and projectIndex
 * @returns Array of violations for unused exports
 */
export function unusedExportsCheck(
  rule: PolicyRule,
  context: PolicyCheckContext
): PolicyViolation[] {
  const { projectIndex, source, filePath } = context;

  // Gracefully skip if index is not available
  // This happens when no plugin requires the index, or indexing failed
  if (!projectIndex) {
    return [];
  }

  // Parse rule arguments
  const args = (context.ruleArgs as UnusedExportsArgs) ?? {};

  // Skip package entry points if configured
  if (args.ignorePackageEntryPoints) {
    const packageEntryPoints = workspacePackageMapDiscover(context.dir);
    const entryFiles = new Set(packageEntryPoints.values());
    if (entryFiles.has(filePath)) {
      return [];
    }
  }

  const violations: PolicyViolation[] = [];

  // Get all exports from this file (ExportsRelation provides exportedName)
  const fileExports = projectIndex.fileExportsGet(filePath);
  
  // Get all exported names that are imported from this file by other files
  const importedExportNames = getImportedExportNames(projectIndex, filePath);

  // For each export, check if its exportedName is imported by other files
  for (const exp of fileExports) {
    // Skip namespace re-exports (export * from) - they're not directly importable by name
    if (exp.exportedName === '*') continue;
    
    // Check if this export's name is imported by any other file
    if (!importedExportNames.has(exp.exportedName)) {
      // Get the symbol for better error messages
      const symbol = exp.symbolId ? projectIndex.symbolGet(exp.symbolId) : undefined;
      const symbolName = symbol?.name ?? exp.exportedName;
      const symbolKind = symbol?.kind ?? 'export';
      
      // Use the export's range, or fall back to symbol's range
      const range = exp.byteRange ?? symbol?.byteRange ?? { start: 0, end: 0 };
      const { line, column } = byteOffsetToLineColumn(source, range.start);

      // Format message to show both the exported name and symbol name if they differ
      const nameInfo = exp.exportedName !== symbolName && exp.exportedName !== 'default'
        ? ` (exported as '${exp.exportedName}')`
        : '';
      
      const displayName = exp.exportedName === 'default' ? symbolName : exp.exportedName;

      violations.push({
        ruleId: rule.id || rule.ruleId,
        filePath: filePath,
        message: `Exported ${symbolKind} '${displayName}'${nameInfo} is not imported by any other file`,
        line,
        column,
        fix: exportKeywordRemovalFix(source, range.start, exp.exportedName),
      });
    }
  }

  return violations;
}
