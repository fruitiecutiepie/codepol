import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const WORKSPACE_DAEMON_PROTOCOL_VERSION = '0.1';
export const WORKSPACE_DAEMON_ENGINE_VERSION =
  process.env.CODEPOL_ENGINE_VERSION ?? 'dev';
export const WORKSPACE_DAEMON_BUILD_ID = process.env.CODEPOL_BUILD_ID ?? 'dev';
export const WORKSPACE_DAEMON_INSTALL_ID =
  process.env.CODEPOL_INSTALL_ID ?? 'default';

type JsonObject = Record<string, unknown>;

export type WorkspaceDaemonTransport = {
  kind: 'unix_socket';
  path: string;
};

export type WorkspaceDaemonDescriptor = {
  transport: WorkspaceDaemonTransport;
  pid: number;
  startedAtUnixMs: number;
  protocolVersion: string;
  engineVersion: string;
  buildId: string;
  installId: string;
  sessionNonce: string;
  ownerUid?: string;
};

export type WorkspaceDaemonRuntimePaths = {
  runtimeDir: string;
  descriptorPath: string;
  socketPath: string;
  lockPath: string;
};

export type WorkspaceDaemonClientHello = {
  type: 'hello';
  protocolVersion: string;
  client: {
    kind: string;
    clientVersion: string;
    instanceId: string;
    supportedProtocols: string[];
    supportsFallbackModes: string[];
  };
  expected?: {
    installChannel?: string;
  };
};

type WorkspaceDaemonClientHelloMessage = Omit<WorkspaceDaemonEnvelope, 'id'> &
  WorkspaceDaemonClientHello;

export type WorkspaceDaemonHelloAck = {
  type: 'hello_ack';
  protocolVersion: string;
  compatibility: 'ok' | 'unsupported_protocol' | 'unexpected_install_id';
  daemon: {
    engineVersion: string;
    buildId: string;
    pid: number;
    sessionNonce: string;
  };
  capabilities: Record<string, boolean>;
};

export type WorkspaceDaemonErrorResponse = {
  type: 'error';
  code: string;
  message: string;
};

type WorkspaceDaemonEnvelope = {
  id: number;
  type: string;
} & JsonObject;

export type WorkspaceDaemonServer = {
  descriptor: WorkspaceDaemonDescriptor;
  paths: WorkspaceDaemonRuntimePaths;
  stop: () => Promise<void>;
};

type WorkspaceDaemonServerStartOptions = {
  runtimeDir?: string;
  engineVersion?: string;
  buildId?: string;
  installId?: string;
  capabilities?: Record<string, boolean>;
};

type WorkspaceDaemonLaunchLock = {
  release: () => Promise<void>;
};

export type WorkspaceDaemonRequestClient = {
  request: <TResponse extends JsonObject>(
    message: Omit<WorkspaceDaemonEnvelope, 'id'>,
  ) => Promise<TResponse>;
  close: () => Promise<void>;
};

export type WorkspaceDaemonConnectFn = (
  descriptor: WorkspaceDaemonDescriptor,
) => Promise<WorkspaceDaemonRequestClient>;

type WorkspaceDaemonHelloOptions = {
  connection: WorkspaceDaemonRequestClient;
  client: WorkspaceDaemonClientHello['client'];
  expectedInstallId?: string;
};

export type WorkspaceDaemonLaunchOptions = {
  runtimeDir?: string;
  client: WorkspaceDaemonClientHello['client'];
  expectedInstallId?: string;
  startDaemon: () => Promise<void> | void;
  connectTimeoutMs?: number;
  lockTimeoutMs?: number;
  connect?: WorkspaceDaemonConnectFn;
};

export type WorkspaceDaemonLaunchResult = {
  connection: WorkspaceDaemonRequestClient;
  descriptor: WorkspaceDaemonDescriptor;
  hello: WorkspaceDaemonHelloAck;
  launched: boolean;
};

function workspaceDaemonOwnerUidGet(): string | undefined {
  if (typeof process.getuid !== 'function') {
    return undefined;
  }
  return String(process.getuid());
}

function workspaceDaemonDefaultRuntimeDirResolve(): string {
  const explicit = process.env.CODEPOL_DAEMON_RUNTIME_DIR;
  if (explicit) {
    return path.resolve(explicit);
  }

  const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntimeDir) {
    return path.join(xdgRuntimeDir, 'codepol');
  }

  const user = workspaceDaemonOwnerUidGet() ?? os.userInfo().username;
  return path.join(os.tmpdir(), `codepol-${user}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function socketFileRemove(socketPath: string): void {
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch {
    // ignore stale cleanup failures
  }
}

function descriptorWrite(
  descriptorPath: string,
  descriptor: WorkspaceDaemonDescriptor,
): void {
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor, null, 2), 'utf8');
}

function envelopeWrite(socket: net.Socket, message: WorkspaceDaemonEnvelope): void {
  socket.write(`${JSON.stringify(message)}\n`);
}

function messageErrorCreate(code: string, message: string): WorkspaceDaemonErrorResponse {
  return {
    type: 'error',
    code,
    message,
  };
}

function lineDispatch(buffer: string, onLine: (line: string) => void): string {
  let remaining = buffer;
  while (true) {
    const newlineIndex = remaining.indexOf('\n');
    if (newlineIndex === -1) {
      return remaining;
    }
    const line = remaining.slice(0, newlineIndex).trim();
    remaining = remaining.slice(newlineIndex + 1);
    if (line.length > 0) {
      onLine(line);
    }
  }
}

export function workspaceDaemonRuntimePathsResolve(
  runtimeDir?: string,
): WorkspaceDaemonRuntimePaths {
  const resolvedRuntimeDir = path.resolve(
    runtimeDir ?? workspaceDaemonDefaultRuntimeDirResolve(),
  );
  return {
    runtimeDir: resolvedRuntimeDir,
    descriptorPath: path.join(resolvedRuntimeDir, 'daemon.info.json'),
    socketPath: path.join(resolvedRuntimeDir, 'daemon.sock'),
    lockPath: path.join(resolvedRuntimeDir, 'daemon.lock'),
  };
}

export function workspaceDaemonDescriptorRead(
  runtimeDir?: string,
): WorkspaceDaemonDescriptor | undefined {
  const paths = workspaceDaemonRuntimePathsResolve(runtimeDir);
  if (!fs.existsSync(paths.descriptorPath)) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(paths.descriptorPath, 'utf8');
    return JSON.parse(raw) as WorkspaceDaemonDescriptor;
  } catch {
    return undefined;
  }
}

export function workspaceDaemonDescriptorCreate(options: {
  runtimeDir?: string;
  engineVersion?: string;
  buildId?: string;
  installId?: string;
} = {}): {
  descriptor: WorkspaceDaemonDescriptor;
  paths: WorkspaceDaemonRuntimePaths;
} {
  const paths = workspaceDaemonRuntimePathsResolve(options.runtimeDir);
  return {
    descriptor: {
      transport: {
        kind: 'unix_socket',
        path: paths.socketPath,
      },
      pid: process.pid,
      startedAtUnixMs: Date.now(),
      protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
      engineVersion: options.engineVersion ?? WORKSPACE_DAEMON_ENGINE_VERSION,
      buildId: options.buildId ?? WORKSPACE_DAEMON_BUILD_ID,
      installId: options.installId ?? WORKSPACE_DAEMON_INSTALL_ID,
      sessionNonce: randomUUID(),
      ownerUid: workspaceDaemonOwnerUidGet(),
    },
    paths,
  };
}

export function workspaceDaemonDescriptorWrite(
  runtimeDir: string | undefined,
  descriptor: WorkspaceDaemonDescriptor,
): WorkspaceDaemonRuntimePaths {
  const paths = workspaceDaemonRuntimePathsResolve(runtimeDir);
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  descriptorWrite(paths.descriptorPath, descriptor);
  return paths;
}

export class WorkspaceDaemonConnection implements WorkspaceDaemonRequestClient {
  private readonly pending = new Map<
    number,
    {
      resolve: (value: JsonObject) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextId = 1;
  private buffer = '';

  private constructor(private readonly socket: net.Socket) {
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string | Buffer) => {
      this.buffer = lineDispatch(this.buffer + chunk.toString(), (line) => {
        let parsed: JsonObject;
        try {
          parsed = JSON.parse(line) as JsonObject;
        } catch {
          this.pendingRejectAll(new Error('Invalid daemon response JSON'));
          return;
        }
        const id = parsed.id;
        if (typeof id !== 'number') {
          return;
        }
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        if (parsed.type === 'error') {
          pending.reject(new Error(String(parsed.message ?? 'Daemon error')));
          return;
        }
        pending.resolve(parsed);
      });
    });
    this.socket.on('error', (error) => {
      this.pendingRejectAll(error);
    });
    this.socket.on('close', () => {
      this.pendingRejectAll(new Error('Daemon connection closed'));
    });
  }

  static connect(socketPath: string): Promise<WorkspaceDaemonConnection> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      const onError = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        resolve(new WorkspaceDaemonConnection(socket));
      });
    });
  }

  request<TResponse extends JsonObject>(
    message: Omit<WorkspaceDaemonEnvelope, 'id'>,
  ): Promise<TResponse> {
    const id = this.nextId;
    this.nextId += 1;
    const envelope = {
      id,
      ...(message as JsonObject),
    } as WorkspaceDaemonEnvelope;
    envelopeWrite(this.socket, envelope);
    return new Promise<TResponse>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResponse),
        reject,
      });
    });
  }

  async close(): Promise<void> {
    if (this.socket.destroyed) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.socket.once('close', () => resolve());
      this.socket.end();
    });
  }

  private pendingRejectAll(error: Error): void {
    if (this.pending.size === 0) {
      return;
    }
    const entries = Array.from(this.pending.values());
    this.pending.clear();
    for (const pending of entries) {
      pending.reject(error);
    }
  }
}

export async function workspaceDaemonHello(
  options: WorkspaceDaemonHelloOptions,
): Promise<WorkspaceDaemonHelloAck> {
  const response = await options.connection.request<WorkspaceDaemonHelloAck>({
    type: 'hello',
    protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
    client: {
      ...options.client,
      supportedProtocols: options.client.supportedProtocols,
      supportsFallbackModes: options.client.supportsFallbackModes,
    },
    expected: options.expectedInstallId
      ? { installChannel: options.expectedInstallId }
      : undefined,
  });
  if (response.type !== 'hello_ack') {
    throw new Error(`Unexpected daemon hello response: ${String(response.type)}`);
  }
  if (response.compatibility !== 'ok') {
    throw new Error(`Daemon handshake failed: ${response.compatibility}`);
  }
  return response;
}

export function workspaceDaemonRequestHandle(options: {
  descriptor: WorkspaceDaemonDescriptor;
  capabilities?: Record<string, boolean>;
  message: Omit<WorkspaceDaemonEnvelope, 'id'>;
}): WorkspaceDaemonHelloAck | WorkspaceDaemonErrorResponse {
  const capabilities = {
    hello: true,
    sessionized_workspace_service: true,
    ...options.capabilities,
  };

  if (options.message.type === 'hello') {
    const helloMessage = options.message as WorkspaceDaemonClientHelloMessage;
    const supportedProtocols = Array.isArray(helloMessage.client?.supportedProtocols)
      ? (helloMessage.client.supportedProtocols as unknown[])
      : [];
    const installChannel = helloMessage.expected?.installChannel;
    const protocolSupported = supportedProtocols.some(
      (value) => value === WORKSPACE_DAEMON_PROTOCOL_VERSION,
    );
    const installSupported =
      installChannel === undefined || installChannel === options.descriptor.installId;
    const compatibility = !protocolSupported
      ? 'unsupported_protocol'
      : !installSupported
        ? 'unexpected_install_id'
        : 'ok';
    return {
      type: 'hello_ack',
      protocolVersion: WORKSPACE_DAEMON_PROTOCOL_VERSION,
      compatibility,
      daemon: {
        engineVersion: options.descriptor.engineVersion,
        buildId: options.descriptor.buildId,
        pid: options.descriptor.pid,
        sessionNonce: options.descriptor.sessionNonce,
      },
      capabilities,
    };
  }

  return messageErrorCreate(
    'unsupported_request',
    `Unsupported daemon request: ${options.message.type}`,
  );
}

async function workspaceDaemonConnectHealthy(
  options: {
    runtimeDir?: string;
    client: WorkspaceDaemonClientHello['client'];
    expectedInstallId?: string;
    connect?: WorkspaceDaemonConnectFn;
  },
): Promise<
  | {
      connection: WorkspaceDaemonRequestClient;
      descriptor: WorkspaceDaemonDescriptor;
      hello: WorkspaceDaemonHelloAck;
    }
  | undefined
> {
  const descriptor = workspaceDaemonDescriptorRead(options.runtimeDir);
  if (!descriptor) {
    return undefined;
  }
  let connection: WorkspaceDaemonRequestClient | undefined;
  try {
    connection = await (options.connect
      ? options.connect(descriptor)
      : WorkspaceDaemonConnection.connect(descriptor.transport.path));
    const hello = await workspaceDaemonHello({
      connection,
      client: options.client,
      expectedInstallId: options.expectedInstallId,
    });
    if (hello.daemon.sessionNonce !== descriptor.sessionNonce) {
      await connection.close();
      return undefined;
    }
    return {
      connection,
      descriptor,
      hello,
    };
  } catch {
    if (connection) {
      await connection.close().catch(() => {});
    }
    return undefined;
  }
}

async function workspaceDaemonLaunchLockAcquire(
  lockPath: string,
  timeoutMs: number,
): Promise<WorkspaceDaemonLaunchLock> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const handle = fs.openSync(lockPath, 'wx');
      return {
        release: async () => {
          fs.closeSync(handle);
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // ignore release races
          }
        },
      };
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (code !== 'EEXIST') {
        throw error;
      }

      try {
        const stats = fs.statSync(lockPath);
        if (Date.now() - stats.mtimeMs > timeoutMs) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // ignore raced lock removal
      }
      await sleep(50);
    }
  }

  throw new Error(`Timed out waiting for daemon launch lock at ${lockPath}`);
}

async function workspaceDaemonWaitForHealthy(
  options: WorkspaceDaemonLaunchOptions,
): Promise<{
  connection: WorkspaceDaemonRequestClient;
  descriptor: WorkspaceDaemonDescriptor;
  hello: WorkspaceDaemonHelloAck;
}> {
  const deadline = Date.now() + (options.connectTimeoutMs ?? 5_000);
  while (Date.now() < deadline) {
    const connected = await workspaceDaemonConnectHealthy({
      runtimeDir: options.runtimeDir,
      client: options.client,
      expectedInstallId: options.expectedInstallId,
      connect: options.connect,
    });
    if (connected) {
      return connected;
    }
    await sleep(50);
  }
  throw new Error('Timed out waiting for daemon to become healthy');
}

export async function workspaceDaemonLaunchOrConnect(
  options: WorkspaceDaemonLaunchOptions,
): Promise<WorkspaceDaemonLaunchResult> {
  const paths = workspaceDaemonRuntimePathsResolve(options.runtimeDir);
  fs.mkdirSync(paths.runtimeDir, { recursive: true });

  const existing = await workspaceDaemonConnectHealthy({
    runtimeDir: options.runtimeDir,
    client: options.client,
    expectedInstallId: options.expectedInstallId,
    connect: options.connect,
  });
  if (existing) {
    return {
      ...existing,
      launched: false,
    };
  }

  const lock = await workspaceDaemonLaunchLockAcquire(
    paths.lockPath,
    options.lockTimeoutMs ?? 5_000,
  );
  try {
    const secondCheck = await workspaceDaemonConnectHealthy({
      runtimeDir: options.runtimeDir,
      client: options.client,
      expectedInstallId: options.expectedInstallId,
      connect: options.connect,
    });
    if (secondCheck) {
      return {
        ...secondCheck,
        launched: false,
      };
    }

    await options.startDaemon();
    const started = await workspaceDaemonWaitForHealthy(options);
    return {
      ...started,
      launched: true,
    };
  } finally {
    await lock.release();
  }
}

export async function workspaceDaemonServerStart(
  options: WorkspaceDaemonServerStartOptions = {},
): Promise<WorkspaceDaemonServer> {
  const paths = workspaceDaemonRuntimePathsResolve(options.runtimeDir);
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  socketFileRemove(paths.socketPath);
  try {
    fs.unlinkSync(paths.descriptorPath);
  } catch {
    // ignore stale descriptor cleanup failure
  }

  const { descriptor } = workspaceDaemonDescriptorCreate(options);
  const capabilities = {
    hello: true,
    sessionized_workspace_service: true,
    ...options.capabilities,
  };

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string | Buffer) => {
      buffer = lineDispatch(buffer + chunk.toString(), (line) => {
        let parsed: WorkspaceDaemonEnvelope;
        try {
          parsed = JSON.parse(line) as WorkspaceDaemonEnvelope;
        } catch {
          envelopeWrite(socket, errorEnvelopeCreate(0, 'invalid_json', 'Invalid daemon request JSON'));
          return;
        }

        envelopeWrite(socket, {
          id: parsed.id,
          ...workspaceDaemonRequestHandle({
            descriptor,
            capabilities,
            message: parsed,
          }),
        });
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(paths.socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  descriptorWrite(paths.descriptorPath, descriptor);

  return {
    descriptor,
    paths,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      try {
        const current = workspaceDaemonDescriptorRead(paths.runtimeDir);
        if (current?.sessionNonce === descriptor.sessionNonce) {
          fs.unlinkSync(paths.descriptorPath);
        }
      } catch {
        // ignore descriptor cleanup races
      }
      socketFileRemove(paths.socketPath);
    },
  };
}

function errorEnvelopeCreate(
  id: number,
  code: string,
  message: string,
): WorkspaceDaemonEnvelope {
  return {
    id,
    type: 'error',
    code,
    message,
  };
}
