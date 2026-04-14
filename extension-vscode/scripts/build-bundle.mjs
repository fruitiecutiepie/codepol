import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const bundleRoot = path.join(extensionRoot, 'dist-vsix');

function bundleDirReset() {
  fs.rmSync(bundleRoot, { recursive: true, force: true });
  fs.mkdirSync(bundleRoot, { recursive: true });
}

function wasmAssetsCopy() {
  const webTreeSitterRoot = path.dirname(require.resolve('web-tree-sitter/package.json'));
  const assets = [
    [path.join(webTreeSitterRoot, 'tree-sitter.wasm'), path.join(bundleRoot, 'tree-sitter.wasm')],
    [path.join(repoRoot, 'packages/core/wasm/tree-sitter-python.wasm'), path.join(bundleRoot, 'tree-sitter-python.wasm')],
    [path.join(repoRoot, 'packages/core/wasm/tree-sitter-tsx.wasm'), path.join(bundleRoot, 'tree-sitter-tsx.wasm')],
    [path.join(repoRoot, 'packages/core/wasm/tree-sitter-typescript.wasm'), path.join(bundleRoot, 'tree-sitter-typescript.wasm')],
  ];

  for (const [sourcePath, targetPath] of assets) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing bundle asset: ${sourcePath}`);
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

async function main() {
  bundleDirReset();

  await esbuild.build({
    absWorkingDir: repoRoot,
    bundle: true,
    define: {
      'process.env.CODEPOL_BUNDLED_RUNTIME': JSON.stringify('1'),
    },
    entryPoints: {
      extension: path.join(extensionRoot, 'src/extension.ts'),
      lsp: path.join(repoRoot, 'apps/lsp/src/indexBundled.ts'),
    },
    external: ['vscode', '@codepol/workspace-service'],
    format: 'cjs',
    logLevel: 'warning',
    minify: production,
    outdir: bundleRoot,
    platform: 'node',
    sourcemap: !production,
    sourcesContent: false,
    target: 'node18',
  });

  await esbuild.build({
    absWorkingDir: repoRoot,
    bundle: true,
    define: {
      'process.env.CODEPOL_BUNDLED_RUNTIME': JSON.stringify('1'),
    },
    entryPoints: {
      daemon: path.join(repoRoot, 'apps/daemon/src/index.ts'),
    },
    external: ['vscode'],
    format: 'cjs',
    logLevel: 'warning',
    minify: production,
    outdir: bundleRoot,
    platform: 'node',
    sourcemap: !production,
    sourcesContent: false,
    target: 'node18',
  });

  wasmAssetsCopy();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
