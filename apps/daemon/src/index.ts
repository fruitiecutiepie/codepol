#!/usr/bin/env node

import { diagnosticsRuntimeGet, diagnosticsRuntimeSetOverrides } from '@codepol/core';
import {
  WorkspaceServiceEngine,
  daemonExitOnFirstWasmAbortInstall,
  daemonSelfWatchEntryFileStart,
  policyCheck as workspacePolicyCheck,
  WORKSPACE_DAEMON_BUILD_ID,
  WORKSPACE_DAEMON_ENGINE_VERSION,
  workspaceDaemonDefaultCacheDirResolve,
  workspaceTypeAwareBridgeProviderResolve,
  workspaceDaemonServerStart,
  workspaceTypeAwareBridgeSourcesRegister,
  workspaceWatcherCreate,
  workspaceWarmCacheEnvironmentIdCreate,
  workspaceWarmCacheFsStoreCreate,
} from '@codepol/workspace-service';
import { workspaceTypeAwareBridgeProviderCreate } from '@codepol/type-aware-provider';

// Daemon uses stdout only incidentally; keep diagnostics on stderr like LSP.
diagnosticsRuntimeSetOverrides({ sinks: ['console'] });

async function main(): Promise<void> {
  const procDiag = diagnosticsRuntimeGet().getDiagnostics('daemon.process');
  procDiag.info('daemon.process.boot', {
    pid: process.pid,
    buildId: WORKSPACE_DAEMON_BUILD_ID,
    engineVersion: WORKSPACE_DAEMON_ENGINE_VERSION,
  });

  // A WASM abort permanently poisons the shared tree-sitter module for
  // this process. Exit so the LSP respawns a fresh daemon instead of
  // serving "Tree check failed / RuntimeError: Aborted()" forever.
  daemonExitOnFirstWasmAbortInstall();

  // If the bundled daemon.js on disk is replaced (e.g. `reinstall:
  // extension-vscode:dev`), terminate so the LSP's next request spawns
  // the new bundle instead of talking to this old process.
  daemonSelfWatchEntryFileStart({ entryPath: __filename });
  procDiag.info('daemon.process.self_watch', { entryPath: __filename });

  // Sockets / descriptor / lock live under the runtime dir
  // (CODEPOL_DAEMON_RUNTIME_DIR -> XDG_RUNTIME_DIR -> tmpdir), resolved
  // internally by workspaceDaemonServerStart. Warm-cache snapshots live
  // under a separate cache dir so they survive reboot on Linux desktops
  // where XDG_RUNTIME_DIR is tmpfs.
  const cacheDir = workspaceDaemonDefaultCacheDirResolve();
  procDiag.info('daemon.process.cache_dir', { cacheDir });

  procDiag.info('daemon.process.type_aware_provider.resolve.start', {});
  const typeAwareBridgeProvider = await workspaceTypeAwareBridgeProviderResolve({
    defaultProviderFactory: workspaceTypeAwareBridgeProviderCreate,
  });
  procDiag.info('daemon.process.type_aware_provider.resolve.end', {});

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
  procDiag.info('daemon.process.engine.created', {
    backgroundWarmup: true,
    warmCache: true,
  });

  workspaceTypeAwareBridgeSourcesRegister({
    engine,
    provider: typeAwareBridgeProvider,
  });

  const server = await workspaceDaemonServerStart({
    service: engine,
    policyCheck: workspacePolicyCheck,
  });

  procDiag.info('daemon.process.server.ready', {
    pid: process.pid,
    socketPath: server.paths.socketPath,
    buildId: server.descriptor.buildId,
    sessionNonce: server.descriptor.sessionNonce,
    daemonPid: server.descriptor.pid,
  });

  let shutdownSignal: 'SIGINT' | 'SIGTERM' | 'unknown' = 'unknown';

  const shutdown = async (): Promise<void> => {
    procDiag.info('daemon.process.shutdown.start', {
      signal: shutdownSignal,
      socketPath: server.paths.socketPath,
    });
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    try {
      await server.stop();
      procDiag.info('daemon.process.shutdown.end', { ok: true });
      process.exit(0);
    } catch (error) {
      procDiag.info('daemon.process.shutdown.end', {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  const onSigint = () => {
    shutdownSignal = 'SIGINT';
    void shutdown();
  };
  const onSigterm = () => {
    shutdownSignal = 'SIGTERM';
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
