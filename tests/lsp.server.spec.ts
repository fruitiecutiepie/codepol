import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceCodeAction } from '@codepol/core';
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

  it('resolves a daemon-backed workspace service when daemon mode is enabled', async () => {
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
        CODEPOL_WORKSPACE_SERVICE_MODE: 'daemon',
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

  it('falls back to an in-process workspace service when daemon mode startup fails', async () => {
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
        CODEPOL_WORKSPACE_SERVICE_MODE: 'daemon',
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
        CODEPOL_WORKSPACE_SERVICE_MODE: 'daemon',
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
});
