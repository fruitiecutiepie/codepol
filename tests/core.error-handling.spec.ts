import { beforeAll, describe, expect, it } from 'vitest';
import {
  langAdd,
  parserInit,
  policyViolationsGetForFile,
  type PolicyFile,
  type PolicyRule,
  type PolicyRuleTarget,
} from '@codepol/core';
import { policyPluginLogger } from '@codepol/plugin';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

describe('core error handling', () => {
  beforeAll(async () => {
    langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
    await parserInit();
  });

  it('returns Err when logger configuration is missing', () => {
    const filePath = path.join(process.cwd(), 'temp-test.ts');
    writeFileSync(filePath, 'function test() {}');

    const policy: PolicyFile = {
      rules: [],
    };

    const rule: PolicyRule = {
      id: 'test-rule',
      semantics: { description: 'test', type: 'logger' },
      targets: [],
    };

    const target: PolicyRuleTarget = {
      language: 'typescript',
      files: [],
    };

    // Construct a plugins map manually
    const pluginsMap = new Map();
    pluginsMap.set('logger', policyPluginLogger);

    try {
      const result = policyViolationsGetForFile(
        filePath,
        rule,
        target,
        policy,
        pluginsMap,
        process.cwd()
      );

      expect('Err' in result).toBe(true);
      if ('Err' in result) {
        expect(result.Err).toContain('Logger configuration missing');
      }
    } finally {
      unlinkSync(filePath);
    }
  });
});
