import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { policyViolationsGetOutputPretty } from './policyCheck';
import type { PolicyViolation } from './policyTypes';

describe('policyCheck', () => {
  describe('policyViolationsGetOutputPretty', () => {
    const cwd = '/project';

    it('should return empty string for no violations', () => {
      const result = policyViolationsGetOutputPretty([], cwd);
      expect(result).toBe('');
    });

    it('should format a single violation with relative path', () => {
      const violations: PolicyViolation[] = [
        {
          ruleId: 'require-logger',
          filePath: path.join(cwd, 'src', 'foo.ts'),
          message: 'Missing logger.enter()',
          line: 10,
          column: 5,
        },
      ];

      const result = policyViolationsGetOutputPretty(violations, cwd);

      expect(result).toBe(
        `src${path.sep}foo.ts:10:5: error [require-logger] Missing logger.enter()`
      );
    });

    it('should format multiple violations across files grouped by file', () => {
      const violations: PolicyViolation[] = [
        {
          ruleId: 'require-logger',
          filePath: path.join(cwd, 'src', 'alpha.ts'),
          message: 'Missing logger.enter()',
          line: 5,
          column: 1,
        },
        {
          ruleId: 'no-console',
          filePath: path.join(cwd, 'src', 'alpha.ts'),
          message: 'Unexpected console.log',
          line: 12,
          column: 3,
        },
        {
          ruleId: 'require-logger',
          filePath: path.join(cwd, 'lib', 'beta.ts'),
          message: 'Missing logger.exit()',
          line: 20,
          column: 7,
        },
      ];

      const result = policyViolationsGetOutputPretty(violations, cwd);
      const lines = result.split('\n');

      expect(lines).toHaveLength(3);
      // First file's violations come first
      expect(lines[0]).toContain('alpha.ts:5:1: error [require-logger]');
      expect(lines[1]).toContain('alpha.ts:12:3: error [no-console]');
      // Second file
      expect(lines[2]).toContain('beta.ts:20:7: error [require-logger]');
    });
  });
});
