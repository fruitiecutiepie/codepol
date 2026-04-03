import { describe, expect, it } from 'vitest';
import {
  violationToLintDiagnostic,
  violationsToLintDiagnostics,
} from './treeCheckAdapter';
import type { PolicyViolation } from '../policy/policyTypes';

describe('treeCheckAdapter', () => {
  const baseViolation: PolicyViolation = {
    ruleId: 'require-logger',
    filePath: '/src/foo.ts',
    message: 'Missing logger.enter()',
    line: 10,
    column: 5,
  };

  describe('violationToLintDiagnostic', () => {
    it('should map all fields correctly with default severity', () => {
      const diagnostic = violationToLintDiagnostic(baseViolation);

      expect(diagnostic.message).toBe('Missing logger.enter()');
      expect(diagnostic.line).toBe(10);
      expect(diagnostic.column).toBe(5);
      expect(diagnostic.ruleId).toBe('require-logger');
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.fix).toBeUndefined();
    });

    it('should use custom severity when provided', () => {
      const diagnostic = violationToLintDiagnostic(baseViolation, 'warning');
      expect(diagnostic.severity).toBe('warning');

      const infoDiagnostic = violationToLintDiagnostic(baseViolation, 'info');
      expect(infoDiagnostic.severity).toBe('info');
    });

    it('should pass through fix data when present', () => {
      const violationWithFix: PolicyViolation = {
        ...baseViolation,
        fix: { byteRange: { start: 100, end: 110 }, text: 'logger.enter();' },
      };

      const diagnostic = violationToLintDiagnostic(violationWithFix);

      expect(diagnostic.fix).toEqual(
        { byteRange: { start: 100, end: 110 }, text: 'logger.enter();' }
      );
    });

    it('should pass through suggestions when present', () => {
      const violationWithSuggestions: PolicyViolation = {
        ...baseViolation,
        suggestions: [
          {
            message: 'Rename to camelCase: fooBar',
            fix: { byteRange: { start: 1, end: 5 }, text: 'fooBar' },
          },
        ],
      };
      const diagnostic = violationToLintDiagnostic(violationWithSuggestions);
      expect(diagnostic.suggestions).toEqual(violationWithSuggestions.suggestions);
    });

    it('should pass through end range and relatedLocations', () => {
      const violation: PolicyViolation = {
        ruleId: 'no-mixed-exports',
        filePath: '/src/a.ts',
        message: 'mixed',
        line: 2,
        column: 1,
        endLine: 2,
        endColumn: 20,
        relatedLocations: [
          {
            filePath: '/src/a.ts',
            line: 3,
            column: 1,
            endLine: 3,
            endColumn: 22,
            message: 'related',
          },
        ],
      };
      const diagnostic = violationToLintDiagnostic(violation);
      expect(diagnostic.endLine).toBe(2);
      expect(diagnostic.endColumn).toBe(20);
      expect(diagnostic.relatedLocations).toEqual(violation.relatedLocations);
    });
  });

  describe('violationsToLintDiagnostics', () => {
    it('should return empty array for empty input', () => {
      const diagnostics = violationsToLintDiagnostics([]);
      expect(diagnostics).toEqual([]);
    });

    it('should map each violation to a diagnostic', () => {
      const violations: PolicyViolation[] = [
        baseViolation,
        {
          ruleId: 'no-console',
          filePath: '/src/bar.ts',
          message: 'Unexpected console.log',
          line: 20,
          column: 3,
        },
      ];

      const diagnostics = violationsToLintDiagnostics(violations);

      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0].ruleId).toBe('require-logger');
      expect(diagnostics[0].severity).toBe('error');
      expect(diagnostics[1].ruleId).toBe('no-console');
      expect(diagnostics[1].message).toBe('Unexpected console.log');
    });

    it('should apply custom severity to all diagnostics', () => {
      const violations: PolicyViolation[] = [baseViolation, baseViolation];

      const diagnostics = violationsToLintDiagnostics(violations, 'warning');

      for (const d of diagnostics) {
        expect(d.severity).toBe('warning');
      }
    });
  });
});
