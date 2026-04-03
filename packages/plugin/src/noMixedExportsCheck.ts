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

/**
 * Updates export flags from a single top-level statement (same semantics as the
 * original `mixedExportsAnalyze` walk).
 */
function applyStatementToExportFlags(
  stmt: ts.Statement,
  flags: { hasDefaultExport: boolean; hasNamedExport: boolean },
): void {
  if (ts.isExportAssignment(stmt)) {
    if (!stmt.isExportEquals) {
      flags.hasDefaultExport = true;
    }
    return;
  }

  if (ts.isExportDeclaration(stmt)) {
    if (stmt.moduleSpecifier) {
      if (stmt.exportClause === undefined) {
        flags.hasNamedExport = true;
      } else if (ts.isNamespaceExport(stmt.exportClause)) {
        flags.hasNamedExport = true;
      } else if (ts.isNamedExports(stmt.exportClause)) {
        if (stmt.exportClause.elements.length > 0) {
          flags.hasNamedExport = true;
        }
      }
    } else if (stmt.exportClause !== undefined) {
      if (ts.isNamedExports(stmt.exportClause)) {
        if (stmt.exportClause.elements.length > 0) {
          flags.hasNamedExport = true;
        }
      }
    }
    return;
  }

  if (hasExportModifier(stmt) && hasDefaultModifier(stmt)) {
    flags.hasDefaultExport = true;
    return;
  }

  if (hasExportModifier(stmt) && !hasDefaultModifier(stmt)) {
    flags.hasNamedExport = true;
  }
}

function isExportingStatement(stmt: ts.Statement): boolean {
  if (ts.isExportAssignment(stmt)) return true;
  if (ts.isExportDeclaration(stmt)) return true;
  if (hasExportModifier(stmt)) return true;
  return false;
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

  const flags = { hasDefaultExport: false, hasNamedExport: false };
  let primaryIndex = -1;

  const statements = sourceFile.statements;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!;
    const wasMixed = flags.hasDefaultExport && flags.hasNamedExport;
    applyStatementToExportFlags(stmt, flags);
    const isMixed = flags.hasDefaultExport && flags.hasNamedExport;
    if (isMixed && !wasMixed) {
      primaryIndex = i;
      break;
    }
  }

  if (primaryIndex < 0) {
    return [];
  }

  const primaryStmt = statements[primaryIndex]!;
  const primarySpan = spanFromStatement(sourceFile, primaryStmt);

  const relatedLocations: PolicyDiagnosticLocation[] = [];
  for (let j = primaryIndex + 1; j < statements.length; j++) {
    const stmt = statements[j]!;
    if (!isExportingStatement(stmt)) continue;
    const span = spanFromStatement(sourceFile, stmt);
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
      message: MIXED_MESSAGE,
      line: primarySpan.line,
      column: primarySpan.column,
      endLine: primarySpan.endLine,
      endColumn: primarySpan.endColumn,
      relatedLocations: relatedLocations.length > 0 ? relatedLocations : undefined,
    },
  ];
}
