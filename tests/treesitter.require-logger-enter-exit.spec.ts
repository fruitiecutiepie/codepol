import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import basePolicy from '../policy.json';
import type { PolicyFile, PolicyRule } from '@codepol/core';
import { parserInit, policyViolationsGetFromDir } from '@codepol/core';

describe('tree-sitter policy scan', () => {
  beforeAll(async () => {
    await parserInit();
  });

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

    const violationsResult = await policyViolationsGetFromDir(policy, process.cwd());
    expect('Err' in violationsResult).toBe(false);
    const violations = violationsResult.Ok!;
    const violationFiles = violations.map(violation => path.relative(process.cwd(), violation.filePath));

    expect(violationFiles).toContain(path.join('tests', 'fixtures', 'ts', 'missing.ts'));
    expect(violationFiles).toContain(path.join('tests', 'fixtures', 'ts', 'arrow.ts'));
    expect(violationFiles).not.toContain(path.join('tests', 'fixtures', 'ts', 'already.ts'));
  });
});
