import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  WorkspaceDaemonServiceClient,
  WorkspaceServiceEngine,
  workspaceDaemonLaunchOrConnect,
  workspaceServiceCreate,
  WORKSPACE_DAEMON_PROTOCOL_VERSION,
  type WorkspaceDaemonConnectFn,
  type WorkspaceService,
} from '@codepol/workspace-service';

const nodeRequire = createRequire(__filename);

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

function errorAsError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        backgroundWarmup: true,
      }),
    });
    options.onResolved?.({ mode: 'in_process' });
    return service;
  }

  const clientInstanceId = options.clientInstanceId ?? `codepol-lsp-${process.pid}`;
  try {
    const launched = await workspaceDaemonLaunchOrConnect({
      client: {
        kind: 'lsp',
        clientVersion: '1.0.0',
        instanceId: clientInstanceId,
        supportedProtocols: [WORKSPACE_DAEMON_PROTOCOL_VERSION],
        supportsFallbackModes: ['in_process'],
      },
      runtimeDir: env.CODEPOL_DAEMON_RUNTIME_DIR,
      expectedInstallId: env.CODEPOL_INSTALL_ID,
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
    if (options.allowInProcessFallback === false) {
      throw daemonError;
    }

    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine({
        backgroundWarmup: true,
      }),
    });
    options.onResolved?.({
      mode: 'in_process_fallback',
      error: daemonError,
    });
    return service;
  }
}
