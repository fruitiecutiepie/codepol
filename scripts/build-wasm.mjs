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

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const wasmOutputDir = join(rootDir, 'packages', 'core', 'wasm');

const require = createRequire(import.meta.url);

// tree-sitter-typescript version to download pre-built WASM for
const TREE_SITTER_TS_VERSION = '0.23.2';

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
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const fileStream = createWriteStream(destPath);
  await pipeline(response.body, fileStream);
  console.log(`  ✓ Downloaded to ${destPath}`);
}

/**
 * Download pre-built WASM from GitHub releases
 */
async function downloadPrebuiltWasm(langName, outputPath) {
  // tree-sitter-typescript releases include pre-built WASM files
  const baseUrl = `https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v${TREE_SITTER_TS_VERSION}`;
  const wasmFileName = `tree-sitter-${langName}.wasm`;
  const url = `${baseUrl}/${wasmFileName}`;

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

  // Check if WASM files already exist
  if (existsSync(tsWasmPath) && existsSync(tsxWasmPath)) {
    console.log('WASM files already exist, skipping build.');
    console.log(`  ${tsWasmPath}`);
    console.log(`  ${tsxWasmPath}`);
    return;
  }

  let success = false;

  // Try local build first if tools are available
  if (canBuildLocally()) {
    const tsPackageDir = findTreeSitterTypescriptDir();
    console.log(`\nFound tree-sitter-typescript at: ${tsPackageDir}\n`);

    const typescriptDir = join(tsPackageDir, 'typescript');
    const tsxDir = join(tsPackageDir, 'tsx');

    const tsSuccess = buildWasmLocally(typescriptDir, tsWasmPath);
    const tsxSuccess = buildWasmLocally(tsxDir, tsxWasmPath);
    success = tsSuccess && tsxSuccess;
  }

  // Fall back to downloading pre-built WASM
  if (!success) {
    console.log('\nLocal build not available. Downloading pre-built WASM files...\n');

    const tsSuccess = await downloadPrebuiltWasm('typescript', tsWasmPath);
    const tsxSuccess = await downloadPrebuiltWasm('tsx', tsxWasmPath);
    success = tsSuccess && tsxSuccess;
  }

  if (success) {
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
