#!/usr/bin/env node
/**
 * Build/download WASM grammars for web-tree-sitter.
 *
 * This script attempts to build WASM from source using tree-sitter-cli.
 * If Emscripten/Docker is not available, it downloads pre-built WASM files.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream/promises';
import { WorkspaceFault } from './workspaceFault.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const wasmOutputDir = join(rootDir, 'packages', 'core', 'wasm');

const require = createRequire(import.meta.url);

// Versions for downloading pre-built WASM files
const TREE_SITTER_TS_VERSION = '0.23.2';
const TREE_SITTER_PYTHON_VERSION = '0.23.6';

/**
 * Find the tree-sitter-typescript package directory
 */
function findTreeSitterTypescriptDir() {
  const packagePath = require.resolve('tree-sitter-typescript/package.json');
  return dirname(packagePath);
}

/**
 * Check if we can build WASM locally (have emcc, docker, or podman)
 */
function canBuildLocally() {
  const tools = ['emcc', 'docker', 'podman'];
  for (const tool of tools) {
    const result = spawnSync('which', [tool], { stdio: 'pipe' });
    if (result.status === 0) {
      console.log(`Found ${tool}, will attempt local build.`);
      return true;
    }
  }
  return false;
}

/**
 * Build WASM for a grammar directory using tree-sitter-cli
 */
function buildWasmLocally(grammarDir, outputPath) {
  console.log(`Building ${outputPath} from ${grammarDir}...`);

  try {
    execSync(`npx tree-sitter build --wasm -o "${outputPath}"`, {
      cwd: grammarDir,
      stdio: 'inherit',
    });
    console.log(`  ✓ Built ${outputPath}`);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to build: ${error.message}`);
    return false;
  }
}

/**
 * Download a file from URL to destination
 */
async function downloadFile(url, destPath) {
  console.log(`Downloading ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new WorkspaceFault(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const fileStream = createWriteStream(destPath);
  await pipeline(response.body, fileStream);
  console.log(`  ✓ Downloaded to ${destPath}`);
}

/**
 * Download pre-built WASM from GitHub releases.
 * @param {string} repoName - GitHub repo name under tree-sitter org (e.g., 'tree-sitter-typescript')
 * @param {string} version - Release version tag (without 'v' prefix)
 * @param {string} wasmFileName - WASM file name in the release assets
 * @param {string} outputPath - Local output path
 */
async function downloadPrebuiltWasm(repoName, version, wasmFileName, outputPath) {
  const url = `https://github.com/tree-sitter/${repoName}/releases/download/v${version}/${wasmFileName}`;

  try {
    await downloadFile(url, outputPath);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to download ${wasmFileName}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('Building/downloading Tree-sitter WASM grammars...\n');

  // Ensure output directory exists
  if (!existsSync(wasmOutputDir)) {
    mkdirSync(wasmOutputDir, { recursive: true });
  }

  const tsWasmPath = join(wasmOutputDir, 'tree-sitter-typescript.wasm');
  const tsxWasmPath = join(wasmOutputDir, 'tree-sitter-tsx.wasm');
  const pyWasmPath = join(wasmOutputDir, 'tree-sitter-python.wasm');

  const allExist = existsSync(tsWasmPath) && existsSync(tsxWasmPath) && existsSync(pyWasmPath);
  if (allExist) {
    console.log('WASM files already exist, skipping build.');
    console.log(`  ${tsWasmPath}`);
    console.log(`  ${tsxWasmPath}`);
    console.log(`  ${pyWasmPath}`);
    return;
  }

  let tsSuccess = existsSync(tsWasmPath) && existsSync(tsxWasmPath);
  let pySuccess = existsSync(pyWasmPath);

  // Try local build for TypeScript/TSX if tools are available and files missing
  if (!tsSuccess && canBuildLocally()) {
    const tsPackageDir = findTreeSitterTypescriptDir();
    console.log(`\nFound tree-sitter-typescript at: ${tsPackageDir}\n`);

    const typescriptDir = join(tsPackageDir, 'typescript');
    const tsxDir = join(tsPackageDir, 'tsx');

    const tsBuild = buildWasmLocally(typescriptDir, tsWasmPath);
    const tsxBuild = buildWasmLocally(tsxDir, tsxWasmPath);
    tsSuccess = tsBuild && tsxBuild;
  }

  // Fall back to downloading pre-built WASM for TypeScript/TSX
  if (!tsSuccess) {
    console.log('\nDownloading pre-built TypeScript/TSX WASM files...\n');
    const tsDl = await downloadPrebuiltWasm('tree-sitter-typescript', TREE_SITTER_TS_VERSION, 'tree-sitter-typescript.wasm', tsWasmPath);
    const tsxDl = await downloadPrebuiltWasm('tree-sitter-typescript', TREE_SITTER_TS_VERSION, 'tree-sitter-tsx.wasm', tsxWasmPath);
    tsSuccess = tsDl && tsxDl;
  }

  // Download pre-built Python WASM (no local build — the npm package doesn't ship grammar source)
  if (!pySuccess) {
    console.log('\nDownloading pre-built Python WASM file...\n');
    pySuccess = await downloadPrebuiltWasm('tree-sitter-python', TREE_SITTER_PYTHON_VERSION, 'tree-sitter-python.wasm', pyWasmPath);
  }

  if (tsSuccess && pySuccess) {
    console.log('\n✓ All WASM grammars ready!');
    console.log(`  Output: ${wasmOutputDir}`);
  } else {
    console.error('\n✗ Failed to obtain WASM grammars.');
    console.error('  Please ensure Docker is installed, or manually download the WASM files.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nFailed to build WASM grammars:', error.message);
  process.exit(1);
});
