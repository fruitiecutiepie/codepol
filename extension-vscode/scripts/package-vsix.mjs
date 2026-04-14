import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const tarballDir = path.join(extensionRoot, '.vsix-tarballs');
const stageRoot = path.join(extensionRoot, '.vsix-stage');
const artifactDir = path.join(repoRoot, 'artifacts');
const artifactPath = path.join(artifactDir, 'codepol-extension-vscode.vsix');
const workspacePackageDirs = [
  ['@codepol/core', 'packages/core'],
  ['@codepol/plugin', 'packages/plugin'],
  ['@codepol/plugin-biome', 'packages/plugin-biome'],
  ['@codepol/plugin-eslint', 'packages/plugin-eslint'],
  ['@codepol/plugin-ruff', 'packages/plugin-ruff'],
  ['@codepol/plugin-vulture', 'packages/plugin-vulture'],
  ['@codepol/workspace-service', 'packages/workspace-service'],
  ['@codepol/daemon', 'apps/daemon'],
  ['@codepol/lsp', 'apps/lsp'],
];
const expectedArchivePaths = [
  'extension/dist/extension.js',
  'extension/media/codepol.svg',
  'extension/node_modules/@codepol/core/dist/index.js',
  'extension/node_modules/@codepol/core/wasm/tree-sitter-typescript.wasm',
  'extension/node_modules/@codepol/lsp/dist/index.js',
  'extension/node_modules/@codepol/workspace-service/dist/index.js',
  'extension/node_modules/@codepol/plugin/dist/index.js',
  'extension/node_modules/@codepol/plugin-eslint/dist/index.js',
  'extension/node_modules/vscode-languageclient/lib/node/main.js',
];
const nodeModulesPruneDirNames = new Set([
  '.github',
  '.vscode',
  '__tests__',
  'coverage',
  'doc',
  'docs',
  'example',
  'examples',
  'test',
  'tests',
]);
const nodeModulesPruneFilePatterns = [
  /^\.editorconfig$/iu,
  /^\.gitattributes$/iu,
  /^\.gitignore$/iu,
  /^\.npmignore$/iu,
  /^authors?(?:\..+)?$/iu,
  /^changelog(?:\..+)?$/iu,
  /^history(?:\..+)?$/iu,
  /^license(?:\..+)?$/iu,
  /^licence(?:\..+)?$/iu,
  /^notice(?:\..+)?$/iu,
  /^readme(?:\..+)?$/iu,
  /^security(?:\..+)?$/iu,
  /^thirdpartynoticetext(?:\..+)?$/iu,
  /^tsconfig(?:\..+)?\.json$/iu,
  /\.map$/iu,
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
    throw new Error(`${command} ${args.join(' ')} failed${output ? `\n${output}` : ''}`);
  }

  return result;
}

function removeIfExists(entryPath) {
  fs.rmSync(entryPath, { recursive: true, force: true });
}

function nodeModulesArtifactPruneRecursive(entryPath) {
  const entryName = path.basename(entryPath);
  let stat;
  try {
    stat = fs.statSync(entryPath);
  } catch {
    return;
  }

  if (stat.isDirectory()) {
    if (nodeModulesPruneDirNames.has(entryName)) {
      removeIfExists(entryPath);
      return;
    }
    for (const childName of fs.readdirSync(entryPath)) {
      nodeModulesArtifactPruneRecursive(path.join(entryPath, childName));
    }
    return;
  }

  if (nodeModulesPruneFilePatterns.some((pattern) => pattern.test(entryName))) {
    removeIfExists(entryPath);
  }
}

function typescriptPackagePrune() {
  const typescriptRoot = path.join(stageRoot, 'node_modules', 'typescript');
  if (!fs.existsSync(typescriptRoot)) {
    return;
  }

  const keepAtRoot = new Set(['lib', 'package.json']);
  for (const entryName of fs.readdirSync(typescriptRoot)) {
    if (!keepAtRoot.has(entryName)) {
      removeIfExists(path.join(typescriptRoot, entryName));
    }
  }

  const libDir = path.join(typescriptRoot, 'lib');
  if (!fs.existsSync(libDir)) {
    return;
  }

  for (const entryName of fs.readdirSync(libDir)) {
    if (entryName !== 'typescript.js') {
      removeIfExists(path.join(libDir, entryName));
    }
  }
}

function nodeModulesPrune() {
  const nodeModulesRoot = path.join(stageRoot, 'node_modules');
  if (!fs.existsSync(nodeModulesRoot)) {
    return;
  }

  nodeModulesArtifactPruneRecursive(nodeModulesRoot);
  typescriptPackagePrune();
}

function sourceManifestRead() {
  return JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
}

function packageVersionRead(packageDirRelative) {
  const packageJsonPath = path.join(repoRoot, packageDirRelative, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return manifest.version;
}

function lastNonEmptyLine(value) {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const line = lines.at(-1);
  if (!line) {
    throw new Error('Expected command output to contain a path');
  }
  return line;
}

function relativeFileSpecifierCreate(targetPathAbsolute) {
  const relativePath = path.relative(stageRoot, targetPathAbsolute).split(path.sep).join('/');
  return `file:${relativePath}`;
}

function workspaceTarballsPack() {
  removeIfExists(tarballDir);
  fs.mkdirSync(tarballDir, { recursive: true });

  const tarballDependencies = {};
  for (const [packageName, packageDirRelative] of workspacePackageDirs) {
    const result = run(
      'pnpm',
      ['pack', '--pack-destination', tarballDir],
      {
        cwd: path.join(repoRoot, packageDirRelative),
        captureOutput: true,
      },
    );
    const tarballPath = lastNonEmptyLine(result.stdout);
    tarballDependencies[packageName] = relativeFileSpecifierCreate(tarballPath);
  }
  return tarballDependencies;
}

function stageRuntimeFilesCopy() {
  removeIfExists(stageRoot);
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.cpSync(path.join(extensionRoot, 'dist'), path.join(stageRoot, 'dist'), { recursive: true });
  fs.cpSync(path.join(extensionRoot, 'media'), path.join(stageRoot, 'media'), { recursive: true });
  fs.copyFileSync(path.join(extensionRoot, 'README.md'), path.join(stageRoot, 'README.md'));
  removeIfExists(path.join(stageRoot, 'dist', 'smoke'));
}

function installManifestWrite(tarballDependencies) {
  const sourceManifest = sourceManifestRead();
  const externalDependencies = Object.fromEntries(
    Object.entries(sourceManifest.dependencies ?? {}).filter(([, value]) => !String(value).startsWith('workspace:')),
  );
  const manifest = {
    ...sourceManifest,
    dependencies: {
      ...tarballDependencies,
      ...externalDependencies,
    },
  };
  delete manifest.devDependencies;
  delete manifest.scripts;
  delete manifest.files;

  fs.writeFileSync(
    path.join(stageRoot, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function finalManifestWrite() {
  const sourceManifest = sourceManifestRead();
  const directDependencies = Object.fromEntries(
    Object.entries(sourceManifest.dependencies ?? {}).map(([dependencyName, dependencyRange]) => {
      if (!String(dependencyRange).startsWith('workspace:')) {
        return [dependencyName, dependencyRange];
      }
      const packageDirRelative = workspacePackageDirs.find(([packageName]) => packageName === dependencyName)?.[1];
      if (!packageDirRelative) {
        throw new Error(`Could not resolve workspace dependency ${dependencyName}`);
      }
      return [dependencyName, packageVersionRead(packageDirRelative)];
    }),
  );

  const manifest = {
    ...sourceManifest,
    dependencies: directDependencies,
  };
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
    'dist/smoke/**\npackage-lock.json\n',
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
      throw new Error(`VSIX is missing expected entry: ${entry}`);
    }
  }
}

function packageVsceBinaryResolve() {
  const binaryName = process.platform === 'win32' ? 'vsce.cmd' : 'vsce';
  const binaryPath = path.join(extensionRoot, 'node_modules', '.bin', binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `Missing ${binaryName}. Install extension dev dependencies first so @vscode/vsce is available.`,
    );
  }
  return binaryPath;
}

fs.mkdirSync(artifactDir, { recursive: true });
removeIfExists(artifactPath);

const tarballDependencies = workspaceTarballsPack();
stageRuntimeFilesCopy();
installManifestWrite(tarballDependencies);
run('npm', ['install', '--omit=dev'], { cwd: stageRoot });
nodeModulesPrune();
removeIfExists(path.join(stageRoot, 'package-lock.json'));
finalManifestWrite();
stageIgnoreWrite();

const vsceBinary = packageVsceBinaryResolve();
run(vsceBinary, ['package', '--skip-license', '--out', artifactPath], { cwd: stageRoot });

verifyArchive();

console.log(`VSIX artifact created at ${artifactPath}`);
