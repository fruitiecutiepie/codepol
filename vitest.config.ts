import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.spec.ts'],
    coverage: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      '@codepol/core': path.resolve(__dirname, './packages/core/src'),
      '@codepol/eslint-plugin': path.resolve(__dirname, './packages/eslint-plugin/src'),
      '@codepol/esbuild-plugin': path.resolve(__dirname, './packages/esbuild-plugin/src'),
      '@codepol/plugin': path.resolve(__dirname, './packages/plugin/src'),
    },
  },
});
