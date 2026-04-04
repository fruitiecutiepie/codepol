import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  WorkspaceDaemonConnectFn,
  WorkspaceDaemonDescriptor,
  WorkspaceDaemonRequestClient,
} from './daemon.js';
import {
  workspaceDaemonDescriptorCreate,
  workspaceDaemonDescriptorRead,
  workspaceDaemonDescriptorWrite,
  workspaceDaemonLaunchOrConnect,
  workspaceDaemonRequestHandle,
  WORKSPACE_DAEMON_PROTOCOL_VERSION,
} from './daemon.js';

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

describe('workspace daemon control plane', () => {
  const runtimeDirs: string[] = [];
  const liveDescriptors = new Map<string, WorkspaceDaemonDescriptor>();

  afterEach(() => {
    liveDescriptors.clear();
    for (const runtimeDir of runtimeDirs.splice(0)) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
  });

  const connect: WorkspaceDaemonConnectFn = async (
    descriptor: WorkspaceDaemonDescriptor,
  ): Promise<WorkspaceDaemonRequestClient> => {
    const live = liveDescriptors.get(descriptor.transport.path);
    if (!live || live.sessionNonce !== descriptor.sessionNonce) {
      throw new Error('daemon unavailable');
    }
    return {
      async request<TResponse extends Record<string, unknown>>(
        message: Parameters<WorkspaceDaemonRequestClient['request']>[0],
      ): Promise<TResponse> {
        const response = workspaceDaemonRequestHandle({
          descriptor: live,
          message,
        });
        return response as unknown as TResponse;
      },
      async close(): Promise<void> {},
    };
  };

  it('persists the runtime descriptor and serves the hello contract', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    runtimeDirs.push(runtimeDir);

    const { descriptor } = workspaceDaemonDescriptorCreate({ runtimeDir });
    workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
    liveDescriptors.set(descriptor.transport.path, descriptor);

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

  it('launches once through the shared launcher and then reuses the healthy daemon', async () => {
    const runtimeDir = tempRuntimeDirCreate();
    runtimeDirs.push(runtimeDir);

    let descriptor: WorkspaceDaemonDescriptor | undefined;
    let startCalls = 0;

    const startDaemon = async () => {
      startCalls += 1;
      if (!descriptor) {
        const created = workspaceDaemonDescriptorCreate({ runtimeDir });
        descriptor = created.descriptor;
        workspaceDaemonDescriptorWrite(runtimeDir, descriptor);
        liveDescriptors.set(descriptor.transport.path, descriptor);
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
    runtimeDirs.push(runtimeDir);

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
        liveDescriptors.set(created.descriptor.transport.path, created.descriptor);
      },
    });

    expect(launched.launched).toBe(true);
    expect(startedDescriptor).toBeDefined();
    expect(launched.descriptor.sessionNonce).toBe(startedDescriptor?.sessionNonce);
    expect(launched.descriptor.sessionNonce).not.toBe('stale');
    await launched.connection.close();
  });
});
