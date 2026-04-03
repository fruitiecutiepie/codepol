/**
 * @packageDocumentation
 * Tree-check to lint provider adapter utilities.
 *
 * Provides platform-agnostic conversion from PolicyViolation to LintDiagnostic,
 * enabling TreeCheckProvider implementations to be adapted to any lint provider.
 *
 * Violation line/column anchoring is normally whatever the check reports. Rules may
 * instead set `violationPositionStrategy` on the `TreeCheckProvider`; core runs
 * {@link violationsApplyPositionStrategy} after `check()` in the tree-check pipeline
 * and in ESLint/Ruff adapters so adapters stay strategy-agnostic.
 */

import type { SyntaxNode } from 'web-tree-sitter';
import type {
  LintDiagnostic,
  PolicyCheckContext,
  PolicyViolation,
  TreeCheckProvider,
} from '../policy/policyTypes';
import { isErr } from '../result/result';
import { parserGetForFile } from '../parser/parserInit';

/**
 * Converts a PolicyViolation to a platform-agnostic LintDiagnostic.
 *
 * Line and column are taken from the violation as-is after any rule-level
 * {@link violationsApplyPositionStrategy} pass. Prefer setting
 * `TreeCheckProvider.violationPositionStrategy` instead of ad hoc positioning in checks.
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
