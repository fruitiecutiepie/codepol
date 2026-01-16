import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { eslintAdapter, policyCacheClear, providerInitStateClear } from '@codepol/eslint-plugin';
import { loggerEnterExitRule } from '@codepol/plugin';
import { langAdd, parserInit } from '@codepol/core';

// Initialize tree-sitter parser before tests
beforeAll(async () => {
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();
  policyCacheClear();
  providerInitStateClear();
});

// RuleTester must be run at module level, not inside vitest it() blocks
const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as any,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

const adaptedRule = eslintAdapter.adapt(loggerEnterExitRule, {
  ruleName: 'adapted-logger-check',
});

const filename = path.join(process.cwd(), 'src/example.ts');

const loggerConfig = {
  identifier: 'logger',
  enterMethod: 'enter',
  exitMethod: 'exit',
  import: {
    module: '@org/logger',
    named: 'logger',
  },
};

const options = [
  {
    logger: loggerConfig,
  },
];

// Run the ESLint RuleTester at module level
ruleTester.run('adapted-logger-check', adaptedRule as any, {
  valid: [
    {
      name: 'already instrumented function passes tree-check',
      filename,
      options,
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
      options,
      code: 'export function skip() { return 1; }',
    },
  ],
  invalid: [
    {
      name: 'missing logger instrumentation is reported',
      filename,
      options,
      code: `function f() {
  doStuff();
}`,
      errors: [{ messageId: 'treeCheckViolation' }],
    },
    {
      name: 'arrow function without instrumentation is reported',
      filename,
      options,
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
    const warningRule = eslintAdapter.adapt(loggerEnterExitRule, {
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
