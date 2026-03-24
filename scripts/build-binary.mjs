#!/usr/bin/env node
/**
 * Bundles the codepol CLI into a single JS file, then optionally compiles
 * it into a standalone binary via `bun build --compile`.
 *
 * Usage:
 *   node scripts/build-binary.mjs              # bundle only
 *   node scripts/build-binary.mjs --compile    # bundle + compile for current platform
 *   node scripts/build-binary.mjs --all        # bundle + compile for all platforms
 */

import { build } from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outDir = resolve(rootDir, 'dist-binary');
const bundlePath = resolve(outDir, 'codepol-bundle.cjs');

const args = process.argv.slice(2);
const shouldCompile = args.includes('--compile') || args.includes('--all');
const compileAll = args.includes('--all');

const BUN_TARGETS = [
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-darwin-x64',
  'bun-darwin-arm64',
];

// ---------------------------------------------------------------------------
// Step 1: esbuild bundle
// ---------------------------------------------------------------------------

console.log('Bundling CLI with esbuild...\n');

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(rootDir, 'apps/cli/src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: bundlePath,
  // web-tree-sitter loads its own WASM via __dirname; must stay external.
  // eslint is optional and massive; stays external.
  external: [
    'web-tree-sitter',
    'eslint',
  ],
  banner: {
    js: 'var import_meta_url = typeof __filename !== "undefined" ? require("url").pathToFileURL(__filename).href : undefined;',
  },
  define: {
    'process.env.CODEPOL_BINARY': '"1"',
    'import.meta.url': 'import_meta_url',
  },
  logLevel: 'info',
});

// ---------------------------------------------------------------------------
// Step 2: Copy WASM assets next to the bundle
// ---------------------------------------------------------------------------

console.log('\nCopying WASM assets...');

const grammarWasmDir = resolve(rootDir, 'packages/core/wasm');
const treeSitterWasm = resolve(rootDir, 'node_modules/web-tree-sitter/tree-sitter.wasm');

const wasmFiles = [
  { src: treeSitterWasm, name: 'tree-sitter.wasm' },
  { src: join(grammarWasmDir, 'tree-sitter-typescript.wasm'), name: 'tree-sitter-typescript.wasm' },
  { src: join(grammarWasmDir, 'tree-sitter-tsx.wasm'), name: 'tree-sitter-tsx.wasm' },
  { src: join(grammarWasmDir, 'tree-sitter-python.wasm'), name: 'tree-sitter-python.wasm' },
];

for (const { src, name } of wasmFiles) {
  const dest = join(outDir, name);
  if (existsSync(src)) {
    cpSync(src, dest);
    console.log(`  ${name}`);
  } else {
    console.warn(`  WARN: ${name} not found at ${src}`);
    console.warn(`        Run "pnpm run build:wasm" first.`);
  }
}

console.log('\nBundle complete: ' + bundlePath);

// ---------------------------------------------------------------------------
// Step 3 (optional): Compile to standalone binary
// ---------------------------------------------------------------------------

if (!shouldCompile) {
  console.log('\nSkipping compilation. Use --compile or --all to create a standalone binary.');
  process.exit(0);
}

const targets = compileAll ? BUN_TARGETS : [null]; // null = current platform

for (const target of targets) {
  const suffix = target ? `-${target.replace('bun-', '')}` : '';
  const isWindows = target?.includes('windows');
  const outName = `codepol${suffix}${isWindows ? '.exe' : ''}`;
  const outPath = join(outDir, outName);

  const targetArgs = target ? `--target=${target}` : '';
  const cmd = `bun build ${bundlePath} --compile ${targetArgs} --outfile ${outPath}`;

  console.log(`\nCompiling: ${outName}`);
  console.log(`  ${cmd}`);

  try {
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
    console.log(`  Done: ${outPath}`);
  } catch (error) {
    console.error(`  Failed to compile for ${target ?? 'current platform'}: ${error.message}`);
    if (compileAll) continue;
    process.exit(1);
  }
}

console.log('\nBuild complete! Artifacts in: ' + outDir);
console.log('IMPORTANT: WASM files must be in the same directory as the binary at runtime.');
