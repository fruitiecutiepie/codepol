import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  WorkspaceTypeAwareBridgeExecutionContext,
  WorkspaceTypeAwareBridgeOverlayCloseLifecycleInput,
  WorkspaceTypeAwareBridgeOverlayLifecycleInput,
  WorkspaceTypeAwareBridgeProviderRuntime,
  WorkspaceTypeAwareBridgeTransport,
  WorkspaceTypeAwareBridgeTransportResolver,
  WorkspaceTypeAwareBridgeTransports,
  WorkspaceTypeAwareBridgeWorkspaceLifecycleInput,
} from '@codepol/workspace-service';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node';
import type { WorkspaceTypeAwareProviderBackend } from './providerBackend';

export type WorkspaceTypeAwareLspSubprocessSessionHandle = {
  request<T>(method: string, params: unknown): Promise<T>;
  overlayOpen(input: WorkspaceTypeAwareBridgeOverlayLifecycleInput): Promise<void>;
  overlayUpdate(input: WorkspaceTypeAwareBridgeOverlayLifecycleInput): Promise<void>;
  overlayClose(
    input: WorkspaceTypeAwareBridgeOverlayCloseLifecycleInput,
  ): Promise<void>;
  dispose(): Promise<void>;
};

export type WorkspaceTypeAwareLspSubprocessConnectionHandlersInstall = (
  connection: MessageConnection,
  input: { rootUri: string; workspaceName: string },
) => void;

export type WorkspaceTypeAwareLspSubprocessInitializeParamsCreate = (input: {
  rootPath: string;
  rootUri: string;
  workspaceName: string;
  processId: number;
}) => Record<string, unknown>;

export type WorkspaceTypeAwareLspSubprocessLaunchSpec = {
  binary: string;
  args: string[];
};

export type WorkspaceTypeAwareLspSubprocessSessionFactoryInput = {
  env: NodeJS.ProcessEnv;
  languageId: string;
  launchSpec: WorkspaceTypeAwareLspSubprocessLaunchSpec;
  initializeParams: Record<string, unknown>;
  connectionHandlersInstall: WorkspaceTypeAwareLspSubprocessConnectionHandlersInstall;
} & WorkspaceTypeAwareBridgeWorkspaceLifecycleInput;

export type WorkspaceTypeAwareLspSubprocessSessionFactory = (
  input: WorkspaceTypeAwareLspSubprocessSessionFactoryInput,
) => WorkspaceTypeAwareLspSubprocessSessionHandle;

export type WorkspaceTypeAwareLspSubprocessBackendOptions = {
  backendId: string;
  transportKey: keyof WorkspaceTypeAwareBridgeTransports;
  languageId: string;
  binaryEnvVar: string;
  argsEnvVar?: string;
  defaultBinary: string;
  defaultArgs?: string[];
  initializeParamsCreate?: WorkspaceTypeAwareLspSubprocessInitializeParamsCreate;
  connectionHandlersInstall?: WorkspaceTypeAwareLspSubprocessConnectionHandlersInstall;
  sessionFactory?: WorkspaceTypeAwareLspSubprocessSessionFactory;
};

export function workspaceTypeAwareLspSubprocessBackendCreate(
  options: WorkspaceTypeAwareLspSubprocessBackendOptions,
): WorkspaceTypeAwareProviderBackend {
  return {
    backendId: options.backendId,
    runtimeCreate: async ({ env }) =>
      workspaceTypeAwareLspSubprocessRuntimeCreate({
        ...options,
        env,
      }),
  };
}

export function workspaceTypeAwareLspSubprocessRuntimeCreate(
  options: WorkspaceTypeAwareLspSubprocessBackendOptions & {
    env?: NodeJS.ProcessEnv;
  },
): WorkspaceTypeAwareBridgeProviderRuntime {
  const env = options.env ?? process.env;
  const sessionFactory =
    options.sessionFactory ?? workspaceTypeAwareLspSubprocessSessionCreate;
  const initializeParamsCreate =
    options.initializeParamsCreate ?? workspaceTypeAwareLspSubprocessInitializeParamsCreateDefault;
  const connectionHandlersInstall =
    options.connectionHandlersInstall
    ?? workspaceTypeAwareLspSubprocessConnectionHandlersInstallDefault;
  const workspaceContexts = new Map<
    string,
    WorkspaceTypeAwareBridgeWorkspaceLifecycleInput
  >();
  const sessions = new Map<string, WorkspaceTypeAwareLspSubprocessSessionHandle>();

  const sessionGetOrCreate = (
    context: WorkspaceTypeAwareBridgeExecutionContext,
  ): WorkspaceTypeAwareLspSubprocessSessionHandle => {
    workspaceContexts.set(context.workspaceId, context);
    const existing = sessions.get(context.workspaceId);
    if (existing) {
      return existing;
    }
    const rootUri = pathToFileURL(context.rootPath).href;
    const workspaceName = path.basename(context.rootPath);
    const session = sessionFactory({
      env,
      ...(workspaceContexts.get(context.workspaceId) ?? context),
      languageId: options.languageId,
      launchSpec: workspaceTypeAwareLspSubprocessLaunchSpecResolve({
        env,
        binaryEnvVar: options.binaryEnvVar,
        argsEnvVar: options.argsEnvVar,
        defaultBinary: options.defaultBinary,
        defaultArgs: options.defaultArgs,
      }),
      initializeParams: initializeParamsCreate({
        rootPath: context.rootPath,
        rootUri,
        workspaceName,
        processId: process.pid,
      }),
      connectionHandlersInstall,
    });
    sessions.set(context.workspaceId, session);
    return session;
  };

  const transport: WorkspaceTypeAwareBridgeTransportResolver = {
    transportResolve(context) {
      return {
        async request<T>(method: string, params: unknown): Promise<T> {
          return await sessionGetOrCreate(context).request<T>(method, params);
        },
      };
    },
  };

  return {
    transports: {
      [options.transportKey]: transport,
    } as WorkspaceTypeAwareBridgeTransports,
    lifecycle: {
      async workspaceAttached(input) {
        workspaceContexts.set(input.workspaceId, input);
      },
      async workspaceDetached(input) {
        workspaceContexts.delete(input.workspaceId);
        const session = sessions.get(input.workspaceId);
        if (!session) {
          return;
        }
        sessions.delete(input.workspaceId);
        await session.dispose();
      },
      async overlayOpened(input) {
        await sessionGetOrCreate(input).overlayOpen(input);
      },
      async overlayUpdated(input) {
        await sessionGetOrCreate(input).overlayUpdate(input);
      },
      async overlayClosed(input) {
        const session = sessions.get(input.workspaceId);
        if (!session) {
          return;
        }
        await session.overlayClose(input);
      },
      async dispose() {
        for (const session of sessions.values()) {
          await session.dispose();
        }
        sessions.clear();
        workspaceContexts.clear();
      },
    },
  };
}

type LspSubprocessDocumentState = {
  version: number;
  text: string;
  openedInServer: boolean;
};

function workspaceTypeAwareLspSubprocessSessionCreate(
  input: WorkspaceTypeAwareLspSubprocessSessionFactoryInput,
): WorkspaceTypeAwareLspSubprocessSessionHandle {
  const documents = new Map<string, LspSubprocessDocumentState>();
  const rootUri = pathToFileURL(input.rootPath).href;
  let child: ChildProcess | undefined;
  let connection: MessageConnection | undefined;
  let startPromise: Promise<MessageConnection> | undefined;

  const startEnsure = async (): Promise<MessageConnection> => {
    if (connection) {
      return connection;
    }
    if (!startPromise) {
      startPromise = (async () => {
        const nextChild = spawn(input.launchSpec.binary, input.launchSpec.args, {
          cwd: input.rootPath,
          stdio: 'pipe',
        });
        if (!nextChild.stdout || !nextChild.stdin) {
          throw new Error(`${input.launchSpec.binary} stdio pipes are unavailable`);
        }
        const nextConnection = createMessageConnection(
          new StreamMessageReader(nextChild.stdout),
          new StreamMessageWriter(nextChild.stdin),
        );
        input.connectionHandlersInstall(nextConnection, {
          rootUri,
          workspaceName: path.basename(input.rootPath),
        });
        nextConnection.listen();
        nextChild.once('exit', () => {
          if (connection === nextConnection) {
            connection = undefined;
          }
          if (child === nextChild) {
            child = undefined;
          }
          startPromise = undefined;
          for (const document of documents.values()) {
            document.openedInServer = false;
          }
          nextConnection.dispose();
        });
        nextChild.once('error', () => {
          startPromise = undefined;
        });

        await nextConnection.sendRequest('initialize', input.initializeParams);
        await Promise.resolve(nextConnection.sendNotification('initialized', {}));
        child = nextChild;
        connection = nextConnection;

        for (const [uri, document] of documents) {
          await Promise.resolve(
            nextConnection.sendNotification('textDocument/didOpen', {
              textDocument: {
                uri,
                languageId: input.languageId,
                version: document.version,
                text: document.text,
              },
            }),
          );
          document.openedInServer = true;
        }
        return nextConnection;
      })().catch((error) => {
        startPromise = undefined;
        if (child) {
          child.kill();
          child = undefined;
        }
        if (connection) {
          connection.dispose();
          connection = undefined;
        }
        for (const document of documents.values()) {
          document.openedInServer = false;
        }
        throw error;
      });
    }
    return await startPromise;
  };

  const overlaySynchronize = async (
    overlay: WorkspaceTypeAwareBridgeOverlayLifecycleInput,
  ): Promise<void> => {
    const document = documents.get(overlay.uri) ?? {
      version: overlay.version,
      text: overlay.text,
      openedInServer: false,
    };
    document.version = overlay.version;
    document.text = overlay.text;
    documents.set(overlay.uri, document);
    if (!connection) {
      return;
    }
    if (document.openedInServer) {
      await Promise.resolve(
        connection.sendNotification('textDocument/didChange', {
          textDocument: {
            uri: overlay.uri,
            version: overlay.version,
          },
          contentChanges: [{ text: overlay.text }],
        }),
      );
      return;
    }
    await Promise.resolve(
      connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: overlay.uri,
          languageId: input.languageId,
          version: overlay.version,
          text: overlay.text,
        },
      }),
    );
    document.openedInServer = true;
  };

  return {
    async request<T>(method: string, params: unknown): Promise<T> {
      const activeConnection = await startEnsure();
      return await activeConnection.sendRequest<T>(method, params);
    },
    async overlayOpen(overlay) {
      await overlaySynchronize(overlay);
    },
    async overlayUpdate(overlay) {
      await overlaySynchronize(overlay);
    },
    async overlayClose(overlay) {
      const document = documents.get(overlay.uri);
      documents.delete(overlay.uri);
      if (!connection || !document?.openedInServer) {
        return;
      }
      await Promise.resolve(
        connection.sendNotification('textDocument/didClose', {
          textDocument: {
            uri: overlay.uri,
          },
        }),
      );
    },
    async dispose() {
      const activeConnection = connection;
      const activeChild = child;
      connection = undefined;
      child = undefined;
      startPromise = undefined;
      for (const document of documents.values()) {
        document.openedInServer = false;
      }
      if (activeConnection) {
        try {
          await activeConnection.sendRequest('shutdown');
        } catch {
          // ignore shutdown failures
        }
        try {
          await Promise.resolve(activeConnection.sendNotification('exit'));
        } catch {
          // ignore exit failures
        }
        activeConnection.dispose();
      }
      if (activeChild) {
        activeChild.kill();
      }
    },
  };
}

export function workspaceTypeAwareLspSubprocessConnectionHandlersInstallDefault(
  connection: MessageConnection,
  input: { rootUri: string; workspaceName: string },
): void {
  connection.onRequest('workspace/configuration', () => []);
  connection.onRequest('workspace/workspaceFolders', () => [
    {
      uri: input.rootUri,
      name: input.workspaceName,
    },
  ]);
  connection.onRequest('client/registerCapability', () => null);
  connection.onRequest('client/unregisterCapability', () => null);
  connection.onRequest('window/workDoneProgress/create', () => null);
  connection.onRequest('workspace/applyEdit', () => ({ applied: false }));
  connection.onRequest('window/showMessageRequest', () => null);
}

export function workspaceTypeAwareLspSubprocessInitializeParamsCreateDefault(
  input: {
    rootPath: string;
    rootUri: string;
    workspaceName: string;
    processId: number;
  },
): Record<string, unknown> {
  return {
    processId: input.processId,
    clientInfo: {
      name: 'codepol',
      version: '1.0.0',
    },
    rootUri: input.rootUri,
    rootPath: input.rootPath,
    capabilities: {
      workspace: {
        workspaceFolders: true,
      },
      textDocument: {
        callHierarchy: {
          dynamicRegistration: false,
        },
        implementation: {
          dynamicRegistration: false,
        },
        typeHierarchy: {
          dynamicRegistration: false,
        },
        synchronization: {
          dynamicRegistration: false,
          didSave: true,
          willSave: false,
          willSaveWaitUntil: false,
        },
      },
    },
    workspaceFolders: [
      {
        uri: input.rootUri,
        name: input.workspaceName,
      },
    ],
  };
}

export function workspaceTypeAwareLspSubprocessLaunchSpecResolve(input: {
  env: NodeJS.ProcessEnv;
  binaryEnvVar: string;
  argsEnvVar?: string;
  defaultBinary: string;
  defaultArgs?: string[];
}): WorkspaceTypeAwareLspSubprocessLaunchSpec {
  const binary = input.env[input.binaryEnvVar] || input.defaultBinary;
  return {
    binary,
    args: workspaceTypeAwareLspSubprocessArgsResolve({
      env: input.env,
      argsEnvVar: input.argsEnvVar,
      defaultArgs: input.defaultArgs,
    }),
  };
}

export function workspaceTypeAwareLspSubprocessArgsResolve(input: {
  env: NodeJS.ProcessEnv;
  argsEnvVar?: string;
  defaultArgs?: string[];
}): string[] {
  const args = [...(input.defaultArgs ?? [])];
  if (!input.argsEnvVar) {
    return args;
  }
  const raw = input.env[input.argsEnvVar];
  if (!raw) {
    return args;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(
      `${input.argsEnvVar} must be a JSON array of strings`,
    );
  }
  for (const arg of parsed) {
    if (!args.includes(arg)) {
      args.push(arg);
    }
  }
  return args;
}
