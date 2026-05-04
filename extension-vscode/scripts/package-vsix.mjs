import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WorkspaceFault } from '../../scripts/workspaceFault.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const bundleRoot = path.join(extensionRoot, 'dist-vsix');
const stageRoot = path.join(extensionRoot, '.vsix-stage');
const artifactDir = path.join(repoRoot, 'artifacts');
const artifactPath = path.join(artifactDir, 'codepol-extension-vscode.vsix');
const expectedArchivePaths = [
  'extension/package.json',
  'extension/dist/daemon.js',
  'extension/dist/extension.js',
  'extension/dist/lsp.js',
  'extension/dist/tree-sitter-python.wasm',
  'extension/dist/tree-sitter-tsx.wasm',
  'extension/dist/tree-sitter-typescript.wasm',
  'extension/dist/tree-sitter.wasm',
  'extension/media/codepol.svg',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    stdio: options.captureOutput ? 'pipe' : 'inherit',
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new WorkspaceFault(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }

  return result;
}

function removeIfExists(entryPath) {
  fs.rmSync(entryPath, { recursive: true, force: true });
}

function sourceManifestRead() {
  return JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
}

function bundleOutputsAssert() {
  if (!fs.existsSync(bundleRoot)) {
    throw new WorkspaceFault(`Missing bundled runtime at ${bundleRoot}. Run the bundle build first.`);
  }
}

function stageRuntimeFilesCopy() {
  bundleOutputsAssert();
  removeIfExists(stageRoot);
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.cpSync(bundleRoot, path.join(stageRoot, 'dist'), { recursive: true });
  fs.cpSync(path.join(extensionRoot, 'media'), path.join(stageRoot, 'media'), { recursive: true });
  fs.copyFileSync(path.join(extensionRoot, 'README.md'), path.join(stageRoot, 'README.md'));
}

function finalManifestWrite() {
  const sourceManifest = sourceManifestRead();
  const manifest = { ...sourceManifest };
  delete manifest.dependencies;
  delete manifest.devDependencies;
  delete manifest.scripts;
  delete manifest.files;

  fs.writeFileSync(
    path.join(stageRoot, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function stageIgnoreWrite() {
  fs.writeFileSync(
    path.join(stageRoot, '.vscodeignore'),
    'package-lock.json\n',
  );
}

function verifyArchive() {
  const zipListing = run('unzip', ['-Z1', artifactPath], { captureOutput: true });
  const archiveEntries = new Set(
    zipListing.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  for (const entry of expectedArchivePaths) {
    if (!archiveEntries.has(entry)) {
      throw new WorkspaceFault(`VSIX is missing expected entry: ${entry}`);
    }
  }

  for (const entry of archiveEntries) {
    if (entry.startsWith('extension/node_modules/')) {
      throw new WorkspaceFault(`VSIX unexpectedly contains node_modules content: ${entry}`);
    }
  }

  const manifest = run('unzip', ['-p', artifactPath, 'extension/package.json'], {
    captureOutput: true,
  });
  const parsedManifest = JSON.parse(manifest.stdout);
  const contributedViewIds = new Set(
    parsedManifest.contributes?.views?.codepol?.map((view) => view.id) ?? [],
  );
  if (!contributedViewIds.has('codepol.packageTargets')) {
    throw new WorkspaceFault('VSIX manifest is missing the codepol.packageTargets view contribution.');
  }
}

function packageVsceBinaryResolve() {
  const binaryName = process.platform === 'win32' ? 'vsce.cmd' : 'vsce';
  const binaryPath = path.join(extensionRoot, 'node_modules', '.bin', binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new WorkspaceFault(
      `Missing ${binaryName}. Install extension dev dependencies first so @vscode/vsce is available.`,
    );
  }
  return binaryPath;
}

fs.mkdirSync(artifactDir, { recursive: true });
removeIfExists(artifactPath);

stageRuntimeFilesCopy();
finalManifestWrite();
stageIgnoreWrite();

const vsceBinary = packageVsceBinaryResolve();
run(vsceBinary, ['package', '--skip-license', '--out', artifactPath], { cwd: stageRoot });

verifyArchive();

console.log(`VSIX artifact created at ${artifactPath}`);
