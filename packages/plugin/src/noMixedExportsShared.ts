/**
 * Shared AST helpers for no-mixed-exports check and fix.
 */

import ts from 'typescript';

export type NoMixedExportsPreferredStyle = 'default' | 'named';

export type NoMixedExportsArgs = {
  preferredStyle?: NoMixedExportsPreferredStyle;
};

export type ExportStyle = NoMixedExportsPreferredStyle;

export type MixedExportStatement = {
  index: number;
  stmt: ts.Statement;
  style: ExportStyle;
};

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

export function statement_export_style_get(stmt: ts.Statement): ExportStyle | undefined {
  if (ts.isExportAssignment(stmt)) {
    if (!stmt.isExportEquals) {
      return 'default';
    }
    return undefined;
  }

  if (ts.isExportDeclaration(stmt)) {
    if (stmt.moduleSpecifier) {
      if (stmt.exportClause === undefined) {
        return 'named';
      } else if (ts.isNamespaceExport(stmt.exportClause)) {
        return 'named';
      } else if (ts.isNamedExports(stmt.exportClause)) {
        if (stmt.exportClause.elements.length > 0) {
          return 'named';
        }
      }
    } else if (stmt.exportClause !== undefined) {
      if (ts.isNamedExports(stmt.exportClause)) {
        if (stmt.exportClause.elements.length > 0) {
          return 'named';
        }
      }
    }
    return undefined;
  }

  if (hasExportModifier(stmt) && hasDefaultModifier(stmt)) {
    return 'default';
  }

  if (hasExportModifier(stmt) && !hasDefaultModifier(stmt)) {
    return 'named';
  }

  return undefined;
}

function applyStatementToExportFlags(
  stmt: ts.Statement,
  flags: { hasDefaultExport: boolean; hasNamedExport: boolean },
): void {
  const style = statement_export_style_get(stmt);
  if (style === 'default') {
    flags.hasDefaultExport = true;
    return;
  }
  if (style === 'named') {
    flags.hasNamedExport = true;
  }
}

export function mixedExportsAnalyze(sourceFile: ts.SourceFile): {
  hasDefaultExport: boolean;
  hasNamedExport: boolean;
} {
  const flags = { hasDefaultExport: false, hasNamedExport: false };
  for (const stmt of sourceFile.statements) {
    applyStatementToExportFlags(stmt, flags);
  }
  return flags;
}

export function preferred_style_get(ruleArgs: unknown): ExportStyle | undefined {
  const preferredStyle = (ruleArgs as NoMixedExportsArgs | undefined)?.preferredStyle;
  if (preferredStyle === 'default' || preferredStyle === 'named') {
    return preferredStyle;
  }
  return undefined;
}

export function export_statements_collect(sourceFile: ts.SourceFile): MixedExportStatement[] {
  const statements: MixedExportStatement[] = [];
  for (let i = 0; i < sourceFile.statements.length; i++) {
    const stmt = sourceFile.statements[i]!;
    const style = statement_export_style_get(stmt);
    if (!style) continue;
    statements.push({ index: i, stmt, style });
  }
  return statements;
}

export function primary_export_statement_get(
  exportStatements: MixedExportStatement[],
  preferredStyle: ExportStyle | undefined,
): MixedExportStatement | undefined {
  const hasDefaultExport = exportStatements.some((stmt) => stmt.style === 'default');
  const hasNamedExport = exportStatements.some((stmt) => stmt.style === 'named');
  if (!hasDefaultExport || !hasNamedExport) {
    return undefined;
  }

  if (preferredStyle) {
    return exportStatements.find((stmt) => stmt.style !== preferredStyle);
  }

  const flags = { hasDefaultExport: false, hasNamedExport: false };
  for (const exportStmt of exportStatements) {
    const wasMixed = flags.hasDefaultExport && flags.hasNamedExport;
    if (exportStmt.style === 'default') {
      flags.hasDefaultExport = true;
    } else {
      flags.hasNamedExport = true;
    }
    const isMixed = flags.hasDefaultExport && flags.hasNamedExport;
    if (isMixed && !wasMixed) {
      return exportStmt;
    }
  }

  return undefined;
}
