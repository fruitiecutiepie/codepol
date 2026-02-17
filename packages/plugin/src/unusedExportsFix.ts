import path from 'node:path';
import ts from 'typescript';
import { workspacePackageMapDiscover } from '@codepol/core';

type FileSource = {
  filePath: string;
  source: string;
};

type ImportBinding = {
  importedName: string;
  moduleSpec: string;
};

const IMPORT_RE =
  /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;

/**
 * Fix all files by removing `export` keywords from declarations that are
 * not imported by any other file in the set.
 *
 * @param files - Source files to analyze and fix
 * @param cwd - Workspace root for discovering workspace package imports
 * @returns Map of filePath → fixed source, only for files that changed.
 */
export function unusedExportsFix(
  files: FileSource[],
  cwd?: string,
): Map<string, string> {
  const workspacePackages = cwd ? workspacePackageMapDiscover(cwd) : undefined;
  const namesPerFile = importedNamesByFilePath(files, workspacePackages);
  const result = new Map<string, string>();

  for (const { filePath, source } of files) {
    const importedNames = namesPerFile.get(filePath) ?? new Set();
    const fixed = unusedExportKeywordSingleFileFix(source, importedNames);
    if (fixed !== source) {
      result.set(filePath, fixed);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cross-file import analysis
// ---------------------------------------------------------------------------

/**
 * For each file in the set, collect the names that are imported by at least
 * one *other* file.  Returns a map: filePath → Set<imported names>.
 *
 * Resolves both relative specifiers and workspace package names.
 */
function importedNamesByFilePath(
  files: FileSource[],
  workspacePackages?: Map<string, string>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const file of files) {
    result.set(file.filePath, new Set());
  }

  for (const file of files) {
    const bindings = sourceImportBindings(file.source);

    for (const { importedName, moduleSpec } of bindings) {
      const resolved = moduleSpecAbsolutePath(moduleSpec, file.filePath, workspacePackages);
      if (!resolved) continue;

      for (const target of files) {
        if (target.filePath === file.filePath) continue;
        if (absolutePathMatchesFile(resolved, target.filePath)) {
          result.get(target.filePath)!.add(importedName);
          break;
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Single-file export-keyword removal
// ---------------------------------------------------------------------------

/**
 * Remove `export` keyword from named declarations whose names are not
 * in `importedNames`.
 *
 * Skips `export default` (different semantics) and `export { … }` re-exports.
 * Uses the TypeScript compiler API so multi-line declarations, comments between
 * modifiers, and other edge cases are handled correctly.
 */
function unusedExportKeywordSingleFileFix(
  source: string,
  importedNames: Set<string>,
): string {
  const sourceFile = ts.createSourceFile(
    'temp.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const removals: { start: number; end: number }[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.canHaveModifiers(statement)) continue;
    const modifiers = ts.getModifiers(statement);
    if (!modifiers) continue;

    const exportMod = modifiers.find(
      m => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exportMod) continue;

    // Skip `export default` — removing it changes module semantics
    if (modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) continue;

    const names = declarationNames(statement);

    // Keep the export when every declared name is imported externally
    if (names.length > 0 && names.every(n => importedNames.has(n))) continue;

    // Remove `export ` (keyword + trailing horizontal whitespace)
    const start = exportMod.getStart(sourceFile);
    let end = exportMod.getEnd();
    while (end < source.length && (source[end] === ' ' || source[end] === '\t')) {
      end++;
    }
    removals.push({ start, end });
  }

  if (removals.length === 0) return source;

  // Apply in reverse order to preserve earlier positions
  removals.sort((a, b) => b.start - a.start);

  let result = source;
  for (const { start, end } of removals) {
    result = result.slice(0, start) + result.slice(end);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sourceImportBindings(source: string): ImportBinding[] {
  const results: ImportBinding[] = [];
  IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const names = match[1]!;
    const moduleSpec = match[2]!;
    for (const part of names.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const asMatch = /^(\w+)\s+as\s+\w+$/.exec(trimmed);
      results.push({
        importedName: asMatch ? asMatch[1]! : trimmed,
        moduleSpec,
      });
    }
  }
  return results;
}

function moduleSpecAbsolutePath(
  spec: string,
  fromFile: string,
  workspacePackages?: Map<string, string>,
): string | undefined {
  // Workspace package name → source entry file
  if (workspacePackages) {
    const wsEntry = workspacePackages.get(spec);
    if (wsEntry) return wsEntry;
  }

  if (!spec.startsWith('.')) return undefined;
  return path.resolve(path.dirname(fromFile), spec);
}

function absolutePathMatchesFile(resolved: string, target: string): boolean {
  if (resolved === target) return true;
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    if (resolved + ext === target) return true;
  }
  for (const idx of ['/index.ts', '/index.tsx', '/index.js', '/index.jsx']) {
    if (resolved + idx === target) return true;
  }
  return false;
}

function declarationNames(node: ts.Node): string[] {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return [node.name.text];
  }
  if (ts.isClassDeclaration(node) && node.name) {
    return [node.name.text];
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return [node.name.text];
  }
  if (ts.isInterfaceDeclaration(node)) {
    return [node.name.text];
  }
  if (ts.isEnumDeclaration(node)) {
    return [node.name.text];
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .map(d => (ts.isIdentifier(d.name) ? d.name.text : undefined))
      .filter((n): n is string => n !== undefined);
  }
  return [];
}
