import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { eslintPluginCreate } from '@codepol/eslint-plugin';
import rulePlugins from '@codepol/plugin';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as any,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

const plugin = eslintPluginCreate(rulePlugins);
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

const options = [
  {
    logger: loggerConfig,
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
      name: 'adds logger instrumentation to block function',
      filename,
      options,
      code: `function f(){
  doStuff();
}`,
      errors: [{ messageId: 'missingLogger' }],
      output: `import { logger } from '@org/logger';
function f(){
  logger.enter();
  try {
    doStuff();
  } finally {
    logger.exit();
  }
}`,
    },
    {
      name: 'arrow expression converted to block',
      filename,
      options,
      code: 'const add = (a: number, b: number) => a + b;',
      errors: [{ messageId: 'missingLogger' }],
      output: `import { logger } from '@org/logger';
const add = (a: number, b: number) => {
  logger.enter();
  try {
    return a + b;
  } finally {
    logger.exit();
  }
};`,
    },
    {
      name: 'reuses existing logger import',
      filename,
      options,
      code: `import { logger } from '@org/logger';
const run = () => 1;`,
      errors: [{ messageId: 'missingLogger' }],
      output: `import { logger } from '@org/logger';
const run = () => {
  logger.enter();
  try {
    return 1;
  } finally {
    logger.exit();
  }
};`,
    },
  ],
});
