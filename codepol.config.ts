import { defineConfig } from '@codepol/core';

export default defineConfig({
  eslintConfigPath: './eslint.config.mjs',
  plugins: ['@codepol/plugin'],
  exclude: ['dist/**', 'node_modules/**'],
  targets: {
    'codepol-src': {
      language: 'typescript',
      files: ['packages/*/src/**/*.ts'],
      // exclude: ['**/*.spec.ts', '**/*.test.ts', '**/__mocks__/**'],
    },
    'python-src': {
      language: 'python',
      files: ['**/*.py'],
      exclude: ['**/venv/**', '**/.venv/**', '**/dist/**', '**/node_modules/**'],
    },
  },
  rules: [
    {
      id: 'no-unused-exports',
      ruleId: 'no-unused-exports',
      description: 'Detect exported symbols not imported by any other file',
      args: {
        ignorePackageEntryPoints: true,
      },
      targets: ['codepol-src'],
    },
    {
      ruleId: 'forbidden-words',
      severity: 'error',
      targets: ['codepol-src', 'python-src'],
      args: {
        words: [
          // Too vague - tells you nothing
          'handle', 'process', 'do', 'resolve',
          // Semantically empty - says nothing about what it holds
          'state', 'thing',
          // Catch-all dumping grounds - encourages poor organization
          'util', 'helper',
          // Implementation leak - exposes internal patterns
          'yield', 'generator', 'stepper',
          // Placeholder - temporary names that stick around
          'tmp', 'temp'
        ],
      },
    },
    {
      ruleId: 'forbidden-path-words',
      severity: 'error',
      targets: ['codepol-src'],
      args: {
        words: [
          // Too vague - tells you nothing
          'handle', 'process', 'do', 'resolve',
          // Semantically empty - says nothing about what it holds
          'state', 'thing',
          // Catch-all dumping grounds - encourages poor organization
          'util', 'helper',
          // Implementation leak - exposes internal patterns
          'yield', 'generator', 'stepper',
          // Placeholder - temporary names that stick around
          'tmp', 'temp'
        ],
      },
    },
    {
      ruleId: 'no-verb-function-name',
      targets: ['codepol-src'],
      severity: 'error',
      args: {
        verbs: [
          'get', 'set', 'create', 'add', 'update', 'delete', 'remove',
          'fetch', 'load', 'save', 'send', 'receive', 'parse', 'format', 'convert', 'transform',
          'init', 'initialize', 'start', 'stop', 'run', 'execute',
          'extract', 'compute', 'calculate', 'build', 'make', 'check', 'validate',
          'render', 'find', 'contains'
        ],
      },
    },
    {
      ruleId: 'no-duplicate-exports',
      targets: ['codepol-src'],
      severity: 'error',
      args: {
        identifierTypes: ['function', 'variable', 'type'],
        includeReexports: true,
      },
    },
    {
      ruleId: 'no-interface',
      targets: ['codepol-src'],
    },
    {
      ruleId: 'no-star-export-collisions',
      targets: ['codepol-src'],
      severity: 'error',
      args: {
        includeLocalExports: true,
      },
    },
  ],
});
