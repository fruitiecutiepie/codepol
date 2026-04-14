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
import type { SyntaxNode } from 'web-tree-sitter';
import { importBindingIsTypeOnly } from './lib/importBindingTypeOnly';
import {
  exportClauseGet,
  exportSpecifiersGet,
  exportStatementDeclarationGet,
  export_statements_collect,
  localNamedExportBindingCountGet,
  localNamedExportStatementsGet,
  singleLocalNamedExportNameGet,
  statement_export_style_get,
} from './lib/moduleSyntax';
import {
  importStatementAt,
  lineStartGet,
  parseJsTsSource,
  statementTrailingNewlineExtend,
} from './lib/jsTsTree';
import { preferred_style_get } from './noMixedExportsShared';

function workspace_edit_key(edit: PolicyWorkspaceEdit): string {
  return `${edit.filePath}:${edit.byteRange.start}:${edit.byteRange.end}:${edit.text}`;
}

function has_named_export_of_name(
  root: SyntaxNode,
  source: string,
  name: string,
): boolean {
  for (const statement of localNamedExportStatementsGet(root, source)) {
    const exportClause = exportClauseGet(statement);
    if (exportClause) {
      for (const specifier of exportSpecifiersGet(exportClause)) {
        if (specifier.exportedName === name) {
          return true;
        }
      }
      continue;
    }

    const exportedName = singleLocalNamedExportNameGet(statement);
    if (exportedName === name) {
      return true;
    }
  }

  return false;
}

function local_edits_named_preferred(
  filePath: string,
  source: string,
  root: SyntaxNode,
): PolicyWorkspaceEdit[] | undefined {
  const defaultStmt = root.namedChildren.find(
    (statement) => statement_export_style_get(statement, source) === 'default',
  );
  if (!defaultStmt) {
    return undefined;
  }

  const declaration = exportStatementDeclarationGet(defaultStmt);
  if (
    declaration &&
    (declaration.type === 'function_declaration' ||
      declaration.type === 'class_declaration')
  ) {
    const nameNode = declaration.childForFieldName('name');
    if (!nameNode) {
      return undefined;
    }
    const slice = source.slice(defaultStmt.startIndex, defaultStmt.endIndex);
    const replaced = slice.replace(/\bexport\s+default\s+/u, 'export ');
    if (replaced === slice) {
      return undefined;
    }
    return [
      {
        filePath,
        byteRange: { start: defaultStmt.startIndex, end: defaultStmt.endIndex },
        text: replaced,
      },
    ];
  }

  const expr = defaultStmt.namedChildren.find((child) => child.type === 'identifier');
  if (!expr) {
    return undefined;
  }
  const idText = expr.text;
  const start = lineStartGet(source, defaultStmt.startIndex);
  const end = statementTrailingNewlineExtend(source, defaultStmt.endIndex);

  if (has_named_export_of_name(root, source, idText)) {
    return [{ filePath, byteRange: { start, end }, text: '' }];
  }

  return [
    { filePath, byteRange: { start, end }, text: '' },
    {
      filePath,
      byteRange: { start: source.length, end: source.length },
      text: `\nexport { ${idText} };\n`,
    },
  ];
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
  const { root } = parseJsTsSource(importerPath, source);
  const statement = importStatementAt(root, binding.byteRange.start);
  const clause = statement?.namedChildren.find((child) => child.type === 'import_clause');
  const defaultName = clause?.namedChildren.find((child) => child.type === 'identifier');
  const moduleSpecifier = statement?.namedChildren.find((child) => child.type === 'string');
  if (!statement || !clause || !defaultName || !moduleSpecifier) {
    return undefined;
  }

  const localName = defaultName.text;
  const bindingText =
    exportedName === localName
      ? exportedName
      : `${exportedName} as ${localName}`;
  const typeOnly = importBindingIsTypeOnly(source, binding.byteRange.start);

  return {
    filePath: importerPath,
    byteRange: { start: statement.startIndex, end: statement.endIndex },
    text: typeOnly
      ? `import type { ${bindingText} } from ${moduleSpecifier.text};`
      : `import { ${bindingText} } from ${moduleSpecifier.text};`,
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
  const { root } = parseJsTsSource(importerPath, source);
  const statement = importStatementAt(root, binding.byteRange.start);
  const clause = statement?.namedChildren.find((child) => child.type === 'import_clause');
  const namedImports = clause?.namedChildren.find((child) => child.type === 'named_imports');
  const moduleSpecifier = statement?.namedChildren.find((child) => child.type === 'string');
  if (!statement || !namedImports || !moduleSpecifier) {
    return undefined;
  }

  const elements = namedImports.namedChildren.filter(
    (child) => child.type === 'import_specifier',
  );
  if (elements.length !== 1) {
    return undefined;
  }

  const element = elements[0]!;
  const importedNode = element.childForFieldName('name');
  const aliasNode = element.childForFieldName('alias');
  if (!importedNode || aliasNode || importedNode.text !== binding.importedName) {
    return undefined;
  }

  const localName = importedNode.text;
  if (localName !== defaultExportName) {
    return undefined;
  }

  const typeOnly = importBindingIsTypeOnly(source, binding.byteRange.start);
  return {
    filePath: importerPath,
    byteRange: { start: statement.startIndex, end: statement.endIndex },
    text: typeOnly
      ? `import type ${localName} from ${moduleSpecifier.text};`
      : `import ${localName} from ${moduleSpecifier.text};`,
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
  statement: SyntaxNode,
): PolicyWorkspaceEdit | undefined {
  const slice = source.slice(statement.startIndex, statement.endIndex);
  const match = /^export\s+/u.exec(slice);
  if (!match) {
    return undefined;
  }

  return {
    filePath,
    byteRange: {
      start: statement.startIndex,
      end: statement.startIndex + match[0].length,
    },
    text: '',
  };
}

function default_preferred_local_edits(
  filePath: string,
  source: string,
  root: SyntaxNode,
): PolicyWorkspaceEdit[] | undefined {
  if (localNamedExportBindingCountGet(root, source) !== 1) {
    return undefined;
  }

  const defaultStatements = root.namedChildren.filter(
    (statement) => statement_export_style_get(statement, source) === 'default',
  );
  if (defaultStatements.length !== 1) {
    return undefined;
  }
  const defaultStmt = defaultStatements[0]!;
  const defaultIdentifier = defaultStmt.namedChildren.find(
    (child) => child.type === 'identifier',
  );
  if (!defaultIdentifier) {
    return undefined;
  }
  const defaultId = defaultIdentifier.text;

  const namedStatements = localNamedExportStatementsGet(root, source);
  if (namedStatements.length !== 1) {
    return undefined;
  }
  const namedStmt = namedStatements[0]!;
  const exportedName = singleLocalNamedExportNameGet(namedStmt);

  if (!exportedName || exportedName !== defaultId) {
    return undefined;
  }

  const strip = strip_export_keyword_from_statement(filePath, source, namedStmt);
  return strip ? [strip] : undefined;
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
  for (const edit of edits) {
    const key = workspace_edit_key(edit);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(edit);
  }
  return out;
}

/**
 * Build a fix for mixed exports when `preferredStyle` is set. Returns undefined if
 * no safe rewrite applies or project index is missing.
 */
export function noMixedExportsFixPlan(
  context: PolicyCheckContext,
  root: SyntaxNode,
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
  const exportStatements = export_statements_collect(root, source);
  const hasDefault = exportStatements.some((statement) => statement.style === 'default');
  const hasNamed = exportStatements.some((statement) => statement.style === 'named');
  if (!hasDefault || !hasNamed) {
    return undefined;
  }

  const edits: PolicyWorkspaceEdit[] = [];

  if (preferred === 'named') {
    const local = local_edits_named_preferred(filePath, source, root);
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
    const local = default_preferred_local_edits(filePath, source, root);
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

  const primary = merged.find((edit) => edit.filePath === filePath) ?? merged[0]!;
  return {
    byteRange: primary.byteRange,
    text: primary.text,
    edits: merged,
  };
}
