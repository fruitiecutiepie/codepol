import { describe, expect, it } from 'vitest';
import type {
  WorkspaceTypeAwareBridgeOverlayCloseLifecycleInput,
  WorkspaceTypeAwareBridgeOverlayLifecycleInput,
  WorkspaceTypeAwareBridgeWorkspaceLifecycleInput,
} from '@codepol/workspace-service';
import {
  workspaceTypeAwareLspSubprocessArgsResolve,
  workspaceTypeAwareLspSubprocessBackendCreate,
  workspaceTypeAwareLspSubprocessRuntimeCreate,
  type WorkspaceTypeAwareLspSubprocessSessionFactoryInput,
} from './lspSubprocessBackend';

describe('workspaceTypeAwareLspSubprocessRuntimeCreate', () => {
  it('routes requests and lifecycle through a shared workspace session', async () => {
    const sessionInputs: WorkspaceTypeAwareLspSubprocessSessionFactoryInput[] = [];
    const events: string[] = [];
    const runtime = workspaceTypeAwareLspSubprocessRuntimeCreate({
      env: {},
      backendId: 'test-backend',
      transportKey: 'python',
      languageId: 'python',
      binaryEnvVar: 'CODEPOL_TEST_BIN',
      defaultBinary: 'test-langserver',
      defaultArgs: ['--stdio'],
      sessionFactory: (input) => {
        sessionInputs.push(input);
        return {
          async request<T>(method: string): Promise<T> {
            return [{ method, binary: input.launchSpec.binary }] as T;
          },
          async overlayOpen(overlay) {
            events.push(`open:${overlay.uri}`);
          },
          async overlayUpdate(overlay) {
            events.push(`update:${overlay.uri}:${overlay.version}`);
          },
          async overlayClose(overlay) {
            events.push(`close:${overlay.uri}`);
          },
          async dispose() {
            events.push(`dispose:${input.workspaceId}`);
          },
        };
      },
    });

    const workspace = workspaceInputCreate();
    const overlay = overlayInputCreate();
    const overlayClose = overlayCloseInputCreate();

    await runtime.lifecycle?.workspaceAttached?.(workspace);
    await runtime.lifecycle?.overlayOpened?.(overlay);
    await runtime.lifecycle?.overlayUpdated?.({
      ...overlay,
      version: 2,
    });

    const pythonTransport = runtime.transports?.python;
    const resolved =
      pythonTransport && 'transportResolve' in pythonTransport
        ? pythonTransport.transportResolve(workspace)
        : pythonTransport;
    const result = await resolved?.request<Array<{ method: string; binary: string }>>(
      'textDocument/implementation',
      {},
    );
    await runtime.lifecycle?.overlayClosed?.(overlayClose);
    await runtime.lifecycle?.workspaceDetached?.(workspace);

    expect(result).toEqual([
      {
        method: 'textDocument/implementation',
        binary: 'test-langserver',
      },
    ]);
    expect(sessionInputs).toHaveLength(1);
    expect(sessionInputs[0]!.languageId).toBe('python');
    expect(sessionInputs[0]!.launchSpec).toEqual({
      binary: 'test-langserver',
      args: ['--stdio'],
    });
    expect(events).toEqual([
      `open:${overlay.uri}`,
      `update:${overlay.uri}:2`,
      `close:${overlay.uri}`,
      `dispose:${workspace.workspaceId}`,
    ]);
  });

  it('merges env args with defaults without duplicates', async () => {
    const runtime = workspaceTypeAwareLspSubprocessRuntimeCreate({
      env: {
        CODEPOL_TEST_BIN: 'custom-langserver',
        CODEPOL_TEST_ARGS_JSON: JSON.stringify(['--stdio', '--flag']),
      },
      backendId: 'test-backend',
      transportKey: 'python',
      languageId: 'python',
      binaryEnvVar: 'CODEPOL_TEST_BIN',
      argsEnvVar: 'CODEPOL_TEST_ARGS_JSON',
      defaultBinary: 'test-langserver',
      defaultArgs: ['--stdio'],
      sessionFactory: (input) => ({
        async request<T>(): Promise<T> {
          return [input.launchSpec] as T;
        },
        async overlayOpen() {},
        async overlayUpdate() {},
        async overlayClose() {},
        async dispose() {},
      }),
    });

    const pythonTransport = runtime.transports?.python;
    const resolved =
      pythonTransport && 'transportResolve' in pythonTransport
        ? pythonTransport.transportResolve(workspaceInputCreate())
        : pythonTransport;
    const result = await resolved?.request<Array<{ binary: string; args: string[] }>>(
      'textDocument/implementation',
      {},
    );
    expect(result).toEqual([
      {
        binary: 'custom-langserver',
        args: ['--stdio', '--flag'],
      },
    ]);
  });
});

describe('workspaceTypeAwareLspSubprocessBackendCreate', () => {
  it('wraps the runtime factory in a provider backend', async () => {
    const backend = workspaceTypeAwareLspSubprocessBackendCreate({
      backendId: 'test-backend',
      transportKey: 'python',
      languageId: 'python',
      binaryEnvVar: 'CODEPOL_TEST_BIN',
      defaultBinary: 'test-langserver',
      sessionFactory: (input) => ({
        async request<T>(): Promise<T> {
          return [{ languageId: input.languageId }] as T;
        },
        async overlayOpen() {},
        async overlayUpdate() {},
        async overlayClose() {},
        async dispose() {},
      }),
    });

    const runtime = await backend.runtimeCreate({ env: {} });
    const pythonTransport = runtime?.transports?.python;
    const resolved =
      pythonTransport && 'transportResolve' in pythonTransport
        ? pythonTransport.transportResolve(workspaceInputCreate())
        : pythonTransport;
    const result = await resolved?.request<Array<{ languageId: string }>>(
      'textDocument/implementation',
      {},
    );
    expect(backend.backendId).toBe('test-backend');
    expect(result).toEqual([{ languageId: 'python' }]);
  });
});

describe('workspaceTypeAwareLspSubprocessArgsResolve', () => {
  it('throws on invalid args env payload', () => {
    expect(() =>
      workspaceTypeAwareLspSubprocessArgsResolve({
        env: {
          CODEPOL_BAD_ARGS: JSON.stringify(['ok', 42]),
        } as NodeJS.ProcessEnv,
        argsEnvVar: 'CODEPOL_BAD_ARGS',
      })).toThrow('CODEPOL_BAD_ARGS must be a JSON array of strings');
  });
});

function workspaceInputCreate(): WorkspaceTypeAwareBridgeWorkspaceLifecycleInput {
  return {
    clientSessionId: 'client-1',
    workspaceId: 'workspace-1',
    rootPath: '/tmp/workspace',
    configPath: '/tmp/workspace/codepol.toml',
  };
}

function overlayInputCreate(): WorkspaceTypeAwareBridgeOverlayLifecycleInput {
  return {
    ...workspaceInputCreate(),
    uri: 'file:///tmp/workspace/src/app.py',
    version: 1,
    text: 'print("hello")\n',
  };
}

function overlayCloseInputCreate(): WorkspaceTypeAwareBridgeOverlayCloseLifecycleInput {
  return {
    ...workspaceInputCreate(),
    uri: 'file:///tmp/workspace/src/app.py',
  };
}
