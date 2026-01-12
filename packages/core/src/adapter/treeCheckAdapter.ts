/**
 * @packageDocumentation
 * Tree-check to lint provider adapter utilities.
 *
 * Provides platform-agnostic conversion from PolicyViolation to LintDiagnostic,
 * enabling TreeCheckProvider implementations to be adapted to any lint provider.
 */

import type { LintDiagnostic, PolicyViolation } from '../policy/policyTypes';

/**
 * Converts a PolicyViolation to a platform-agnostic LintDiagnostic.
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
