import path from 'node:path';
import { describe, expect, it } from 'vitest';
import basePolicy from '../policy.json';
import type { PolicyFile, PolicyRule } from '../tools/policy-scan';
import { scanWithPolicy } from '../tools/policy-scan';

describe('tree-sitter policy scan', () => {
  it('finds missing logger instrumentation while ignoring already instrumented files', async () => {
    const policy: PolicyFile = {
      ...basePolicy,
      exclude: [],
      rules: basePolicy.rules.map((rule): PolicyRule => ({
        ...rule,
        files: ['tests/fixtures/ts/**/*.ts'],
        exclude: [],
        language: rule.language as 'typescript' | 'tsx',
      })),
    };

    const violations = await scanWithPolicy(policy, process.cwd());
    const violationFiles = violations.map(violation => path.relative(process.cwd(), violation.filePath));

    expect(violationFiles).toContain(path.join('tests', 'fixtures', 'ts', 'missing.ts'));
    expect(violationFiles).toContain(path.join('tests', 'fixtures', 'ts', 'arrow.ts'));
    expect(violationFiles).not.toContain(path.join('tests', 'fixtures', 'ts', 'already.ts'));
  });
});
