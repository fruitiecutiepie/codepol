/**
 * Resolve an in-process {@link WorkspaceService} for CLI graph subcommands
 * and attach the project workspace so graph queries can run.
 *
 * Phase 4 of the architecture-graph work keeps the CLI `graph` family
 * independent of the daemon lifecycle. Each invocation spins up a fresh
 * {@link WorkspaceServiceEngine}, registers a CLI client session, and
 * tears everything down on `close()`. Daemon-backed graph queries are a
 * follow-up.
 */
import type { ClientSessionId } from '@codepol/core';
import {
  WorkspaceServiceEngine,
  builtinPluginsRefresh,
  ensureWorkspaceRuntimeReady,
  workspaceServiceCreate,
  type WorkspaceService,
} from '@codepol/workspace-service';

export type GraphWorkspaceSession = {
  service: WorkspaceService;
  clientSessionId: ClientSessionId;
  workspaceId: string;
  close: () => Promise<void>;
};

export async function graphWorkspaceSessionCreate(options: {
  cwd: string;
  configPath: string;
  clientInstanceId?: string;
}): Promise<GraphWorkspaceSession> {
  await ensureWorkspaceRuntimeReady();
  builtinPluginsRefresh();

  const service = workspaceServiceCreate({
    engine: new WorkspaceServiceEngine(),
  });

  const clientInstanceId = options.clientInstanceId ?? `codepol-cli-graph-${process.pid}`;
  const registered = await service.registerClientSession({
    clientKind: 'cli',
    clientInstanceId,
  });
  const attached = await service.attachWorkspace({
    clientSessionId: registered.clientSessionId,
    rootPath: options.cwd,
    configPath: options.configPath,
  });

  return {
    service,
    clientSessionId: registered.clientSessionId,
    workspaceId: attached.workspaceId,
    close: async () => {
      await service.closeClientSession({ clientSessionId: registered.clientSessionId });
    },
  };
}
