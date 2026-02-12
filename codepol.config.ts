import { defineConfig } from '@codepol/core';

export default defineConfig({
  plugins: ['@codepol/plugin'],
  targets: {
    'codepol-src': {
      language: 'typescript',
      files: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.test.ts', '**/__mocks__/**'],
    },
  },
  rules: [
    {
      id: 'no-unused-exports',
      ruleId: 'no-unused-exports',
      description: 'Detect exported symbols not imported by any other file',
      args: {
        ignoreEntryPoints: true,
      },
      targets: ['codepol-src'],
    },
  ],
  exclude: ['dist/**', 'node_modules/**'],
});
