#!/usr/bin/env node

import {
  WorkspaceServiceEngine,
  policyCheck as workspacePolicyCheck,
  WORKSPACE_DAEMON_BUILD_ID,
  WORKSPACE_DAEMON_ENGINE_VERSION,
  workspaceDaemonServerStart,
  workspaceDaemonRuntimePathsResolve,
  workspaceWatcherCreate,
  workspaceWarmCacheEnvironmentIdCreate,
  workspaceWarmCacheFsStoreCreate,
} from '@codepol/workspace-service';

async function main(): Promise<void> {
  const runtimeDir = workspaceDaemonRuntimePathsResolve(
    process.env.CODEPOL_DAEMON_RUNTIME_DIR,
  ).runtimeDir;
  const server = await workspaceDaemonServerStart({
    service: new WorkspaceServiceEngine({
      backgroundWarmup: true,
      watcherCreate: workspaceWatcherCreate,
      warmCache: workspaceWarmCacheFsStoreCreate({
        runtimeDir,
        engineVersion: WORKSPACE_DAEMON_ENGINE_VERSION,
        buildId: WORKSPACE_DAEMON_BUILD_ID,
        environmentId: workspaceWarmCacheEnvironmentIdCreate(process.env),
      }),
    }),
    policyCheck: workspacePolicyCheck,
  });

  const shutdown = async (): Promise<void> => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    await server.stop();
    process.exit(0);
  };

  const onSigint = () => {
    void shutdown();
  };
  const onSigterm = () => {
    void shutdown();
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
