#!/usr/bin/env node

import {
  WorkspaceServiceEngine,
  daemonExitOnFirstWasmAbortInstall,
  daemonSelfWatchEntryFileStart,
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
  // A WASM abort permanently poisons the shared tree-sitter module for
  // this process. Exit so the LSP respawns a fresh daemon instead of
  // serving "Tree check failed / RuntimeError: Aborted()" forever.
  daemonExitOnFirstWasmAbortInstall();

  // If the bundled daemon.js on disk is replaced (e.g. `reinstall:
  // extension-vscode:dev`), terminate so the LSP's next request spawns
  // the new bundle instead of talking to this old process.
  daemonSelfWatchEntryFileStart({ entryPath: __filename });

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
