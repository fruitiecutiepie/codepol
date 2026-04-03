/**
 * @packageDocumentation
 * Tree-check to lint provider adapter utilities.
 *
 * Provides platform-agnostic conversion from PolicyViolation to LintDiagnostic,
 * enabling TreeCheckProvider implementations to be adapted to any lint provider.
 */

import type { SyntaxNode } from 'web-tree-sitter';
import type { LintDiagnostic, PolicyViolation } from '../policy/policyTypes';

/**
 * Line/column (1-based) for a violation on a Tree-sitter function-like node.
 * Prefers the identifier (`name` field) so diagnostics underline `foo` in
 * `function foo()`, not the `function` keyword. Falls back to `const`/`let`
 * binding for anonymous `() => {}`, then to the node start.
 */
export function treeSitterViolationPositionPreferred(
  fnNode: SyntaxNode,
): { line: number; column: number } {
  const nameNode = fnNode.childForFieldName('name');
  if (nameNode) {
    const { row, column } = nameNode.startPosition;
    return { line: row + 1, column: column + 1 };
  }
  const parent = fnNode.parent;
  if (parent?.type === 'variable_declarator') {
    const id = parent.childForFieldName('name');
    if (id) {
      const { row, column } = id.startPosition;
      return { line: row + 1, column: column + 1 };
    }
  }
  const { row, column } = fnNode.startPosition;
  return { line: row + 1, column: column + 1 };
}

/**
 * Converts a PolicyViolation to a platform-agnostic LintDiagnostic.
 *
 * Line and column are taken from the violation as-is; rules should set them to
 * the most relevant span (often the identifier). For Tree-sitter function
 * nodes, use {@link treeSitterViolationPositionPreferred} when building the
 * violation.
 *
 * @param violation - The policy violation to convert
 * @param severity - The severity level to assign (default: 'error')
 * @returns A LintDiagnostic representing the violation
 *
 * @example
 * ```typescript
 * const violation: PolicyViolation = {
 *   ruleId: 'require-logger',
 *   filePath: '/src/foo.ts',
 *   message: 'Missing logger.enter()',
 *   line: 10,
 *   column: 5,
 * };
 *
 * const diagnostic = violationToLintDiagnostic(violation);
 * // { message: '...', line: 10, column: 5, ruleId: 'require-logger', severity: 'error' }
 * ```
 */
export function violationToLintDiagnostic(
  violation: PolicyViolation,
  severity: 'error' | 'warning' | 'info' = 'error'
): LintDiagnostic {
  return {
    message: violation.message,
    line: violation.line,
    column: violation.column,
    ruleId: violation.ruleId,
    severity,
    fix: violation.fix,
  };
}

/**
 * Converts an array of PolicyViolations to LintDiagnostics.
 *
 * @param violations - The policy violations to convert
 * @param severity - The severity level to assign (default: 'error')
 * @returns An array of LintDiagnostics
 */
export function violationsToLintDiagnostics(
  violations: PolicyViolation[],
  severity: 'error' | 'warning' | 'info' = 'error'
): LintDiagnostic[] {
  return violations.map(v => violationToLintDiagnostic(v, severity));
}
