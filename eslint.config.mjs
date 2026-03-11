import tseslint from 'typescript-eslint';
import { eslintPluginCreate } from '@codepol/plugin-eslint';
import { langAdd, parserInit, providerRulesConfigGet } from '@codepol/core';
import pluginRules from '@codepol/plugin';

// Initialize tree-sitter so cross-file analysis rules (no-unused-exports)
// can build the project index. Must happen before rules execute.
langAdd({ langId: 'typescript', fileExtensions: ['.ts', '.mts', '.cts'] });
langAdd({ langId: 'tsx', fileExtensions: ['.tsx'] });
await parserInit();

const codepol = eslintPluginCreate(pluginRules);

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
