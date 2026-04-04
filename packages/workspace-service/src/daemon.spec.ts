import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  WorkspaceDaemonServiceClient,
  WorkspaceDaemonSession,
  WORKSPACE_DAEMON_PROTOCOL_VERSION,
} from './daemon.js';
import { WorkspaceServiceEngine } from './index.js';

function tempRuntimeDirCreate(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codepol-daemon-'));
}

function clientIdentityCreate(instanceId: string) {
  return {
    kind: 'test',
    clientVersion: '1.0.0',
    instanceId,
    supportedProtocols: [WORKSPACE_DAEMON_PROTOCOL_VERSION],
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
    expect(attached.workspaceInstanceId).toBeDefined();
    expect(diagnostics).toHaveLength(1);

    await service.close();
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

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'stale-workspace-instance-session',
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

    await expect(
      session.handleEnvelope({
        id: 2,
        type: 'register_client_session',
        clientKind: 'test',
        clientInstanceId: 'stale-replay-epoch-client',
        clientSessionId: 'stale-replay-epoch-session',
      }),
    ).resolves.toMatchObject({
      type: 'register_client_session_ack',
      clientSessionId: 'stale-replay-epoch-session',
    });

    const attachResponse = await session.handleEnvelope({
      id: 3,
      type: 'attach_workspace',
      clientSessionId: 'stale-replay-epoch-session',
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
        type: 'complete_replay',
        clientSessionId: 'stale-replay-epoch-session',
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
