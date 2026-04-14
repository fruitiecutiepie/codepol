import path from 'node:path';
import { workspacePackageMapDiscover } from '@codepol/core';
import {
  declarationBindingsGet,
  exportClauseGet,
  exportStatementDeclarationGet,
  statement_export_style_get,
} from './lib/moduleSyntax';
import { parseJsTsSource } from './lib/jsTsTree';

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

const REEXPORT_RE =
  /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;

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
    let fixed = unusedExportKeywordSingleFileFix(source, filePath, importedNames);
    fixed = missingExportKeywordSingleFileFix(fixed, filePath, importedNames);
    if (fixed !== source) {
      result.set(filePath, fixed);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cross-file import analysis
// ---------------------------------------------------------------------------

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

function unusedExportKeywordSingleFileFix(
  source: string,
  filePath: string,
  importedNames: Set<string>,
): string {
  const { root } = parseJsTsSource(filePath, source);
  const removals: { start: number; end: number }[] = [];

  for (const statement of root.namedChildren) {
    if (statement.type !== 'export_statement') {
      continue;
    }

    if (statement_export_style_get(statement, source) === 'default') {
      continue;
    }

    if (exportClauseGet(statement)) {
      continue;
    }

    const declaration = exportStatementDeclarationGet(statement);
    if (!declaration) {
      continue;
    }

    const names = declarationBindingsGet(declaration).map((binding) => binding.name);
    if (names.length > 0 && names.every((name) => importedNames.has(name))) {
      continue;
    }

    const match = /^export\s+/u.exec(source.slice(statement.startIndex, statement.endIndex));
    if (!match) {
      continue;
    }
    removals.push({
      start: statement.startIndex,
      end: statement.startIndex + match[0].length,
    });
  }

  if (removals.length === 0) return source;

  removals.sort((a, b) => b.start - a.start);

  let result = source;
  for (const { start, end } of removals) {
    result = result.slice(0, start) + result.slice(end);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Single-file missing-export-keyword addition
// ---------------------------------------------------------------------------

function missingExportKeywordSingleFileFix(
  source: string,
  filePath: string,
  importedNames: Set<string>,
): string {
  if (importedNames.size === 0) return source;

  const { root } = parseJsTsSource(filePath, source);
  const insertions: { position: number; text: string }[] = [];

  for (const statement of root.namedChildren) {
    if (statement.type === 'export_statement') {
      continue;
    }

    const names = declarationBindingsGet(statement).map((binding) => binding.name);
    if (names.length === 0) {
      continue;
    }

    if (names.some((name) => importedNames.has(name))) {
      insertions.push({
        position: statement.startIndex,
        text: 'export ',
      });
    }
  }

  if (insertions.length === 0) return source;

  insertions.sort((a, b) => b.position - a.position);

  let result = source;
  for (const { position, text } of insertions) {
    result = result.slice(0, position) + text + result.slice(position);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sourceImportBindings(source: string): ImportBinding[] {
  const results: ImportBinding[] = [];

  for (const re of [IMPORT_RE, REEXPORT_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const names = match[1]!;
      const moduleSpec = match[2]!;
      for (const part of names.split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const asMatch = /^(\w+)\s+as\s+\w+$/u.exec(trimmed);
        results.push({
          importedName: asMatch ? asMatch[1]! : trimmed,
          moduleSpec,
        });
      }
    }
  }

  return results;
}

function moduleSpecAbsolutePath(
  spec: string,
  fromFile: string,
  workspacePackages?: Map<string, string>,
): string | undefined {
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
