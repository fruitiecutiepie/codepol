#!/usr/bin/env node
/**
 * Dev-loop helper: swap the installed Codepol VSCode extension with the
 * freshly bundled output, and tear down any running daemon so the next
 * LSP request spawns a daemon built from the current source.
 *
 * Inputs (all optional):
 *   --extension-dir <path>       Installed extension dir. Auto-discovered
 *                                from ~/.vscode-server, ~/.vscode,
 *                                ~/.cursor-server, ~/.cursor otherwise.
 *   --bundle-dir <path>          Source of freshly built files.
 *                                Defaults to extension-vscode/dist-vsix.
 *   --runtime-dir <path>         CODEPOL_DAEMON_RUNTIME_DIR override.
 *   --skip-daemon-kill           Do not terminate running daemons.
 *   --skip-copy                  Do not copy the bundle (daemon kill only).
 *
 * Exits non-zero on fatal errors (e.g. bundle dir missing). Missing
 * extension dir is a warning — the copy is skipped but the daemon kill
 * still runs so a freshly installed VSIX can pick up cleanly.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WorkspaceFault, workspaceThrownMessageFromUnknown } from './workspaceFault.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const defaultBundleDir = path.join(repoRoot, 'extension-vscode/dist-vsix');

function argParse(argv) {
  const parsed = {
    extensionDir: undefined,
    bundleDir: defaultBundleDir,
    runtimeDir: undefined,
    skipDaemonKill: false,
    skipCopy: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--extension-dir') parsed.extensionDir = argv[++i];
    else if (arg === '--bundle-dir') parsed.bundleDir = path.resolve(argv[++i]);
    else if (arg === '--runtime-dir') parsed.runtimeDir = path.resolve(argv[++i]);
    else if (arg === '--skip-daemon-kill') parsed.skipDaemonKill = true;
    else if (arg === '--skip-copy') parsed.skipCopy = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('\n').slice(1, 25).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
      process.exit(0);
    } else {
      console.error(`[install-extension-dev] unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return parsed;
}

function extensionIdGuess() {
  return 'codepol.extension-vscode-1.0.0';
}

function extensionDirDiscover() {
  const id = extensionIdGuess();
  const home = os.homedir();
  const candidates = [
    path.join(home, '.vscode-server/extensions', id),
    path.join(home, '.vscode/extensions', id),
    path.join(home, '.cursor-server/extensions', id),
    path.join(home, '.cursor/extensions', id),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'dist'))) {
      return candidate;
    }
  }
  return undefined;
}

function bundleFilesValidate(bundleDir) {
  const required = ['extension.js', 'lsp.js', 'daemon.js'];
  const wasmFiles = [
    'tree-sitter.wasm',
    'tree-sitter-typescript.wasm',
    'tree-sitter-tsx.wasm',
    'tree-sitter-python.wasm',
  ];
  const missing = [...required, ...wasmFiles].filter(
    (file) => !fs.existsSync(path.join(bundleDir, file)),
  );
  if (missing.length > 0) {
    throw new WorkspaceFault(
      `Bundle dir ${bundleDir} is missing required files: ${missing.join(', ')}. Run \`pnpm --dir extension-vscode bundle:prod\` first.`,
    );
  }
}

function bundleCopy(bundleDir, extensionDir) {
  const targetDir = path.join(extensionDir, 'dist');
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(bundleDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const src = path.join(bundleDir, entry.name);
    const dst = path.join(targetDir, entry.name);
    fs.copyFileSync(src, dst);
  }
  fs.copyFileSync(
    path.join(repoRoot, 'extension-vscode/package.json'),
    path.join(extensionDir, 'package.json'),
  );
  return targetDir;
}

async function daemonTerminate(runtimeDir) {
  // Dynamic import: the caller may run this before `@codepol/workspace-
  // service` is built. Fall back to filesystem-only cleanup when dist
  // isn't ready yet.
  const distEntry = path.join(
    repoRoot,
    'packages/workspace-service/dist/index.js',
  );
  if (!fs.existsSync(distEntry)) {
    daemonTerminateFilesystemOnly(runtimeDir);
    return;
  }
  const mod = await import(`file://${distEntry}`);
  const fn = mod.workspaceDaemonTerminateExternal;
  if (typeof fn !== 'function') {
    daemonTerminateFilesystemOnly(runtimeDir);
    return;
  }
  const result = await fn(runtimeDir);
  if (!result.descriptor) {
    console.log('[install-extension-dev] no daemon was running.');
  } else if (result.terminated) {
    console.log(
      `[install-extension-dev] terminated daemon pid=${result.descriptor.pid} buildId=${result.descriptor.buildId}`,
    );
  } else {
    console.warn(
      `[install-extension-dev] could not terminate daemon pid=${result.descriptor.pid}; descriptor cleared`,
    );
  }
}

function daemonTerminateFilesystemOnly(runtimeDir) {
  const dir = runtimeDir ?? daemonDefaultRuntimeDirResolve();
  const descriptorPath = path.join(dir, 'daemon.info.json');
  const socketPath = path.join(dir, 'daemon.sock');
  if (fs.existsSync(descriptorPath)) {
    try {
      const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
      if (typeof descriptor.pid === 'number') {
        try {
          process.kill(descriptor.pid, 'SIGTERM');
          console.log(
            `[install-extension-dev] SIGTERM sent to daemon pid=${descriptor.pid} (fallback path)`,
          );
        } catch {
          // already gone
        }
      }
      fs.unlinkSync(descriptorPath);
    } catch {
      // ignore malformed descriptor
    }
  } else {
    console.log('[install-extension-dev] no daemon descriptor present.');
  }
  if (fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }
}

function daemonDefaultRuntimeDirResolve() {
  if (process.env.CODEPOL_DAEMON_RUNTIME_DIR) {
    return path.resolve(process.env.CODEPOL_DAEMON_RUNTIME_DIR);
  }
  if (process.env.XDG_RUNTIME_DIR) {
    return path.join(process.env.XDG_RUNTIME_DIR, 'codepol');
  }
  const uid =
    process.getuid && typeof process.getuid === 'function'
      ? String(process.getuid())
      : os.userInfo().username;
  return path.join(os.tmpdir(), `codepol-${uid}`);
}

async function main() {
  const args = argParse(process.argv.slice(2));

  if (!args.skipCopy) {
    bundleFilesValidate(args.bundleDir);
  }

  const extensionDir = args.extensionDir ?? extensionDirDiscover();
  if (!args.skipCopy) {
    if (!extensionDir) {
      console.warn(
        '[install-extension-dev] could not auto-discover installed extension dir. Pass --extension-dir <path> to copy the bundle; skipping copy.',
      );
    } else {
      const targetDir = bundleCopy(args.bundleDir, extensionDir);
      console.log(
        `[install-extension-dev] copied ${args.bundleDir} -> ${targetDir}`,
      );
    }
  }

  if (!args.skipDaemonKill) {
    await daemonTerminate(args.runtimeDir);
  }

  console.log(
    '[install-extension-dev] done. Reload the VSCode/Cursor window (Cmd+Shift+P -> Developer: Reload Window) to pick up the new bundle.',
  );
}

main().catch((error) => {
  console.error('[install-extension-dev] failed:', workspaceThrownMessageFromUnknown(error));
  process.exitCode = 1;
});
