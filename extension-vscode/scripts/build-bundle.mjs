import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import { WorkspaceFault, workspaceThrownMessageFromUnknown } from '../../scripts/workspaceFault.mjs';

const production = process.argv.includes('--production');
const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const bundleRoot = path.join(extensionRoot, 'dist-vsix');
const coreIndex = path.join(repoRoot, 'packages/core/src/index.ts');
const pluginIndex = path.join(repoRoot, 'packages/plugin/src/index.ts');
const pluginBiomeIndex = path.join(repoRoot, 'packages/plugin-biome/src/index.ts');
const pluginEslintIndex = path.join(repoRoot, 'packages/plugin-eslint/src/index.ts');
const pluginRuffIndex = path.join(repoRoot, 'packages/plugin-ruff/src/index.ts');
const pluginVultureIndex = path.join(repoRoot, 'packages/plugin-vulture/src/index.ts');
const workspaceServiceIndex = path.join(repoRoot, 'packages/workspace-service/src/index.ts');
const workspaceServiceDaemon = path.join(repoRoot, 'packages/workspace-service/src/daemon.ts');
const workspaceServiceContracts = path.join(repoRoot, 'packages/workspace-service/src/contracts.ts');

const workspaceServiceAliasPlugin = {
  name: 'workspace-service-alias',
  setup(build) {
    build.onResolve({ filter: /^@codepol\/core$/ }, () => ({
      path: coreIndex,
    }));
    build.onResolve({ filter: /^@codepol\/plugin$/ }, () => ({
      path: pluginIndex,
    }));
    build.onResolve({ filter: /^@codepol\/plugin-biome$/ }, () => ({
      path: pluginBiomeIndex,
    }));
    build.onResolve({ filter: /^@codepol\/plugin-eslint$/ }, () => ({
      path: pluginEslintIndex,
    }));
    build.onResolve({ filter: /^@codepol\/plugin-ruff$/ }, () => ({
      path: pluginRuffIndex,
    }));
    build.onResolve({ filter: /^@codepol\/plugin-vulture$/ }, () => ({
      path: pluginVultureIndex,
    }));
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

/**
 * Build-time identity. Has to change whenever the bundled daemon binary
 * would meaningfully differ, so a LSP bundled against the new sources
 * can reject a stale running daemon during `hello`. Prefers git when
 * available (SHA for clean trees, SHA + dirty-timestamp for uncommitted
 * edits); falls back to a plain timestamp in environments without git.
 */
function buildIdResolve() {
  const override = process.env.CODEPOL_BUILD_ID?.trim();
  if (override && override.length > 0) {
    return override;
  }
  try {
    const sha = execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
      .trim()
      .slice(0, 12);
    const dirty = execSync(
      'git status --porcelain --untracked-files=no',
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
    ).trim().length > 0;
    return dirty ? `${sha}-dirty-${Date.now()}` : sha;
  } catch {
    return `nogit-${Date.now()}`;
  }
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
      throw new WorkspaceFault(`Missing bundle asset: ${sourcePath}`);
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
    throw new WorkspaceFault(
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

  const buildId = buildIdResolve();
  const sharedDefine = {
    'process.env.CODEPOL_BUNDLED_RUNTIME': JSON.stringify('1'),
    // Inlined at bundle time so LSP + daemon carry identical build
    // identity. The hello handshake compares them; a mismatch forces
    // the LSP to terminate the running daemon and spawn a fresh one.
    'process.env.CODEPOL_BUILD_ID': JSON.stringify(buildId),
  };
  console.log(`[build-bundle] buildId=${buildId}`);

  await esbuild.build({
    absWorkingDir: repoRoot,
    bundle: true,
    define: sharedDefine,
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
    define: sharedDefine,
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
    plugins: [workspaceServiceAliasPlugin],
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
  console.error(workspaceThrownMessageFromUnknown(error));
  process.exitCode = 1;
});
