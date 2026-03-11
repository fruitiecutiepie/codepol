import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll } from 'vitest';
import { eslintPluginCreate, policyCacheClear } from '@codepol/eslint-plugin';
import pluginRules from '@codepol/plugin';
import { langAdd, parserInit } from '@codepol/core';

beforeAll(async () => {
  langAdd({ langId: 'typescript', fileExtensions: ['.ts'] });
  langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
  await parserInit();
  policyCacheClear();
});

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as any,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

const plugin = eslintPluginCreate(pluginRules);
const rule = (plugin as any).rules['require-logger-enter-exit'];
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

const ruleTargets = [
  {
    ruleId: '@codepol/plugin/require-logger-enter-exit',
    description: 'Ensure functions include logger enter/exit',
    args: { logger: loggerConfig },
    target: {
      language: 'typescript',
      files: ['src/**/*.ts'],
      exclude: ['**/*.spec.ts'],
    },
  },
];

const options = [
  {
    ruleTargets,
    policyExclude: [] as string[],
  },
];

ruleTester.run('codepol/require-logger-enter-exit', rule, {
  valid: [
    {
      name: 'already instrumented function',
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
      name: 'ignored file via policy exclude',
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
      code: `function f(){
  doStuff();
}`,
      errors: [{ messageId: 'treeCheckViolation' }],
    },
    {
      name: 'arrow expression without instrumentation is reported',
      filename,
      options,
      code: 'const add = (a: number, b: number) => a + b;',
      errors: [{ messageId: 'treeCheckViolation' }],
    },
    {
      name: 'multiple functions in one file',
      filename,
      options,
      code: `function a() {
  doA();
}
function b() {
  doB();
}`,
      errors: [{ messageId: 'treeCheckViolation' }, { messageId: 'treeCheckViolation' }],
    },
    {
      name: 'class method without instrumentation',
      filename,
      options,
      code: `class Service {
  handle() {
    return 'done';
  }
}`,
      errors: [{ messageId: 'treeCheckViolation' }],
    },
  ],
});
