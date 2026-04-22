#!/usr/bin/env node

import {
  WorkspaceServiceEngine,
  daemonExitOnFirstWasmAbortInstall,
  daemonSelfWatchEntryFileStart,
  policyCheck as workspacePolicyCheck,
  WORKSPACE_DAEMON_BUILD_ID,
  WORKSPACE_DAEMON_ENGINE_VERSION,
  workspaceDaemonDefaultCacheDirResolve,
  workspaceDaemonServerStart,
  workspaceTypeAwareBridgeSourcesRegister,
  workspaceTypeAwareBridgeTransportsResolve,
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

  // Sockets / descriptor / lock live under the runtime dir
  // (CODEPOL_DAEMON_RUNTIME_DIR -> XDG_RUNTIME_DIR -> tmpdir), resolved
  // internally by workspaceDaemonServerStart. Warm-cache snapshots live
  // under a separate cache dir so they survive reboot on Linux desktops
  // where XDG_RUNTIME_DIR is tmpfs.
  const cacheDir = workspaceDaemonDefaultCacheDirResolve();
  const typeAwareBridgeTransports = await workspaceTypeAwareBridgeTransportsResolve();
  const engine = new WorkspaceServiceEngine({
    backgroundWarmup: true,
    watcherCreate: workspaceWatcherCreate,
    warmCache: workspaceWarmCacheFsStoreCreate({
      cacheDir,
      engineVersion: WORKSPACE_DAEMON_ENGINE_VERSION,
      buildId: WORKSPACE_DAEMON_BUILD_ID,
      environmentId: workspaceWarmCacheEnvironmentIdCreate(process.env),
    }),
  });
  workspaceTypeAwareBridgeSourcesRegister({
    engine,
    transports: typeAwareBridgeTransports,
  });

  const server = await workspaceDaemonServerStart({
    service: engine,
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
