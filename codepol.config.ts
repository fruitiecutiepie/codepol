import { defineConfig } from '@codepol/core';

export default defineConfig({
  plugins: ['@codepol/plugin'],
  targets: {
    'typescript-src': {
      language: 'typescript',
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/*.spec.ts', '**/*.test.ts', '**/__mocks__/**'],
    },
  },
  rules: [
    {
      id: 'function-logging',
      ruleId: 'require-logger-enter-exit',
      description: 'Ensure all exported TypeScript functions are wrapped with logger enter/exit',
      args: {
        logger: {
          identifier: 'logger',
          enterMethod: 'enter',
          exitMethod: 'exit',
          import: {
            module: '@org/logger',
            named: 'logger',
          },
        },
      },
      targets: ['typescript-src'],
    },
  ],
  exclude: ['dist/**'],
});
