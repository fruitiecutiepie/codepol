import tseslint from 'typescript-eslint';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import {
  langAdd,
  parserInit,
  providerRulesConfigGet,
  policyPluginRulesGet,
  pluginBuiltinRegister,
} from '@codepol/core';
import codepolBuiltin from '@codepol/plugin';

// Initialize tree-sitter so cross-file analysis rules (no-unused-exports)
// can build the project index. Must happen before rules execute.
langAdd({ langId: 'typescript', fileExtensions: ['.ts', '.mts', '.cts'] });
langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
await parserInit();

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
