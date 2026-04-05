import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspacePathToUri } from '@codepol/core';
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

describe('workspace daemon control plane', () => {
  const tempDirs: string[] = [];
  const liveDaemons = new Map<
    string,
    { descriptor: WorkspaceDaemonDescriptor; service?: WorkspaceServiceEngine }
  >();

  afterEach(() => {
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

  it('fails fast on install mismatch without attempting relaunch', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    tempDirs.push(runtimeDir);

    const { descriptor } = workspaceDaemonDescriptorCreate({
      runtimeDir,
      installId: 'stable',
    });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    liveDaemons.set(descriptor.transport.path, { descriptor });

    let startDaemonCalls = 0;
    await expect(
      workspaceDaemonLaunchOrConnect({
        runtimeDir,
        client: clientIdentityCreate('unexpected-install-client'),
        expectedInstallId: 'insiders',
        connect,
        startDaemon: async () => {
          startDaemonCalls += 1;
        },
      }),
    ).rejects.toThrow('Daemon handshake failed: unexpected_install_id');
    expect(startDaemonCalls).toBe(0);
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

    const warmCache = workspaceWarmCacheFsStoreCreate({ runtimeDir });
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
    });
    await expect(secondPromise).resolves.toEqual({
      type: 'query_diagnostics_ack',
      diagnostics: [],
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

    const server = await workspaceDaemonServerStart({ runtimeDir });

    expect(server.descriptor.transport.path).toBe(paths.socketPath);
    expect(workspaceDaemonDescriptorRead(runtimeDir)?.sessionNonce).toBe(
      server.descriptor.sessionNonce,
    );
    expect(fs.statSync(paths.socketPath).isSocket()).toBe(true);

    await server.stop();
    expect(fs.existsSync(paths.socketPath)).toBe(false);
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
});
