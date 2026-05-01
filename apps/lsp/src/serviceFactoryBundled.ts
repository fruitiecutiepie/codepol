import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { diagnosticsRuntimeGet } from '@codepol/core';
import {
  WorkspaceDaemonServiceClient,
  workspaceDaemonLaunchOrConnect,
  WORKSPACE_DAEMON_BUILD_ID,
  WORKSPACE_DAEMON_PROTOCOL_VERSION,
  type WorkspaceDaemonConnectFn,
} from '@codepol/workspace-service/daemon';
import type { WorkspaceService } from '@codepol/workspace-service/contracts';

const nodeRequire = createRequire(__filename);
const daemonRequiredCapabilities = [
  'query_lint_rules',
  'query_lint_rule_details',
];

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
  const daemonEntry = daemonEntryPathResolve();
  diagnosticsRuntimeGet().getDiagnostics('lsp.daemon_spawn').info('lsp.daemon.spawn.begin', {
    execPath: process.execPath,
    daemonEntry,
    lspPid: process.pid,
  });
  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env, NODE_NO_WARNINGS: '1' },
  });
  diagnosticsRuntimeGet().getDiagnostics('lsp.daemon_spawn').info('lsp.daemon.spawn.end', {
    childPid: child.pid ?? null,
    daemonEntry,
  });
  child.unref();
}

function daemonMinStartedAtUnixMsResolve(): number | undefined {
  const daemonEntryPath = daemonEntryPathResolve();
  try {
    return Math.ceil(fs.statSync(daemonEntryPath).mtimeMs);
  } catch {
    return undefined;
  }
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
  const svcDiag = diagnosticsRuntimeGet().getDiagnostics('lsp.workspace_service');
  svcDiag.info('lsp.workspace_service.resolve.begin', {
    mode: 'daemon',
    clientInstanceId,
    runtimeDir: env.CODEPOL_DAEMON_RUNTIME_DIR ?? null,
    buildId: WORKSPACE_DAEMON_BUILD_ID,
  });
  const minStartedAtUnixMs = daemonMinStartedAtUnixMsResolve();
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
    expectedBuildId: WORKSPACE_DAEMON_BUILD_ID,
    requiredCapabilities: daemonRequiredCapabilities,
    minStartedAtUnixMs,
    connect: options.connect,
    startDaemon: options.startDaemon ?? (() => daemonProcessStart(env)),
  });

  svcDiag.info('lsp.workspace_service.resolve.daemon_ready', {
    launched: launched.launched,
    daemonPid: launched.descriptor.pid,
    socketPath: launched.descriptor.transport.path,
    buildId: launched.descriptor.buildId,
  });

  options.onResolved?.({
    mode: 'daemon',
    launched: launched.launched,
  });
  return new WorkspaceDaemonServiceClient(launched.connection);
}
