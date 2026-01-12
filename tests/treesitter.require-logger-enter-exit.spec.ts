import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import basePolicy from '../policy.json';
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
      ...basePolicy,
      // For tree-sitter checking, export the PolicyPlugin (policyPluginLogger)
      plugins: [
        {
          module: '@codepol/plugin',
          export: 'policyPluginLogger',
          rules: basePolicy.plugins[0].rules,
        },
      ],
      exclude: [],
      rules: basePolicy.rules.map((rule): PolicyRule => ({
        ...rule,
        targets: rule.targets.map(target => ({
          ...target,
          files: ['tests/fixtures/ts/**/*.ts'],
          exclude: [],
        })),
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
