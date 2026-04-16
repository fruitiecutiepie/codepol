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
const workspaceServiceIndex = path.join(repoRoot, 'packages/workspace-service/src/index.ts');
const workspaceServiceDaemon = path.join(repoRoot, 'packages/workspace-service/src/daemon.ts');
const workspaceServiceContracts = path.join(repoRoot, 'packages/workspace-service/src/contracts.ts');

const workspaceServiceAliasPlugin = {
  name: 'workspace-service-alias',
  setup(build) {
    build.onResolve({ filter: /^@codepol\/workspace-service$/ }, () => ({
      path: workspaceServiceIndex,
    }));
    build.onResolve({ filter: /^@codepol\/workspace-service\/daemon$/ }, () => ({
      path: workspaceServiceDaemon,
    }));
    build.onResolve({ filter: /^@codepol\/workspace-service\/contracts$/ }, () => ({
      path: workspaceServiceContracts,
    }));
  },
};

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

function daemonBundleValidate(metafile) {
  const runtimeTypescriptInput = Object.keys(metafile.inputs).find((input) =>
    input.replaceAll('\\', '/').endsWith('/typescript/lib/typescript.js') ||
    input.replaceAll('\\', '/').endsWith('typescript/lib/typescript.js'),
  );

  if (runtimeTypescriptInput) {
    throw new Error(
      `Daemon bundle regression: runtime TypeScript compiler included via ${runtimeTypescriptInput}`,
    );
  }
}

function outputFilesWrite(outputFiles) {
  for (const outputFile of outputFiles) {
    fs.mkdirSync(path.dirname(outputFile.path), { recursive: true });
    fs.writeFileSync(outputFile.path, outputFile.contents);
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
    external: ['vscode'],
    format: 'cjs',
    logLevel: 'warning',
    minify: production,
    outdir: bundleRoot,
    platform: 'node',
    plugins: [workspaceServiceAliasPlugin],
    sourcemap: !production,
    sourcesContent: false,
    target: 'node18',
  });

  const daemonBuild = await esbuild.build({
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
    metafile: true,
    minify: production,
    outdir: bundleRoot,
    platform: 'node',
    sourcemap: !production,
    sourcesContent: false,
    target: 'node18',
    write: false,
  });

  daemonBundleValidate(daemonBuild.metafile);
  outputFilesWrite(daemonBuild.outputFiles);

  wasmAssetsCopy();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
