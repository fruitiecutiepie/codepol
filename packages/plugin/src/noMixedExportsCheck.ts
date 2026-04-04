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
import { noMixedExportsFixPlan } from './noMixedExportsFix';
import {
  export_statements_collect,
  preferred_style_get,
  primary_export_statement_get,
  type ExportStyle,
} from './noMixedExportsShared';

export { mixedExportsAnalyze } from './noMixedExportsShared';

const MIXED_MESSAGE =
  'Do not mix default exports with named exports in the same module; use one style per file.';

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

function mixed_exports_message_get(preferredStyle: ExportStyle | undefined): string {
  if (preferredStyle === 'default') {
    return 'Do not mix default exports with named exports in the same module; prefer default exports for mixed modules.';
  }
  if (preferredStyle === 'named') {
    return 'Do not mix default exports with named exports in the same module; prefer named exports for mixed modules.';
  }
  return MIXED_MESSAGE;
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

  const fix =
    preferredStyle !== undefined
      ? noMixedExportsFixPlan(context, sourceFile)
      : undefined;

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
      fix,
    },
  ];
}
