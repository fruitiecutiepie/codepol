import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import baseConfig from '../codepol.config';
import type { PolicyFile, PolicyRule } from '@codepol/core';
import { langAdd, parserInit, policyViolationsGetFromDir } from '@codepol/core';

describe('tree-sitter policy check', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
    await parserInit();
  });

  it('finds missing logger instrumentation while ignoring already instrumented files', async () => {
    const policy: PolicyFile = {
      ...baseConfig,
      plugins: [
        { module: '@codepol/plugin' },
      ],
      exclude: [],
      targets: {
        'test-fixtures': {
          language: 'typescript',
          files: ['tests/fixtures/ts/**/*.ts'],
        },
      },
      rules: baseConfig.rules.map((rule): PolicyRule => ({
        ...rule,
        targets: ['test-fixtures'],
      })),
    };

    const violationsResult = await policyViolationsGetFromDir(policy, process.cwd());
    if ('Err' in violationsResult) {
      console.error(violationsResult.Err);
    }
    expect('Err' in violationsResult).toBe(false);
    const violations = violationsResult.Ok!;
    const violationFiles = violations.map(violation => path.relative(process.cwd(), violation.filePath));

    expect(violationFiles).toContain(path.join('tests', 'fixtures', 'ts', 'missing.ts'));
    expect(violationFiles).toContain(path.join('tests', 'fixtures', 'ts', 'arrow.ts'));
    expect(violationFiles).not.toContain(path.join('tests', 'fixtures', 'ts', 'already.ts'));
  });
});
