import path from 'node:path';
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { beforeAll, describe, expect, it } from 'vitest';
import { eslintAdapter, clearPolicyCache, clearProviderInitState } from '@codepol/eslint-plugin';
import { policyPluginLogger } from '@codepol/plugin';
import { langAdd, parserInit } from '@codepol/core';

// Initialize tree-sitter parser before tests
beforeAll(async () => {
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();
  clearPolicyCache();
  clearProviderInitState();
});

// RuleTester must be run at module level, not inside vitest it() blocks
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

const adaptedRule = eslintAdapter.adapt(policyPluginLogger, {
  ruleName: 'adapted-logger-check',
});

const filename = path.join(process.cwd(), 'src/example.ts');

// Run the ESLint RuleTester at module level
ruleTester.run('adapted-logger-check', adaptedRule as any, {
  valid: [
    {
      name: 'already instrumented function passes tree-check',
      filename,
      code: `import { logger } from '@org/logger';
export function instrumented() {
  logger.enter({});
  try {
    doStuff();
  } finally {
    logger.exit({});
  }
}`,
    },
    {
      name: 'excluded file is skipped',
      filename: path.join(process.cwd(), 'src/example.spec.ts'),
      code: 'export function skip() { return 1; }',
    },
  ],
  invalid: [
    {
      name: 'missing logger instrumentation is reported',
      filename,
      code: `function f() {
  doStuff();
}`,
      errors: [{ messageId: 'treeCheckViolation' }],
    },
    {
      name: 'arrow function without instrumentation is reported',
      filename,
      code: 'const add = (a: number, b: number) => a + b;',
      errors: [{ messageId: 'treeCheckViolation' }],
    },
  ],
});

describe('eslint tree-check adapter', () => {
  it('adapts a TreeCheckProvider to an ESLint rule', () => {
    expect(adaptedRule).toBeDefined();
    expect(adaptedRule.meta).toBeDefined();
    expect(adaptedRule.meta?.messages).toHaveProperty('treeCheckViolation');
    expect(adaptedRule.create).toBeInstanceOf(Function);
  });

  it('uses custom severity from options', () => {
    const warningRule = eslintAdapter.adapt(policyPluginLogger, {
      ruleName: 'adapted-logger-warning',
      severity: 'warning',
    });

    // The severity is used internally when converting violations
    // We verify the rule was created successfully
    expect(warningRule).toBeDefined();
    expect(warningRule.meta?.type).toBe('problem');
  });

  it('adapter has correct platform identifier', () => {
    expect(eslintAdapter.platform).toBe('eslint');
  });
});
