/**
 * Detects modules that mix `export default` with named exports or re-exports.
 */

import type {
  PolicyRule,
  PolicyCheckContext,
  PolicyViolation,
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
 * Classify top-level export shapes in a JS/TS module.
 */
export function mixedExportsAnalyze(sourceFile: ts.SourceFile): {
  hasDefaultExport: boolean;
  hasNamedExport: boolean;
} {
  let hasDefaultExport = false;
  let hasNamedExport = false;

  for (const stmt of sourceFile.statements) {
    if (ts.isExportAssignment(stmt)) {
      if (!stmt.isExportEquals) {
        hasDefaultExport = true;
      }
      continue;
    }

    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier) {
        if (stmt.exportClause === undefined) {
          hasNamedExport = true;
        } else if (ts.isNamespaceExport(stmt.exportClause)) {
          hasNamedExport = true;
        } else if (ts.isNamedExports(stmt.exportClause)) {
          if (stmt.exportClause.elements.length > 0) {
            hasNamedExport = true;
          }
        }
      } else if (stmt.exportClause !== undefined) {
        if (ts.isNamedExports(stmt.exportClause)) {
          if (stmt.exportClause.elements.length > 0) {
            hasNamedExport = true;
          }
        }
      }
      continue;
    }

    if (hasExportModifier(stmt) && hasDefaultModifier(stmt)) {
      hasDefaultExport = true;
      continue;
    }

    if (hasExportModifier(stmt) && !hasDefaultModifier(stmt)) {
      hasNamedExport = true;
    }
  }

  return { hasDefaultExport, hasNamedExport };
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

  const { hasDefaultExport, hasNamedExport } = mixedExportsAnalyze(sourceFile);

  if (!hasDefaultExport || !hasNamedExport) {
    return [];
  }

  return [
    {
      ruleId: rule.id || rule.ruleId,
      filePath: context.filePath,
      message:
        'Do not mix default exports with named exports in the same module; use one style per file.',
      line: 1,
      column: 1,
    },
  ];
}
