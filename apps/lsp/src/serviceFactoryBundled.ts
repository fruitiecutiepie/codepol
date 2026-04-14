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

export type LspWorkspaceServiceResolvedInfo =
  | { mode: 'daemon'; launched: boolean };

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

export async function lspWorkspaceServiceResolve(options: {
  env?: NodeJS.ProcessEnv;
  clientInstanceId?: string;
  connect?: WorkspaceDaemonConnectFn;
  startDaemon?: () => Promise<void> | void;
  onResolved?: (info: LspWorkspaceServiceResolvedInfo) => void;
} = {}): Promise<WorkspaceService> {
  const env = options.env ?? process.env;
  const clientInstanceId = options.clientInstanceId ?? `codepol-lsp-${process.pid}`;
  const launched = await workspaceDaemonLaunchOrConnect({
    client: {
      kind: 'lsp',
      clientVersion: '1.0.0',
      instanceId: clientInstanceId,
      supportedProtocols: [WORKSPACE_DAEMON_PROTOCOL_VERSION],
      supportsFallbackModes: [],
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
}
