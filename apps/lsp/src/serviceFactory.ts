import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  WorkspaceDaemonServiceClient,
  workspaceDaemonLaunchOrConnect,
  WORKSPACE_DAEMON_PROTOCOL_VERSION,
  type WorkspaceDaemonConnectFn,
} from '@codepol/workspace-service/daemon';
import type { WorkspaceService } from '@codepol/workspace-service/contracts';

const nodeRequire = createRequire(__filename);
const runtimeBundled = process.env.CODEPOL_BUNDLED_RUNTIME === '1';
const daemonRequiredCapabilities = [
  'query_lint_rules',
  'query_lint_rule_details',
];
const daemonRuntimePackageIds = [
  '@codepol/daemon',
  '@codepol/workspace-service',
  '@codepol/core',
  '@codepol/plugin',
  '@codepol/plugin-biome',
  '@codepol/plugin-eslint',
  '@codepol/plugin-ruff',
  '@codepol/plugin-vulture',
];

export type LspWorkspaceServiceMode = 'in_process' | 'daemon';
export type LspWorkspaceServiceResolvedMode =
  | 'in_process'
  | 'daemon'
  | 'in_process_fallback';
export type LspWorkspaceServiceResolvedInfo =
  | { mode: 'in_process' }
  | { mode: 'daemon'; launched: boolean }
  | { mode: 'in_process_fallback'; error: Error };

export function lspWorkspaceServiceModeGet(
  env: NodeJS.ProcessEnv = process.env,
): LspWorkspaceServiceMode {
  return env.CODEPOL_WORKSPACE_SERVICE_MODE === 'in_process'
    ? 'in_process'
    : 'daemon';
}

function daemonEntryPathResolve(): string {
  const bundledDaemon = path.join(__dirname, 'daemon.js');
  if (fs.existsSync(bundledDaemon)) {
    return bundledDaemon;
  }
  return nodeRequire.resolve('@codepol/daemon');
}

function daemonProcessStart(env: NodeJS.ProcessEnv = process.env): void {
  const child = spawn(process.execPath, [daemonEntryPathResolve()], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env, NODE_NO_WARNINGS: '1' },
  });
  child.unref();
}

function packageRootFindFromEntry(moduleEntryPath: string, expectedName: string): string {
  let dir = path.dirname(moduleEntryPath);
  while (true) {
    const packageJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string };
        if (pkg.name === expectedName) {
          return dir;
        }
      } catch {
        // ignore invalid package metadata
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find package root for ${expectedName}`);
    }
    dir = parent;
  }
}

function packageFilesCollect(rootPath: string): string[] {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...packageFilesCollect(entryPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function packageArtifactPathsResolve(moduleSpecifier: string): string[] {
  try {
    const entry = nodeRequire.resolve(moduleSpecifier);
    const root = packageRootFindFromEntry(entry, moduleSpecifier);
    const candidates = [
      path.join(root, 'package.json'),
      ...(fs.existsSync(path.join(root, 'dist'))
        ? packageFilesCollect(path.join(root, 'dist'))
        : [entry]),
      ...(fs.existsSync(path.join(root, 'wasm'))
        ? packageFilesCollect(path.join(root, 'wasm'))
        : []),
    ];
    return [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
      .filter((candidate) => {
        try {
          return fs.statSync(candidate).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function daemonMinStartedAtUnixMsResolve(): number | undefined {
  const artifactPaths = daemonRuntimePackageIds.flatMap(packageArtifactPathsResolve);
  let newestMtimeMs = 0;
  for (const artifactPath of artifactPaths) {
    try {
      newestMtimeMs = Math.max(newestMtimeMs, fs.statSync(artifactPath).mtimeMs);
    } catch {
      // ignore raced fs reads
    }
  }
  return newestMtimeMs > 0 ? Math.ceil(newestMtimeMs) : undefined;
}

function errorAsError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function workspaceServiceInProcessCreate(): Promise<WorkspaceService> {
  const runtime = await import('@codepol/workspace-service');
  return runtime.workspaceServiceCreate({
    engine: new runtime.WorkspaceServiceEngine({
      backgroundWarmup: true,
    }),
  });
}

export async function lspWorkspaceServiceResolve(options: {
  env?: NodeJS.ProcessEnv;
  clientInstanceId?: string;
  connect?: WorkspaceDaemonConnectFn;
  startDaemon?: () => Promise<void> | void;
  allowInProcessFallback?: boolean;
  onResolved?: (info: LspWorkspaceServiceResolvedInfo) => void;
} = {}): Promise<WorkspaceService> {
  const env = options.env ?? process.env;
  const mode = lspWorkspaceServiceModeGet(env);

  if (mode === 'in_process') {
    if (runtimeBundled) {
      throw new Error('CODEPOL_WORKSPACE_SERVICE_MODE=in_process is unavailable in the bundled runtime');
    }
    const service = await workspaceServiceInProcessCreate();
    options.onResolved?.({ mode: 'in_process' });
    return service;
  }

  const clientInstanceId = options.clientInstanceId ?? `codepol-lsp-${process.pid}`;
  try {
    const minStartedAtUnixMs = daemonMinStartedAtUnixMsResolve();
    const launched = await workspaceDaemonLaunchOrConnect({
      client: {
        kind: 'lsp',
        clientVersion: '1.0.0',
        instanceId: clientInstanceId,
        supportedProtocols: [WORKSPACE_DAEMON_PROTOCOL_VERSION],
        supportsFallbackModes: runtimeBundled ? [] : ['in_process'],
      },
      runtimeDir: env.CODEPOL_DAEMON_RUNTIME_DIR,
      expectedInstallId: env.CODEPOL_INSTALL_ID,
      requiredCapabilities: daemonRequiredCapabilities,
      minStartedAtUnixMs,
      connect: options.connect,
      startDaemon: options.startDaemon ?? (() => daemonProcessStart(env)),
    });

    options.onResolved?.({
      mode: 'daemon',
      launched: launched.launched,
    });
    return new WorkspaceDaemonServiceClient(launched.connection);
  } catch (error) {
    const daemonError = errorAsError(error);
    if (options.allowInProcessFallback === false || runtimeBundled) {
      throw daemonError;
    }

    const service = await workspaceServiceInProcessCreate();
    options.onResolved?.({
      mode: 'in_process_fallback',
      error: daemonError,
    });
    return service;
  }
}
