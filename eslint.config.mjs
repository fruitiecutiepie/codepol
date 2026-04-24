import tseslint from 'typescript-eslint';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import {
  providerRulesConfigGet,
  providerParserRuntimeInit,
  policyPluginRulesGet,
  pluginBuiltinRegister,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

// Explicit dependency: adapted tree-check rules require parser runtime
// initialization before ESLint executes them.
await providerParserRuntimeInit('eslint');

pluginBuiltinRegister('@codepol/plugin', codepolBuiltin);

const codepol = eslintPluginCreate(await policyPluginRulesGet());

export default [
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts'],
    plugins: { codepol },
    rules: {
      ...await providerRulesConfigGet('eslint'),
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
