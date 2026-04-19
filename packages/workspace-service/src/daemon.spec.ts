import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pluginModuleRegister,
  pluginRuleNew,
  treeCheckProviderNew,
  workspacePathToUri,
} from '@codepol/core';
import type {
  WorkspaceDaemonConnectFn,
  WorkspaceDaemonDescriptor,
  WorkspaceDaemonRequestClient,
} from './daemon.js';
import {
  workspaceDaemonDescriptorCreate,
  workspaceDaemonDescriptorRead,
  workspaceDaemonDescriptorWrite,
  workspaceDaemonHello,
  workspaceDaemonLaunchOrConnect,
  workspaceDaemonRuntimePathsResolve,
  workspaceDaemonServerStart,
  WorkspaceDaemonServiceClient,
  WorkspaceDaemonSession,
  WORKSPACE_DAEMON_PROTOCOL_VERSION,
} from './daemon.js';
import {
  WorkspaceServiceEngine,
  workspaceWarmCacheFsStoreCreate,
  type WorkspaceService,
  type WorkspaceWatcherCreate,
} from './index.js';

function tempRuntimeDirCreate(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-'));
}

function clientIdentityCreate(
  instanceId: string,
  options: {
    supportedProtocols?: string[];
  } = {},
) {
  return {
    kind: 'test',
    clientVersion: '1.0.0',
    instanceId,
    supportedProtocols: options.supportedProtocols ?? [WORKSPACE_DAEMON_PROTOCOL_VERSION],
    supportsFallbackModes: ['in_process'],
  };
}

function noInterfaceConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-interface"
targets = ["src"]
`;
}

function unusedExportsConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-unused-exports"
targets = ["src"]
`;
}

function pluginRuleConfigContentCreate(input: {
  pluginId: string;
  ruleId: string;
}): string {
  return `[[plugins]]
id = "${input.pluginId}"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "${input.pluginId}/${input.ruleId}"
targets = ["src"]
`;
}

function mockBiomeDiagnosticScriptCreate(
  projectDir: string,
  options: {
    diagnostic: {
      code: string;
      filePath: string;
      message: string;
    };
    fileName?: string;
  },
): string {
  const biomeBin = path.join(
    projectDir,
    options.fileName ?? 'mock-biome-diagnostic.cjs',
  );
  const diagnostic = {
    code: {
      value: options.diagnostic.code,
    },
    location: {
      path: options.diagnostic.filePath,
      range: {
        start: { line: 0, column: 0 },
        end: { line: 0, column: 5 },
      },
    },
    message: options.diagnostic.message,
  };
  fs.writeFileSync(
    biomeBin,
    `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(JSON.stringify({ diagnostics: [diagnostic] }))});
process.exit(0);
`,
    'utf8',
  );
  fs.chmodSync(biomeBin, 0o755);
  return biomeBin;
}

function mockBiomeBlockingScriptCreate(
  projectDir: string,
  options: {
    markerPath: string;
    fileName?: string;
  },
): string {
  const biomeBin = path.join(
    projectDir,
    options.fileName ?? 'mock-biome-blocking.cjs',
  );
  fs.writeFileSync(
    biomeBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const markerPath = ${JSON.stringify(options.markerPath)};
let settled = false;
fs.writeFileSync(markerPath, 'started', 'utf8');
function finish(state) {
  if (settled) {
    return;
  }
  settled = true;
  fs.writeFileSync(markerPath, state, 'utf8');
  process.exit(state === 'aborted' ? 143 : 0);
}
process.on('SIGTERM', () => finish('aborted'));
setTimeout(() => {
  process.stdout.write(JSON.stringify({ diagnostics: [] }));
  finish('completed');
}, 5000);
`,
    'utf8',
  );
  fs.chmodSync(biomeBin, 0o755);
  return biomeBin;
}

async function fileContentsWaitFor(
  filePath: string,
  options: {
    attempts?: number;
    delayMs?: number;
    expected?: string;
  } = {},
): Promise<string | undefined> {
  const attempts = options.attempts ?? 40;
  const delayMs = options.delayMs ?? 25;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const contents = fs.readFileSync(filePath, 'utf8');
      if (options.expected === undefined || contents === options.expected) {
        return contents;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    if (options.expected === undefined || contents === options.expected) {
      return contents;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function analyzerScorecardGet(
  engine: WorkspaceServiceEngine,
  input: {
    clientSessionId: string;
    workspaceId: string;
  },
): Array<{
  analyzerId: string;
  platform: string;
  status: string;
  ownedRuleIds: string[];
  skippedRuleIds: string[];
  skippedReason?: string;
}> {
  const debugEngine = engine as unknown as {
    clientSessions: Map<
      string,
      {
        workspaces: Map<
          string,
          {
            lastAnalysis?: {
              analyzerScorecard?: Array<{
                analyzerId: string;
                platform: string;
                status: string;
                ownedRuleIds: string[];
                skippedRuleIds: string[];
                skippedReason?: string;
              }>;
            };
          }
        >;
      }
    >;
  };
  return (
    debugEngine.clientSessions
      .get(input.clientSessionId)
      ?.workspaces.get(input.workspaceId)
      ?.lastAnalysis?.analyzerScorecard ?? []
  );
}

function analyzerInventoryGet(
  engine: WorkspaceServiceEngine,
  input: {
    clientSessionId: string;
    workspaceId: string;
  },
): Array<{
  ruleId: string;
  wrappedPlatforms: string[];
  hasNativeOwner: boolean;
  ownership: string;
}> {
  const debugEngine = engine as unknown as {
    clientSessions: Map<
      string,
      {
        workspaces: Map<
          string,
          {
            lastAnalysis?: {
              analyzerInventory?: Array<{
                ruleId: string;
                wrappedPlatforms: string[];
                hasNativeOwner: boolean;
                ownership: string;
              }>;
            };
          }
        >;
      }
    >;
  };
  return (
    debugEngine.clientSessions
      .get(input.clientSessionId)
      ?.workspaces.get(input.workspaceId)
      ?.lastAnalysis?.analyzerInventory ?? []
  );
}

function workspaceWatcherStubCreate(): {
  watcherCreate: WorkspaceWatcherCreate;
  trigger: (eventName: string, filePath: string) => void;
  triggerError: (error: Error) => void;
} {
  let listener: ((eventName: string, filePath: string) => void) | undefined;
  let errorListener: ((error: Error) => void) | undefined;
  const watcher = {
    on(
      event: 'all' | 'error',
      nextListener: ((eventName: string, filePath: string) => void) | ((error: Error) => void),
    ) {
      if (event === 'all') {
        listener = nextListener as (eventName: string, filePath: string) => void;
      } else {
        errorListener = nextListener as (error: Error) => void;
      }
      return watcher;
    },
    async close() {},
  };
  return {
    watcherCreate: () => watcher,
    trigger(eventName: string, filePath: string) {
      listener?.(eventName, filePath);
    },
    triggerError(error: Error) {
      errorListener?.(error);
    },
  };
}

function backgroundTaskQueueCreate(): {
  schedule: (task: () => Promise<void>) => void;
  pendingCountGet: () => number;
  runNext: () => Promise<void>;
} {
  const tasks: Array<() => Promise<void>> = [];
  return {
    schedule(task) {
      tasks.push(task);
    },
    pendingCountGet() {
      return tasks.length;
    },
    async runNext() {
      const next = tasks.shift();
      if (!next) {
        throw new Error('No background task queued');
      }
      await next();
    },
  };
}

function workspaceReadQueriesStubCreate(): Pick<
  WorkspaceService,
  | 'queryLintRules'
  | 'queryLintRuleDetails'
  | 'queryWorkspaceSymbols'
  | 'queryDependencyGraph'
  | 'queryImpactRadius'
  | 'queryDependencyPath'
  | 'queryDeadModules'
  | 'queryDependencyDiff'
  | 'queryCallGraph'
  | 'queryTypeHierarchy'
  | 'querySymbolFlow'
  | 'querySemanticSearch'
  | 'querySemanticDefinition'
  | 'querySemanticReferences'
  | 'querySemanticHover'
  | 'prepareRename'
  | 'previewRename'
  | 'queryArchitectureSummary'
  | 'querySymbolLookup'
  | 'querySymbolAtPosition'
  | 'querySymbolsInFileWithCallCounts'
  | 'queryImportSpecifiersInFile'
  | 'planSourceFixAll'
  | 'planFileFixAll'
> {
  return {
    async queryLintRules() {
      return {
        analysisGeneration: 0,
        workspaceReady: false,
        rules: [],
      };
    },
    async queryLintRuleDetails() {
      return null;
    },
    async queryWorkspaceSymbols() {
      return [];
    },
    async queryDependencyGraph() {
      return {
        nodes: [],
        edges: [],
        entryPoints: [],
        cycles: [],
      };
    },
    async queryImpactRadius() {
      return {
        nodes: [],
        edges: [],
        entryPoints: [],
        cycles: [],
      };
    },
    async queryDependencyPath() {
      return {
        paths: [],
        shortestLength: 0,
        truncated: false,
      };
    },
    async queryDeadModules() {
      return {
        unreachable: [],
      };
    },
    async queryDependencyDiff(input) {
      return {
        workspaceId: input.workspaceId,
        currentAnalysisGeneration: 0,
        addedNodes: [],
        removedNodes: [],
        addedEdges: [],
        removedEdges: [],
        newCycles: [],
        removedCycles: [],
      };
    },
    async queryCallGraph() {
      return {
        nodes: [],
        edges: [],
        entryPoints: [],
        cycles: [],
      };
    },
    async queryTypeHierarchy() {
      return {
        nodes: [],
        edges: [],
        entryPoints: [],
        cycles: [],
      };
    },
    async querySymbolFlow() {
      return {
        edges: [],
      };
    },
    async querySemanticSearch() {
      return [];
    },
    async querySemanticDefinition() {
      return null;
    },
    async querySemanticReferences() {
      return null;
    },
    async querySemanticHover() {
      return null;
    },
    async prepareRename() {
      return {
        ok: false,
        code: 'unsupported_context',
        message: 'Rename foundations are wired, but no rename registry is available yet.',
      };
    },
    async previewRename() {
      return {
        ok: false,
        code: 'unsupported_context',
        message: 'Rename foundations are wired, but no rename registry is available yet.',
      };
    },
    async queryArchitectureSummary() {
      return {
        summary: '',
        indexedFileCount: 0,
        symbolCount: 0,
        scopeCount: 0,
        relationCount: 0,
        entryPointCount: 0,
        cycleCount: 0,
        hotspots: [],
      };
    },
    async querySymbolLookup() {
      return { symbols: [] };
    },
    async querySymbolAtPosition() {
      return { symbol: undefined };
    },
    async querySymbolsInFileWithCallCounts() {
      return { items: [] };
    },
    async queryImportSpecifiersInFile() {
      return { specifiers: [] };
    },
    async planSourceFixAll() {
      return null;
    },
    async planFileFixAll() {
      return null;
    },
  };
}

describe('workspace daemon control plane', () => {
  const tempDirs: string[] = [];
  const liveDaemons = new Map<
    string,
    { descriptor: WorkspaceDaemonDescriptor; service?: WorkspaceServiceEngine }
  >();

  afterEach(() => {
    vi.restoreAllMocks();
    liveDaemons.clear();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const connect: WorkspaceDaemonConnectFn = async (
    descriptor: WorkspaceDaemonDescriptor,
  ): Promise<WorkspaceDaemonRequestClient> => {
    const live = liveDaemons.get(descriptor.transport.path);
    if (!live || live.descriptor.sessionNonce !== descriptor.sessionNonce) {
      throw new Error('daemon unavailable');
    }

    const session = new WorkspaceDaemonSession({
      descriptor: live.descriptor,
      service: live.service,
    });

    return {
      async request<TResponse extends Record<string, unknown>>(
        message: Parameters<WorkspaceDaemonRequestClient['request']>[0],
      ): Promise<TResponse> {
        const response = await session.handleMessage(message);
        if (response.type === 'error') {
          throw new Error(response.message);
        }
        return response as unknown as TResponse;
      },
      async close(): Promise<void> {},
    };
  };

  async function daemonServiceClientCreate(input: {
    descriptor: WorkspaceDaemonDescriptor;
    clientInstanceId: string;
  }): Promise<WorkspaceDaemonServiceClient> {
    const connection = await connect(input.descriptor);
    await workspaceDaemonHello({
      connection,
      client: clientIdentityCreate(input.clientInstanceId),
    });
    return new WorkspaceDaemonServiceClient(connection);
  }

  async function daemonReadWorkspaceCreate(): Promise<{
    service: WorkspaceDaemonServiceClient;
    registered: Awaited<
      ReturnType<WorkspaceDaemonServiceClient['registerClientSession']>
    >;
    attached: Awaited<
      ReturnType<WorkspaceDaemonServiceClient['attachWorkspace']>
    >;
    sharedUri: string;
  }> {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const sharedPath = path.join(workspaceRoot, 'src', 'shared.ts');
    const appPath = path.join(workspaceRoot, 'src', 'app.ts');
    const sharedUri = workspacePathToUri(sharedPath);
    fs.writeFileSync(sharedPath, 'export const sharedValue = 1;\n', 'utf8');
    fs.writeFileSync(
      appPath,
      "import { sharedValue } from './shared';\nexport const appValue = sharedValue;\n",
      'utf8',
    );

    const descriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    liveDaemons.set(descriptor.transport.path, {
      descriptor,
      service: new WorkspaceServiceEngine(),
    });

    const clientInstanceId = `daemon-read-client-${randomUUID()}`;
    const clientSessionId = `daemon-read-session-${randomUUID()}`;
    const service = await daemonServiceClientCreate({
      descriptor,
      clientInstanceId,
    });
    const registered = await service.registerClientSession({
      clientKind: 'test',
      clientInstanceId,
      clientSessionId,
    });
    const attached = await service.attachWorkspace({
      clientSessionId: registered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    await service.completeReplay({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
    });

    return {
      service,
      registered,
      attached,
      sharedUri,
    };
  }

  it('persists the runtime descriptor and serves the hello contract', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    liveDaemons.set(descriptor.transport.path, { descriptor });

    const persisted = workspaceDaemonDescriptorRead(runtimeDir);
    expect(persisted).toMatchObject({
      protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
      sessionNonce: descriptor.sessionNonce,
      transport: {
        kind: 'unix_socket',
        path: descriptor.transport.path,
      },
    });

    const launched = await workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('hello-client'),
      connect,
      startDaemon: async () => {
        throw new Error('startDaemon should not run for a healthy descriptor');
      },
    });

    expect(launched.launched).toBe(false);
    expect(launched.hello.compatibility).toBe('ok');
    expect(launched.hello.daemon.sessionNonce).toBe(descriptor.sessionNonce);
    await launched.connection.close();
  });

  it('fails fast on unsupported protocol without attempting relaunch', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    liveDaemons.set(descriptor.transport.path, { descriptor });

    let startDaemonCalls = 0;
    await expect(
      workspaceDaemonLaunchOrConnect({
        runtimeDir,
        client: clientIdentityCreate('unsupported-protocol-client', {
          supportedProtocols: ['0.0'],
        }),
        connect,
        startDaemon: async () => {
          startDaemonCalls += 1;
        },
      }),
    ).rejects.toThrow('Daemon handshake failed: unsupported_protocol');
    expect(startDaemonCalls).toBe(0);
  });

  it('relaunches when the existing daemon has an unexpected install id', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const staleDescriptor = workspaceDaemonDescriptorCreate({
      runtimeDir,
      installId: 'stable',
    }).descriptor;
    workspaceDaemonDescriptorWrite(runtimeDir, staleDescriptor);
    liveDaemons.set(staleDescriptor.transport.path, { descriptor: staleDescriptor });

    let startedDescriptor: WorkspaceDaemonDescriptor | undefined;
    const launched = await workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('unexpected-install-client'),
      expectedInstallId: 'insiders',
      connect,
      startDaemon: async () => {
        const created = workspaceDaemonDescriptorCreate({
          runtimeDir,
          installId: 'insiders',
        });
        startedDescriptor = created.descriptor;
        workspaceDaemonDescriptorWrite(runtimeDir, created.descriptor);
        liveDaemons.set(created.descriptor.transport.path, {
          descriptor: created.descriptor,
        });
      },
    });

    expect(launched.launched).toBe(true);
    expect(startedDescriptor).toBeDefined();
    expect(launched.descriptor.installId).toBe('insiders');
    expect(launched.descriptor.sessionNonce).toBe(startedDescriptor?.sessionNonce);
    expect(launched.descriptor.sessionNonce).not.toBe(staleDescriptor.sessionNonce);
    await launched.connection.close();
  });

  it('requires hello before service RPC and serves the current workspace-service surface after handshake', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noInterfaceConfigContentCreate(),
      'utf8',
    );

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const engine = new WorkspaceServiceEngine();
    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    liveDaemons.set(descriptor.transport.path, { descriptor, service: engine });

    const connection = await connect(descriptor);
    await expect(
      connection.request({
        type: 'register_client_session',
        clientKind: 'test',
        clientInstanceId: 'before-hello',
      }),
    ).rejects.toThrow('hello handshake required');

    await workspaceDaemonHello({
      connection,
      client: clientIdentityCreate('service-client'),
    });

    const service = new WorkspaceDaemonServiceClient(connection);
    const registered = await service.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'rpc-client',
      clientSessionId: 'daemon-stable-client',
    });
    const repeated = await service.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'rpc-client',
      clientSessionId: 'daemon-stable-client',
    });
    const attached = await service.attachWorkspace({
      clientSessionId: registered.clientSessionId,
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    const diagnosticsSubscription = await service.subscribeDiagnostics({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      scope: 'workspace',
    });
    const repeatedDiagnosticsSubscription = await service.subscribeDiagnostics({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      scope: 'workspace',
    });
    await expect(
      service.queryDiagnostics({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        uri,
      }),
    ).rejects.toThrow('complete_replay required');
    const replay = await service.completeReplay({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
    });
    const indexStatus = await service.queryIndexStatus({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
    });
    const diagnostics = await service.queryDiagnostics({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri,
    });

    expect(registered.daemonSessionId).toBeDefined();
    expect(registered.clientSessionId).toBe('daemon-stable-client');
    expect(repeated).toEqual(registered);
    expect(diagnosticsSubscription).toEqual({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      scope: 'workspace',
      subscriptionState: 'active',
    });
    expect(repeatedDiagnosticsSubscription).toEqual(diagnosticsSubscription);
    expect(replay).toEqual({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      replayEpoch: 1,
      replayState: 'applied',
    });
    expect(indexStatus).toMatchObject({
      daemonSessionId: registered.daemonSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'cold',
      replayState: 'applied',
      replayEpoch: 1,
      workspaceReady: false,
      featureStatus: {
        diagnostics: { readiness: 'cold' },
        codeActions: { readiness: 'cold' },
        editPlans: { readiness: 'cold' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
    });
    expect(attached.workspaceInstanceId).toBeDefined();
    expect(diagnostics).toHaveLength(1);

    await service.close();
  });

  it('shares daemon workspace base state across client sessions while keeping overlays isolated', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const engine = new WorkspaceServiceEngine();
    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    liveDaemons.set(descriptor.transport.path, { descriptor, service: engine });

    const writer = await daemonServiceClientCreate({
      descriptor,
      clientInstanceId: 'daemon-overlay-writer',
    });
    const reader = await daemonServiceClientCreate({
      descriptor,
      clientInstanceId: 'daemon-overlay-reader',
    });

    const writerRegistered = await writer.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-overlay-writer',
      clientSessionId: 'daemon-overlay-writer-session',
    });
    const readerRegistered = await reader.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-overlay-reader',
      clientSessionId: 'daemon-overlay-reader-session',
    });

    const writerAttached = await writer.attachWorkspace({
      clientSessionId: writerRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    const readerAttached = await reader.attachWorkspace({
      clientSessionId: readerRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });

    expect(readerAttached.workspaceId).toBe(writerAttached.workspaceId);
    expect(readerAttached.workspaceInstanceId).toBe(writerAttached.workspaceInstanceId);

    await writer.completeReplay({
      clientSessionId: writerRegistered.clientSessionId,
      workspaceId: writerAttached.workspaceId,
      workspaceInstanceId: writerAttached.workspaceInstanceId,
    });
    await reader.completeReplay({
      clientSessionId: readerRegistered.clientSessionId,
      workspaceId: readerAttached.workspaceId,
      workspaceInstanceId: readerAttached.workspaceInstanceId,
    });

    expect(
      await writer.queryDiagnostics({
        clientSessionId: writerRegistered.clientSessionId,
        workspaceId: writerAttached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);
    expect(
      await reader.queryDiagnostics({
        clientSessionId: readerRegistered.clientSessionId,
        workspaceId: readerAttached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);

    await writer.openOverlay({
      clientSessionId: writerRegistered.clientSessionId,
      workspaceId: writerAttached.workspaceId,
      uri,
      version: 1,
      text: 'export type User = {\n  name: string;\n};\n',
    });

    expect(
      await writer.queryDiagnostics({
        clientSessionId: writerRegistered.clientSessionId,
        workspaceId: writerAttached.workspaceId,
        uri,
      }),
    ).toEqual([]);
    expect(
      await reader.queryDiagnostics({
        clientSessionId: readerRegistered.clientSessionId,
        workspaceId: readerAttached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);

    await reader.openOverlay({
      clientSessionId: readerRegistered.clientSessionId,
      workspaceId: readerAttached.workspaceId,
      uri,
      version: 1,
      text: 'export interface User {\n  name: string;\n  age: number;\n}\n',
    });

    expect(
      await writer.queryDiagnostics({
        clientSessionId: writerRegistered.clientSessionId,
        workspaceId: writerAttached.workspaceId,
        uri,
      }),
    ).toEqual([]);
    expect(
      await reader.queryDiagnostics({
        clientSessionId: readerRegistered.clientSessionId,
        workspaceId: readerAttached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);

    await writer.close();
    await reader.close();
  });

  it('rebuilds shared daemon base state after a watched disk invalidation without leaking overlays', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const watcher = workspaceWatcherStubCreate();
    const engine = new WorkspaceServiceEngine({
      watcherCreate: watcher.watcherCreate,
    });
    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    liveDaemons.set(descriptor.transport.path, { descriptor, service: engine });

    const writer = await daemonServiceClientCreate({
      descriptor,
      clientInstanceId: 'daemon-watch-writer',
    });
    const reader = await daemonServiceClientCreate({
      descriptor,
      clientInstanceId: 'daemon-watch-reader',
    });

    const writerRegistered = await writer.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-watch-writer',
      clientSessionId: 'daemon-watch-writer-session',
    });
    const readerRegistered = await reader.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-watch-reader',
      clientSessionId: 'daemon-watch-reader-session',
    });

    const writerAttached = await writer.attachWorkspace({
      clientSessionId: writerRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    const readerAttached = await reader.attachWorkspace({
      clientSessionId: readerRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });

    expect(readerAttached.workspaceId).toBe(writerAttached.workspaceId);
    expect(readerAttached.workspaceInstanceId).toBe(writerAttached.workspaceInstanceId);

    await writer.completeReplay({
      clientSessionId: writerRegistered.clientSessionId,
      workspaceId: writerAttached.workspaceId,
      workspaceInstanceId: writerAttached.workspaceInstanceId,
    });
    await reader.completeReplay({
      clientSessionId: readerRegistered.clientSessionId,
      workspaceId: readerAttached.workspaceId,
      workspaceInstanceId: readerAttached.workspaceInstanceId,
    });

    expect(
      await reader.queryDiagnostics({
        clientSessionId: readerRegistered.clientSessionId,
        workspaceId: readerAttached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);
    expect(
      await reader.queryIndexStatus({
        clientSessionId: readerRegistered.clientSessionId,
        workspaceId: readerAttached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: readerAttached.workspaceId,
      workspaceInstanceId: readerAttached.workspaceInstanceId,
      status: 'ready',
      replayState: 'applied',
      analysisGeneration: 1,
    });

    await writer.openOverlay({
      clientSessionId: writerRegistered.clientSessionId,
      workspaceId: writerAttached.workspaceId,
      uri,
      version: 1,
      text: 'export interface User {\n  name: string;\n  age: number;\n}\n',
    });

    fs.writeFileSync(
      filePath,
      'export type User = {\n  name: string;\n};\n',
      'utf8',
    );
    watcher.trigger('change', filePath);

    expect(
      await reader.queryIndexStatus({
        clientSessionId: readerRegistered.clientSessionId,
        workspaceId: readerAttached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: readerAttached.workspaceId,
      workspaceInstanceId: readerAttached.workspaceInstanceId,
      status: 'cold',
      replayState: 'applied',
      analysisGeneration: 1,
    });

    expect(
      await reader.queryDiagnostics({
        clientSessionId: readerRegistered.clientSessionId,
        workspaceId: readerAttached.workspaceId,
        uri,
      }),
    ).toEqual([]);
    expect(
      await reader.queryIndexStatus({
        clientSessionId: readerRegistered.clientSessionId,
        workspaceId: readerAttached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: readerAttached.workspaceId,
      workspaceInstanceId: readerAttached.workspaceInstanceId,
      status: 'ready',
      replayState: 'applied',
      analysisGeneration: 2,
    });

    const writerDiagnostics = await writer.queryDiagnostics({
      clientSessionId: writerRegistered.clientSessionId,
      workspaceId: writerAttached.workspaceId,
      uri,
    });
    expect(writerDiagnostics).toHaveLength(1);
    expect(writerDiagnostics[0]?.code).toBe('@codepol/plugin/no-interface');

    await writer.close();
    await reader.close();
  });

  it('keeps the daemon session alive when the workspace watcher emits an error', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-watcher-error-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.writeFileSync(filePath, 'export const ready = true;\n', 'utf8');

    const watcher = workspaceWatcherStubCreate();
    const engine = new WorkspaceServiceEngine({
      watcherCreate: watcher.watcherCreate,
    });
    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    liveDaemons.set(descriptor.transport.path, { descriptor, service: engine });

    const client = await daemonServiceClientCreate({
      descriptor,
      clientInstanceId: 'daemon-watch-error-client',
    });
    const registered = await client.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-watch-error-client',
      clientSessionId: 'daemon-watch-error-session',
    });
    const attached = await client.attachWorkspace({
      clientSessionId: registered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    await client.completeReplay({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
    });

    watcher.triggerError(new Error('watch backend dropped'));

    await expect(
      client.queryIndexStatus({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).resolves.toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      replayState: 'applied',
    });

    await client.close();
  });

  it('reports replay pending and background warm-up status through the daemon workspace lifecycle', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const backgroundTasks = backgroundTaskQueueCreate();
    const engine = new WorkspaceServiceEngine({
      backgroundWarmup: true,
      backgroundTaskSchedule: backgroundTasks.schedule,
    });
    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    liveDaemons.set(descriptor.transport.path, { descriptor, service: engine });

    const service = await daemonServiceClientCreate({
      descriptor,
      clientInstanceId: 'daemon-background-warmup-client',
    });
    const registered = await service.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-background-warmup-client',
      clientSessionId: 'daemon-background-warmup-session',
    });
    const attached = await service.attachWorkspace({
      clientSessionId: registered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });

    expect(
      await service.queryIndexStatus({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'cold',
      replayState: 'pending',
      replayEpoch: 0,
      workspaceReady: false,
      analysisGeneration: 0,
      featureStatus: {
        diagnostics: { readiness: 'cold' },
        codeActions: { readiness: 'cold' },
        editPlans: { readiness: 'cold' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
    });

    await service.completeReplay({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
    });

    expect(backgroundTasks.pendingCountGet()).toBe(1);
    expect(
      await service.queryIndexStatus({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'warming',
      replayState: 'applied',
      replayEpoch: 1,
      workspaceReady: false,
      analysisGeneration: 0,
      featureStatus: {
        diagnostics: { readiness: 'warming' },
        codeActions: { readiness: 'warming' },
        editPlans: { readiness: 'warming' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
    });

    await backgroundTasks.runNext();

    expect(
      await service.queryIndexStatus({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
      status: 'ready',
      replayState: 'applied',
      replayEpoch: 1,
      workspaceReady: true,
      analysisGeneration: 1,
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
    });
    expect(
      await service.queryDiagnostics({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);

    await service.close();
  });

  it('restores a warm cache across daemon incarnations and lets replayed overlays win over it', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(
      filePath,
      'export interface User {\n  name: string;\n}\n',
      'utf8',
    );

    const warmCache = workspaceWarmCacheFsStoreCreate({ cacheDir: runtimeDir });
    const firstDescriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    liveDaemons.set(firstDescriptor.transport.path, {
      descriptor: firstDescriptor,
      service: new WorkspaceServiceEngine({ warmCache }),
    });

    const firstService = await daemonServiceClientCreate({
      descriptor: firstDescriptor,
      clientInstanceId: 'daemon-warm-cache-writer',
    });
    const firstRegistered = await firstService.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-warm-cache-writer',
      clientSessionId: 'daemon-warm-cache-writer-session',
    });
    const firstAttached = await firstService.attachWorkspace({
      clientSessionId: firstRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    await firstService.subscribeDiagnostics({
      clientSessionId: firstRegistered.clientSessionId,
      workspaceId: firstAttached.workspaceId,
      workspaceInstanceId: firstAttached.workspaceInstanceId,
      scope: 'workspace',
    });
    await firstService.completeReplay({
      clientSessionId: firstRegistered.clientSessionId,
      workspaceId: firstAttached.workspaceId,
      workspaceInstanceId: firstAttached.workspaceInstanceId,
    });

    expect(
      await firstService.queryDiagnostics({
        clientSessionId: firstRegistered.clientSessionId,
        workspaceId: firstAttached.workspaceId,
        uri,
      }),
    ).toHaveLength(1);
    // Explicit close so the engine flushes the debounced warm-cache persist
    // before we drop the connection. Pre-debounce, persist was synchronous;
    // now the engine schedules a 2s timer that the disposing connection
    // race could otherwise bypass.
    await firstService.closeClientSession({
      clientSessionId: firstRegistered.clientSessionId,
    });
    await firstService.close();

    const secondDescriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    liveDaemons.set(secondDescriptor.transport.path, {
      descriptor: secondDescriptor,
      service: new WorkspaceServiceEngine({ warmCache }),
    });

    const secondService = await daemonServiceClientCreate({
      descriptor: secondDescriptor,
      clientInstanceId: 'daemon-warm-cache-reader',
    });
    const secondRegistered = await secondService.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-warm-cache-reader',
      clientSessionId: 'daemon-warm-cache-reader-session',
    });
    const secondAttached = await secondService.attachWorkspace({
      clientSessionId: secondRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    await secondService.subscribeDiagnostics({
      clientSessionId: secondRegistered.clientSessionId,
      workspaceId: secondAttached.workspaceId,
      workspaceInstanceId: secondAttached.workspaceInstanceId,
      scope: 'workspace',
    });

    expect(
      await secondService.queryIndexStatus({
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: secondAttached.workspaceId,
      workspaceInstanceId: secondAttached.workspaceInstanceId,
      status: 'ready',
      replayState: 'pending',
      workspaceReady: false,
      analysisGeneration: 1,
      featureStatus: {
        diagnostics: { readiness: 'ready' },
        codeActions: { readiness: 'ready' },
        editPlans: { readiness: 'ready' },
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Not required by current policy',
        },
      },
    });

    await secondService.openOverlay({
      clientSessionId: secondRegistered.clientSessionId,
      workspaceId: secondAttached.workspaceId,
      uri,
      version: 1,
      text: 'export type User = {\n  name: string;\n};\nexport const OverlayOnly = 1;\n',
    });
    await secondService.completeReplay({
      clientSessionId: secondRegistered.clientSessionId,
      workspaceId: secondAttached.workspaceId,
      workspaceInstanceId: secondAttached.workspaceInstanceId,
    });

    expect(
      await secondService.queryDiagnostics({
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
        uri,
      }),
    ).toEqual([]);
    expect(
      await secondService.querySemanticSearch({
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
        query: 'OverlayOnly',
      }),
    ).toContainEqual(
      expect.objectContaining({
        name: 'OverlayOnly',
        kind: 'exported_symbol',
        location: expect.objectContaining({
          uri,
        }),
      }),
    );

    await secondService.close();
  });

  it('restores native ownership analyzer scorecards across daemon warm restore', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf8');

    const pluginId = `daemon-dual-native-${randomUUID()}`;
    const ruleId = 'dual-capability';
    const resolvedRuleId = `${pluginId}/${ruleId}`;
    const biomeBin = mockBiomeDiagnosticScriptCreate(workspaceRoot, {
      fileName: 'mock-daemon-biome-diagnostic.cjs',
      diagnostic: {
        code: 'lint/mock/daemon-wrapped',
        filePath,
        message: 'wrapped daemon diagnostic',
      },
    });
    pluginModuleRegister(pluginId, {
      default: [
        pluginRuleNew({
          id: ruleId,
          capabilities: {
            lintProviders: [
              {
                platform: 'biome',
                languages: ['typescript'],
                config: {
                  biomeBin,
                },
              },
            ],
            treeCheckProvider: treeCheckProviderNew({
              languages: ['typescript'],
              check: () => [
                {
                  ruleId: resolvedRuleId,
                  filePath,
                  message: 'daemon native diagnostic',
                  line: 1,
                  column: 1,
                },
              ],
            }),
          },
        }),
      ],
    });

    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      pluginRuleConfigContentCreate({ pluginId, ruleId }),
      'utf8',
    );

    const warmCache = workspaceWarmCacheFsStoreCreate({ cacheDir: runtimeDir });
    const firstDescriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    const firstEngine = new WorkspaceServiceEngine({ warmCache });
    liveDaemons.set(firstDescriptor.transport.path, {
      descriptor: firstDescriptor,
      service: firstEngine,
    });

    const firstService = await daemonServiceClientCreate({
      descriptor: firstDescriptor,
      clientInstanceId: 'daemon-scorecard-writer',
    });
    const firstRegistered = await firstService.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-scorecard-writer',
      clientSessionId: 'daemon-scorecard-writer-session',
    });
    const firstAttached = await firstService.attachWorkspace({
      clientSessionId: firstRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    await firstService.subscribeDiagnostics({
      clientSessionId: firstRegistered.clientSessionId,
      workspaceId: firstAttached.workspaceId,
      workspaceInstanceId: firstAttached.workspaceInstanceId,
      scope: 'workspace',
    });
    await firstService.completeReplay({
      clientSessionId: firstRegistered.clientSessionId,
      workspaceId: firstAttached.workspaceId,
      workspaceInstanceId: firstAttached.workspaceInstanceId,
    });

    expect(
      await firstService.queryDiagnostics({
        clientSessionId: firstRegistered.clientSessionId,
        workspaceId: firstAttached.workspaceId,
        uri,
      }),
    ).toEqual([
      expect.objectContaining({
        source: 'codepol',
        code: resolvedRuleId,
        message: 'daemon native diagnostic',
      }),
    ]);
    expect(
      analyzerScorecardGet(firstEngine, {
        clientSessionId: firstRegistered.clientSessionId,
        workspaceId: firstAttached.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        analyzerId: 'biome',
        status: 'skipped',
        skippedRuleIds: [resolvedRuleId],
        skippedReason: 'native_preferred',
      }),
    );
    // Explicit close so the engine flushes the debounced warm-cache persist
    // before we drop the connection.
    await firstService.closeClientSession({
      clientSessionId: firstRegistered.clientSessionId,
    });
    await firstService.close();

    const secondDescriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    const secondEngine = new WorkspaceServiceEngine({ warmCache });
    liveDaemons.set(secondDescriptor.transport.path, {
      descriptor: secondDescriptor,
      service: secondEngine,
    });

    const secondService = await daemonServiceClientCreate({
      descriptor: secondDescriptor,
      clientInstanceId: 'daemon-scorecard-reader',
    });
    const secondRegistered = await secondService.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-scorecard-reader',
      clientSessionId: 'daemon-scorecard-reader-session',
    });
    const secondAttached = await secondService.attachWorkspace({
      clientSessionId: secondRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    await secondService.subscribeDiagnostics({
      clientSessionId: secondRegistered.clientSessionId,
      workspaceId: secondAttached.workspaceId,
      workspaceInstanceId: secondAttached.workspaceInstanceId,
      scope: 'workspace',
    });

    expect(
      await secondService.queryIndexStatus({
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
      }),
    ).toMatchObject({
      status: 'ready',
      replayState: 'pending',
      analysisGeneration: 1,
    });
    expect(
      analyzerScorecardGet(secondEngine, {
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        analyzerId: 'biome',
        status: 'skipped',
        skippedRuleIds: [resolvedRuleId],
        skippedReason: 'native_preferred',
      }),
    );
    expect(
      analyzerInventoryGet(secondEngine, {
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
      }),
    ).toContainEqual(
      expect.objectContaining({
        ruleId: resolvedRuleId,
        wrappedPlatforms: ['biome'],
        hasNativeOwner: true,
        ownership: 'native_preferred',
      }),
    );

    await secondService.completeReplay({
      clientSessionId: secondRegistered.clientSessionId,
      workspaceId: secondAttached.workspaceId,
      workspaceInstanceId: secondAttached.workspaceInstanceId,
    });
    await expect(
      secondService.queryLintRules({
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
      }),
    ).resolves.toMatchObject({
      workspaceReady: true,
      rules: [
        expect.objectContaining({
          ruleId: resolvedRuleId,
          ownership: 'native_preferred',
          analysisState: 'ready',
          targetPatterns: ['src/**/*.ts'],
          providers: [
            expect.objectContaining({
              platform: 'biome',
              languages: ['typescript'],
            }),
          ],
        }),
      ],
    });
    expect(
      await secondService.queryDiagnostics({
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
        uri,
      }),
    ).toEqual([
      expect.objectContaining({
        source: 'codepol',
        code: resolvedRuleId,
        message: 'daemon native diagnostic',
      }),
    ]);
    await expect(
      secondService.queryLintRuleDetails({
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
        ruleId: resolvedRuleId,
      }),
    ).resolves.toMatchObject({
      totalDiagnosticCount: 1,
      rule: expect.objectContaining({
        ruleId: resolvedRuleId,
        ownership: 'native_preferred',
      }),
      groups: [
        expect.objectContaining({
          uri,
          workspaceRelativePath: 'src/app.ts',
          diagnostics: [
            expect.objectContaining({
              message: 'daemon native diagnostic',
            }),
          ],
        }),
      ],
    });
    await secondService.close();
  });

  it('serves workspace symbol, graph, semantic search, semantic navigation, and architecture summary RPCs through the daemon service client', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const sharedPath = path.join(workspaceRoot, 'src', 'shared.ts');
    const appPath = path.join(workspaceRoot, 'src', 'app.ts');
    const sharedUri = workspacePathToUri(sharedPath);
    const appUri = workspacePathToUri(appPath);
    fs.writeFileSync(sharedPath, 'export const sharedValue = 1;\n', 'utf8');
    fs.writeFileSync(
      appPath,
      "import { sharedValue } from './shared';\nexport const appValue = sharedValue;\n",
      'utf8',
    );

    const descriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    liveDaemons.set(descriptor.transport.path, {
      descriptor,
      service: new WorkspaceServiceEngine(),
    });

    const service = await daemonServiceClientCreate({
      descriptor,
      clientInstanceId: 'daemon-read-rpc-client',
    });
    const registered = await service.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'daemon-read-rpc-client',
      clientSessionId: 'daemon-read-rpc-session',
    });
    const attached = await service.attachWorkspace({
      clientSessionId: registered.clientSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    await service.openOverlay({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: sharedUri,
      version: 1,
      text: 'export const sharedValue = 1;\nexport const OverlayOnly = 2;\n',
    });
    await service.completeReplay({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
    });

    expect(
      await service.queryWorkspaceSymbols({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        query: 'shared',
      }),
    ).toEqual([
      {
        name: 'shared.ts',
        kind: 'module',
        location: {
          uri: sharedUri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
        containerName: 'src',
        detail: 'src/shared.ts',
        source: 'codepol',
        semanticClass: 'workspace_module',
        score: expect.any(Number),
      },
    ]);
    expect(
      await service.querySemanticSearch({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        query: 'OverlayOnly',
      }),
    ).toContainEqual(
      expect.objectContaining({
        name: 'OverlayOnly',
        kind: 'exported_symbol',
        location: expect.objectContaining({
          uri: sharedUri,
          range: expect.objectContaining({
            start: { line: 1, character: 13 },
            end: expect.objectContaining({
              line: 1,
              character: expect.any(Number),
            }),
          }),
        }),
        detail: 'src/shared.ts • const',
        source: 'codepol',
        semanticClass: 'exported_symbol',
      }),
    );
    expect(
      await service.querySemanticDefinition({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        uri: sharedUri,
      }),
    ).toEqual({
      kind: 'single_location',
      target: {
        uri: sharedUri,
        semanticClass: 'architecture_node',
      },
      location: {
        uri: sharedUri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      source: 'codepol',
      semanticClass: 'architecture_node',
    });
    expect(
      await service.querySemanticReferences({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        uri: sharedUri,
      }),
    ).toMatchObject({
      target: {
        uri: sharedUri,
        semanticClass: 'architecture_node',
      },
      presentation: 'grouped_list',
      totalItems: 3,
      totalAvailableItems: 3,
      truncated: false,
      groups: [
        {
          group: 'declarations',
          totalCount: 1,
        },
        {
          group: 'incoming',
          totalCount: 2,
          items: [
            expect.objectContaining({
              location: {
                uri: appUri,
                range: {
                  start: { line: 0, character: 0 },
                  end: {
                    line: 0,
                    character: expect.any(Number),
                  },
                },
              },
              label: 'src/app.ts',
              detail: 'import sharedValue from ./shared',
            }),
            expect.objectContaining({
              location: {
                uri: appUri,
                range: {
                  start: { line: 0, character: 28 },
                  end: {
                    line: 0,
                    character: expect.any(Number),
                  },
                },
              },
              label: 'src/app.ts',
              detail: 'import from ./shared',
            }),
          ],
        },
        {
          group: 'outgoing',
          totalCount: 0,
        },
      ],
      source: 'codepol',
      semanticClass: 'architecture_node',
    });
    expect(
      await service.querySemanticHover({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        uri: sharedUri,
      }),
    ).toEqual({
      target: {
        uri: sharedUri,
        semanticClass: 'architecture_node',
      },
      title: 'shared.ts',
      subtitle: 'src/shared.ts',
      summary: 'Indexed architecture node for the workspace module graph.',
      fields: [
        { label: 'Directory', value: 'src' },
        { label: 'Inbound edges', value: '1' },
        { label: 'Outbound edges', value: '0' },
        { label: 'Entry point', value: 'No' },
        { label: 'Cycle member', value: 'No' },
      ],
      tags: undefined,
      actions: ['go_to_definition', 'find_references', 'show_graph'],
      source: 'codepol',
      semanticClass: 'architecture_node',
    });
    expect(
      await service.prepareRename({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'architecture_node',
          uri: sharedUri,
        },
      }),
    ).toEqual({
      ok: false,
      code: 'not_renameable_class',
      message: 'Semantic class architecture_node is not renameable in MVP.',
    });
    expect(
      await service.previewRename({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        target: {
          semanticClass: 'architecture_node',
          uri: sharedUri,
        },
        newName: 'shared-renamed',
      }),
    ).toEqual({
      ok: false,
      code: 'not_renameable_class',
      message: 'Semantic class architecture_node is not renameable in MVP.',
    });
    expect(
      await service.queryDependencyGraph({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toEqual({
      nodes: [
        {
          uri: appUri,
          workspaceRelativePath: 'src/app.ts',
          metrics: {
            importerCount: 0,
            importeeCount: 1,
            symbolCount: 2,
            loc: 2,
            isEntryPoint: true,
            isInCycle: false,
          },
        },
        {
          uri: sharedUri,
          workspaceRelativePath: 'src/shared.ts',
          metrics: {
            importerCount: 1,
            importeeCount: 0,
            symbolCount: 2,
            loc: 2,
            isEntryPoint: false,
            isInCycle: false,
          },
        },
      ],
      edges: [
        {
          fromUri: appUri,
          toUri: sharedUri,
          kind: 'static',
          bindingCount: 1,
        },
      ],
      entryPoints: [appUri],
      cycles: [],
    });
    expect(
      await service.queryArchitectureSummary({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toMatchObject({
      indexedFileCount: 2,
      entryPointCount: 1,
      cycleCount: 0,
      hotspots: [
        {
          uri: sharedUri,
          workspaceRelativePath: 'src/shared.ts',
          importerCount: 1,
          importeeCount: 0,
        },
        {
          uri: appUri,
          workspaceRelativePath: 'src/app.ts',
          importerCount: 0,
          importeeCount: 1,
        },
      ],
    });

    // Phase 2 narrow queries round-trip through the daemon transport.
    const impactRadius = await service.queryImpactRadius({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: appUri,
      direction: 'downstream',
    });
    expect(impactRadius.nodes.map((node) => node.uri).sort()).toEqual(
      [appUri, sharedUri].sort(),
    );
    expect(impactRadius.edges).toEqual([
      {
        fromUri: appUri,
        toUri: sharedUri,
        kind: 'static',
        bindingCount: 1,
      },
    ]);

    expect(
      await service.queryDependencyPath({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        fromUri: appUri,
        toUri: sharedUri,
      }),
    ).toEqual({
      paths: [[appUri, sharedUri]],
      shortestLength: 1,
      truncated: false,
    });

    expect(
      await service.queryDeadModules({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
      }),
    ).toEqual({
      unreachable: [],
    });

    // Phase 7 symbol-level queries round-trip through the daemon
    // transport. We pass an unknown symbol id so the request exercises
    // the daemon plumbing without depending on any specific id format.
    const callGraph = await service.queryCallGraph({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      symbolId: 'unknown-id',
      direction: 'both',
    });
    expect(callGraph.nodes).toHaveLength(1);
    expect(callGraph.nodes[0]!.symbolId).toBe('unknown-id');
    expect(callGraph.nodes[0]!.uri.startsWith('codepol-symbol://')).toBe(true);
    expect(callGraph.edges).toEqual([]);

    const typeHierarchy = await service.queryTypeHierarchy({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      symbolId: 'unknown-id',
      direction: 'both',
    });
    expect(typeHierarchy.nodes).toHaveLength(1);
    expect(typeHierarchy.nodes[0]!.symbolId).toBe('unknown-id');
    expect(typeHierarchy.edges).toEqual([]);

    // Phase 9.4 / Gap 3: queryTypeHierarchy carries the new
    // `includeStructural` flag through the daemon round-trip. With
    // an unknown symbol id the result is still seed-only, but the
    // request/ack pair must accept the flag without rejecting it.
    const typeHierarchyStructural = await service.queryTypeHierarchy({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      symbolId: 'unknown-id',
      direction: 'both',
      includeStructural: true,
      minConfidence: 'declared',
    });
    expect(typeHierarchyStructural.nodes).toHaveLength(1);
    expect(typeHierarchyStructural.nodes[0]!.symbolId).toBe('unknown-id');

    // Phase 9.1 / Gap 1: querySymbolFlow round-trips through the
    // daemon transport. Unknown symbol id ⇒ empty edge list (never
    // null), exercising both the request type registration and the
    // ack shape.
    const symbolFlow = await service.querySymbolFlow({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      symbolId: 'unknown-id',
      direction: 'outgoing',
    });
    expect(symbolFlow).toEqual({ edges: [] });

    // Phase 9.2 / Gap 1: queryCallGraph honours `requireTypeAware`
    // when no source is registered — the daemon round-trip surfaces
    // the structured error as a thrown Error message containing the
    // `type-aware-source-missing` code so the LSP / CLI can detect it.
    let typeAwareError: unknown;
    try {
      await service.queryCallGraph({
        clientSessionId: registered.clientSessionId,
        workspaceId: attached.workspaceId,
        symbolId: 'unknown-id',
        direction: 'callees',
        requireTypeAware: true,
      });
    } catch (error) {
      typeAwareError = error;
    }
    expect(typeAwareError).toBeDefined();
    expect(String((typeAwareError as Error).message)).toContain(
      'TypeAwareCallGraphSource',
    );

    // Phase 7 follow-up: symbol-id discovery RPCs round-trip through
    // the daemon transport. We use a name that has no chance of
    // matching anything in the test workspace so the assertion stays
    // independent of the indexed corpus.
    const lookup = await service.querySymbolLookup({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      name: '__codepol_daemon_test_symbol_that_does_not_exist__',
    });
    expect(lookup.symbols).toEqual([]);

    const atPosition = await service.querySymbolAtPosition({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: appUri,
      position: { line: 0, character: 0 },
    });
    expect(atPosition).toEqual({ symbol: undefined });

    // CodeLens batched RPC round-trips through the daemon transport.
    // The unindexed-but-attached file path returns an empty item list
    // (never `undefined`) so the editor's per-file CodeLens fan-in
    // never has to null-guard.
    const codelensCounts = await service.querySymbolsInFileWithCallCounts({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: appUri,
    });
    expect(codelensCounts).toEqual({ items: [] });

    // Phase 5 (deferred) hover marker layer round-trip. `appUri` is
    // the importer file in the test workspace (it imports `shared`),
    // so the daemon should round-trip exactly one specifier descriptor
    // pointing at the in-workspace target.
    const importSpecifiers = await service.queryImportSpecifiersInFile({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri: appUri,
    });
    expect(importSpecifiers.specifiers).toHaveLength(1);
    expect(importSpecifiers.specifiers[0]!.resolvedModuleWorkspaceRelativePath).toBe(
      'src/shared.ts',
    );
    expect(importSpecifiers.specifiers[0]!.edgeKind).toBe('static');
  });

  it('rejects stale analysisGeneration for workspace symbol reads through the daemon service client', async () => {
    const setup = await daemonReadWorkspaceCreate();

    try {
      expect(
        await setup.service.queryWorkspaceSymbols({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          query: 'shared',
        }),
      ).toHaveLength(1);

      const initialStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });

      await setup.service.openOverlay({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
        uri: setup.sharedUri,
        version: 1,
        text: 'export const sharedValue = 1;\nexport const OverlayOnly = 2;\n',
      });

      expect(
        await setup.service.queryWorkspaceSymbols({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          query: 'shared',
        }),
      ).toHaveLength(1);

      const currentStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });
      expect(currentStatus.analysisGeneration).toBeGreaterThan(initialStatus.analysisGeneration);

      await expect(
        setup.service.queryWorkspaceSymbols({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          query: 'shared',
          analysisGeneration: initialStatus.analysisGeneration,
        }),
      ).rejects.toThrow(
        `Analysis generation mismatch: expected ${currentStatus.analysisGeneration}, received ${initialStatus.analysisGeneration}`,
      );
    } finally {
      await setup.service.close();
    }
  });

  it('rejects stale analysisGeneration for dependency-graph reads through the daemon service client', async () => {
    const setup = await daemonReadWorkspaceCreate();

    try {
      expect(
        await setup.service.queryDependencyGraph({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
        }),
      ).toMatchObject({
        nodes: expect.any(Array),
      });

      const initialStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });

      await setup.service.openOverlay({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
        uri: setup.sharedUri,
        version: 1,
        text: 'export const sharedValue = 1;\nexport const OverlayOnly = 2;\n',
      });

      expect(
        await setup.service.queryDependencyGraph({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
        }),
      ).toMatchObject({
        nodes: expect.any(Array),
      });

      const currentStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });
      expect(currentStatus.analysisGeneration).toBeGreaterThan(initialStatus.analysisGeneration);

      await expect(
        setup.service.queryDependencyGraph({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          analysisGeneration: initialStatus.analysisGeneration,
        }),
      ).rejects.toThrow(
        `Analysis generation mismatch: expected ${currentStatus.analysisGeneration}, received ${initialStatus.analysisGeneration}`,
      );
    } finally {
      await setup.service.close();
    }
  });

  it('rejects stale analysisGeneration for semantic-search reads through the daemon service client', async () => {
    const setup = await daemonReadWorkspaceCreate();

    try {
      expect(
        await setup.service.querySemanticSearch({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          query: 'sharedValue',
        }),
      ).toContainEqual(
        expect.objectContaining({
          name: 'sharedValue',
        }),
      );

      const initialStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });

      await setup.service.openOverlay({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
        uri: setup.sharedUri,
        version: 1,
        text: 'export const sharedValue = 1;\nexport const OverlayOnly = 2;\n',
      });

      expect(
        await setup.service.querySemanticSearch({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          query: 'OverlayOnly',
        }),
      ).toContainEqual(
        expect.objectContaining({
          name: 'OverlayOnly',
        }),
      );

      const currentStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });
      expect(currentStatus.analysisGeneration).toBeGreaterThan(initialStatus.analysisGeneration);

      await expect(
        setup.service.querySemanticSearch({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          query: 'OverlayOnly',
          analysisGeneration: initialStatus.analysisGeneration,
        }),
      ).rejects.toThrow(
        `Analysis generation mismatch: expected ${currentStatus.analysisGeneration}, received ${initialStatus.analysisGeneration}`,
      );
    } finally {
      await setup.service.close();
    }
  });

  it('rejects stale analysisGeneration for semantic-reference reads through the daemon service client', async () => {
    const setup = await daemonReadWorkspaceCreate();

    try {
      expect(
        await setup.service.querySemanticReferences({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          uri: setup.sharedUri,
        }),
      ).toMatchObject({
        target: {
          uri: setup.sharedUri,
          semanticClass: 'architecture_node',
        },
      });

      const initialStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });

      await setup.service.openOverlay({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
        uri: setup.sharedUri,
        version: 1,
        text: 'export const sharedValue = 1;\nexport const OverlayOnly = 2;\n',
      });

      expect(
        await setup.service.querySemanticReferences({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          uri: setup.sharedUri,
        }),
      ).toMatchObject({
        target: {
          uri: setup.sharedUri,
          semanticClass: 'architecture_node',
        },
      });

      const currentStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });
      expect(currentStatus.analysisGeneration).toBeGreaterThan(initialStatus.analysisGeneration);

      await expect(
        setup.service.querySemanticReferences({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          uri: setup.sharedUri,
          analysisGeneration: initialStatus.analysisGeneration,
        }),
      ).rejects.toThrow(
        `Analysis generation mismatch: expected ${currentStatus.analysisGeneration}, received ${initialStatus.analysisGeneration}`,
      );
    } finally {
      await setup.service.close();
    }
  });

  it('rejects stale analysisGeneration for rename-preview reads through the daemon service client', async () => {
    const setup = await daemonReadWorkspaceCreate();

    try {
      expect(
        await setup.service.previewRename({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          target: {
            semanticClass: 'architecture_node',
            uri: setup.sharedUri,
          },
          newName: 'shared-renamed',
        }),
      ).toEqual({
        ok: false,
        code: 'not_renameable_class',
        message: 'Semantic class architecture_node is not renameable in MVP.',
      });

      const initialStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });

      await setup.service.openOverlay({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
        uri: setup.sharedUri,
        version: 1,
        text: 'export const sharedValue = 1;\nexport const OverlayOnly = 2;\n',
      });

      expect(
        await setup.service.previewRename({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          target: {
            semanticClass: 'architecture_node',
            uri: setup.sharedUri,
          },
          newName: 'shared-renamed',
        }),
      ).toEqual({
        ok: false,
        code: 'not_renameable_class',
        message: 'Semantic class architecture_node is not renameable in MVP.',
      });

      const currentStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });
      expect(currentStatus.analysisGeneration).toBeGreaterThan(initialStatus.analysisGeneration);

      await expect(
        setup.service.previewRename({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          target: {
            semanticClass: 'architecture_node',
            uri: setup.sharedUri,
          },
          newName: 'shared-renamed',
          analysisGeneration: initialStatus.analysisGeneration,
        }),
      ).rejects.toThrow(
        `Analysis generation mismatch: expected ${currentStatus.analysisGeneration}, received ${initialStatus.analysisGeneration}`,
      );
    } finally {
      await setup.service.close();
    }
  });

  it('rejects stale analysisGeneration for architecture-summary reads through the daemon service client', async () => {
    const setup = await daemonReadWorkspaceCreate();

    try {
      expect(
        await setup.service.queryArchitectureSummary({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
        }),
      ).toMatchObject({
        indexedFileCount: 2,
      });

      const initialStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });

      await setup.service.openOverlay({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
        uri: setup.sharedUri,
        version: 1,
        text: 'export const sharedValue = 1;\nexport const OverlayOnly = 2;\n',
      });

      expect(
        await setup.service.queryArchitectureSummary({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
        }),
      ).toMatchObject({
        indexedFileCount: 2,
      });

      const currentStatus = await setup.service.queryIndexStatus({
        clientSessionId: setup.registered.clientSessionId,
        workspaceId: setup.attached.workspaceId,
      });
      expect(currentStatus.analysisGeneration).toBeGreaterThan(initialStatus.analysisGeneration);

      await expect(
        setup.service.queryArchitectureSummary({
          clientSessionId: setup.registered.clientSessionId,
          workspaceId: setup.attached.workspaceId,
          analysisGeneration: initialStatus.analysisGeneration,
        }),
      ).rejects.toThrow(
        `Analysis generation mismatch: expected ${currentStatus.analysisGeneration}, received ${initialStatus.analysisGeneration}`,
      );
    } finally {
      await setup.service.close();
    }
  });

  it('restores a warm index-backed workspace across daemon incarnations', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      unusedExportsConfigContentCreate(),
      'utf8',
    );

    const exporterPath = path.join(workspaceRoot, 'src', 'exporter.ts');
    const importerPath = path.join(workspaceRoot, 'src', 'importer.ts');
    const exporterUri = workspacePathToUri(exporterPath);
    const importerUri = workspacePathToUri(importerPath);
    fs.writeFileSync(exporterPath, 'export const sharedValue = 1;\n', 'utf8');
    fs.writeFileSync(
      importerPath,
      "import { sharedValue } from './exporter';\nexport const value = sharedValue;\n",
      'utf8',
    );

    const warmCache = workspaceWarmCacheFsStoreCreate({ cacheDir: runtimeDir });
    const firstDescriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    liveDaemons.set(firstDescriptor.transport.path, {
      descriptor: firstDescriptor,
      service: new WorkspaceServiceEngine({ warmCache }),
    });

    const firstConnection = await connect(firstDescriptor);
    await workspaceDaemonHello({
      connection: firstConnection,
      client: clientIdentityCreate('warm-daemon-writer'),
    });
    const firstService = new WorkspaceDaemonServiceClient(firstConnection);
    const firstRegistered = await firstService.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'warm-daemon-writer',
      clientSessionId: 'warm-daemon-writer-session',
    });
    const firstAttached = await firstService.attachWorkspace({
      clientSessionId: firstRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    await firstService.subscribeDiagnostics({
      clientSessionId: firstRegistered.clientSessionId,
      workspaceId: firstAttached.workspaceId,
      workspaceInstanceId: firstAttached.workspaceInstanceId,
      scope: 'workspace',
    });
    await firstService.completeReplay({
      clientSessionId: firstRegistered.clientSessionId,
      workspaceId: firstAttached.workspaceId,
      workspaceInstanceId: firstAttached.workspaceInstanceId,
    });
    expect(
      await firstService.queryDiagnostics({
        clientSessionId: firstRegistered.clientSessionId,
        workspaceId: firstAttached.workspaceId,
        uri: exporterUri,
      }),
    ).toEqual([]);
    // Explicit close so the engine flushes the debounced warm-cache persist
    // before we drop the connection.
    await firstService.closeClientSession({
      clientSessionId: firstRegistered.clientSessionId,
    });
    await firstService.close();

    const secondDescriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    liveDaemons.set(secondDescriptor.transport.path, {
      descriptor: secondDescriptor,
      service: new WorkspaceServiceEngine({ warmCache }),
    });

    const secondConnection = await connect(secondDescriptor);
    await workspaceDaemonHello({
      connection: secondConnection,
      client: clientIdentityCreate('warm-daemon-reader'),
    });
    const secondService = new WorkspaceDaemonServiceClient(secondConnection);
    const secondRegistered = await secondService.registerClientSession({
      clientKind: 'test',
      clientInstanceId: 'warm-daemon-reader',
      clientSessionId: 'warm-daemon-reader-session',
    });
    const secondAttached = await secondService.attachWorkspace({
      clientSessionId: secondRegistered.clientSessionId,
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    await secondService.subscribeDiagnostics({
      clientSessionId: secondRegistered.clientSessionId,
      workspaceId: secondAttached.workspaceId,
      workspaceInstanceId: secondAttached.workspaceInstanceId,
      scope: 'workspace',
    });
    await secondService.completeReplay({
      clientSessionId: secondRegistered.clientSessionId,
      workspaceId: secondAttached.workspaceId,
      workspaceInstanceId: secondAttached.workspaceInstanceId,
    });

    expect(
      await secondService.queryIndexStatus({
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
      }),
    ).toMatchObject({
      workspaceId: secondAttached.workspaceId,
      workspaceInstanceId: secondAttached.workspaceInstanceId,
      status: 'ready',
      replayState: 'applied',
      workspaceReady: true,
      indexedFileCount: 2,
      analysisGeneration: 1,
      featureStatus: {
        workspaceIndex: {
          readiness: 'ready',
          detail: 'Session-derived index ready',
        },
      },
    });
    expect(
      await secondService.queryDiagnostics({
        clientSessionId: secondRegistered.clientSessionId,
        workspaceId: secondAttached.workspaceId,
        uri: exporterUri,
      }),
    ).toEqual([]);

    await secondService.openOverlay({
      clientSessionId: secondRegistered.clientSessionId,
      workspaceId: secondAttached.workspaceId,
      uri: importerUri,
      version: 1,
      text: 'export const value = 1;\n',
    });

    const diagnostics = await secondService.queryDiagnostics({
      clientSessionId: secondRegistered.clientSessionId,
      workspaceId: secondAttached.workspaceId,
      uri: exporterUri,
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('@codepol/plugin/no-unused-exports');

    await secondService.close();
  });

  it('rejects overlay writes for a stale workspace instance id', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noInterfaceConfigContentCreate(),
      'utf8',
    );

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      service: new WorkspaceServiceEngine(),
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('stale-workspace-instance-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'stale-workspace-instance-client',
      clientSessionId: 'stale-workspace-instance-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'stale-workspace-instance-session',
      daemonSessionId: registerResponse.daemonSessionId,
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    expect(attachResponse.type).toBe('attach_workspace_ack');

    if (attachResponse.type !== 'attach_workspace_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 4,
        type: 'open_overlay',
        clientSessionId: 'stale-workspace-instance-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: 'workspace-wrong-instance',
        uri: workspacePathToUri(path.join(workspaceRoot, 'src', 'app.ts')),
        version: 1,
        text: 'export type User = {};\n',
      }),
    ).resolves.toEqual({
      type: 'error',
      code: 'workspace_instance_mismatch',
      message: `Workspace instance mismatch for ${attachResponse.workspaceId}: expected ${attachResponse.workspaceInstanceId}, received workspace-wrong-instance`,
    });
  });

  it('rejects post-replay reads for a stale replay epoch', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noInterfaceConfigContentCreate(),
      'utf8',
    );

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      service: new WorkspaceServiceEngine(),
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('stale-replay-epoch-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'stale-replay-epoch-client',
      clientSessionId: 'stale-replay-epoch-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'stale-replay-epoch-session',
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
      daemonSessionId: registerResponse.daemonSessionId,
    });
    expect(attachResponse.type).toBe('attach_workspace_ack');

    if (attachResponse.type !== 'attach_workspace_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 4,
        type: 'complete_replay',
        clientSessionId: 'stale-replay-epoch-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
      }),
    ).resolves.toEqual({
      type: 'complete_replay_ack',
      result: {
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 1,
        replayState: 'applied',
      },
    });

    await expect(
      session.handleEnvelope({
        id: 5,
        type: 'query_index_status',
        clientSessionId: 'stale-replay-epoch-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 0,
      }),
    ).resolves.toEqual({
      type: 'error',
      code: 'replay_epoch_mismatch',
      message: `Replay epoch mismatch for ${attachResponse.workspaceId}: expected 1, received 0`,
    });
  });

  it('rejects diagnostics reads for a stale overlay document version', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noInterfaceConfigContentCreate(),
      'utf8',
    );

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      service: new WorkspaceServiceEngine(),
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('stale-document-version-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'stale-document-version-client',
      clientSessionId: 'stale-document-version-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'stale-document-version-session',
      daemonSessionId: registerResponse.daemonSessionId,
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    expect(attachResponse.type).toBe('attach_workspace_ack');
    if (attachResponse.type !== 'attach_workspace_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 4,
        type: 'open_overlay',
        clientSessionId: 'stale-document-version-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        uri,
        version: 2,
        text: 'export interface User {\n  name: string;\n}\n',
      }),
    ).resolves.toEqual({
      type: 'open_overlay_ack',
    });

    await expect(
      session.handleEnvelope({
        id: 5,
        type: 'complete_replay',
        clientSessionId: 'stale-document-version-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
      }),
    ).resolves.toEqual({
      type: 'complete_replay_ack',
      result: {
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 1,
        replayState: 'applied',
      },
    });

    await expect(
      session.handleEnvelope({
        id: 6,
        type: 'query_diagnostics',
        clientSessionId: 'stale-document-version-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 1,
        uri,
        documentVersion: 1,
      }),
    ).resolves.toEqual({
      type: 'error',
      code: 'document_version_mismatch',
      message: `Document version mismatch for ${uri}: expected 2, received 1`,
    });
  });

  it('supersedes an older diagnostics request when a newer request for the same lane arrives', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    let resolveFirstDiagnostics: ((diagnostics: never[]) => void) | undefined;
    let diagnosticsCalls = 0;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession(input) {
        return {
          clientSessionId: input.clientSessionId ?? 'supersede-client-session',
          daemonSessionId: 'daemon-supersede-session',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-supersede',
          workspaceInstanceId: 'workspace-supersede-instance',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-supersede',
          workspaceInstanceId: 'workspace-supersede-instance',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-supersede',
          workspaceInstanceId: 'workspace-supersede-instance',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        diagnosticsCalls += 1;
        if (diagnosticsCalls === 1) {
          return new Promise((resolve) => {
            resolveFirstDiagnostics = resolve as (diagnostics: never[]) => void;
          });
        }
        return [];
      },
      async queryCodeActions() {
        return [];
      },
      async applyEditPlan() {
        return {
          applied: false,
          failureReason: 'plan_not_found',
        };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-supersede',
          workspaceInstanceId: 'workspace-supersede-instance',
          status: 'ready',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 1,
        };
      },
    };

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      service,
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('supersede-diagnostics-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'supersede-diagnostics-client',
      clientSessionId: 'supersede-diagnostics-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'supersede-diagnostics-session',
      daemonSessionId: registerResponse.daemonSessionId,
      rootPath: runtimeDir,
      configPath: path.join(runtimeDir, 'codepol.toml'),
    });
    expect(attachResponse.type).toBe('attach_workspace_ack');
    if (attachResponse.type !== 'attach_workspace_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 4,
        type: 'complete_replay',
        clientSessionId: 'supersede-diagnostics-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
      }),
    ).resolves.toEqual({
      type: 'complete_replay_ack',
      result: {
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 1,
        replayState: 'applied',
      },
    });

    const firstPromise = session.handleEnvelope({
      id: 5,
      type: 'query_diagnostics',
      clientSessionId: 'supersede-diagnostics-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      requestId: 'diagnostics-request-1',
    });

    for (let attempt = 0; attempt < 20 && !resolveFirstDiagnostics; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(resolveFirstDiagnostics).toBeDefined();

    const secondPromise = session.handleEnvelope({
      id: 6,
      type: 'query_diagnostics',
      clientSessionId: 'supersede-diagnostics-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      requestId: 'diagnostics-request-2',
    });

    resolveFirstDiagnostics!([]);

    await expect(firstPromise).resolves.toEqual({
      type: 'error',
      code: 'request_superseded',
      message: 'Request superseded',
      data: {
        kind: 'request_superseded',
        requestType: 'query_diagnostics',
        requestKey: `query_diagnostics:supersede-diagnostics-session:${attachResponse.workspaceId}:*`,
        requestId: 'diagnostics-request-1',
        replacedByRequestId: 'diagnostics-request-2',
      },
    });
    await expect(secondPromise).resolves.toEqual({
      type: 'query_diagnostics_ack',
      diagnostics: [],
    });
  });

  it('supersedes an older workspace-symbol request when a newer request for the same lane arrives', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    let resolveFirstSymbols: ((symbols: never[]) => void) | undefined;
    let symbolCalls = 0;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession(input) {
        return {
          clientSessionId: input.clientSessionId ?? 'supersede-symbol-client-session',
          daemonSessionId: 'daemon-supersede-symbol-session',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-supersede-symbol',
          workspaceInstanceId: 'workspace-supersede-symbol-instance',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-supersede-symbol',
          workspaceInstanceId: 'workspace-supersede-symbol-instance',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-supersede-symbol',
          workspaceInstanceId: 'workspace-supersede-symbol-instance',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        return [];
      },
      async queryWorkspaceSymbols() {
        symbolCalls += 1;
        if (symbolCalls === 1) {
          return new Promise((resolve) => {
            resolveFirstSymbols = resolve as (symbols: never[]) => void;
          });
        }
        return [];
      },
      async queryCodeActions() {
        return [];
      },
      async applyEditPlan() {
        return {
          applied: false,
          failureReason: 'plan_not_found',
        };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-supersede-symbol',
          workspaceInstanceId: 'workspace-supersede-symbol-instance',
          status: 'ready',
          indexedFileCount: 1,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 1,
        };
      },
    };

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      service,
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('supersede-symbol-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'supersede-symbol-client',
      clientSessionId: 'supersede-symbol-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'supersede-symbol-session',
      daemonSessionId: registerResponse.daemonSessionId,
      rootPath: runtimeDir,
      configPath: path.join(runtimeDir, 'codepol.toml'),
    });
    expect(attachResponse.type).toBe('attach_workspace_ack');
    if (attachResponse.type !== 'attach_workspace_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 4,
        type: 'complete_replay',
        clientSessionId: 'supersede-symbol-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
      }),
    ).resolves.toEqual({
      type: 'complete_replay_ack',
      result: {
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 1,
        replayState: 'applied',
      },
    });

    const firstPromise = session.handleEnvelope({
      id: 5,
      type: 'query_workspace_symbols',
      clientSessionId: 'supersede-symbol-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      query: 'app',
      requestId: 'workspace-symbols-request-1',
    });

    for (let attempt = 0; attempt < 20 && !resolveFirstSymbols; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(resolveFirstSymbols).toBeDefined();

    const secondPromise = session.handleEnvelope({
      id: 6,
      type: 'query_workspace_symbols',
      clientSessionId: 'supersede-symbol-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      query: 'app',
      requestId: 'workspace-symbols-request-2',
    });

    resolveFirstSymbols!([]);

    await expect(firstPromise).resolves.toEqual({
      type: 'error',
      code: 'request_superseded',
      message: 'Request superseded',
      data: {
        kind: 'request_superseded',
        requestType: 'query_workspace_symbols',
        requestKey: `query_workspace_symbols:supersede-symbol-session:${attachResponse.workspaceId}`,
        requestId: 'workspace-symbols-request-1',
        replacedByRequestId: 'workspace-symbols-request-2',
      },
    });
    await expect(secondPromise).resolves.toEqual({
      type: 'query_workspace_symbols_ack',
      symbols: [],
    });
  });

  it('supersedes an older semantic-search request when a newer request for the same lane arrives', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    let resolveFirstSearch:
      | ((results: Array<{ name: string; kind: 'exported_symbol' }>) => void)
      | undefined;
    let searchCalls = 0;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession(input) {
        return {
          clientSessionId: input.clientSessionId ?? 'supersede-search-client-session',
          daemonSessionId: 'daemon-supersede-search-session',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-supersede-search',
          workspaceInstanceId: 'workspace-supersede-search-instance',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-supersede-search',
          workspaceInstanceId: 'workspace-supersede-search-instance',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-supersede-search',
          workspaceInstanceId: 'workspace-supersede-search-instance',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        return [];
      },
      async queryWorkspaceSymbols() {
        return [];
      },
      async querySemanticSearch() {
        searchCalls += 1;
        if (searchCalls === 1) {
          return new Promise((resolve) => {
            resolveFirstSearch = resolve as (results: Array<{
              name: string;
              kind: 'exported_symbol';
            }>) => void;
          });
        }
        return [];
      },
      async queryCodeActions() {
        return [];
      },
      async applyEditPlan() {
        return {
          applied: false,
          failureReason: 'plan_not_found',
        };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-supersede-search',
          workspaceInstanceId: 'workspace-supersede-search-instance',
          status: 'ready',
          indexedFileCount: 1,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 1,
        };
      },
      async queryDependencyGraph() {
        return {
          nodes: [],
          edges: [],
          entryPoints: [],
          cycles: [],
        };
      },
      async queryArchitectureSummary() {
        return {
          summary: '',
          indexedFileCount: 0,
          symbolCount: 0,
          scopeCount: 0,
          relationCount: 0,
          entryPointCount: 0,
          cycleCount: 0,
          hotspots: [],
        };
      },
    };

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      service,
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('supersede-search-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'supersede-search-client',
      clientSessionId: 'supersede-search-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'supersede-search-session',
      daemonSessionId: registerResponse.daemonSessionId,
      rootPath: runtimeDir,
      configPath: path.join(runtimeDir, 'codepol.toml'),
    });
    expect(attachResponse.type).toBe('attach_workspace_ack');
    if (attachResponse.type !== 'attach_workspace_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 4,
        type: 'complete_replay',
        clientSessionId: 'supersede-search-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
      }),
    ).resolves.toEqual({
      type: 'complete_replay_ack',
      result: {
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 1,
        replayState: 'applied',
      },
    });

    const firstPromise = session.handleEnvelope({
      id: 5,
      type: 'query_semantic_search',
      clientSessionId: 'supersede-search-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      query: 'OverlayOnly',
      requestId: 'semantic-search-request-1',
    });

    for (let attempt = 0; attempt < 20 && !resolveFirstSearch; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(resolveFirstSearch).toBeDefined();

    const secondPromise = session.handleEnvelope({
      id: 6,
      type: 'query_semantic_search',
      clientSessionId: 'supersede-search-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      query: 'OverlayOnly',
      requestId: 'semantic-search-request-2',
    });

    resolveFirstSearch!([]);

    await expect(firstPromise).resolves.toEqual({
      type: 'error',
      code: 'request_superseded',
      message: 'Request superseded',
      data: {
        kind: 'request_superseded',
        requestType: 'query_semantic_search',
        requestKey: `query_semantic_search:supersede-search-session:${attachResponse.workspaceId}`,
        requestId: 'semantic-search-request-1',
        replacedByRequestId: 'semantic-search-request-2',
      },
    });
    await expect(secondPromise).resolves.toEqual({
      type: 'query_semantic_search_ack',
      results: [],
    });
  });

  it('rejects client-session requests for a stale daemon session id', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noInterfaceConfigContentCreate(),
      'utf8',
    );

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      service: new WorkspaceServiceEngine(),
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('stale-daemon-session-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'stale-daemon-session-client',
      clientSessionId: 'stale-daemon-session-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 3,
        type: 'attach_workspace',
        clientSessionId: 'stale-daemon-session-session',
        daemonSessionId: 'daemon-stale-session',
        rootPath: workspaceRoot,
        configPath: path.join(workspaceRoot, 'codepol.toml'),
      }),
    ).resolves.toEqual({
      type: 'error',
      code: 'daemon_session_mismatch',
      message: `Daemon session mismatch for client session stale-daemon-session-session: expected ${registerResponse.daemonSessionId}, received daemon-stale-session`,
    });
  });

  it('prioritizes status ahead of medium-priority work within a workspace queue', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const queueCalls: string[] = [];
    let releaseDiagnostics: ((diagnostics: unknown[]) => void) | undefined;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession(input) {
        return {
          clientSessionId: input.clientSessionId ?? 'queued-client-session',
          daemonSessionId: 'daemon-queued-session',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-queued',
          workspaceInstanceId: 'workspace-queued-instance',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-queued',
          workspaceInstanceId: 'workspace-queued-instance',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-queued',
          workspaceInstanceId: 'workspace-queued-instance',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        queueCalls.push('queryDiagnostics:start');
        return new Promise((resolve) => {
          releaseDiagnostics = (diagnostics) => {
            queueCalls.push('queryDiagnostics:end');
            resolve(diagnostics as never);
          };
        });
      },
      async queryCodeActions() {
        queueCalls.push('queryCodeActions:start');
        return [];
      },
      async applyEditPlan() {
        return {
          applied: false,
          failureReason: 'plan_not_found',
        };
      },
      async queryIndexStatus() {
        queueCalls.push('queryIndexStatus:start');
        return {
          workspaceId: 'workspace-queued',
          workspaceInstanceId: 'workspace-queued-instance',
          status: 'ready',
          indexedFileCount: 1,
          openDocumentCount: 1,
          overlayCount: 1,
          analysisGeneration: 1,
        };
      },
    };

    const session = new WorkspaceDaemonSession({
      descriptor,
      service,
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('queued-priority-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'queued-priority-client',
      clientSessionId: 'queued-priority-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'queued-priority-session',
      daemonSessionId: registerResponse.daemonSessionId,
      rootPath: runtimeDir,
      configPath: path.join(runtimeDir, 'codepol.toml'),
    });
    expect(attachResponse.type).toBe('attach_workspace_ack');
    if (attachResponse.type !== 'attach_workspace_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 4,
        type: 'complete_replay',
        clientSessionId: 'queued-priority-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
      }),
    ).resolves.toEqual({
      type: 'complete_replay_ack',
      result: {
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 1,
        replayState: 'applied',
      },
    });

    await expect(
      session.handleEnvelope({
        id: 8,
        type: 'open_overlay',
        clientSessionId: 'queued-priority-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        uri: workspacePathToUri(path.join(runtimeDir, 'src', 'app.ts')),
        version: 1,
        text: 'export interface User {\n  name: string;\n}\n',
      }),
    ).resolves.toEqual({
      type: 'open_overlay_ack',
    });

    const diagnosticsPromise = session.handleEnvelope({
      id: 5,
      type: 'query_diagnostics',
      clientSessionId: 'queued-priority-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      uri: workspacePathToUri(path.join(runtimeDir, 'src', 'app.ts')),
    });

    for (let attempt = 0; attempt < 20 && queueCalls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(queueCalls).toEqual(['queryDiagnostics:start']);

    const codeActionsPromise = session.handleEnvelope({
      id: 6,
      type: 'query_code_actions',
      clientSessionId: 'queued-priority-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      uri: workspacePathToUri(path.join(runtimeDir, 'src', 'app.ts')),
      version: 1,
      diagnosticIds: ['diag-1'],
    });

    const statusPromise = session.handleEnvelope({
      id: 7,
      type: 'query_index_status',
      clientSessionId: 'queued-priority-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queueCalls).toEqual(['queryDiagnostics:start']);
    expect(releaseDiagnostics).toBeDefined();

    releaseDiagnostics?.([]);

    await expect(diagnosticsPromise).resolves.toEqual({
      type: 'query_diagnostics_ack',
      diagnostics: [],
    });
    await expect(statusPromise).resolves.toMatchObject({
      type: 'query_index_status_ack',
      indexStatus: {
        workspaceId: 'workspace-queued',
      },
    });
    await expect(codeActionsPromise).resolves.toEqual({
      type: 'query_code_actions_ack',
      codeActions: [],
    });

    expect(queueCalls).toEqual([
      'queryDiagnostics:start',
      'queryDiagnostics:end',
      'queryIndexStatus:start',
      'queryCodeActions:start',
    ]);
  });

  it('acknowledges cancel_request and suppresses a canceled daemon response', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      policyCheck: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              policy: {
                exclude: [],
                plugins: [],
                targets: {},
                rules: [],
              } as never,
              files: [],
              violations: [],
              treeViolations: [],
              workspaceDiagnostics: [],
              eslintOutput: '',
              eslintHasErrors: false,
            });
          }, 10);
        }),
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('cancel-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const requestPromise = session.handleEnvelope({
      id: 2,
      type: 'policy_check',
      options: {
        configPath: 'codepol.toml',
        cwd: runtimeDir,
        fix: false,
      },
    });

    await expect(
      session.handleEnvelope({
        id: 3,
        type: 'cancel_request',
        targetId: 2,
      }),
    ).resolves.toEqual({
      type: 'cancel_request_ack',
      targetId: 2,
      cancellationState: 'cancel_requested',
    });

    await expect(requestPromise).resolves.toEqual({
      type: 'error',
      code: 'request_cancelled',
      message: 'Request cancelled',
    });
  });

  it('cancels an in-flight semantic-references request through daemon request signals', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    let resolveReferences:
      | ((value: {
          target: { uri: string; semanticClass: 'architecture_node' };
          presentation: 'grouped_list';
          totalItems: number;
          totalAvailableItems: number;
          truncated: boolean;
          groups: [];
          source: 'codepol';
          semanticClass: 'architecture_node';
        } | null) => void)
      | undefined;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession(input) {
        return {
          clientSessionId: input.clientSessionId ?? 'semantic-cancel-session',
          daemonSessionId: 'daemon-semantic-cancel-session',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'semantic-cancel-workspace',
          workspaceInstanceId: 'semantic-cancel-workspace-instance',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'semantic-cancel-workspace',
          workspaceInstanceId: 'semantic-cancel-workspace-instance',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'semantic-cancel-workspace',
          workspaceInstanceId: 'semantic-cancel-workspace-instance',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        return [];
      },
      async queryCodeActions() {
        return [];
      },
      async applyEditPlan() {
        return {
          applied: false,
          failureReason: 'plan_not_found',
        };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'semantic-cancel-workspace',
          workspaceInstanceId: 'semantic-cancel-workspace-instance',
          status: 'ready',
          indexedFileCount: 1,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 1,
        };
      },
      async querySemanticReferences() {
        return new Promise((resolve) => {
          resolveReferences = resolve;
        });
      },
    };

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      service,
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('semantic-cancel-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'semantic-cancel-client',
      clientSessionId: 'semantic-cancel-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'semantic-cancel-session',
      daemonSessionId: registerResponse.daemonSessionId,
      rootPath: runtimeDir,
      configPath: path.join(runtimeDir, 'codepol.toml'),
    });
    expect(attachResponse.type).toBe('attach_workspace_ack');
    if (attachResponse.type !== 'attach_workspace_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 4,
        type: 'complete_replay',
        clientSessionId: 'semantic-cancel-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
      }),
    ).resolves.toEqual({
      type: 'complete_replay_ack',
      result: {
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 1,
        replayState: 'applied',
      },
    });

    const requestPromise = session.handleEnvelope({
      id: 5,
      type: 'query_semantic_references',
      clientSessionId: 'semantic-cancel-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      uri: 'file:///semantic-target.ts',
      requestId: 'semantic-references-request-1',
    });

    for (let attempt = 0; attempt < 20 && !resolveReferences; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(resolveReferences).toBeDefined();

    await expect(
      session.handleEnvelope({
        id: 6,
        type: 'cancel_request',
        targetId: 5,
      }),
    ).resolves.toEqual({
      type: 'cancel_request_ack',
      targetId: 5,
      cancellationState: 'cancel_requested',
    });

    resolveReferences!(null);

    await expect(requestPromise).resolves.toEqual({
      type: 'error',
      code: 'request_cancelled',
      message: 'Request cancelled',
    });
  });

  it('cancels a long-running external biome analyzer through daemon request signals', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-workspace-'));
    tempDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = workspacePathToUri(filePath);
    fs.writeFileSync(filePath, 'export const value = 1;\n', 'utf8');

    const markerPath = path.join(workspaceRoot, 'biome-abort-marker.txt');
    const biomeBin = mockBiomeBlockingScriptCreate(workspaceRoot, {
      markerPath,
    });

    const pluginId = `daemon-cancel-biome-${randomUUID()}`;
    const ruleId = 'blocking-biome';
    pluginModuleRegister(pluginId, {
      default: [
        pluginRuleNew({
          id: ruleId,
          capabilities: {
            lintProviders: [
              {
                platform: 'biome',
                languages: ['typescript'],
                config: {
                  biomeBin,
                },
              },
            ],
          },
        }),
      ],
    });

    const configPath = path.join(workspaceRoot, 'codepol.toml');
    fs.writeFileSync(
      configPath,
      pluginRuleConfigContentCreate({ pluginId, ruleId }),
      'utf8',
    );

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    const session = new WorkspaceDaemonSession({
      descriptor,
      service: new WorkspaceServiceEngine(),
    });

    await expect(
      session.handleEnvelope({
        id: 1,
        type: 'hello',
        protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
        client: clientIdentityCreate('cancel-biome-client'),
      }),
    ).resolves.toMatchObject({
      type: 'hello_ack',
      compatibility: 'ok',
    });

    const registerResponse = await session.handleEnvelope({
      id: 2,
      type: 'register_client_session',
      clientKind: 'test',
      clientInstanceId: 'cancel-biome-client',
      clientSessionId: 'cancel-biome-session',
    });
    expect(registerResponse.type).toBe('register_client_session_ack');
    if (registerResponse.type !== 'register_client_session_ack') {
      return;
    }

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'cancel-biome-session',
      daemonSessionId: registerResponse.daemonSessionId,
      rootPath: workspaceRoot,
      configPath,
    });
    expect(attachResponse.type).toBe('attach_workspace_ack');
    if (attachResponse.type !== 'attach_workspace_ack') {
      return;
    }

    await expect(
      session.handleEnvelope({
        id: 4,
        type: 'complete_replay',
        clientSessionId: 'cancel-biome-session',
        daemonSessionId: registerResponse.daemonSessionId,
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
      }),
    ).resolves.toEqual({
      type: 'complete_replay_ack',
      result: {
        workspaceId: attachResponse.workspaceId,
        workspaceInstanceId: attachResponse.workspaceInstanceId,
        replayEpoch: 1,
        replayState: 'applied',
      },
    });

    const diagnosticsPromise = session.handleEnvelope({
      id: 5,
      type: 'query_diagnostics',
      clientSessionId: 'cancel-biome-session',
      daemonSessionId: registerResponse.daemonSessionId,
      workspaceId: attachResponse.workspaceId,
      workspaceInstanceId: attachResponse.workspaceInstanceId,
      replayEpoch: 1,
      uri,
      requestId: 'cancel-biome-diagnostics',
    });

    await expect(
      fileContentsWaitFor(markerPath, {
        expected: 'started',
      }),
    ).resolves.toBe('started');

    await expect(
      session.handleEnvelope({
        id: 6,
        type: 'cancel_request',
        targetId: 5,
      }),
    ).resolves.toEqual({
      type: 'cancel_request_ack',
      targetId: 5,
      cancellationState: 'cancel_requested',
    });

    await expect(diagnosticsPromise).resolves.toEqual({
      type: 'error',
      code: 'request_cancelled',
      message: 'Request cancelled',
    });
    await expect(
      fileContentsWaitFor(markerPath, {
        expected: 'aborted',
      }),
    ).resolves.toBe('aborted');
  });

  it('launches once through the shared launcher and then reuses the healthy daemon', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    let descriptor: WorkspaceDaemonDescriptor | undefined;
    let startCalls = 0;

    const startDaemon = async () => {
      startCalls += 1;
      if (!descriptor) {
        const created = workspaceDaemonDescriptorCreate({ runtimeDir });
        descriptor = created.descriptor;
        workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
        liveDaemons.set(descriptor.transport.path, { descriptor });
      }
    };

    const first = await workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('client-a'),
      connect,
      startDaemon,
    });
    expect(first.launched).toBe(true);
    expect(startCalls).toBe(1);
    await first.connection.close();

    const second = await workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('client-b'),
      connect,
      startDaemon,
    });
    expect(second.launched).toBe(false);
    expect(startCalls).toBe(1);
    expect(second.descriptor.sessionNonce).toBe(first.descriptor.sessionNonce);
    await second.connection.close();
  });

  it('serializes parallel launcher callers behind a single daemon start', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    let descriptor: WorkspaceDaemonDescriptor | undefined;
    let startCalls = 0;
    let releaseStart: (() => void) | undefined;
    const startEntered = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let startHasEntered = false;

    const startDaemon = async () => {
      startCalls += 1;
      startHasEntered = true;
      await startEntered;
      if (!descriptor) {
        const created = workspaceDaemonDescriptorCreate({ runtimeDir });
        descriptor = created.descriptor;
        workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
        liveDaemons.set(descriptor.transport.path, { descriptor });
      }
    };

    const first = workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('client-parallel-a'),
      connect,
      startDaemon,
    });

    while (!startHasEntered) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const second = workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('client-parallel-b'),
      connect,
      startDaemon,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(startCalls).toBe(1);

    releaseStart?.();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.launched).toBe(true);
    expect(secondResult.launched).toBe(false);
    expect(startCalls).toBe(1);
    expect(secondResult.descriptor.sessionNonce).toBe(firstResult.descriptor.sessionNonce);
    await firstResult.connection.close();
    await secondResult.connection.close();
  });

  it('recovers from a stale daemon launch lock by clearing it before start', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const paths = workspaceDaemonRuntimePathsResolve(runtimeDir);
    fs.mkdirSync(paths.runtimeDir, { recursive: true });
    fs.writeFileSync(paths.lockPath, 'stale lock', 'utf8');
    const staleAt = new Date(Date.now() - 10_000);
    fs.utimesSync(paths.lockPath, staleAt, staleAt);

    let startedDescriptor: WorkspaceDaemonDescriptor | undefined;
    let startCalls = 0;
    const launched = await workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('client-stale-lock'),
      connect,
      lockTimeoutMs: 100,
      startDaemon: async () => {
        startCalls += 1;
        const created = workspaceDaemonDescriptorCreate({ runtimeDir });
        startedDescriptor = created.descriptor;
        workspaceDaemonDescriptorWrite(runtimeDir, created.descriptor);
        liveDaemons.set(created.descriptor.transport.path, {
          descriptor: created.descriptor,
        });
      },
    });

    expect(startCalls).toBe(1);
    expect(launched.launched).toBe(true);
    expect(startedDescriptor).toBeDefined();
    expect(launched.descriptor.sessionNonce).toBe(startedDescriptor?.sessionNonce);
    expect(fs.existsSync(paths.lockPath)).toBe(false);
    await launched.connection.close();
  });

  it('recovers from a stale socket path by removing it before daemon startup', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const paths = workspaceDaemonRuntimePathsResolve(runtimeDir);
    fs.mkdirSync(paths.runtimeDir, { recursive: true });
    fs.writeFileSync(paths.socketPath, 'stale socket', 'utf8');
    expect(fs.statSync(paths.socketPath).isFile()).toBe(true);

    const fakeServer = {
      once: vi.fn().mockReturnThis(),
      removeListener: vi.fn().mockReturnThis(),
      listen: vi.fn((socketPath: string, callback?: () => void) => {
        expect(socketPath).toBe(paths.socketPath);
        expect(fs.existsSync(paths.socketPath)).toBe(false);
        callback?.();
        return fakeServer;
      }),
      close: vi.fn((callback?: (error?: Error) => void) => {
        callback?.();
        return fakeServer;
      }),
    } as unknown as net.Server;
    const createServerSpy = vi.spyOn(net, 'createServer').mockReturnValue(fakeServer);
    try {
      const server = await workspaceDaemonServerStart({ runtimeDir });

      expect(createServerSpy).toHaveBeenCalledOnce();
      expect(server.descriptor.transport.path).toBe(paths.socketPath);
      expect(workspaceDaemonDescriptorRead(runtimeDir)?.sessionNonce).toBe(
        server.descriptor.sessionNonce,
      );
      expect(fs.existsSync(paths.socketPath)).toBe(false);
      await server.stop();
    } finally {
      createServerSpy.mockRestore();
    }
  });

  it('recovers from a stale descriptor by launching a fresh daemon descriptor', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    workspaceDaemonDescriptorWrite(runtimeDir, {
      transport: {
        kind: 'unix_socket',
        path: path.join(runtimeDir, 'stale.sock'),
      },
      pid: 999999,
      startedAtUnixMs: Date.now(),
      protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
      engineVersion: 'stale',
      buildId: 'stale',
      installId: 'default',
      sessionNonce: 'stale',
    });

    let startedDescriptor: WorkspaceDaemonDescriptor | undefined;
    const launched = await workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('client-stale'),
      connect,
      startDaemon: async () => {
        const created = workspaceDaemonDescriptorCreate({ runtimeDir });
        startedDescriptor = created.descriptor;
        workspaceDaemonDescriptorWrite(runtimeDir, created.descriptor);
        liveDaemons.set(created.descriptor.transport.path, {
          descriptor: created.descriptor,
        });
      },
    });

    expect(launched.launched).toBe(true);
    expect(startedDescriptor).toBeDefined();
    expect(launched.descriptor.sessionNonce).toBe(startedDescriptor?.sessionNonce);
    expect(launched.descriptor.sessionNonce).not.toBe('stale');
    await launched.connection.close();
  });

  it('relaunches when the existing daemon is missing required capabilities', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const staleDescriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    workspaceDaemonDescriptorWrite(runtimeDir, staleDescriptor);
    liveDaemons.set(staleDescriptor.transport.path, {
      descriptor: staleDescriptor,
    });

    let startedDescriptor: WorkspaceDaemonDescriptor | undefined;
    const launched = await workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('client-required-capabilities'),
      requiredCapabilities: ['query_lint_rules', 'query_lint_rule_details'],
      connect,
      startDaemon: async () => {
        const created = workspaceDaemonDescriptorCreate({ runtimeDir });
        startedDescriptor = created.descriptor;
        workspaceDaemonDescriptorWrite(runtimeDir, created.descriptor);
        liveDaemons.set(created.descriptor.transport.path, {
          descriptor: created.descriptor,
          service: new WorkspaceServiceEngine(),
        });
      },
    });

    expect(launched.launched).toBe(true);
    expect(startedDescriptor).toBeDefined();
    expect(launched.descriptor.sessionNonce).toBe(startedDescriptor?.sessionNonce);
    expect(launched.descriptor.sessionNonce).not.toBe(staleDescriptor.sessionNonce);
    await launched.connection.close();
  });

  it('relaunches when the existing daemon predates the required runtime freshness', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const staleDescriptor = workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor;
    workspaceDaemonDescriptorWrite(runtimeDir, {
      ...staleDescriptor,
      startedAtUnixMs: Date.now() - 60_000,
    });
    liveDaemons.set(staleDescriptor.transport.path, {
      descriptor: {
        ...staleDescriptor,
        startedAtUnixMs: Date.now() - 60_000,
      },
      service: new WorkspaceServiceEngine(),
    });

    let startedDescriptor: WorkspaceDaemonDescriptor | undefined;
    const launched = await workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('client-fresh-runtime'),
      minStartedAtUnixMs: Date.now(),
      connect,
      startDaemon: async () => {
        const created = workspaceDaemonDescriptorCreate({ runtimeDir });
        startedDescriptor = created.descriptor;
        workspaceDaemonDescriptorWrite(runtimeDir, created.descriptor);
        liveDaemons.set(created.descriptor.transport.path, {
          descriptor: created.descriptor,
          service: new WorkspaceServiceEngine(),
        });
      },
    });

    expect(launched.launched).toBe(true);
    expect(startedDescriptor).toBeDefined();
    expect(launched.descriptor.sessionNonce).toBe(startedDescriptor?.sessionNonce);
    expect(launched.descriptor.sessionNonce).not.toBe(staleDescriptor.sessionNonce);
    expect(launched.descriptor.startedAtUnixMs).toBeGreaterThanOrEqual(
      startedDescriptor?.startedAtUnixMs ?? 0,
    );
    await launched.connection.close();
  });

  it('terminates the matched stale daemon before relaunching', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const staleDescriptor = {
      ...workspaceDaemonDescriptorCreate({ runtimeDir }).descriptor,
      pid: 424_242,
      startedAtUnixMs: Date.now() - 60_000,
    };
    workspaceDaemonDescriptorWrite(runtimeDir, staleDescriptor);
    liveDaemons.set(staleDescriptor.transport.path, {
      descriptor: staleDescriptor,
      service: new WorkspaceServiceEngine(),
    });

    const livePids = new Set([staleDescriptor.pid]);
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (!livePids.has(pid)) {
          const error = new Error(`kill ESRCH ${pid}`) as NodeJS.ErrnoException;
          error.code = 'ESRCH';
          throw error;
        }
        if (signal === 0) {
          return true;
        }
        if (signal === undefined || signal === 'SIGTERM' || signal === 'SIGKILL') {
          livePids.delete(pid);
          liveDaemons.delete(staleDescriptor.transport.path);
          return true;
        }
        return true;
      }) as typeof process.kill);

    let startedDescriptor: WorkspaceDaemonDescriptor | undefined;
    const launched = await workspaceDaemonLaunchOrConnect({
      runtimeDir,
      client: clientIdentityCreate('client-terminate-stale-daemon'),
      minStartedAtUnixMs: Date.now(),
      connect,
      startDaemon: async () => {
        const created = workspaceDaemonDescriptorCreate({ runtimeDir });
        startedDescriptor = created.descriptor;
        workspaceDaemonDescriptorWrite(runtimeDir, created.descriptor);
        liveDaemons.set(created.descriptor.transport.path, {
          descriptor: created.descriptor,
          service: new WorkspaceServiceEngine(),
        });
      },
    });

    expect(launched.launched).toBe(true);
    expect(startedDescriptor).toBeDefined();
    expect(
      killSpy.mock.calls.some(
        ([pid, signal]) => pid === staleDescriptor.pid && signal === 'SIGTERM',
      ),
    ).toBe(true);
    expect(livePids.has(staleDescriptor.pid)).toBe(false);
    await launched.connection.close();
  });
});
