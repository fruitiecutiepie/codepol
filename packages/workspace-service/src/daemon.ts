import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ClientSessionId,
  DaemonSessionId,
  IndexStatusResult,
  WorkspaceApplyResult,
  WorkspaceCodeAction,
  WorkspaceDiagnostic,
  WorkspaceInstanceId,
} from '@codepol/core';
import type {
  WorkspaceDiagnosticsSubscriptionResult,
  WorkspaceDiagnosticsSubscriptionScope,
  WorkspacePolicyCheckOptions,
  WorkspacePolicyCheckResult,
  WorkspaceReplayResult,
  WorkspaceClientKind,
  WorkspaceService,
} from './index';

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

export type WorkspaceDaemonEnvelope = {
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
  service?: WorkspaceService;
  policyCheck?: (
    options: WorkspacePolicyCheckOptions,
  ) => Promise<WorkspacePolicyCheckResult>;
};

type WorkspaceDaemonLaunchLock = {
  release: () => Promise<void>;
};

export type WorkspaceDaemonRequestClient = {
  request: <TResponse extends JsonObject>(
    message: Omit<WorkspaceDaemonEnvelope, 'id'>,
    options?: WorkspaceDaemonRequestOptions,
  ) => Promise<TResponse>;
  close: () => Promise<void>;
};

export type WorkspaceDaemonRequestOptions = {
  signal?: AbortSignal;
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

type WorkspaceDaemonMessage = Omit<WorkspaceDaemonEnvelope, 'id'>;

type WorkspaceDaemonWorkspaceFreshness = {
  workspaceInstanceId?: WorkspaceInstanceId;
  replayEpoch?: number;
};

type WorkspaceDaemonCancelRequest = WorkspaceDaemonMessage & {
  type: 'cancel_request';
  targetId: number;
};

type WorkspaceDaemonRegisterClientSessionRequest = WorkspaceDaemonMessage & {
  type: 'register_client_session';
  clientKind: WorkspaceClientKind;
  clientInstanceId: string;
  clientSessionId?: ClientSessionId;
};

type WorkspaceDaemonCloseClientSessionRequest = WorkspaceDaemonMessage & {
  type: 'close_client_session';
  clientSessionId: ClientSessionId;
};

type WorkspaceDaemonAttachWorkspaceRequest = WorkspaceDaemonMessage & {
  type: 'attach_workspace';
  clientSessionId: ClientSessionId;
  rootPath: string;
  configPath: string;
};

type WorkspaceDaemonSubscribeDiagnosticsRequest = WorkspaceDaemonMessage & {
  type: 'subscribe_diagnostics';
  clientSessionId: ClientSessionId;
  workspaceId: string;
  workspaceInstanceId: WorkspaceInstanceId;
  scope: WorkspaceDiagnosticsSubscriptionScope;
};

type WorkspaceDaemonCompleteReplayRequest = WorkspaceDaemonMessage & {
  type: 'complete_replay';
  clientSessionId: ClientSessionId;
  workspaceId: string;
  workspaceInstanceId: WorkspaceInstanceId;
};

type WorkspaceDaemonOpenOverlayRequest = WorkspaceDaemonMessage & {
  type: 'open_overlay';
  clientSessionId: ClientSessionId;
  workspaceId: string;
  workspaceInstanceId?: WorkspaceInstanceId;
  uri: string;
  version: number;
  text: string;
};

type WorkspaceDaemonUpdateOverlayRequest = WorkspaceDaemonMessage & {
  type: 'update_overlay';
  clientSessionId: ClientSessionId;
  workspaceId: string;
  workspaceInstanceId?: WorkspaceInstanceId;
  uri: string;
  version: number;
  text: string;
};

type WorkspaceDaemonCloseOverlayRequest = WorkspaceDaemonMessage & {
  type: 'close_overlay';
  clientSessionId: ClientSessionId;
  workspaceId: string;
  workspaceInstanceId?: WorkspaceInstanceId;
  uri: string;
};

type WorkspaceDaemonQueryDiagnosticsRequest = WorkspaceDaemonMessage &
  WorkspaceDaemonWorkspaceFreshness & {
  type: 'query_diagnostics';
  clientSessionId: ClientSessionId;
  workspaceId: string;
  uri?: string;
};

type WorkspaceDaemonQueryCodeActionsRequest = WorkspaceDaemonMessage &
  WorkspaceDaemonWorkspaceFreshness & {
  type: 'query_code_actions';
  clientSessionId: ClientSessionId;
  workspaceId: string;
  uri: string;
  version: number;
  diagnosticIds?: string[];
};

type WorkspaceDaemonApplyEditPlanRequest = WorkspaceDaemonMessage &
  WorkspaceDaemonWorkspaceFreshness & {
  type: 'apply_edit_plan';
  clientSessionId: ClientSessionId;
  workspaceId: string;
  planId: string;
  documentVersions: Record<string, number>;
};

type WorkspaceDaemonQueryIndexStatusRequest = WorkspaceDaemonMessage &
  WorkspaceDaemonWorkspaceFreshness & {
  type: 'query_index_status';
  clientSessionId: ClientSessionId;
  workspaceId: string;
};

type WorkspaceDaemonPolicyCheckRequest = WorkspaceDaemonMessage & {
  type: 'policy_check';
  options: WorkspacePolicyCheckOptions;
};

type WorkspaceDaemonRegisterClientSessionAck = {
  type: 'register_client_session_ack';
  clientSessionId: ClientSessionId;
  daemonSessionId: DaemonSessionId;
};

type WorkspaceDaemonAttachWorkspaceAck = {
  type: 'attach_workspace_ack';
  workspaceId: string;
  workspaceInstanceId: WorkspaceInstanceId;
};

type WorkspaceDaemonSubscribeDiagnosticsAck = {
  type: 'subscribe_diagnostics_ack';
  result: WorkspaceDiagnosticsSubscriptionResult;
};

type WorkspaceDaemonCompleteReplayAck = {
  type: 'complete_replay_ack';
  result: WorkspaceReplayResult;
};

type WorkspaceDaemonQueryDiagnosticsAck = {
  type: 'query_diagnostics_ack';
  diagnostics: WorkspaceDiagnostic[];
};

type WorkspaceDaemonQueryCodeActionsAck = {
  type: 'query_code_actions_ack';
  codeActions: WorkspaceCodeAction[];
};

type WorkspaceDaemonApplyEditPlanAck = {
  type: 'apply_edit_plan_ack';
  result: WorkspaceApplyResult;
};

type WorkspaceDaemonQueryIndexStatusAck = {
  type: 'query_index_status_ack';
  indexStatus: IndexStatusResult;
};

type WorkspaceDaemonPolicyCheckAck = {
  type: 'policy_check_ack';
  result: WorkspacePolicyCheckResult;
};

type WorkspaceDaemonCancelRequestAck = {
  type: 'cancel_request_ack';
  targetId: number;
  cancellationState: 'cancel_requested' | 'not_found';
};

type WorkspaceDaemonVoidAck =
  | { type: 'close_client_session_ack' }
  | { type: 'open_overlay_ack' }
  | { type: 'update_overlay_ack' }
  | { type: 'close_overlay_ack' };

type WorkspaceDaemonServiceResponse =
  | WorkspaceDaemonRegisterClientSessionAck
  | WorkspaceDaemonAttachWorkspaceAck
  | WorkspaceDaemonSubscribeDiagnosticsAck
  | WorkspaceDaemonCompleteReplayAck
  | WorkspaceDaemonQueryDiagnosticsAck
  | WorkspaceDaemonQueryCodeActionsAck
  | WorkspaceDaemonApplyEditPlanAck
  | WorkspaceDaemonQueryIndexStatusAck
  | WorkspaceDaemonPolicyCheckAck
  | WorkspaceDaemonCancelRequestAck
  | WorkspaceDaemonVoidAck
  | WorkspaceDaemonHelloAck
  | WorkspaceDaemonErrorResponse;

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

function requestCancelledErrorCreate(): Error {
  return new Error('Request cancelled');
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
      cleanup: () => void;
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
    options: WorkspaceDaemonRequestOptions = {},
  ): Promise<TResponse> {
    if (options.signal?.aborted) {
      return Promise.reject<TResponse>(requestCancelledErrorCreate());
    }
    const id = this.nextId;
    this.nextId += 1;
    const envelope = {
      id,
      ...(message as JsonObject),
    } as WorkspaceDaemonEnvelope;
    return new Promise<TResponse>((resolve, reject) => {
      const abort = () => {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        pending.cleanup();
        reject(requestCancelledErrorCreate());
        this.cancelRequestWrite(id);
      };
      const cleanup = () => {
        if (options.signal) {
          options.signal.removeEventListener('abort', abort);
        }
      };
      if (options.signal) {
        options.signal.addEventListener('abort', abort, { once: true });
      }
      this.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value as TResponse);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        cleanup,
      });
      envelopeWrite(this.socket, envelope);
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

  private cancelRequestWrite(targetId: number): void {
    if (this.socket.destroyed) {
      return;
    }
    const cancelEnvelopeId = this.nextId;
    this.nextId += 1;
    envelopeWrite(this.socket, {
      id: cancelEnvelopeId,
      type: 'cancel_request',
      targetId,
    });
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
  message: WorkspaceDaemonMessage;
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

export class WorkspaceDaemonSession {
  private didHello = false;
  private readonly attachedWorkspaces = new Map<
    ClientSessionId,
    Map<
      string,
      {
        workspaceInstanceId: WorkspaceInstanceId;
        replayEpoch: number;
        replayApplied: boolean;
        diagnosticsSubscribed: boolean;
      }
    >
  >();
  private readonly activeRequests = new Map<
    number,
    {
      cancellationState: 'running' | 'cancel_requested';
      signal: AbortSignal;
      abort: () => void;
    }
  >();

  constructor(
    private readonly options: {
      descriptor: WorkspaceDaemonDescriptor;
      capabilities?: Record<string, boolean>;
      service?: WorkspaceService;
      policyCheck?: (
        options: WorkspacePolicyCheckOptions,
      ) => Promise<WorkspacePolicyCheckResult>;
    },
  ) {}

  private workspaceReplayStateGet(
    clientSessionId: ClientSessionId,
    workspaceId: string,
  ): {
    workspaceInstanceId: WorkspaceInstanceId;
    replayEpoch: number;
    replayApplied: boolean;
    diagnosticsSubscribed: boolean;
  } | undefined {
    return this.attachedWorkspaces.get(clientSessionId)?.get(workspaceId);
  }

  private workspaceReplayStateSet(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
    replayEpoch: number;
    replayApplied: boolean;
    diagnosticsSubscribed: boolean;
  }): void {
    let workspaces = this.attachedWorkspaces.get(input.clientSessionId);
    if (!workspaces) {
      workspaces = new Map();
      this.attachedWorkspaces.set(input.clientSessionId, workspaces);
    }
    workspaces.set(input.workspaceId, {
      workspaceInstanceId: input.workspaceInstanceId,
      replayEpoch: input.replayEpoch,
      replayApplied: input.replayApplied,
      diagnosticsSubscribed: input.diagnosticsSubscribed,
    });
  }

  private workspaceReplayStateDeleteAll(clientSessionId: ClientSessionId): void {
    this.attachedWorkspaces.delete(clientSessionId);
  }

  private replayGateEnsure(
    clientSessionId: ClientSessionId,
    workspaceId: string,
  ): WorkspaceDaemonErrorResponse | undefined {
    const state = this.workspaceReplayStateGet(clientSessionId, workspaceId);
    if (!state || state.replayApplied) {
      return undefined;
    }
    return messageErrorCreate(
      'replay_required',
      `complete_replay required before normal requests for workspace ${workspaceId}`,
    );
  }

  private workspaceInstanceValidate(
    state: {
      workspaceInstanceId: WorkspaceInstanceId;
    } | undefined,
    input: {
      workspaceId: string;
      workspaceInstanceId?: WorkspaceInstanceId;
    },
  ): WorkspaceDaemonErrorResponse | undefined {
    if (!state || input.workspaceInstanceId === undefined) {
      return undefined;
    }
    if (state.workspaceInstanceId === input.workspaceInstanceId) {
      return undefined;
    }
    return messageErrorCreate(
      'workspace_instance_mismatch',
      `Workspace instance mismatch for ${input.workspaceId}: expected ${state.workspaceInstanceId}, received ${input.workspaceInstanceId}`,
    );
  }

  private replayEpochValidate(
    state: {
      replayEpoch: number;
    } | undefined,
    input: {
      workspaceId: string;
      replayEpoch?: number;
    },
  ): WorkspaceDaemonErrorResponse | undefined {
    if (!state || input.replayEpoch === undefined) {
      return undefined;
    }
    if (state.replayEpoch === input.replayEpoch) {
      return undefined;
    }
    return messageErrorCreate(
      'replay_epoch_mismatch',
      `Replay epoch mismatch for ${input.workspaceId}: expected ${state.replayEpoch}, received ${input.replayEpoch}`,
    );
  }

  private requestCancelHandle(targetId: number): WorkspaceDaemonCancelRequestAck {
    const active = this.activeRequests.get(targetId);
    if (!active) {
      return {
        type: 'cancel_request_ack',
        targetId,
        cancellationState: 'not_found',
      };
    }
    active.cancellationState = 'cancel_requested';
    active.abort();
    return {
      type: 'cancel_request_ack',
      targetId,
      cancellationState: 'cancel_requested',
    };
  }

  async handleEnvelope(
    envelope: WorkspaceDaemonEnvelope,
  ): Promise<WorkspaceDaemonServiceResponse> {
    if (envelope.type === 'cancel_request') {
      const input = envelope as WorkspaceDaemonCancelRequest & WorkspaceDaemonEnvelope;
      return this.requestCancelHandle(input.targetId);
    }

    const controller = new AbortController();
    this.activeRequests.set(envelope.id, {
      cancellationState: 'running',
      signal: controller.signal,
      abort: () => controller.abort(),
    });

    try {
      const response = await this.handleMessage(envelope, {
        signal: controller.signal,
      });
      const active = this.activeRequests.get(envelope.id);
      if (active?.cancellationState === 'cancel_requested') {
        return messageErrorCreate('request_cancelled', 'Request cancelled');
      }
      return response;
    } finally {
      this.activeRequests.delete(envelope.id);
    }
  }

  async handleMessage(
    message: WorkspaceDaemonMessage,
    options: { signal?: AbortSignal } = {},
  ): Promise<WorkspaceDaemonServiceResponse> {
    if (message.type === 'hello') {
      const response = workspaceDaemonRequestHandle({
        descriptor: this.options.descriptor,
        capabilities: this.options.capabilities,
        message,
      });
      if (response.type === 'hello_ack' && response.compatibility === 'ok') {
        this.didHello = true;
      }
      return response;
    }

    if (!this.didHello) {
      return messageErrorCreate(
        'hello_required',
        'hello handshake required before normal requests',
      );
    }

    try {
      switch (message.type) {
        case 'policy_check': {
          if (!this.options.policyCheck) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonPolicyCheckRequest;
          const result = await this.options.policyCheck(input.options);
          return {
            type: 'policy_check_ack',
            result,
          };
        }
        case 'register_client_session': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonRegisterClientSessionRequest;
          const result = await this.options.service.registerClientSession({
            clientKind: input.clientKind,
            clientInstanceId: input.clientInstanceId,
            clientSessionId: input.clientSessionId,
          });
          return {
            type: 'register_client_session_ack',
            clientSessionId: result.clientSessionId,
            daemonSessionId: result.daemonSessionId,
          };
        }
        case 'close_client_session': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonCloseClientSessionRequest;
          await this.options.service.closeClientSession({
            clientSessionId: input.clientSessionId,
          });
          this.workspaceReplayStateDeleteAll(input.clientSessionId);
          return { type: 'close_client_session_ack' };
        }
        case 'attach_workspace': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonAttachWorkspaceRequest;
          const result = await this.options.service.attachWorkspace({
            clientSessionId: input.clientSessionId,
            rootPath: input.rootPath,
            configPath: input.configPath,
          });
          this.workspaceReplayStateSet({
            clientSessionId: input.clientSessionId,
            workspaceId: result.workspaceId,
            workspaceInstanceId: result.workspaceInstanceId,
            replayEpoch: 0,
            replayApplied: false,
            diagnosticsSubscribed: false,
          });
          return {
            type: 'attach_workspace_ack',
            workspaceId: result.workspaceId,
            workspaceInstanceId: result.workspaceInstanceId,
          };
        }
        case 'subscribe_diagnostics': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonSubscribeDiagnosticsRequest;
          const state = this.workspaceReplayStateGet(
            input.clientSessionId,
            input.workspaceId,
          );
          if (!state) {
            return messageErrorCreate(
              'subscription_not_attached',
              `Workspace ${input.workspaceId} is not attached for client session ${input.clientSessionId}`,
            );
          }
          if (state.workspaceInstanceId !== input.workspaceInstanceId) {
            return messageErrorCreate(
              'workspace_instance_mismatch',
              `Workspace instance mismatch for ${input.workspaceId}: expected ${state.workspaceInstanceId}, received ${input.workspaceInstanceId}`,
            );
          }
          const result = await this.options.service.subscribeDiagnostics(input);
          this.workspaceReplayStateSet({
            clientSessionId: input.clientSessionId,
            workspaceId: input.workspaceId,
            workspaceInstanceId: input.workspaceInstanceId,
            replayEpoch: state.replayEpoch,
            replayApplied: state.replayApplied,
            diagnosticsSubscribed: true,
          });
          return {
            type: 'subscribe_diagnostics_ack',
            result,
          };
        }
        case 'complete_replay': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonCompleteReplayRequest;
          const state = this.workspaceReplayStateGet(
            input.clientSessionId,
            input.workspaceId,
          );
          if (!state) {
            return messageErrorCreate(
              'replay_not_attached',
              `Workspace ${input.workspaceId} is not attached for client session ${input.clientSessionId}`,
            );
          }
          if (state.workspaceInstanceId !== input.workspaceInstanceId) {
            return messageErrorCreate(
              'workspace_instance_mismatch',
              `Workspace instance mismatch for ${input.workspaceId}: expected ${state.workspaceInstanceId}, received ${input.workspaceInstanceId}`,
            );
          }
          const result = await this.options.service.completeReplay(input);
          this.workspaceReplayStateSet({
            clientSessionId: input.clientSessionId,
            workspaceId: input.workspaceId,
            workspaceInstanceId: input.workspaceInstanceId,
            replayEpoch: result.replayEpoch,
            replayApplied: true,
            diagnosticsSubscribed: state.diagnosticsSubscribed,
          });
          return {
            type: 'complete_replay_ack',
            result,
          };
        }
        case 'open_overlay': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonOpenOverlayRequest;
          const state = this.workspaceReplayStateGet(
            input.clientSessionId,
            input.workspaceId,
          );
          const workspaceInstanceError = this.workspaceInstanceValidate(state, input);
          if (workspaceInstanceError) {
            return workspaceInstanceError;
          }
          await this.options.service.openOverlay(input);
          return { type: 'open_overlay_ack' };
        }
        case 'update_overlay': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonUpdateOverlayRequest;
          const state = this.workspaceReplayStateGet(
            input.clientSessionId,
            input.workspaceId,
          );
          const workspaceInstanceError = this.workspaceInstanceValidate(state, input);
          if (workspaceInstanceError) {
            return workspaceInstanceError;
          }
          await this.options.service.updateOverlay(input);
          return { type: 'update_overlay_ack' };
        }
        case 'close_overlay': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonCloseOverlayRequest;
          const state = this.workspaceReplayStateGet(
            input.clientSessionId,
            input.workspaceId,
          );
          const workspaceInstanceError = this.workspaceInstanceValidate(state, input);
          if (workspaceInstanceError) {
            return workspaceInstanceError;
          }
          await this.options.service.closeOverlay(input);
          return { type: 'close_overlay_ack' };
        }
        case 'query_diagnostics': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonQueryDiagnosticsRequest;
          const replayGate = this.replayGateEnsure(
            input.clientSessionId,
            input.workspaceId,
          );
          if (replayGate) {
            return replayGate;
          }
          const state = this.workspaceReplayStateGet(
            input.clientSessionId,
            input.workspaceId,
          );
          const workspaceInstanceError = this.workspaceInstanceValidate(state, input);
          if (workspaceInstanceError) {
            return workspaceInstanceError;
          }
          const replayEpochError = this.replayEpochValidate(state, input);
          if (replayEpochError) {
            return replayEpochError;
          }
          const diagnostics = await this.options.service.queryDiagnostics({
            ...input,
            signal: options.signal,
          });
          return {
            type: 'query_diagnostics_ack',
            diagnostics,
          };
        }
        case 'query_code_actions': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonQueryCodeActionsRequest;
          const replayGate = this.replayGateEnsure(
            input.clientSessionId,
            input.workspaceId,
          );
          if (replayGate) {
            return replayGate;
          }
          const state = this.workspaceReplayStateGet(
            input.clientSessionId,
            input.workspaceId,
          );
          const workspaceInstanceError = this.workspaceInstanceValidate(state, input);
          if (workspaceInstanceError) {
            return workspaceInstanceError;
          }
          const replayEpochError = this.replayEpochValidate(state, input);
          if (replayEpochError) {
            return replayEpochError;
          }
          const codeActions = await this.options.service.queryCodeActions({
            ...input,
            signal: options.signal,
          });
          return {
            type: 'query_code_actions_ack',
            codeActions,
          };
        }
        case 'apply_edit_plan': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonApplyEditPlanRequest;
          const replayGate = this.replayGateEnsure(
            input.clientSessionId,
            input.workspaceId,
          );
          if (replayGate) {
            return replayGate;
          }
          const state = this.workspaceReplayStateGet(
            input.clientSessionId,
            input.workspaceId,
          );
          const workspaceInstanceError = this.workspaceInstanceValidate(state, input);
          if (workspaceInstanceError) {
            return workspaceInstanceError;
          }
          const replayEpochError = this.replayEpochValidate(state, input);
          if (replayEpochError) {
            return replayEpochError;
          }
          const result = await this.options.service.applyEditPlan({
            ...input,
            signal: options.signal,
          });
          return {
            type: 'apply_edit_plan_ack',
            result,
          };
        }
        case 'query_index_status': {
          if (!this.options.service) {
            return messageErrorCreate(
              'unsupported_request',
              `Unsupported daemon request: ${message.type}`,
            );
          }
          const input = message as WorkspaceDaemonQueryIndexStatusRequest;
          const state = this.workspaceReplayStateGet(
            input.clientSessionId,
            input.workspaceId,
          );
          const workspaceInstanceError = this.workspaceInstanceValidate(state, input);
          if (workspaceInstanceError) {
            return workspaceInstanceError;
          }
          const replayEpochError = this.replayEpochValidate(state, input);
          if (replayEpochError) {
            return replayEpochError;
          }
          const indexStatus = await this.options.service.queryIndexStatus({
            ...input,
            signal: options.signal,
          });
          return {
            type: 'query_index_status_ack',
            indexStatus,
          };
        }
        default:
          return messageErrorCreate(
            'unsupported_request',
            `Unsupported daemon request: ${message.type}`,
          );
      }
    } catch (error) {
      return messageErrorCreate(
        'request_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export class WorkspaceDaemonServiceClient implements WorkspaceService {
  private readonly workspaceFreshness = new Map<
    ClientSessionId,
    Map<
      string,
      {
        workspaceInstanceId: WorkspaceInstanceId;
        replayEpoch: number;
      }
    >
  >();

  constructor(private readonly connection: WorkspaceDaemonRequestClient) {}

  private workspaceFreshnessGet(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
  }): { workspaceInstanceId: WorkspaceInstanceId; replayEpoch: number } | undefined {
    return this.workspaceFreshness.get(input.clientSessionId)?.get(input.workspaceId);
  }

  private workspaceFreshnessSet(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
    replayEpoch: number;
  }): void {
    let workspaces = this.workspaceFreshness.get(input.clientSessionId);
    if (!workspaces) {
      workspaces = new Map();
      this.workspaceFreshness.set(input.clientSessionId, workspaces);
    }
    workspaces.set(input.workspaceId, {
      workspaceInstanceId: input.workspaceInstanceId,
      replayEpoch: input.replayEpoch,
    });
  }

  private workspaceFreshnessDeleteAll(clientSessionId: ClientSessionId): void {
    this.workspaceFreshness.delete(clientSessionId);
  }

  registerClientSession(input: {
    clientKind: WorkspaceClientKind;
    clientInstanceId: string;
    clientSessionId?: ClientSessionId;
  }): Promise<{ clientSessionId: ClientSessionId; daemonSessionId: DaemonSessionId }> {
    return this.connection.request<WorkspaceDaemonRegisterClientSessionAck>({
      type: 'register_client_session',
      clientKind: input.clientKind,
      clientInstanceId: input.clientInstanceId,
      clientSessionId: input.clientSessionId,
    }).then((response) => ({
      clientSessionId: response.clientSessionId,
      daemonSessionId: response.daemonSessionId,
    }));
  }

  closeClientSession(input: { clientSessionId: ClientSessionId }): Promise<void> {
    return this.connection.request<WorkspaceDaemonVoidAck>({
      type: 'close_client_session',
      clientSessionId: input.clientSessionId,
    }).then(() => {
      this.workspaceFreshnessDeleteAll(input.clientSessionId);
      return undefined;
    });
  }

  attachWorkspace(input: {
    clientSessionId: ClientSessionId;
    rootPath: string;
    configPath: string;
  }): Promise<{ workspaceId: string; workspaceInstanceId: WorkspaceInstanceId }> {
    return this.connection.request<WorkspaceDaemonAttachWorkspaceAck>({
      type: 'attach_workspace',
      clientSessionId: input.clientSessionId,
      rootPath: input.rootPath,
      configPath: input.configPath,
    }).then((response) => {
      this.workspaceFreshnessSet({
        clientSessionId: input.clientSessionId,
        workspaceId: response.workspaceId,
        workspaceInstanceId: response.workspaceInstanceId,
        replayEpoch: 0,
      });
      return {
        workspaceId: response.workspaceId,
        workspaceInstanceId: response.workspaceInstanceId,
      };
    });
  }

  subscribeDiagnostics(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
    scope: WorkspaceDiagnosticsSubscriptionScope;
  }): Promise<WorkspaceDiagnosticsSubscriptionResult> {
    return this.connection.request<WorkspaceDaemonSubscribeDiagnosticsAck>({
      type: 'subscribe_diagnostics',
      clientSessionId: input.clientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: input.workspaceInstanceId,
      scope: input.scope,
    }).then((response) => response.result);
  }

  completeReplay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    workspaceInstanceId: WorkspaceInstanceId;
  }): Promise<WorkspaceReplayResult> {
    return this.connection.request<WorkspaceDaemonCompleteReplayAck>({
      type: 'complete_replay',
      clientSessionId: input.clientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: input.workspaceInstanceId,
    }).then((response) => {
      this.workspaceFreshnessSet({
        clientSessionId: input.clientSessionId,
        workspaceId: input.workspaceId,
        workspaceInstanceId: response.result.workspaceInstanceId,
        replayEpoch: response.result.replayEpoch,
      });
      return response.result;
    });
  }

  openOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }): Promise<void> {
    const freshness = this.workspaceFreshnessGet(input);
    return this.connection.request<WorkspaceDaemonVoidAck>({
      type: 'open_overlay',
      clientSessionId: input.clientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: freshness?.workspaceInstanceId,
      uri: input.uri,
      version: input.version,
      text: input.text,
    }).then(() => undefined);
  }

  updateOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    text: string;
  }): Promise<void> {
    const freshness = this.workspaceFreshnessGet(input);
    return this.connection.request<WorkspaceDaemonVoidAck>({
      type: 'update_overlay',
      clientSessionId: input.clientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: freshness?.workspaceInstanceId,
      uri: input.uri,
      version: input.version,
      text: input.text,
    }).then(() => undefined);
  }

  closeOverlay(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
  }): Promise<void> {
    const freshness = this.workspaceFreshnessGet(input);
    return this.connection.request<WorkspaceDaemonVoidAck>({
      type: 'close_overlay',
      clientSessionId: input.clientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: freshness?.workspaceInstanceId,
      uri: input.uri,
    }).then(() => undefined);
  }

  queryDiagnostics(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri?: string;
    signal?: AbortSignal;
  }): Promise<WorkspaceDiagnostic[]> {
    const freshness = this.workspaceFreshnessGet(input);
    return this.connection.request<WorkspaceDaemonQueryDiagnosticsAck>({
      type: 'query_diagnostics',
      clientSessionId: input.clientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: freshness?.workspaceInstanceId,
      replayEpoch: freshness?.replayEpoch,
      uri: input.uri,
    }, {
      signal: input.signal,
    }).then((response) => response.diagnostics);
  }

  queryCodeActions(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    uri: string;
    version: number;
    diagnosticIds?: string[];
    signal?: AbortSignal;
  }): Promise<WorkspaceCodeAction[]> {
    const freshness = this.workspaceFreshnessGet(input);
    return this.connection.request<WorkspaceDaemonQueryCodeActionsAck>({
      type: 'query_code_actions',
      clientSessionId: input.clientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: freshness?.workspaceInstanceId,
      replayEpoch: freshness?.replayEpoch,
      uri: input.uri,
      version: input.version,
      diagnosticIds: input.diagnosticIds,
    }, {
      signal: input.signal,
    }).then((response) => response.codeActions);
  }

  applyEditPlan(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    planId: string;
    documentVersions: Record<string, number>;
    signal?: AbortSignal;
  }): Promise<WorkspaceApplyResult> {
    const freshness = this.workspaceFreshnessGet(input);
    return this.connection.request<WorkspaceDaemonApplyEditPlanAck>({
      type: 'apply_edit_plan',
      clientSessionId: input.clientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: freshness?.workspaceInstanceId,
      replayEpoch: freshness?.replayEpoch,
      planId: input.planId,
      documentVersions: input.documentVersions,
    }, {
      signal: input.signal,
    }).then((response) => response.result);
  }

  queryIndexStatus(input: {
    clientSessionId: ClientSessionId;
    workspaceId: string;
    signal?: AbortSignal;
  }): Promise<IndexStatusResult> {
    const freshness = this.workspaceFreshnessGet(input);
    return this.connection.request<WorkspaceDaemonQueryIndexStatusAck>({
      type: 'query_index_status',
      clientSessionId: input.clientSessionId,
      workspaceId: input.workspaceId,
      workspaceInstanceId: freshness?.workspaceInstanceId,
      replayEpoch: freshness?.replayEpoch,
    }, {
      signal: input.signal,
    }).then((response) => response.indexStatus);
  }

  close(): Promise<void> {
    return this.connection.close();
  }
}

export class WorkspaceDaemonPolicyCheckClient {
  constructor(private readonly connection: WorkspaceDaemonRequestClient) {}

  policyCheck(
    options: WorkspacePolicyCheckOptions,
  ): Promise<WorkspacePolicyCheckResult> {
    return this.connection.request<WorkspaceDaemonPolicyCheckAck>({
      type: 'policy_check',
      options,
    }).then((response) => response.result);
  }

  close(): Promise<void> {
    return this.connection.close();
  }
}

export function workspaceDaemonServiceClientCreate(options: {
  connection: WorkspaceDaemonRequestClient;
}): WorkspaceService {
  return new WorkspaceDaemonServiceClient(options.connection);
}

export function workspaceDaemonPolicyCheckClientCreate(options: {
  connection: WorkspaceDaemonRequestClient;
}): WorkspaceDaemonPolicyCheckClient {
  return new WorkspaceDaemonPolicyCheckClient(options.connection);
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
    policy_check: Boolean(options.policyCheck),
    ...options.capabilities,
  };

  const server = net.createServer((socket) => {
    const session = new WorkspaceDaemonSession({
      descriptor,
      capabilities,
      service: options.service,
      policyCheck: options.policyCheck,
    });
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

        void session
          .handleEnvelope(parsed)
          .then((response) => {
            envelopeWrite(socket, {
              id: parsed.id,
              ...(response as JsonObject),
            } as WorkspaceDaemonEnvelope);
          })
          .catch((error) => {
            envelopeWrite(
              socket,
              errorEnvelopeCreate(
                parsed.id,
                'internal_error',
                error instanceof Error ? error.message : String(error),
              ),
            );
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
