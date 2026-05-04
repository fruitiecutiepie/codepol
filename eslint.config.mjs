import tseslint from 'typescript-eslint';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import {
  providerRulesConfigGet,
  providerParserRuntimeInit,
  policyPluginRulesGet,
  pluginBuiltinRegister,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

// TODO(result-refactor): add CI guard (eslint custom rule or script) for throw/try-catch drift — backlog in packages/core/src/result/result.ts.

function codepolResultUnwrap(result, label) {
  if ('Err' in result) {
    const msg = result.Err?.message ?? String(result.Err);
    console.error(`[eslint.config] ${label}: ${msg}`);
    process.exit(1);
  }
  return result.Ok;
}

// Explicit dependency: adapted tree-check rules require parser runtime
// initialization before ESLint executes them.
await providerParserRuntimeInit('eslint');

pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

const codepol = eslintPluginCreate(
  codepolResultUnwrap(await policyPluginRulesGet(), 'policyPluginRulesGet'),
);

export default [
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts'],
    plugins: { codepol },
    rules: {
      ...codepolResultUnwrap(await providerRulesConfigGet('eslint'), 'providerRulesConfigGet'),
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.spec.ts', '**/*.test.ts'],
  },
];
