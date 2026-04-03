import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@codepol/plugin-biome': path.resolve(__dirname, 'packages/plugin-biome/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.spec.ts', 'packages/**/*.spec.ts'],
    coverage: {
      enabled: false,
    },
    benchmark: {
      include: ['packages/**/*.bench.ts'],
    },
  },
});
