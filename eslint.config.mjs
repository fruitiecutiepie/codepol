import tseslint from 'typescript-eslint';
import { eslintPluginCreate } from '@codepol/eslint-plugin';
import pluginRules from '@codepol/plugin';

const codepol = eslintPluginCreate(pluginRules);

export default [
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts'],
    plugins: { codepol },
    rules: {
      'codepol/no-unused-exports': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.spec.ts', '**/*.test.ts'],
  },
];
