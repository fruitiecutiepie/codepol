import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { eslintPluginCreate } from '@codepol/eslint-plugin';
import pluginRules from '@codepol/plugin';

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
      // Both functions reported. ESLint applies fixes in one pass; the first
      // function's fix (import + block wrap) conflicts with the second's
      // (both insert import at position 0), so only function a is fixed.
      errors: [{ messageId: 'missingLogger' }, { messageId: 'missingLogger' }],
      output: `import { logger } from '@org/logger';
function a() {
  logger.enter();
  try {
    doA();
  } finally {
    logger.exit();
  }
}
function b() {
  doB();
}`,
    },
    {
      name: 'nested functions',
      filename,
      options,
      code: `function outer() {
  function inner() {
    doInner();
  }
  doOuter();
}`,
      // Both functions reported. The inner function's fix has a smaller
      // effective range so ESLint applies it first; the outer's overlaps
      // and is skipped in this pass.
      errors: [{ messageId: 'missingLogger' }, { messageId: 'missingLogger' }],
      output: `import { logger } from '@org/logger';
function outer() {
  function inner() {
  logger.enter();
  try {
    doInner();
  } finally {
    logger.exit();
  }
}
  doOuter();
}`,
    },
    {
      name: 'class method',
      filename,
      options,
      code: `class Service {
  handle() {
    return 'done';
  }
}`,
      // MethodDefinition and FunctionExpression handlers both fire for the method,
      // producing 2 reports for the same function body.
      errors: [{ messageId: 'missingLogger' }, { messageId: 'missingLogger' }],
      output: `import { logger } from '@org/logger';
class Service {
  handle() {
  logger.enter();
  try {
    return 'done';
  } finally {
    logger.exit();
  }
}
}`,
    },
  ],
});
