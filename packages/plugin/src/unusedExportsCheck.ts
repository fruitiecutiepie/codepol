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
  ProjectIndex,
} from '@codepol/core';

/**
 * Rule arguments for configuring unused exports detection.
 */
export type UnusedExportsArgs = {
  /** Glob patterns for files to skip */
  ignorePatterns?: string[];
  /** Skip entry point files (index.ts, main.ts) */
  ignoreEntryPoints?: boolean;
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
 * Check if a file path matches entry point patterns.
 */
function isEntryPoint(filePath: string): boolean {
  const entryPatterns = [
    /[/\\]index\.(ts|tsx|js|jsx)$/,
    /[/\\]main\.(ts|tsx|js|jsx)$/,
  ];
  return entryPatterns.some(pattern => pattern.test(filePath));
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
  const allSymbols = projectIndex.getSymbols();
  const files = new Set(allSymbols.map(s => s.file));
  
  // Check each file's import bindings
  for (const file of files) {
    if (file === targetFile) continue; // Skip self
    
    // Use the proper ImportBinding API
    const bindings = projectIndex.getImportBindings(file);
    
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

  // Skip entry points if configured
  if (args.ignoreEntryPoints && isEntryPoint(filePath)) {
    return [];
  }

  const violations: PolicyViolation[] = [];

  // Get all exports from this file (ExportsRelation provides exportedName)
  const fileExports = projectIndex.getFileExports(filePath);
  
  // Get all exported names that are imported from this file by other files
  const importedExportNames = getImportedExportNames(projectIndex, filePath);

  // For each export, check if its exportedName is imported by other files
  for (const exp of fileExports) {
    // Skip namespace re-exports (export * from) - they're not directly importable by name
    if (exp.exportedName === '*') continue;
    
    // Check if this export's name is imported by any other file
    if (!importedExportNames.has(exp.exportedName)) {
      // Get the symbol for better error messages
      const symbol = exp.symbolId ? projectIndex.getSymbol(exp.symbolId) : undefined;
      const symbolName = symbol?.name ?? exp.exportedName;
      const symbolKind = symbol?.kind ?? 'export';
      
      // Use the export's range, or fall back to symbol's range
      const range = exp.range ?? symbol?.range ?? { start: 0, end: 0 };
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
      });
    }
  }

  return violations;
}
