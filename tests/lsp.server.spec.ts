import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceCodeAction, WorkspaceDiagnostic } from '@codepol/core';
import type {
  WorkspaceDaemonConnectFn,
  WorkspaceDaemonDescriptor,
  WorkspaceDaemonRequestClient,
  WorkspaceService,
} from '@codepol/workspace-service';
import {
  workspaceDaemonDescriptorCreate,
  workspaceDaemonDescriptorWrite,
  WorkspaceDaemonServiceClient,
  WorkspaceDaemonSession,
  workspaceDaemonHello,
  WorkspaceServiceEngine,
  workspaceServiceCreate,
  WORKSPACE_DAEMON_PROTOCOL_VERSION,
} from '@codepol/workspace-service';
import { CodepolLspServer } from '../apps/lsp/src/server';
import { lspWorkspaceServiceResolve } from '../apps/lsp/src/serviceFactory';

function tempWorkspaceCreate(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function noUnusedVarsConfigContentCreate(): string {
  return `[[plugins]]
id = "@codepol/plugin"
source = { kind = "builtin" }

[targets.src]
language = "typescript"
files = ["src/**/*.ts"]

[[rules]]
ruleId = "@codepol/plugin/no-unused-vars"
targets = ["src"]
`;
}

function daemonClientIdentityCreate(instanceId: string) {
  return {
    kind: 'test',
    clientVersion: '1.0.0',
    instanceId,
    supportedProtocols: [WORKSPACE_DAEMON_PROTOCOL_VERSION],
    supportsFallbackModes: ['in_process'],
  };
}

function daemonConnectCreate(options: {
  descriptor: WorkspaceDaemonDescriptor;
  service?: WorkspaceServiceEngine;
}): WorkspaceDaemonConnectFn {
  return async (descriptor): Promise<WorkspaceDaemonRequestClient> => {
    if (descriptor.sessionNonce !== options.descriptor.sessionNonce) {
      throw new Error('daemon unavailable');
    }
    const session = new WorkspaceDaemonSession({
      descriptor: options.descriptor,
      service: options.service,
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
}

async function messageWaitFor<T>(
  messages: T[],
  predicate: (message: T) => boolean,
  attempts = 20,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = messages.find(predicate);
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return messages.find(predicate);
}

type ManualTimeoutHandle = ReturnType<typeof setTimeout>;

function workspaceReadQueriesStubCreate(): Pick<
  WorkspaceService,
  | 'queryWorkspaceSymbols'
  | 'queryDependencyGraph'
  | 'querySemanticSearch'
  | 'querySemanticDefinition'
  | 'querySemanticReferences'
  | 'querySemanticHover'
  | 'prepareRename'
  | 'previewRename'
  | 'queryArchitectureSummary'
> {
  return {
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
  };
}

function manualTimerQueueCreate(): {
  timers: {
    setTimeout: (callback: () => void, delayMs: number) => ManualTimeoutHandle;
    clearTimeout: (handle: ManualTimeoutHandle | undefined) => void;
  };
  pendingCountGet: () => number;
  runNext: () => Promise<void>;
} {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const queue: number[] = [];

  function timeoutHandleCreate(value: number): ManualTimeoutHandle {
    return value as unknown as ManualTimeoutHandle;
  }

  function timeoutHandleRead(handle: ManualTimeoutHandle): number {
    return handle as unknown as number;
  }

  return {
    timers: {
      setTimeout(callback, _delayMs) {
        const handle = nextHandle;
        nextHandle += 1;
        callbacks.set(handle, callback);
        queue.push(handle);
        return timeoutHandleCreate(handle);
      },
      clearTimeout(handle) {
        if (handle === undefined) {
          return;
        }
        const internalHandle = timeoutHandleRead(handle);
        callbacks.delete(internalHandle);
        const index = queue.indexOf(internalHandle);
        if (index !== -1) {
          queue.splice(index, 1);
        }
      },
    },
    pendingCountGet() {
      return queue.filter((handle) => callbacks.has(handle)).length;
    },
    async runNext() {
      const handle = queue.shift();
      if (handle === undefined) {
        throw new Error('No timer queued');
      }
      const callback = callbacks.get(handle);
      callbacks.delete(handle);
      callback?.();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('CodepolLspServer', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('registers a client session and attaches the workspace during initialize', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const calls: string[] = [];
    let registeredInput:
      | { clientKind: string; clientInstanceId: string; clientSessionId?: string }
      | undefined;
    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession(input) {
        registeredInput = input;
        calls.push('registerClientSession');
        return {
          clientSessionId: input.clientSessionId ?? 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {
        calls.push('closeClientSession');
      },
      async attachWorkspace() {
        calls.push('attachWorkspace');
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        calls.push('subscribeDiagnostics');
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        calls.push('completeReplay');
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {
        calls.push('openOverlay');
      },
      async updateOverlay() {
        calls.push('updateOverlay');
      },
      async closeOverlay() {
        calls.push('closeOverlay');
      },
      async queryDiagnostics() {
        calls.push('queryDiagnostics');
        return [];
      },
      async queryCodeActions() {
        calls.push('queryCodeActions');
        return [];
      },
      async applyEditPlan() {
        calls.push('applyEditPlan');
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        calls.push('queryIndexStatus');
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const server = new CodepolLspServer({
      service,
      clientInstanceId: 'lsp-instance-1',
      clientSessionId: 'lsp-client-session-1',
      sendMessage: () => {},
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    expect(calls).toEqual([
      'registerClientSession',
      'attachWorkspace',
      'subscribeDiagnostics',
      'completeReplay',
    ]);
    expect(registeredInput).toEqual({
      clientKind: 'lsp',
      clientInstanceId: 'lsp-instance-1',
      clientSessionId: 'lsp-client-session-1',
    });
  });

  it('advertises workspace symbols and serves Codepol read RPCs over the active LSP session', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    const configPath = path.join(workspaceRoot, 'codepol.toml');
    const configUri = pathToFileURL(configPath).href;
    fs.writeFileSync(configPath, noInterfaceConfigContentCreate(), 'utf8');

    const sharedPath = path.join(workspaceRoot, 'src', 'shared.ts');
    const appPath = path.join(workspaceRoot, 'src', 'app.ts');
    const sharedUri = pathToFileURL(sharedPath).href;
    const appUri = pathToFileURL(appPath).href;
    fs.writeFileSync(sharedPath, 'export const sharedValue = 1;\n', 'utf8');
    fs.writeFileSync(
      appPath,
      "import { sharedValue } from './shared';\nexport const appValue = sharedValue;\n",
      'utf8',
    );

    const messages: any[] = [];
    const service = workspaceServiceCreate({
      engine: new WorkspaceServiceEngine(),
    });
    const server = new CodepolLspServer({
      service,
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    expect(
      messages.find((message) => message.id === 1 && 'result' in message)?.result.capabilities
        .workspaceSymbolProvider,
    ).toBe(true);
    expect(
      messages.find((message) => message.id === 1 && 'result' in message)?.result.capabilities
        .executeCommandProvider.commands,
    ).toEqual([
      'codepol.applyEditPlan',
      'codepol.goToSemanticDefinition',
      'codepol.showArchitectureLinks',
    ]);
    expect(
      messages.find((message) => message.id === 1 && 'result' in message)?.result.capabilities
        .definitionProvider,
    ).toBeUndefined();
    expect(
      messages.find((message) => message.id === 1 && 'result' in message)?.result.capabilities
        .referencesProvider,
    ).toBeUndefined();
    expect(
      messages.find((message) => message.id === 1 && 'result' in message)?.result.capabilities
        .hoverProvider,
    ).toBeUndefined();
    expect(
      messages.find((message) => message.id === 1 && 'result' in message)?.result.capabilities
        .renameProvider,
    ).toBeUndefined();

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: sharedUri,
          version: 1,
          text: 'export const sharedValue = 1;\nexport const OverlayOnly = 2;\n',
        },
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'workspace/symbol',
      params: {
        query: 'shared',
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'codepol/semanticSearch',
      params: {
        query: 'OverlayOnly',
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'codepol/indexStatus',
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'codepol/dependencyGraph',
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'codepol/architectureSummary',
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'codepol/semanticDefinition',
      params: {
        uri: sharedUri,
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'codepol/semanticReferences',
      params: {
        uri: sharedUri,
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'codepol/semanticHover',
      params: {
        uri: sharedUri,
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'codepol/prepareRename',
      params: {
        target: {
          semanticClass: 'architecture_node',
          uri: sharedUri,
        },
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'codepol/previewRename',
      params: {
        target: {
          semanticClass: 'architecture_node',
          uri: sharedUri,
        },
        newName: 'shared-renamed',
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'workspace/executeCommand',
      params: {
        command: 'codepol.goToSemanticDefinition',
        arguments: [{ uri: sharedUri }],
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 13,
      method: 'workspace/executeCommand',
      params: {
        command: 'codepol.showArchitectureLinks',
        arguments: [{ uri: sharedUri }],
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 14,
      method: 'codepol/prepareRename',
      params: {
        target: {
          semanticClass: 'config_component',
          targetId: 'target:src',
        },
      },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 15,
      method: 'codepol/previewRename',
      params: {
        target: {
          semanticClass: 'config_component',
          targetId: 'target:src',
        },
        newName: 'app-src',
      },
    });

    expect(messages.find((message) => message.id === 2)?.result).toEqual([
      {
        name: 'shared.ts',
        kind: 2,
        location: {
          uri: sharedUri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
        containerName: 'src',
        data: {
          source: 'codepol',
          semanticClass: 'workspace_module',
          detail: 'src/shared.ts',
          score: expect.any(Number),
        },
      },
    ]);
    expect(messages.find((message) => message.id === 3)?.result).toContainEqual(
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
    expect(messages.find((message) => message.id === 4)?.result).toMatchObject({
      status: 'ready',
      workspaceReady: true,
      indexedFileCount: 2,
      featureStatus: {
        workspaceSymbols: { readiness: 'ready' },
        semanticSearch: { readiness: 'ready' },
        dependencyGraph: { readiness: 'ready' },
        architectureSummary: { readiness: 'ready' },
      },
    });
    expect(messages.find((message) => message.id === 5)?.result).toEqual({
      nodes: [
        {
          uri: appUri,
          workspaceRelativePath: 'src/app.ts',
        },
        {
          uri: sharedUri,
          workspaceRelativePath: 'src/shared.ts',
        },
      ],
      edges: [
        {
          fromUri: appUri,
          toUri: sharedUri,
        },
      ],
      entryPoints: [appUri],
      cycles: [],
    });
    expect(messages.find((message) => message.id === 6)?.result).toMatchObject({
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
    expect(messages.find((message) => message.id === 7)?.result).toEqual({
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
    expect(messages.find((message) => message.id === 8)?.result).toMatchObject({
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
              relationKind: 'incoming',
              semanticClass: 'architecture_node',
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
              relationKind: 'incoming',
              semanticClass: 'architecture_node',
            }),
          ],
        },
        {
          group: 'outgoing',
          totalCount: 0,
          items: [],
        },
      ],
      source: 'codepol',
      semanticClass: 'architecture_node',
    });
    expect(messages.find((message) => message.id === 9)?.result).toEqual({
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
    expect(messages.find((message) => message.id === 10)?.result).toEqual({
      ok: false,
      code: 'not_renameable_class',
      message: 'Semantic class architecture_node is not renameable in MVP.',
    });
    expect(messages.find((message) => message.id === 11)?.result).toEqual({
      ok: false,
      code: 'not_renameable_class',
      message: 'Semantic class architecture_node is not renameable in MVP.',
    });
    expect(messages.find((message) => message.id === 12)?.result).toEqual(
      messages.find((message) => message.id === 7)?.result,
    );
    expect(messages.find((message) => message.id === 13)?.result).toEqual(
      messages.find((message) => message.id === 8)?.result,
    );
    expect(messages.find((message) => message.id === 14)?.result).toEqual({
      ok: true,
      target: {
        semanticClass: 'config_component',
        targetId: 'target:src',
      },
      displayName: 'src',
      currentName: 'src',
      normalizedCurrentName: 'src',
      namespaceId: `config.targets:${configUri}`,
      declarationLocation: {
        uri: configUri,
        range: {
          start: { line: 4, character: 9 },
          end: { line: 4, character: 12 },
        },
      },
      placeholderRange: {
        start: { line: 4, character: 9 },
        end: { line: 4, character: 12 },
      },
      impactedSiteCount: 2,
      requiresPreview: true,
      namingRules: {
        minLength: 1,
        patternDescription: 'bare TOML key segment ([A-Za-z0-9_-]+)',
        casePolicy: 'preserve',
      },
    });
    expect(messages.find((message) => message.id === 15)?.result).toEqual({
      ok: true,
      target: {
        semanticClass: 'config_component',
        targetId: 'target:src',
      },
      oldName: 'src',
      newName: 'app-src',
      normalizedNewName: 'app-src',
      namespaceId: `config.targets:${configUri}`,
      groups: [
        {
          group: 'declarations',
          edits: [
            {
              uri: configUri,
              range: {
                start: { line: 4, character: 9 },
                end: { line: 4, character: 12 },
              },
              oldText: 'src',
              newText: 'app-src',
              kind: 'declaration',
              semanticClass: 'config_component',
              targetId: 'target:src',
            },
          ],
        },
        {
          group: 'config',
          edits: [
            {
              uri: configUri,
              range: {
                start: { line: 10, character: 12 },
                end: { line: 10, character: 15 },
              },
              oldText: 'src',
              newText: 'app-src',
              kind: 'config_key',
              semanticClass: 'config_component',
              targetId: 'target:src',
            },
          ],
        },
      ],
      totalEdits: 2,
      warnings: [],
      blockingIssues: [],
      canApply: true,
    });
  });

  it('polls index status into work-done progress and reopens progress after invalidation', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const timers = manualTimerQueueCreate();
    const messages: any[] = [];
    let queryIndexStatusCalls = 0;
    const statusResults = [
      {
        workspaceId: 'workspace-1',
        workspaceInstanceId: 'workspace-instance-1',
        status: 'cold',
        replayState: 'applied',
        replayEpoch: 1,
        workspaceReady: false,
        indexedFileCount: 0,
        openDocumentCount: 0,
        overlayCount: 0,
        analysisGeneration: 0,
      },
      {
        workspaceId: 'workspace-1',
        workspaceInstanceId: 'workspace-instance-1',
        status: 'warming',
        replayState: 'applied',
        replayEpoch: 1,
        workspaceReady: false,
        indexedFileCount: 3,
        openDocumentCount: 0,
        overlayCount: 0,
        analysisGeneration: 0,
      },
      {
        workspaceId: 'workspace-1',
        workspaceInstanceId: 'workspace-instance-1',
        status: 'ready',
        replayState: 'applied',
        replayEpoch: 1,
        workspaceReady: true,
        indexedFileCount: 3,
        openDocumentCount: 0,
        overlayCount: 0,
        analysisGeneration: 1,
      },
      {
        workspaceId: 'workspace-1',
        workspaceInstanceId: 'workspace-instance-1',
        status: 'warming',
        replayState: 'applied',
        replayEpoch: 1,
        workspaceReady: false,
        indexedFileCount: 3,
        openDocumentCount: 0,
        overlayCount: 0,
        analysisGeneration: 1,
      },
      {
        workspaceId: 'workspace-1',
        workspaceInstanceId: 'workspace-instance-1',
        status: 'error',
        replayState: 'applied',
        replayEpoch: 1,
        workspaceReady: false,
        indexedFileCount: 3,
        openDocumentCount: 0,
        overlayCount: 0,
        analysisGeneration: 1,
        lastError: 'Index build failed',
      },
    ] as const;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
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
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        const result =
          statusResults[Math.min(queryIndexStatusCalls, statusResults.length - 1)]!;
        queryIndexStatusCalls += 1;
        return result;
      },
    };

    const server = new CodepolLspServer({
      service,
      sendMessage: (message) => {
        messages.push(message);
      },
      timers: timers.timers,
      statusPollIntervalsMs: {
        active: 0,
        idle: 0,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
        capabilities: {
          window: {
            workDoneProgress: true,
          },
        },
      },
    });

    expect(timers.pendingCountGet()).toBe(1);
    await timers.runNext();
    await timers.runNext();
    await timers.runNext();
    await timers.runNext();
    await timers.runNext();

    const progressCreates = messages.filter(
      (message) => message.method === 'window/workDoneProgress/create',
    );
    const progressUpdates = messages.filter((message) => message.method === '$/progress');
    expect(queryIndexStatusCalls).toBe(5);
    expect(progressCreates).toHaveLength(2);
    expect(progressUpdates.map((message) => message.params.value.kind)).toEqual([
      'begin',
      'report',
      'end',
      'begin',
      'end',
    ]);
    expect(progressUpdates[0]?.params.value.message).toBe('Preparing workspace index');
    expect(progressUpdates[1]?.params.value.message).toBe(
      'Warming workspace index (3 indexed files)',
    );
    expect(progressUpdates[2]?.params.value.message).toBe(
      'Workspace ready (3 indexed files)',
    );
    expect(progressUpdates[4]?.params.value.message).toBe('Index build failed');

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'shutdown',
    });
    expect(timers.pendingCountGet()).toBe(0);
  });

  it('resumes status polling and progress after reconnecting from a recoverable index-status failure', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    const fileText = 'export interface User {\n  name: string;\n}\n';
    fs.writeFileSync(filePath, fileText, 'utf8');

    const messages: any[] = [];
    const timers = manualTimerQueueCreate();
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    let serviceFactoryCalls = 0;

    function serviceMockCreate(options: {
      calls: string[];
      daemonSessionId: string;
      workspaceId: string;
      failIndexStatus?: boolean;
      statusResults?: Array<{
        workspaceId: string;
        workspaceInstanceId: string;
        status: 'cold' | 'warming' | 'ready' | 'error';
        replayState?: 'pending' | 'applied';
        replayEpoch?: number;
        workspaceReady?: boolean;
        indexedFileCount: number;
        openDocumentCount: number;
        overlayCount: number;
        analysisGeneration: number;
        lastError?: string;
      }>;
    }): WorkspaceService {
      let queryIndexStatusCalls = 0;

      return {
        ...workspaceReadQueriesStubCreate(),
        async registerClientSession(input) {
          options.calls.push(`register:${input.clientSessionId ?? 'generated'}`);
          return {
            clientSessionId: input.clientSessionId ?? 'client-1',
            daemonSessionId: options.daemonSessionId,
          };
        },
        async closeClientSession() {
          options.calls.push('closeClientSession');
        },
        async attachWorkspace() {
          options.calls.push('attachWorkspace');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
          };
        },
        async subscribeDiagnostics(input) {
          options.calls.push(`subscribeDiagnostics:${input.scope}`);
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            scope: input.scope,
            subscriptionState: 'active',
          };
        },
        async completeReplay() {
          options.calls.push('completeReplay');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            replayEpoch: 1,
            replayState: 'applied',
          };
        },
        async openOverlay(input) {
          options.calls.push(`openOverlay:${input.uri}@${input.version}`);
        },
        async updateOverlay(input) {
          options.calls.push(`updateOverlay:${input.uri}@${input.version}`);
        },
        async closeOverlay(input) {
          options.calls.push(`closeOverlay:${input.uri}`);
        },
        async queryDiagnostics() {
          return [];
        },
        async queryCodeActions() {
          return [];
        },
        async applyEditPlan() {
          return { applied: false, failureReason: 'plan_not_found' };
        },
        async queryIndexStatus() {
          queryIndexStatusCalls += 1;
          options.calls.push(`queryIndexStatus:${queryIndexStatusCalls}`);
          if (options.failIndexStatus) {
            throw new Error('Daemon connection closed');
          }
          const results = options.statusResults ?? [
            {
              workspaceId: options.workspaceId,
              workspaceInstanceId: `${options.workspaceId}-instance`,
              status: 'ready' as const,
              replayState: 'applied' as const,
              replayEpoch: 1,
              workspaceReady: true,
              indexedFileCount: 1,
              openDocumentCount: 1,
              overlayCount: 1,
              analysisGeneration: 1,
            },
          ];
          return results[Math.min(queryIndexStatusCalls - 1, results.length - 1)]!;
        },
      };
    }

    const server = new CodepolLspServer({
      clientInstanceId: 'lsp-progress-reconnect-instance',
      clientSessionId: 'lsp-progress-reconnect-session',
      serviceFactory: async () => {
        serviceFactoryCalls += 1;
        return serviceFactoryCalls === 1
          ? serviceMockCreate({
              calls: firstCalls,
              daemonSessionId: 'daemon-1',
              workspaceId: 'workspace-a',
              failIndexStatus: true,
            })
          : serviceMockCreate({
              calls: secondCalls,
              daemonSessionId: 'daemon-2',
              workspaceId: 'workspace-b',
              statusResults: [
                {
                  workspaceId: 'workspace-b',
                  workspaceInstanceId: 'workspace-b-instance',
                  status: 'cold',
                  replayState: 'applied',
                  replayEpoch: 1,
                  workspaceReady: false,
                  indexedFileCount: 0,
                  openDocumentCount: 1,
                  overlayCount: 1,
                  analysisGeneration: 0,
                },
                {
                  workspaceId: 'workspace-b',
                  workspaceInstanceId: 'workspace-b-instance',
                  status: 'cold',
                  replayState: 'applied',
                  replayEpoch: 1,
                  workspaceReady: false,
                  indexedFileCount: 0,
                  openDocumentCount: 1,
                  overlayCount: 1,
                  analysisGeneration: 0,
                },
                {
                  workspaceId: 'workspace-b',
                  workspaceInstanceId: 'workspace-b-instance',
                  status: 'ready',
                  replayState: 'applied',
                  replayEpoch: 1,
                  workspaceReady: true,
                  indexedFileCount: 1,
                  openDocumentCount: 1,
                  overlayCount: 1,
                  analysisGeneration: 1,
                },
              ],
            });
      },
      sendMessage: (message) => {
        messages.push(message);
      },
      timers: timers.timers,
      statusPollIntervalsMs: {
        active: 0,
        idle: 0,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
        capabilities: {
          window: {
            workDoneProgress: true,
          },
        },
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fileText,
        },
      },
    });

    expect(timers.pendingCountGet()).toBe(1);
    await timers.runNext();

    expect(serviceFactoryCalls).toBe(2);
    expect(firstCalls).toContain('queryIndexStatus:1');
    for (
      let attempt = 0;
      attempt < 20 && !secondCalls.includes('register:lsp-progress-reconnect-session');
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(secondCalls).toContain('register:lsp-progress-reconnect-session');
    expect(secondCalls).toContain('attachWorkspace');
    expect(secondCalls).toContain('subscribeDiagnostics:workspace');
    expect(secondCalls).toContain(`openOverlay:${uri}@1`);
    expect(secondCalls).toContain('completeReplay');
    expect(secondCalls).toContain('queryIndexStatus:1');

    expect(timers.pendingCountGet()).toBe(1);
    await timers.runNext();
    await timers.runNext();

    const progressCreates = messages.filter(
      (message) => message.method === 'window/workDoneProgress/create',
    );
    const progressUpdates = messages.filter((message) => message.method === '$/progress');
    expect(secondCalls).toContain('queryIndexStatus:2');
    expect(secondCalls).toContain('queryIndexStatus:3');
    expect(progressCreates).toHaveLength(1);
    expect(progressUpdates.map((message) => message.params.value.kind)).toEqual([
      'begin',
      'end',
    ]);
    expect(progressUpdates[0]?.params.value.message).toBe('Preparing workspace index');
    expect(progressUpdates[1]?.params.value.message).toBe('Workspace ready (1 indexed files)');

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'shutdown',
    });
    expect(timers.pendingCountGet()).toBe(0);
  });

  it('supports an async daemon-backed service factory during initialize and publish flow', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const { descriptor } = workspaceDaemonDescriptorCreate({
      runtimeDir: workspaceRoot,
    });
    const connect = daemonConnectCreate({
      descriptor,
      service: new WorkspaceServiceEngine(),
    });
    const messages: any[] = [];
    let serviceFactoryCalls = 0;

    const server = new CodepolLspServer({
      serviceFactory: async () => {
        serviceFactoryCalls += 1;
        const connection = await connect(descriptor);
        await workspaceDaemonHello({
          connection,
          client: daemonClientIdentityCreate('lsp-service-factory'),
        });
        return new WorkspaceDaemonServiceClient(connection);
      },
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fs.readFileSync(filePath, 'utf8'),
        },
      },
    });

    const publish = messages.find((message) => message.method === 'textDocument/publishDiagnostics');
    expect(serviceFactoryCalls).toBe(1);
    expect(publish?.params.diagnostics).toHaveLength(1);
  });

  it('preserves initialize/open/change/close diagnostics behavior through a daemon-backed service factory', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const { descriptor } = workspaceDaemonDescriptorCreate({
      runtimeDir: workspaceRoot,
    });
    const connect = daemonConnectCreate({
      descriptor,
      service: new WorkspaceServiceEngine(),
    });
    const messages: any[] = [];
    let serviceFactoryCalls = 0;

    const server = new CodepolLspServer({
      serviceFactory: async () => {
        serviceFactoryCalls += 1;
        const connection = await connect(descriptor);
        await workspaceDaemonHello({
          connection,
          client: daemonClientIdentityCreate('lsp-service-factory-open-change-close'),
        });
        return new WorkspaceDaemonServiceClient(connection);
      },
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fs.readFileSync(filePath, 'utf8'),
        },
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: 'export type User = {\n  name: string;\n};\n' }],
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didClose',
      params: {
        textDocument: { uri },
      },
    });

    const publishMessages = messages.filter(
      (message) => message.method === 'textDocument/publishDiagnostics',
    );
    expect(serviceFactoryCalls).toBe(1);
    expect(publishMessages).toHaveLength(3);
    expect(publishMessages[0]?.params.diagnostics).toHaveLength(1);
    expect(publishMessages[1]?.params.diagnostics).toEqual([]);
    expect(publishMessages[2]?.params.diagnostics).toHaveLength(1);
  });

  it('reconnects, re-attaches, and replays open documents after daemon loss', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    const fileText = 'export interface User {\n  name: string;\n}\n';
    fs.writeFileSync(filePath, fileText, 'utf8');

    const messages: any[] = [];
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    let serviceFactoryCalls = 0;

    function serviceMockCreate(options: {
      calls: string[];
      daemonSessionId: string;
      workspaceId: string;
      failQueryDiagnostics?: boolean;
    }): WorkspaceService {
      return {
        ...workspaceReadQueriesStubCreate(),
        async registerClientSession(input) {
          options.calls.push(`register:${input.clientSessionId ?? 'generated'}`);
          return {
            clientSessionId: input.clientSessionId ?? 'client-1',
            daemonSessionId: options.daemonSessionId,
          };
        },
        async closeClientSession() {
          options.calls.push('closeClientSession');
        },
        async attachWorkspace() {
          options.calls.push('attachWorkspace');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
          };
        },
        async subscribeDiagnostics(input) {
          options.calls.push(`subscribeDiagnostics:${input.scope}`);
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            scope: input.scope,
            subscriptionState: 'active',
          };
        },
        async completeReplay() {
          options.calls.push('completeReplay');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            replayEpoch: 1,
            replayState: 'applied',
          };
        },
        async openOverlay(input) {
          options.calls.push(`openOverlay:${input.uri}`);
        },
        async updateOverlay(input) {
          options.calls.push(`updateOverlay:${input.uri}`);
        },
        async closeOverlay(input) {
          options.calls.push(`closeOverlay:${input.uri}`);
        },
        async queryDiagnostics(input) {
          options.calls.push(`queryDiagnostics:${input.uri ?? '*'}`);
          if (options.failQueryDiagnostics) {
            throw new Error('Daemon connection closed');
          }
          return [
            {
              id: 'diag-1',
              uri: input.uri ?? uri,
              source: 'codepol',
              code: 'no-interface',
              severity: 'error',
              message: 'Interfaces are not allowed.',
              range: {
                start: { line: 0, character: 7 },
                end: { line: 0, character: 16 },
              },
            },
          ];
        },
        async queryCodeActions() {
          options.calls.push('queryCodeActions');
          return [];
        },
        async applyEditPlan() {
          options.calls.push('applyEditPlan');
          return { applied: false, failureReason: 'plan_not_found' };
        },
        async queryIndexStatus() {
          options.calls.push('queryIndexStatus');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            status: 'ready',
            indexedFileCount: 1,
            openDocumentCount: 1,
            overlayCount: 1,
            analysisGeneration: 1,
          };
        },
      };
    }

    const server = new CodepolLspServer({
      clientInstanceId: 'lsp-reconnect-instance',
      clientSessionId: 'lsp-reconnect-session',
      serviceFactory: async () => {
        serviceFactoryCalls += 1;
        return serviceFactoryCalls === 1
          ? serviceMockCreate({
              calls: firstCalls,
              daemonSessionId: 'daemon-1',
              workspaceId: 'workspace-a',
              failQueryDiagnostics: true,
            })
          : serviceMockCreate({
              calls: secondCalls,
              daemonSessionId: 'daemon-2',
              workspaceId: 'workspace-b',
            });
      },
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fileText,
        },
      },
    });

    const publish = messages.find((message) => message.method === 'textDocument/publishDiagnostics');
    expect(serviceFactoryCalls).toBe(2);
    expect(firstCalls).toContain(`queryDiagnostics:${uri}`);
    expect(secondCalls).toContain('register:lsp-reconnect-session');
    expect(secondCalls).toContain('attachWorkspace');
    expect(secondCalls).toContain('subscribeDiagnostics:workspace');
    expect(secondCalls).toContain(`openOverlay:${uri}`);
    expect(secondCalls).toContain('completeReplay');
    expect(publish?.params.diagnostics).toHaveLength(1);
  });

  it('refreshes diagnostics from the reconnected daemon instead of preserving stale continuity', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const messages: any[] = [];
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    let serviceFactoryCalls = 0;

    function serviceMockCreate(options: {
      calls: string[];
      daemonSessionId: string;
      workspaceId: string;
      failOnDocumentVersion?: number;
      diagnosticsByDocumentVersion: Record<number, WorkspaceDiagnostic[]>;
    }): WorkspaceService {
      return {
        ...workspaceReadQueriesStubCreate(),
        async registerClientSession(input) {
          options.calls.push(`register:${input.clientSessionId ?? 'generated'}`);
          return {
            clientSessionId: input.clientSessionId ?? 'client-1',
            daemonSessionId: options.daemonSessionId,
          };
        },
        async closeClientSession() {
          options.calls.push('closeClientSession');
        },
        async attachWorkspace() {
          options.calls.push('attachWorkspace');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
          };
        },
        async subscribeDiagnostics(input) {
          options.calls.push(`subscribeDiagnostics:${input.scope}`);
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            scope: input.scope,
            subscriptionState: 'active',
          };
        },
        async completeReplay() {
          options.calls.push('completeReplay');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            replayEpoch: 1,
            replayState: 'applied',
          };
        },
        async openOverlay(input) {
          options.calls.push(`openOverlay:${input.uri}@${input.version}`);
        },
        async updateOverlay(input) {
          options.calls.push(`updateOverlay:${input.uri}@${input.version}`);
        },
        async closeOverlay(input) {
          options.calls.push(`closeOverlay:${input.uri}`);
        },
        async queryDiagnostics(input) {
          const version = input.documentVersion ?? 0;
          options.calls.push(`queryDiagnostics:${input.uri ?? '*'}@${version}`);
          if (options.failOnDocumentVersion === version) {
            throw new Error('Daemon connection closed');
          }
          return options.diagnosticsByDocumentVersion[version] ?? [];
        },
        async queryCodeActions() {
          options.calls.push('queryCodeActions');
          return [];
        },
        async applyEditPlan() {
          options.calls.push('applyEditPlan');
          return { applied: false, failureReason: 'plan_not_found' };
        },
        async queryIndexStatus() {
          options.calls.push('queryIndexStatus');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            status: 'ready',
            indexedFileCount: 1,
            openDocumentCount: 1,
            overlayCount: 1,
            analysisGeneration: 1,
          };
        },
      };
    }

    const staleDiagnostic: WorkspaceDiagnostic = {
      id: 'diag-stale',
      uri,
      source: 'codepol',
      code: 'no-interface',
      severity: 'error',
      message: 'Interfaces are not allowed.',
      range: {
        start: { line: 0, character: 7 },
        end: { line: 0, character: 16 },
      },
    };

    const server = new CodepolLspServer({
      clientInstanceId: 'lsp-restart-refresh-instance',
      clientSessionId: 'lsp-restart-refresh-session',
      serviceFactory: async () => {
        serviceFactoryCalls += 1;
        return serviceFactoryCalls === 1
          ? serviceMockCreate({
              calls: firstCalls,
              daemonSessionId: 'daemon-1',
              workspaceId: 'workspace-a',
              failOnDocumentVersion: 2,
              diagnosticsByDocumentVersion: {
                1: [staleDiagnostic],
              },
            })
          : serviceMockCreate({
              calls: secondCalls,
              daemonSessionId: 'daemon-2',
              workspaceId: 'workspace-b',
              diagnosticsByDocumentVersion: {
                2: [],
              },
            });
      },
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fs.readFileSync(filePath, 'utf8'),
        },
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: 'export type User = {\n  name: string;\n};\n' }],
      },
    });

    const publishMessages = messages.filter(
      (message) => message.method === 'textDocument/publishDiagnostics',
    );
    expect(serviceFactoryCalls).toBe(2);
    expect(firstCalls).toContain(`queryDiagnostics:${uri}@1`);
    expect(firstCalls).toContain(`queryDiagnostics:${uri}@2`);
    expect(secondCalls).toContain('register:lsp-restart-refresh-session');
    expect(secondCalls).toContain('attachWorkspace');
    expect(secondCalls).toContain('subscribeDiagnostics:workspace');
    expect(secondCalls).toContain(`openOverlay:${uri}@2`);
    expect(secondCalls).toContain('completeReplay');
    expect(secondCalls).toContain(`updateOverlay:${uri}@2`);
    expect(secondCalls).toContain(`queryDiagnostics:${uri}@2`);
    expect(publishMessages).toHaveLength(2);
    expect(publishMessages[0]?.params.diagnostics).toHaveLength(1);
    expect(publishMessages[1]?.params.diagnostics).toEqual([]);
  });

  it('reconnects and replays open documents before retrying a semantic definition read', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const sharedPath = path.join(workspaceRoot, 'src', 'shared.ts');
    const sharedUri = pathToFileURL(sharedPath).href;
    const sharedText = 'export const sharedValue = 1;\n';
    fs.writeFileSync(sharedPath, sharedText, 'utf8');

    const messages: any[] = [];
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    let serviceFactoryCalls = 0;

    function serviceMockCreate(options: {
      calls: string[];
      daemonSessionId: string;
      workspaceId: string;
      failSemanticDefinition?: boolean;
    }): WorkspaceService {
      return {
        ...workspaceReadQueriesStubCreate(),
        async registerClientSession(input) {
          options.calls.push(`register:${input.clientSessionId ?? 'generated'}`);
          return {
            clientSessionId: input.clientSessionId ?? 'client-1',
            daemonSessionId: options.daemonSessionId,
          };
        },
        async closeClientSession() {
          options.calls.push('closeClientSession');
        },
        async attachWorkspace() {
          options.calls.push('attachWorkspace');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
          };
        },
        async subscribeDiagnostics(input) {
          options.calls.push(`subscribeDiagnostics:${input.scope}`);
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            scope: input.scope,
            subscriptionState: 'active',
          };
        },
        async completeReplay() {
          options.calls.push('completeReplay');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            replayEpoch: 1,
            replayState: 'applied',
          };
        },
        async openOverlay(input) {
          options.calls.push(`openOverlay:${input.uri}@${input.version}`);
        },
        async updateOverlay(input) {
          options.calls.push(`updateOverlay:${input.uri}@${input.version}`);
        },
        async closeOverlay(input) {
          options.calls.push(`closeOverlay:${input.uri}`);
        },
        async queryDiagnostics() {
          options.calls.push('queryDiagnostics');
          return [];
        },
        async queryCodeActions() {
          options.calls.push('queryCodeActions');
          return [];
        },
        async applyEditPlan() {
          options.calls.push('applyEditPlan');
          return { applied: false, failureReason: 'plan_not_found' };
        },
        async queryIndexStatus() {
          options.calls.push('queryIndexStatus');
          return {
            workspaceId: options.workspaceId,
            workspaceInstanceId: `${options.workspaceId}-instance`,
            status: 'ready',
            indexedFileCount: 1,
            openDocumentCount: 1,
            overlayCount: 1,
            analysisGeneration: 1,
          };
        },
        async querySemanticDefinition(input) {
          options.calls.push(`querySemanticDefinition:${input.uri}`);
          if (options.failSemanticDefinition) {
            throw new Error('Daemon connection closed');
          }
          return {
            kind: 'single_location',
            target: {
              uri: input.uri,
              semanticClass: 'architecture_node',
            },
            location: {
              uri: input.uri,
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
            },
            source: 'codepol',
            semanticClass: 'architecture_node',
          };
        },
      };
    }

    const server = new CodepolLspServer({
      clientInstanceId: 'lsp-semantic-reconnect-instance',
      clientSessionId: 'lsp-semantic-reconnect-session',
      serviceFactory: async () => {
        serviceFactoryCalls += 1;
        return serviceFactoryCalls === 1
          ? serviceMockCreate({
              calls: firstCalls,
              daemonSessionId: 'daemon-1',
              workspaceId: 'workspace-a',
              failSemanticDefinition: true,
            })
          : serviceMockCreate({
              calls: secondCalls,
              daemonSessionId: 'daemon-2',
              workspaceId: 'workspace-b',
            });
      },
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: sharedUri,
          version: 1,
          text: `${sharedText}export const overlayValue = 2;\n`,
        },
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'codepol/semanticDefinition',
      params: {
        uri: sharedUri,
      },
    });

    expect(serviceFactoryCalls).toBe(2);
    expect(firstCalls).toContain(`querySemanticDefinition:${sharedUri}`);
    expect(secondCalls).toContain('register:lsp-semantic-reconnect-session');
    expect(secondCalls).toContain('attachWorkspace');
    expect(secondCalls).toContain('subscribeDiagnostics:workspace');
    expect(secondCalls).toContain(`openOverlay:${sharedUri}@1`);
    expect(secondCalls).toContain('completeReplay');
    expect(secondCalls).toContain(`querySemanticDefinition:${sharedUri}`);
    expect(messages.find((message) => message.id === 2)?.result).toEqual({
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
  });

  it('resolves a daemon-backed workspace service by default', async () => {
    const runtimeDir = tempWorkspaceCreate('codepol-lsp-daemon-runtime-');
    createdDirs.push(runtimeDir);

    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-daemon-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    const connect = daemonConnectCreate({
      descriptor,
      service: new WorkspaceServiceEngine(),
    });

    const service = await lspWorkspaceServiceResolve({
      env: {
        ...process.env,
        CODEPOL_DAEMON_RUNTIME_DIR: runtimeDir,
      },
      clientInstanceId: 'lsp-resolve-test',
      connect,
      startDaemon: async () => {
        throw new Error('startDaemon should not run for a healthy daemon descriptor');
      },
    });

    const registered = await service.registerClientSession({
      clientKind: 'lsp',
      clientInstanceId: 'resolved-service-client',
    });
    const attached = await service.attachWorkspace({
      clientSessionId: registered.clientSessionId,
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    await service.completeReplay({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      workspaceInstanceId: attached.workspaceInstanceId,
    });
    const diagnostics = await service.queryDiagnostics({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri,
    });

    expect(registered.daemonSessionId).toBeDefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('uses an in-process workspace service when explicitly requested', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-in-process-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    let startDaemonCalls = 0;
    const resolved: Array<{ mode: string }> = [];
    const service = await lspWorkspaceServiceResolve({
      env: {
        ...process.env,
        CODEPOL_WORKSPACE_SERVICE_MODE: 'in_process',
      },
      clientInstanceId: 'lsp-in-process-test',
      startDaemon: async () => {
        startDaemonCalls += 1;
      },
      onResolved: (info) => {
        resolved.push({
          mode: info.mode,
        });
      },
    });

    const registered = await service.registerClientSession({
      clientKind: 'lsp',
      clientInstanceId: 'resolved-service-client',
    });
    const attached = await service.attachWorkspace({
      clientSessionId: registered.clientSessionId,
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    const diagnostics = await service.queryDiagnostics({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri,
    });

    expect(startDaemonCalls).toBe(0);
    expect(resolved).toEqual([{ mode: 'in_process' }]);
    expect(registered.daemonSessionId).toBeDefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('falls back to an in-process workspace service when daemon startup fails', async () => {
    const runtimeDir = tempWorkspaceCreate('codepol-lsp-daemon-runtime-');
    createdDirs.push(runtimeDir);

    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-daemon-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const resolved: Array<{ mode: string; error?: string }> = [];
    const service = await lspWorkspaceServiceResolve({
      env: {
        ...process.env,
        CODEPOL_DAEMON_RUNTIME_DIR: runtimeDir,
      },
      clientInstanceId: 'lsp-fallback-test',
      startDaemon: async () => {
        throw new Error('daemon launch failed');
      },
      onResolved: (info) => {
        resolved.push({
          mode: info.mode,
          error: 'error' in info ? info.error.message : undefined,
        });
      },
    });

    const registered = await service.registerClientSession({
      clientKind: 'lsp',
      clientInstanceId: 'resolved-service-client',
    });
    const attached = await service.attachWorkspace({
      clientSessionId: registered.clientSessionId,
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    const diagnostics = await service.queryDiagnostics({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri,
    });

    expect(resolved).toEqual([
      {
        mode: 'in_process_fallback',
        error: 'daemon launch failed',
      },
    ]);
    expect(registered.daemonSessionId).toBeDefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('falls back to an in-process workspace service when daemon install ids differ', async () => {
    const runtimeDir = tempWorkspaceCreate('codepol-lsp-daemon-runtime-');
    createdDirs.push(runtimeDir);

    const { descriptor } = workspaceDaemonDescriptorCreate({
      runtimeDir,
      installId: 'stable',
    });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);

    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-daemon-workspace-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    let startDaemonCalls = 0;
    const resolved: Array<{ mode: string; error?: string }> = [];
    const service = await lspWorkspaceServiceResolve({
      env: {
        ...process.env,
        CODEPOL_DAEMON_RUNTIME_DIR: runtimeDir,
        CODEPOL_INSTALL_ID: 'insiders',
      },
      clientInstanceId: 'lsp-install-mismatch-test',
      connect: daemonConnectCreate({
        descriptor,
        service: new WorkspaceServiceEngine(),
      }),
      startDaemon: async () => {
        startDaemonCalls += 1;
      },
      onResolved: (info) => {
        resolved.push({
          mode: info.mode,
          error: 'error' in info ? info.error.message : undefined,
        });
      },
    });

    const registered = await service.registerClientSession({
      clientKind: 'lsp',
      clientInstanceId: 'resolved-install-mismatch-client',
    });
    const attached = await service.attachWorkspace({
      clientSessionId: registered.clientSessionId,
      rootPath: workspaceRoot,
      configPath: path.join(workspaceRoot, 'codepol.toml'),
    });
    const diagnostics = await service.queryDiagnostics({
      clientSessionId: registered.clientSessionId,
      workspaceId: attached.workspaceId,
      uri,
    });

    expect(startDaemonCalls).toBe(0);
    expect(resolved).toEqual([
      {
        mode: 'in_process_fallback',
        error: 'Daemon handshake failed: unexpected_install_id',
      },
    ]);
    expect(registered.daemonSessionId).toBeDefined();
    expect(diagnostics).toHaveLength(1);
  });

  it('publishes diagnostics across open, change, and close', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const messages: any[] = [];
    const server = new CodepolLspServer({
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fs.readFileSync(filePath, 'utf8'),
        },
      },
    });

    const firstPublish = messages.find((message) => message.method === 'textDocument/publishDiagnostics');
    expect(firstPublish?.params.diagnostics).toHaveLength(1);

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: 'export type User = {\n  name: string;\n};\n' }],
      },
    });

    const publishMessages = messages.filter((message) => message.method === 'textDocument/publishDiagnostics');
    expect(publishMessages[1]?.params.diagnostics).toEqual([]);

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didClose',
      params: {
        textDocument: { uri },
      },
    });

    const finalPublish = messages.filter((message) => message.method === 'textDocument/publishDiagnostics')[2];
    expect(finalPublish?.params.diagnostics).toHaveLength(1);
  });

  it('forwards the current document version when querying diagnostics for open overlays', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    const seenDocumentVersions: Array<number | undefined> = [];

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics(input) {
        seenDocumentVersions.push(input.documentVersion);
        return [];
      },
      async queryCodeActions() {
        return [];
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const server = new CodepolLspServer({
      service,
      sendMessage: () => {},
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: 'export interface User {\n  name: string;\n}\n',
        },
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: 'export type User = {\n  name: string;\n};\n' }],
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didClose',
      params: {
        textDocument: { uri },
      },
    });

    expect(seenDocumentVersions).toEqual([1, 2, undefined]);
  });

  it('suppresses stale diagnostics when an older query resolves after a newer change', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    const diagnosticsResolvers: Array<(value: any[]) => void> = [];

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        return new Promise((resolve) => {
          diagnosticsResolvers.push(resolve);
        });
      },
      async queryCodeActions() {
        return [];
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const messages: any[] = [];
    const server = new CodepolLspServer({
      service,
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    const openPromise = server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: 'export interface User {\n  name: string;\n}\n',
        },
      },
    });

    for (let attempt = 0; attempt < 20 && diagnosticsResolvers.length < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(diagnosticsResolvers).toHaveLength(1);

    const changePromise = server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: 'export type User = {\n  name: string;\n};\n' }],
      },
    });

    for (let attempt = 0; attempt < 20 && diagnosticsResolvers.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(diagnosticsResolvers).toHaveLength(2);

    diagnosticsResolvers[1]!([]);
    await changePromise;

    diagnosticsResolvers[0]!([
      {
        id: 'diag-1',
        uri,
        source: 'codepol',
        code: 'no-interface',
        severity: 'error',
        message: 'Interfaces are not allowed.',
        range: {
          start: { line: 0, character: 7 },
          end: { line: 0, character: 16 },
        },
      },
    ]);
    await openPromise;

    const publishMessages = messages.filter(
      (message) => message.method === 'textDocument/publishDiagnostics',
    );
    expect(publishMessages).toHaveLength(1);
    expect(publishMessages[0]?.params.diagnostics).toEqual([]);
  });

  it('suppresses superseded diagnostics without failing the notification flow', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    const messages: any[] = [];

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        throw new Error('Request superseded');
      },
      async queryCodeActions() {
        return [];
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const server = new CodepolLspServer({
      service,
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await expect(
      server.handleMessage({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri,
            version: 1,
            text: 'export interface User {\n  name: string;\n}\n',
          },
        },
      }),
    ).resolves.toBeUndefined();

    expect(
      messages.filter((message) => message.method === 'textDocument/publishDiagnostics'),
    ).toEqual([]);
  });

  it('returns request-cancelled when a code action request is canceled in flight', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const uri = pathToFileURL(filePath).href;
    let resolveCodeActions: ((value: WorkspaceCodeAction[]) => void) | undefined;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
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
        return new Promise((resolve) => {
          resolveCodeActions = resolve;
        });
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const messages: any[] = [];
    const server = new CodepolLspServer({
      service,
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    const requestPromise = server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri },
        context: {
          diagnostics: [{ data: { id: 'diag-1' } }],
        },
      },
    });

    for (let attempt = 0; attempt < 20 && !resolveCodeActions; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(resolveCodeActions).toBeDefined();

    await server.handleMessage({
      jsonrpc: '2.0',
      method: '$/cancelRequest',
      params: {
        id: 2,
      },
    });

    resolveCodeActions!([]);
    await requestPromise;

    const response = messages.find((message) => message.id === 2);
    expect(response?.error).toEqual({
      code: -32800,
      message: 'Request cancelled',
    });
    expect(response?.result).toBeUndefined();
  });

  it('returns request-cancelled when a semantic references request is canceled in flight', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const uri = pathToFileURL(filePath).href;
    let resolveSemanticReferences:
      | ((value: Awaited<ReturnType<WorkspaceService['querySemanticReferences']>>) => void)
      | undefined;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
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
      async querySemanticReferences() {
        return new Promise((resolve) => {
          resolveSemanticReferences = resolve;
        });
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const messages: any[] = [];
    const server = new CodepolLspServer({
      service,
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    const requestPromise = server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'codepol/semanticReferences',
      params: {
        uri,
      },
    });

    for (let attempt = 0; attempt < 20 && !resolveSemanticReferences; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(resolveSemanticReferences).toBeDefined();

    await server.handleMessage({
      jsonrpc: '2.0',
      method: '$/cancelRequest',
      params: {
        id: 2,
      },
    });

    resolveSemanticReferences!(null);
    await requestPromise;

    const response = messages.find((message) => message.id === 2);
    expect(response?.error).toEqual({
      code: -32800,
      message: 'Request cancelled',
    });
    expect(response?.result).toBeUndefined();
  });

  it('returns request-cancelled when a rename preview request is canceled in flight', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const uri = pathToFileURL(filePath).href;
    let resolveRenamePreview:
      | ((value: Awaited<ReturnType<WorkspaceService['previewRename']>>) => void)
      | undefined;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
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
      async previewRename() {
        return new Promise((resolve) => {
          resolveRenamePreview = resolve;
        });
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const messages: any[] = [];
    const server = new CodepolLspServer({
      service,
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    const requestPromise = server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'codepol/previewRename',
      params: {
        target: {
          semanticClass: 'architecture_node',
          uri,
        },
        newName: 'app-renamed',
      },
    });

    for (let attempt = 0; attempt < 20 && !resolveRenamePreview; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(resolveRenamePreview).toBeDefined();

    await server.handleMessage({
      jsonrpc: '2.0',
      method: '$/cancelRequest',
      params: {
        id: 2,
      },
    });

    resolveRenamePreview!({
      ok: false,
      code: 'not_renameable_class',
      message: 'Semantic class architecture_node is not renameable in MVP.',
    });
    await requestPromise;

    const response = messages.find((message) => message.id === 2);
    expect(response?.error).toEqual({
      code: -32800,
      message: 'Request cancelled',
    });
    expect(response?.result).toBeUndefined();
  });

  it('returns code actions for a related diagnostic range when the editor sends no diagnostic ids', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export const x = 1;\nexport default x;\n', 'utf8');
    const uri = pathToFileURL(filePath).href;

    const seenDiagnosticIds: string[][] = [];
    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        return [
          {
            id: 'diag-1',
            uri,
            source: 'codepol',
            code: 'no-mixed-exports',
            severity: 'error',
            message: 'Do not mix default exports with named exports in the same module; prefer named exports for mixed modules.',
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 16 },
            },
            relatedLocations: [
              {
                uri,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 19 },
                },
                message: 'Additional export in mixed module',
              },
            ],
          },
        ];
      },
      async queryCodeActions(input) {
        seenDiagnosticIds.push(input.diagnosticIds ?? []);
        if (!input.diagnosticIds?.includes('diag-1')) {
          return [];
        }
        return [
          {
            id: 'action-1',
            title: 'Fix no-mixed-exports',
            kind: 'quickfix',
            diagnosticIds: ['diag-1'],
            isPreferred: true,
            plan: {
              id: 'plan-1',
              title: 'Fix no-mixed-exports',
              kind: 'quickfix',
              edits: [],
              diagnosticIds: ['diag-1'],
              isPreferred: true,
            },
          },
        ];
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const messages: any[] = [];
    const server = new CodepolLspServer({
      service,
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        context: {
          diagnostics: [],
        },
      },
    });

    const codeActionResponse = messages.find((message) => message.id === 2);
    expect(codeActionResponse?.result).toHaveLength(1);
    expect(seenDiagnosticIds).toEqual([['diag-1']]);
  });

  it('publishes same-file related locations as separate diagnostics that keep the primary fix id', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export const x = 1;\nexport default x;\n', 'utf8');
    const uri = pathToFileURL(filePath).href;

    const service: WorkspaceService = {
      ...workspaceReadQueriesStubCreate(),
      async registerClientSession() {
        return {
          clientSessionId: 'client-1',
          daemonSessionId: 'daemon-1',
        };
      },
      async closeClientSession() {},
      async attachWorkspace() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
        };
      },
      async subscribeDiagnostics() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          scope: 'workspace',
          subscriptionState: 'active',
        };
      },
      async completeReplay() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          replayEpoch: 1,
          replayState: 'applied',
        };
      },
      async openOverlay() {},
      async updateOverlay() {},
      async closeOverlay() {},
      async queryDiagnostics() {
        return [
          {
            id: 'diag-1',
            uri,
            source: 'codepol',
            code: 'no-mixed-exports',
            severity: 'error',
            message: 'Do not mix default exports with named exports in the same module; prefer named exports for mixed modules.',
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 16 },
            },
            relatedLocations: [
              {
                uri,
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 19 },
                },
                message: 'Additional export in mixed module',
              },
            ],
          },
        ];
      },
      async queryCodeActions(input) {
        if (!input.diagnosticIds?.includes('diag-1')) {
          return [];
        }
        return [
          {
            id: 'action-1',
            title: 'Fix no-mixed-exports',
            kind: 'quickfix',
            diagnosticIds: ['diag-1'],
            isPreferred: true,
            plan: {
              id: 'plan-1',
              title: 'Fix no-mixed-exports',
              kind: 'quickfix',
              edits: [],
              diagnosticIds: ['diag-1'],
              isPreferred: true,
            },
          },
        ];
      },
      async applyEditPlan() {
        return { applied: false, failureReason: 'plan_not_found' };
      },
      async queryIndexStatus() {
        return {
          workspaceId: 'workspace-1',
          workspaceInstanceId: 'workspace-instance-1',
          status: 'cold',
          indexedFileCount: 0,
          openDocumentCount: 0,
          overlayCount: 0,
          analysisGeneration: 0,
        };
      },
    };

    const messages: any[] = [];
    const server = new CodepolLspServer({
      service,
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fs.readFileSync(filePath, 'utf8'),
        },
      },
    });

    const publish = messages.find((message) => message.method === 'textDocument/publishDiagnostics');
    expect(publish?.params.diagnostics).toHaveLength(2);
    expect(publish?.params.diagnostics[1]?.message).toBe('Additional export in mixed module');
    expect(publish?.params.diagnostics[1]?.data?.id).toBe('diag-1');

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri },
        range: publish.params.diagnostics[1].range,
        context: {
          diagnostics: [publish.params.diagnostics[1]],
        },
      },
    });

    const codeActionResponse = messages.find((message) => message.id === 2);
    expect(codeActionResponse?.result).toHaveLength(1);
  });

  it('returns code actions and applies edit plans through workspace/applyEdit', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'codepol.toml'), noInterfaceConfigContentCreate(), 'utf8');

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    fs.writeFileSync(filePath, 'export interface User {\n  name: string;\n}\n', 'utf8');

    const messages: any[] = [];
    const server = new CodepolLspServer({
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: fs.readFileSync(filePath, 'utf8'),
        },
      },
    });

    const publish = messages.find((message) => message.method === 'textDocument/publishDiagnostics');
    const diagnostic = publish?.params.diagnostics[0];
    expect(diagnostic).toBeDefined();

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri },
        context: {
          diagnostics: [diagnostic],
        },
      },
    });

    const codeActionResponse = messages.find((message) => message.id === 2);
    expect(codeActionResponse?.result).toHaveLength(1);

    const executePromise = server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'workspace/executeCommand',
      params: codeActionResponse.result[0].command,
    });

    const applyEditRequest = await messageWaitFor(
      messages,
      (message) => message.method === 'workspace/applyEdit',
    );
    expect(applyEditRequest?.params.edit.changes[uri]).toHaveLength(1);

    await server.handleMessage({
      jsonrpc: '2.0',
      id: applyEditRequest.id,
      result: { applied: true },
    });
    await executePromise;

    const executeResponse = messages.find((message) => message.id === 3);
    expect(executeResponse?.result).toBeNull();
  });

  it('preserves migrated no-unused-vars diagnostics and fixes through LSP code actions', async () => {
    const workspaceRoot = tempWorkspaceCreate('codepol-lsp-');
    createdDirs.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, 'codepol.toml'),
      noUnusedVarsConfigContentCreate(),
      'utf8',
    );

    const filePath = path.join(workspaceRoot, 'src', 'app.ts');
    const uri = pathToFileURL(filePath).href;
    const source = `function demo() {
  const unused = 1;
  return 1;
}

demo();
`;
    fs.writeFileSync(filePath, source, 'utf8');

    const messages: any[] = [];
    const server = new CodepolLspServer({
      sendMessage: (message) => {
        messages.push(message);
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        rootUri: pathToFileURL(workspaceRoot).href,
      },
    });

    await server.handleMessage({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri,
          version: 1,
          text: source,
        },
      },
    });

    const publish = messages.find((message) => message.method === 'textDocument/publishDiagnostics');
    expect(publish?.params.diagnostics).toHaveLength(1);
    expect(publish?.params.diagnostics[0]).toEqual(
      expect.objectContaining({
        source: 'codepol',
        code: '@codepol/plugin/no-unused-vars',
        message: "'unused' is assigned a value but never used.",
      }),
    );

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri },
        context: {
          diagnostics: [publish.params.diagnostics[0]],
        },
      },
    });

    const codeActionResponse = messages.find((message) => message.id === 2);
    expect(codeActionResponse?.result).toHaveLength(1);
    expect(codeActionResponse?.result[0]).toEqual(
      expect.objectContaining({
        title: 'Fix @codepol/plugin/no-unused-vars',
        kind: 'quickfix',
      }),
    );

    const executePromise = server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'workspace/executeCommand',
      params: codeActionResponse.result[0].command,
    });

    const applyEditRequest = await messageWaitFor(
      messages,
      (message) => message.method === 'workspace/applyEdit',
    );
    expect(applyEditRequest?.params.label).toBe('Fix @codepol/plugin/no-unused-vars');
    expect(applyEditRequest?.params.edit.changes[uri]).toHaveLength(1);
    expect(applyEditRequest?.params.edit.changes[uri][0]).toEqual(
      expect.objectContaining({
        newText: '',
      }),
    );

    await server.handleMessage({
      jsonrpc: '2.0',
      id: applyEditRequest.id,
      result: { applied: true },
    });
    await executePromise;

    const executeResponse = messages.find((message) => message.id === 3);
    expect(executeResponse?.result).toBeNull();
  });
});
