/**
 * Autofix plans for {@link noMixedExportsCheck} when `args.preferredStyle` is set.
 * Requires {@link PolicyCheckContext.projectIndex} for cross-file import updates.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  PolicyCheckContext,
  PolicyViolationFix,
  PolicyWorkspaceEdit,
  ProjectIndex,
} from '@codepol/core';
import ts from 'typescript';
import { importBindingIsTypeOnly } from './lib/importBindingTypeOnly';
import {
  export_statements_collect,
  preferred_style_get,
  statement_export_style_get,
} from './noMixedExportsShared';

function workspace_edit_key(edit: PolicyWorkspaceEdit): string {
  return `${edit.filePath}:${edit.byteRange.start}:${edit.byteRange.end}:${edit.text}`;
}

function has_export_modifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function has_default_modifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

/**
 * True if `name` is already exported as a named export (excluding default export forms).
 */
function has_named_export_of_name(sourceFile: ts.SourceFile, name: string): boolean {
  for (const stmt of sourceFile.statements) {
    if (statement_export_style_get(stmt) !== 'named') continue;

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          return true;
        }
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      return true;
    }
    if (ts.isClassDeclaration(stmt) && stmt.name?.text === name) {
      return true;
    }
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) {
      return true;
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) {
      return true;
    }
    if (ts.isEnumDeclaration(stmt) && stmt.name.text === name) {
      return true;
    }
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        if (el.name.text === name) {
          return true;
        }
      }
    }
  }
  return false;
}

function statement_removal_end_get(source: string, end: number): number {
  let cursor = end;
  while (cursor < source.length && (source[cursor] === ' ' || source[cursor] === '\t')) {
    cursor++;
  }
  if (source[cursor] === '\r') {
    cursor++;
  }
  if (source[cursor] === '\n') {
    cursor++;
  }
  return cursor;
}

/** Byte offset of the first character on the same line as `byteOffset` (start of file if none). */
function line_start_get(source: string, byteOffset: number): number {
  let i = byteOffset;
  while (i > 0) {
    const ch = source[i - 1];
    if (ch === '\n' || ch === '\r') {
      return i;
    }
    i--;
  }
  return 0;
}

function local_edits_named_preferred(
  filePath: string,
  source: string,
  sourceFile: ts.SourceFile,
): PolicyWorkspaceEdit[] | undefined {
  const defaultStmt = sourceFile.statements.find(
    (s) => statement_export_style_get(s) === 'default',
  );
  if (!defaultStmt) {
    return undefined;
  }

  if (
    (ts.isFunctionDeclaration(defaultStmt) || ts.isClassDeclaration(defaultStmt)) &&
    has_export_modifier(defaultStmt) &&
    has_default_modifier(defaultStmt)
  ) {
    if (!defaultStmt.name) {
      return undefined;
    }
    const start = defaultStmt.getStart(sourceFile);
    const end = defaultStmt.getEnd();
    const slice = source.slice(start, end);
    const replaced = slice.replace(/\bexport\s+default\s+/, 'export ');
    if (replaced === slice) {
      return undefined;
    }
    return [{ filePath, byteRange: { start, end }, text: replaced }];
  }

  if (ts.isExportAssignment(defaultStmt) && !defaultStmt.isExportEquals) {
    const expr = defaultStmt.expression;
    if (!ts.isIdentifier(expr)) {
      return undefined;
    }
    const idText = expr.text;
    const start = line_start_get(source, defaultStmt.getStart(sourceFile));
    const end = statement_removal_end_get(source, defaultStmt.getEnd());

    if (has_named_export_of_name(sourceFile, idText)) {
      return [{ filePath, byteRange: { start, end }, text: '' }];
    }

    const insert = `\nexport { ${idText} };\n`;
    return [
      { filePath, byteRange: { start, end }, text: '' },
      { filePath, byteRange: { start: source.length, end: source.length }, text: insert },
    ];
  }

  return undefined;
}

function import_declaration_at(
  sourceFile: ts.SourceFile,
  byteOffset: number,
): ts.ImportDeclaration | undefined {
  function visit(node: ts.Node): ts.ImportDeclaration | undefined {
    if (
      ts.isImportDeclaration(node) &&
      node.getStart(sourceFile) <= byteOffset &&
      byteOffset < node.getEnd()
    ) {
      return node;
    }
    return ts.forEachChild(node, visit);
  }
  return visit(sourceFile);
}

function default_import_to_named_edit(
  importerPath: string,
  source: string,
  binding: {
    byteRange: { start: number; end: number };
    localSymbolId: string;
  },
  exportedName: string,
): PolicyWorkspaceEdit | undefined {
  const sf = ts.createSourceFile(importerPath, source, ts.ScriptTarget.Latest, true);
  const decl = import_declaration_at(sf, binding.byteRange.start);
  if (!decl || !decl.importClause?.name) {
    return undefined;
  }
  const localName = decl.importClause.name.text;
  const moduleSpecifier = decl.moduleSpecifier.getText(sf);
  const typeOnly = importBindingIsTypeOnly(source, binding.byteRange.start);

  const bindingText =
    exportedName === localName
      ? exportedName
      : `${exportedName} as ${localName}`;

  const newText = typeOnly
    ? `import type { ${bindingText} } from ${moduleSpecifier};`
    : `import { ${bindingText} } from ${moduleSpecifier};`;

  return {
    filePath: importerPath,
    byteRange: { start: decl.getStart(sf), end: decl.getEnd() },
    text: newText,
  };
}

function named_import_to_default_edit(
  importerPath: string,
  source: string,
  binding: {
    byteRange: { start: number; end: number };
    importedName: string;
  },
  defaultExportName: string,
): PolicyWorkspaceEdit | undefined {
  const sf = ts.createSourceFile(importerPath, source, ts.ScriptTarget.Latest, true);
  const decl = import_declaration_at(sf, binding.byteRange.start);
  if (!decl || !decl.importClause?.namedBindings) {
    return undefined;
  }
  const nb = decl.importClause.namedBindings;
  if (!ts.isNamedImports(nb)) {
    return undefined;
  }
  const elements = nb.elements;
  if (elements.length !== 1) {
    return undefined;
  }
  const el = elements[0]!;
  if (el.propertyName || el.name.text !== binding.importedName) {
    return undefined;
  }
  const localName = el.name.text;
  const moduleSpecifier = decl.moduleSpecifier.getText(sf);
  const typeOnly = importBindingIsTypeOnly(source, binding.byteRange.start);

  if (localName !== defaultExportName) {
    return undefined;
  }

  const newText = typeOnly
    ? `import type ${localName} from ${moduleSpecifier};`
    : `import ${localName} from ${moduleSpecifier};`;

  return {
    filePath: importerPath,
    byteRange: { start: decl.getStart(sf), end: decl.getEnd() },
    text: newText,
  };
}

function importer_edits_named_preferred(
  projectIndex: ProjectIndex,
  targetFile: string,
  exportedName: string,
): PolicyWorkspaceEdit[] {
  const targetResolved = path.resolve(targetFile);
  const edits: PolicyWorkspaceEdit[] = [];

  for (const importer of projectIndex.moduleImportersGet(targetFile)) {
    let source: string;
    try {
      source = fs.readFileSync(importer, 'utf8');
    } catch {
      continue;
    }

    for (const binding of projectIndex.importBindingsGet(importer)) {
      if (!binding.resolvedModulePath) {
        continue;
      }
      if (path.resolve(binding.resolvedModulePath) !== targetResolved) {
        continue;
      }
      if (!binding.isDefault || !binding.resolvedExportId) {
        continue;
      }
      const sym = projectIndex.symbolGet(binding.resolvedExportId);
      if (!sym || sym.name !== exportedName) {
        continue;
      }
      const edit = default_import_to_named_edit(importer, source, binding, exportedName);
      if (edit) {
        edits.push(edit);
      }
    }
  }

  return edits;
}

function strip_export_keyword_from_statement(
  filePath: string,
  source: string,
  sourceFile: ts.SourceFile,
  stmt: ts.Statement,
): PolicyWorkspaceEdit | undefined {
  if (!has_export_modifier(stmt) || has_default_modifier(stmt)) {
    return undefined;
  }
  const start = stmt.getStart(sourceFile);
  const end = stmt.getEnd();
  const slice = source.slice(start, end);
  const replaced = slice.replace(/^\s*export\s+/, '');
  if (replaced === slice) {
    return undefined;
  }
  return {
    filePath,
    byteRange: { start, end },
    text: replaced,
  };
}

function local_named_statements_non_reexport(
  sourceFile: ts.SourceFile,
): ts.Statement[] {
  const out: ts.Statement[] = [];
  for (const stmt of sourceFile.statements) {
    if (statement_export_style_get(stmt) !== 'named') {
      continue;
    }
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      continue;
    }
    out.push(stmt);
  }
  return out;
}

function count_named_export_bindings(sourceFile: ts.SourceFile): number {
  let n = 0;
  for (const stmt of local_named_statements_non_reexport(sourceFile)) {
    if (ts.isVariableStatement(stmt)) {
      n += stmt.declarationList.declarations.length;
    } else if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      n += 1;
    }
  }
  return n;
}

function default_preferred_local_edits(
  filePath: string,
  source: string,
  sourceFile: ts.SourceFile,
): PolicyWorkspaceEdit[] | undefined {
  if (count_named_export_bindings(sourceFile) !== 1) {
    return undefined;
  }

  const defaultStmts = sourceFile.statements.filter(
    (s) => statement_export_style_get(s) === 'default',
  );
  if (defaultStmts.length !== 1) {
    return undefined;
  }
  const defaultStmt = defaultStmts[0]!;
  if (!ts.isExportAssignment(defaultStmt) || defaultStmt.isExportEquals) {
    return undefined;
  }
  if (!ts.isIdentifier(defaultStmt.expression)) {
    return undefined;
  }
  const defaultId = defaultStmt.expression.text;

  const namedStmts = local_named_statements_non_reexport(sourceFile);
  if (namedStmts.length !== 1) {
    return undefined;
  }
  const namedStmt = namedStmts[0]!;
  let exportedName: string | undefined;
  if (ts.isVariableStatement(namedStmt)) {
    if (namedStmt.declarationList.declarations.length !== 1) {
      return undefined;
    }
    const d = namedStmt.declarationList.declarations[0]!;
    if (!ts.isIdentifier(d.name)) {
      return undefined;
    }
    exportedName = d.name.text;
  } else if (ts.isFunctionDeclaration(namedStmt) || ts.isClassDeclaration(namedStmt)) {
    exportedName = namedStmt.name?.text;
  } else if (ts.isInterfaceDeclaration(namedStmt) || ts.isTypeAliasDeclaration(namedStmt) || ts.isEnumDeclaration(namedStmt)) {
    exportedName = namedStmt.name.text;
  }

  if (!exportedName || exportedName !== defaultId) {
    return undefined;
  }

  const strip = strip_export_keyword_from_statement(filePath, source, sourceFile, namedStmt);
  if (!strip) {
    return undefined;
  }
  return [strip];
}

function importer_edits_default_preferred(
  projectIndex: ProjectIndex,
  targetFile: string,
  defaultExportName: string,
): PolicyWorkspaceEdit[] {
  const targetResolved = path.resolve(targetFile);
  const namedExport = projectIndex
    .fileExportsGet(targetFile)
    .find((e) => !e.isDefault && e.exportedName === defaultExportName);
  if (!namedExport) {
    return [];
  }
  const expectedSymbolId = namedExport.symbolId;
  const edits: PolicyWorkspaceEdit[] = [];

  for (const importer of projectIndex.moduleImportersGet(targetFile)) {
    let source: string;
    try {
      source = fs.readFileSync(importer, 'utf8');
    } catch {
      continue;
    }

    for (const binding of projectIndex.importBindingsGet(importer)) {
      if (!binding.resolvedModulePath) {
        continue;
      }
      if (path.resolve(binding.resolvedModulePath) !== targetResolved) {
        continue;
      }
      if (binding.isDefault || binding.isNamespace) {
        continue;
      }
      if (binding.importedName !== defaultExportName) {
        continue;
      }
      if (binding.resolvedExportId !== expectedSymbolId) {
        continue;
      }
      const edit = named_import_to_default_edit(importer, source, binding, defaultExportName);
      if (edit) {
        edits.push(edit);
      }
    }
  }

  return edits;
}

function default_export_symbol_name(projectIndex: ProjectIndex, filePath: string): string | undefined {
  const exports = projectIndex.fileExportsGet(filePath);
  const def = exports.find((e) => e.isDefault);
  if (!def) {
    return undefined;
  }
  const sym = projectIndex.symbolGet(def.symbolId);
  return sym?.name;
}

function dedupe_edits(edits: PolicyWorkspaceEdit[]): PolicyWorkspaceEdit[] {
  const seen = new Set<string>();
  const out: PolicyWorkspaceEdit[] = [];
  for (const e of edits) {
    const k = workspace_edit_key(e);
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * Build a fix for mixed exports when `preferredStyle` is set. Returns undefined if
 * no safe rewrite applies or project index is missing.
 */
export function noMixedExportsFixPlan(
  context: PolicyCheckContext,
  sourceFile: ts.SourceFile,
): PolicyViolationFix | undefined {
  const preferred = preferred_style_get(context.ruleArgs);
  if (!preferred) {
    return undefined;
  }
  const projectIndex = context.projectIndex;
  if (!projectIndex) {
    return undefined;
  }

  const filePath = context.filePath;
  const source = context.source;
  const exportStmts = export_statements_collect(sourceFile);
  const hasDefault = exportStmts.some((e) => e.style === 'default');
  const hasNamed = exportStmts.some((e) => e.style === 'named');
  if (!hasDefault || !hasNamed) {
    return undefined;
  }

  const edits: PolicyWorkspaceEdit[] = [];

  if (preferred === 'named') {
    const local = local_edits_named_preferred(filePath, source, sourceFile);
    if (!local || local.length === 0) {
      return undefined;
    }
    const exportedName = default_export_symbol_name(projectIndex, filePath);
    if (!exportedName) {
      return undefined;
    }
    edits.push(...local);
    edits.push(...importer_edits_named_preferred(projectIndex, filePath, exportedName));
  } else {
    const local = default_preferred_local_edits(filePath, source, sourceFile);
    if (!local || local.length === 0) {
      return undefined;
    }
    const name = default_export_symbol_name(projectIndex, filePath);
    if (!name) {
      return undefined;
    }
    edits.push(...local);
    edits.push(...importer_edits_default_preferred(projectIndex, filePath, name));
  }

  const merged = dedupe_edits(edits);
  if (merged.length === 0) {
    return undefined;
  }

  const primary = merged.find((e) => e.filePath === filePath) ?? merged[0]!;
  return {
    byteRange: primary.byteRange,
    text: primary.text,
    edits: merged,
  };
}
