/**
 * Detects modules that mix `export default` with named exports or re-exports.
 */

import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
  PolicyDiagnosticLocation,
} from '@codepol/core';
import ts from 'typescript';

type NoMixedExportsPreferredStyle = 'default' | 'named';

type NoMixedExportsArgs = {
  preferredStyle?: NoMixedExportsPreferredStyle;
};

type ExportStyle = NoMixedExportsPreferredStyle;

type ExportStatement = {
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

function statement_export_style_get(stmt: ts.Statement): ExportStyle | undefined {
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

/**
 * Updates export flags from a single top-level statement (same semantics as the
 * original `mixedExportsAnalyze` walk).
 */
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

function spanFromStatement(
  sourceFile: ts.SourceFile,
  stmt: ts.Statement,
): { line: number; column: number; endLine: number; endColumn: number } {
  const start = stmt.getStart(sourceFile);
  const end = stmt.getEnd();
  const s = sourceFile.getLineAndCharacterOfPosition(start);
  const e = sourceFile.getLineAndCharacterOfPosition(end);
  return {
    line: s.line + 1,
    column: s.character + 1,
    endLine: e.line + 1,
    endColumn: e.character + 1,
  };
}

/**
 * Classify top-level export shapes in a JS/TS module.
 */
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

const MIXED_MESSAGE =
  'Do not mix default exports with named exports in the same module; use one style per file.';

function preferred_style_get(ruleArgs: unknown): ExportStyle | undefined {
  const preferredStyle = (ruleArgs as NoMixedExportsArgs | undefined)?.preferredStyle;
  if (preferredStyle === 'default' || preferredStyle === 'named') {
    return preferredStyle;
  }
  return undefined;
}

function mixed_exports_message_get(preferredStyle: ExportStyle | undefined): string {
  if (preferredStyle === 'default') {
    return 'Do not mix default exports with named exports in the same module; prefer default exports for mixed modules.';
  }
  if (preferredStyle === 'named') {
    return 'Do not mix default exports with named exports in the same module; prefer named exports for mixed modules.';
  }
  return MIXED_MESSAGE;
}

function export_statements_collect(sourceFile: ts.SourceFile): ExportStatement[] {
  const statements: ExportStatement[] = [];
  for (let i = 0; i < sourceFile.statements.length; i++) {
    const stmt = sourceFile.statements[i]!;
    const style = statement_export_style_get(stmt);
    if (!style) continue;
    statements.push({ index: i, stmt, style });
  }
  return statements;
}

function primary_export_statement_get(
  exportStatements: ExportStatement[],
  preferredStyle: ExportStyle | undefined,
): ExportStatement | undefined {
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

export function noMixedExportsCheck(
  rule: PolicyRule,
  context: PolicyCheckContext,
): PolicyViolation[] {
  const sourceFile = ts.createSourceFile(
    context.filePath,
    context.source,
    ts.ScriptTarget.Latest,
    true,
  );

  const preferredStyle = preferred_style_get(context.ruleArgs);
  const exportStatements = export_statements_collect(sourceFile);
  const primaryExportStatement = primary_export_statement_get(
    exportStatements,
    preferredStyle,
  );

  if (!primaryExportStatement) {
    return [];
  }

  const primaryStmt = primaryExportStatement.stmt;
  const primarySpan = spanFromStatement(sourceFile, primaryStmt);

  const relatedLocations: PolicyDiagnosticLocation[] = [];
  const relatedStatements = preferredStyle
    ? exportStatements.filter((stmt) => stmt.index !== primaryExportStatement.index)
    : exportStatements.filter((stmt) => stmt.index > primaryExportStatement.index);
  for (const relatedStatement of relatedStatements) {
    const span = spanFromStatement(sourceFile, relatedStatement.stmt);
    relatedLocations.push({
      filePath: context.filePath,
      line: span.line,
      column: span.column,
      endLine: span.endLine,
      endColumn: span.endColumn,
      message: 'Additional export in mixed module',
    });
  }

  return [
    {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message: mixed_exports_message_get(preferredStyle),
      line: primarySpan.line,
      column: primarySpan.column,
      endLine: primarySpan.endLine,
      endColumn: primarySpan.endColumn,
      relatedLocations: relatedLocations.length > 0 ? relatedLocations : undefined,
    },
  ];
}
