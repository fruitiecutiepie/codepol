/**
 * Detects modules that mix `export default` with named exports or re-exports.
 */

import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
  PolicyDiagnosticLocation,
} from '@codepol/core';
import type { SyntaxNode } from 'web-tree-sitter';
import { parseJsTsSource } from './lib/jsTsTree';
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
  statement: SyntaxNode,
): { line: number; column: number; endLine: number; endColumn: number } {
  return {
    line: statement.startPosition.row + 1,
    column: statement.startPosition.column + 1,
    endLine: statement.endPosition.row + 1,
    endColumn: statement.endPosition.column + 1,
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
  const { root } = parseJsTsSource(context.filePath, context.source);
  const preferredStyle = preferred_style_get(context.ruleArgs);
  const exportStatements = export_statements_collect(root, context.source);
  const primaryExportStatement = primary_export_statement_get(
    exportStatements,
    preferredStyle,
  );

  if (!primaryExportStatement) {
    return [];
  }

  const primaryStmt = primaryExportStatement.stmt;
  const primarySpan = spanFromStatement(primaryStmt);

  const relatedLocations: PolicyDiagnosticLocation[] = [];
  const relatedStatements = preferredStyle
    ? exportStatements.filter((stmt) => stmt.index !== primaryExportStatement.index)
    : exportStatements.filter((stmt) => stmt.index > primaryExportStatement.index);
  for (const relatedStatement of relatedStatements) {
    const span = spanFromStatement(relatedStatement.stmt);
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
      ? noMixedExportsFixPlan(context, root)
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
