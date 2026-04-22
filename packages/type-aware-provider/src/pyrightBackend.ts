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
  WorkspaceTypeAwareBridgeWorkspaceLifecycleInput,
} from '@codepol/workspace-service';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node';
import type { WorkspaceTypeAwareProviderBackend } from './providerBackend';

export const WORKSPACE_TYPE_AWARE_PYRIGHT_BIN_ENV = 'CODEPOL_PYRIGHT_BIN';
export const WORKSPACE_TYPE_AWARE_PYRIGHT_ARGS_JSON_ENV =
  'CODEPOL_PYRIGHT_ARGS_JSON';

type PyrightWorkspaceSessionHandle = {
  request<T>(method: string, params: unknown): Promise<T>;
  overlayOpen(input: WorkspaceTypeAwareBridgeOverlayLifecycleInput): Promise<void>;
  overlayUpdate(input: WorkspaceTypeAwareBridgeOverlayLifecycleInput): Promise<void>;
  overlayClose(
    input: WorkspaceTypeAwareBridgeOverlayCloseLifecycleInput,
  ): Promise<void>;
  dispose(): Promise<void>;
};

type PyrightSessionFactory = (input: {
  env: NodeJS.ProcessEnv;
} & WorkspaceTypeAwareBridgeWorkspaceLifecycleInput) => PyrightWorkspaceSessionHandle;

export function workspaceTypeAwarePyrightBackendCreate(options: {
  sessionFactory?: PyrightSessionFactory;
} = {}): WorkspaceTypeAwareProviderBackend {
  return {
    backendId: 'pyright-subprocess',
    runtimeCreate: async ({ env }) =>
      workspaceTypeAwarePyrightRuntimeCreate({
        env,
        sessionFactory: options.sessionFactory,
      }),
  };
}

export function workspaceTypeAwarePyrightRuntimeCreate(options: {
  env?: NodeJS.ProcessEnv;
  sessionFactory?: PyrightSessionFactory;
} = {}): WorkspaceTypeAwareBridgeProviderRuntime {
  const env = options.env ?? process.env;
  const sessionFactory = options.sessionFactory ?? pyrightWorkspaceSessionCreate;
  const workspaceContexts = new Map<
    string,
    WorkspaceTypeAwareBridgeWorkspaceLifecycleInput
  >();
  const sessions = new Map<string, PyrightWorkspaceSessionHandle>();

  const sessionGetOrCreate = (
    context: WorkspaceTypeAwareBridgeExecutionContext,
  ): PyrightWorkspaceSessionHandle => {
    workspaceContexts.set(context.workspaceId, context);
    const existing = sessions.get(context.workspaceId);
    if (existing) {
      return existing;
    }
    const session = sessionFactory({
      env,
      ...(workspaceContexts.get(context.workspaceId) ?? context),
    });
    sessions.set(context.workspaceId, session);
    return session;
  };

  const pythonTransport: WorkspaceTypeAwareBridgeTransportResolver = {
    transportResolve(context) {
      const transport: WorkspaceTypeAwareBridgeTransport = {
        async request<T>(method: string, params: unknown): Promise<T> {
          return await sessionGetOrCreate(context).request<T>(method, params);
        },
      };
      return transport;
    },
  };

  return {
    transports: {
      python: pythonTransport,
    },
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

type PyrightDocumentState = {
  version: number;
  text: string;
  openedInServer: boolean;
};

function pyrightWorkspaceSessionCreate(input: {
  env: NodeJS.ProcessEnv;
} & WorkspaceTypeAwareBridgeWorkspaceLifecycleInput): PyrightWorkspaceSessionHandle {
  const documents = new Map<string, PyrightDocumentState>();
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
        const launch = pyrightLaunchSpecResolve(input.env);
        const nextChild = spawn(launch.binary, launch.args, {
          cwd: input.rootPath,
          stdio: 'pipe',
        });
        if (!nextChild.stdout || !nextChild.stdin) {
          throw new Error('pyright-langserver stdio pipes are unavailable');
        }
        const nextConnection = createMessageConnection(
          new StreamMessageReader(nextChild.stdout),
          new StreamMessageWriter(nextChild.stdin),
        );
        pyrightConnectionHandlersInstall(nextConnection, {
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

        await nextConnection.sendRequest('initialize', {
          processId: process.pid,
          clientInfo: {
            name: 'codepol',
            version: '1.0.0',
          },
          rootUri,
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
              uri: rootUri,
              name: path.basename(input.rootPath),
            },
          ],
        });
        await Promise.resolve(nextConnection.sendNotification('initialized', {}));
        child = nextChild;
        connection = nextConnection;

        for (const [uri, document] of documents) {
          await Promise.resolve(
            nextConnection.sendNotification('textDocument/didOpen', {
              textDocument: {
                uri,
                languageId: 'python',
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
    input: WorkspaceTypeAwareBridgeOverlayLifecycleInput,
  ): Promise<void> => {
    const document = documents.get(input.uri) ?? {
      version: input.version,
      text: input.text,
      openedInServer: false,
    };
    document.version = input.version;
    document.text = input.text;
    documents.set(input.uri, document);
    if (!connection) {
      return;
    }
    if (document.openedInServer) {
      await Promise.resolve(
        connection.sendNotification('textDocument/didChange', {
          textDocument: {
            uri: input.uri,
            version: input.version,
          },
          contentChanges: [{ text: input.text }],
        }),
      );
      return;
    }
    await Promise.resolve(
      connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: input.uri,
          languageId: 'python',
          version: input.version,
          text: input.text,
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
    async overlayOpen(input) {
      await overlaySynchronize(input);
    },
    async overlayUpdate(input) {
      await overlaySynchronize(input);
    },
    async overlayClose(input) {
      const document = documents.get(input.uri);
      documents.delete(input.uri);
      if (!connection || !document?.openedInServer) {
        return;
      }
      await Promise.resolve(
        connection.sendNotification('textDocument/didClose', {
          textDocument: {
            uri: input.uri,
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

function pyrightConnectionHandlersInstall(
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

function pyrightLaunchSpecResolve(env: NodeJS.ProcessEnv): {
  binary: string;
  args: string[];
} {
  const binary = env[WORKSPACE_TYPE_AWARE_PYRIGHT_BIN_ENV] || 'pyright-langserver';
  const args = pyrightArgsResolve(env);
  if (!args.includes('--stdio')) {
    args.push('--stdio');
  }
  return { binary, args };
}

function pyrightArgsResolve(env: NodeJS.ProcessEnv): string[] {
  const raw = env[WORKSPACE_TYPE_AWARE_PYRIGHT_ARGS_JSON_ENV];
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(
      `${WORKSPACE_TYPE_AWARE_PYRIGHT_ARGS_JSON_ENV} must be a JSON array of strings`,
    );
  }
  return [...parsed];
}
