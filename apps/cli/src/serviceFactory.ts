import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  WorkspaceDaemonPolicyCheckClient,
  policyCheck as workspacePolicyCheck,
  workspaceDaemonLaunchOrConnect,
  WORKSPACE_DAEMON_PROTOCOL_VERSION,
  type WorkspaceDaemonConnectFn,
  type WorkspacePolicyCheckOptions,
  type WorkspacePolicyCheckResult,
} from '@codepol/workspace-service';

const nodeRequire = createRequire(__filename);

export type CliWorkspaceServiceMode = 'in_process' | 'daemon';
export type CliWorkspaceServiceResolvedInfo =
  | { mode: 'in_process' }
  | { mode: 'daemon'; launched: boolean }
  | { mode: 'in_process_fallback'; error: Error };

export type CliPolicyChecker = {
  policyCheck: (
    options: WorkspacePolicyCheckOptions,
  ) => Promise<WorkspacePolicyCheckResult>;
  close?: () => Promise<void>;
};

export function cliWorkspaceServiceModeGet(
  env: NodeJS.ProcessEnv = process.env,
): CliWorkspaceServiceMode {
  return env.CODEPOL_WORKSPACE_SERVICE_MODE === 'daemon'
    ? 'daemon'
    : 'in_process';
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

export async function cliPolicyCheckerResolve(options: {
  env?: NodeJS.ProcessEnv;
  clientInstanceId?: string;
  connect?: WorkspaceDaemonConnectFn;
  startDaemon?: () => Promise<void> | void;
  allowInProcessFallback?: boolean;
  onResolved?: (info: CliWorkspaceServiceResolvedInfo) => void;
} = {}): Promise<CliPolicyChecker> {
  const env = options.env ?? process.env;
  const mode = cliWorkspaceServiceModeGet(env);

  if (mode === 'in_process') {
    options.onResolved?.({ mode: 'in_process' });
    return {
      policyCheck: workspacePolicyCheck,
    };
  }

  const clientInstanceId = options.clientInstanceId ?? `codepol-cli-${process.pid}`;
  try {
    const launched = await workspaceDaemonLaunchOrConnect({
      client: {
        kind: 'cli',
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

    const client = new WorkspaceDaemonPolicyCheckClient(launched.connection);
    options.onResolved?.({
      mode: 'daemon',
      launched: launched.launched,
    });
    return {
      policyCheck: (policyOptions) => client.policyCheck(policyOptions),
      close: () => client.close(),
    };
  } catch (error) {
    const daemonError = errorAsError(error);
    if (options.allowInProcessFallback === false) {
      throw daemonError;
    }

    options.onResolved?.({
      mode: 'in_process_fallback',
      error: daemonError,
    });
    return {
      policyCheck: workspacePolicyCheck,
    };
  }
}
