import path from 'node:path';
import { defineConfig } from 'vitest/config';

const workspaceSourceEntries = {
  '@codepol/core': 'packages/core/src/index.ts',
  '@codepol/lsp': 'apps/lsp/src/index.ts',
  '@codepol/lsp/protocol': 'apps/lsp/src/protocol.ts',
  '@codepol/plugin': 'packages/plugin/src/index.ts',
  '@codepol/plugin-biome': 'packages/plugin-biome/src/index.ts',
  '@codepol/plugin-eslint': 'packages/plugin-eslint/src/index.ts',
  '@codepol/plugin-esbuild': 'packages/plugin-esbuild/src/index.ts',
  '@codepol/plugin-ruff': 'packages/plugin-ruff/src/index.ts',
  '@codepol/plugin-vulture': 'packages/plugin-vulture/src/index.ts',
  '@codepol/workspace-service': 'packages/workspace-service/src/index.ts',
};

const workspaceAliases = Object.fromEntries(
  Object.entries(workspaceSourceEntries).map(([packageName, relativePath]) => [
    packageName,
    path.resolve(__dirname, relativePath),
  ]),
);

export default defineConfig({
  resolve: {
    // Keep tests independent from built package artifacts in workspace installs.
    alias: workspaceAliases,
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
