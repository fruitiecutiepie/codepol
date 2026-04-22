import { describe, expect, it } from 'vitest';
import type {
  WorkspaceTypeAwareBridgeOverlayCloseLifecycleInput,
  WorkspaceTypeAwareBridgeOverlayLifecycleInput,
  WorkspaceTypeAwareBridgeProviderRuntime,
  WorkspaceTypeAwareBridgeWorkspaceLifecycleInput,
} from '@codepol/workspace-service';
import {
  workspaceTypeAwareBridgeProviderCreate,
  workspaceTypeAwareBridgeTransportsCreate,
} from './index';
import type { WorkspaceTypeAwareProviderBackend } from './providerBackend';

function backendCreate(
  backendId: string,
  runtimeCreate: WorkspaceTypeAwareProviderBackend['runtimeCreate'],
): WorkspaceTypeAwareProviderBackend {
  return {
    backendId,
    runtimeCreate,
  };
}

describe('workspaceTypeAwareBridgeProviderCreate', () => {
  it('prefers the editor backend when it exposes python transport', async () => {
    const editorPythonTransport = {
      async request<T>(): Promise<T> {
        return [] as T;
      },
    };
    const pyrightPythonTransport = {
      async request<T>(): Promise<T> {
        return [{ source: 'pyright' }] as T;
      },
    };
    let editorAttached = 0;
    let pyrightAttached = 0;

    const runtime = await workspaceTypeAwareBridgeProviderCreate({
      env: {},
      editorBackend: backendCreate('editor', async () => ({
        transports: {
          python: editorPythonTransport,
          typescript: editorPythonTransport,
        },
        lifecycle: {
          async workspaceAttached() {
            editorAttached += 1;
          },
        },
      })),
      pyrightBackend: backendCreate('pyright', async () => ({
        transports: {
          python: pyrightPythonTransport,
        },
        lifecycle: {
          async workspaceAttached() {
            pyrightAttached += 1;
          },
        },
      })),
    });

    const pythonTransport = runtime?.transports?.python;
    const resolvedPython =
      pythonTransport && 'transportResolve' in pythonTransport
        ? pythonTransport.transportResolve(workspaceInputCreate())
        : pythonTransport;
    const pythonResult = await resolvedPython?.request<Array<{ source: string }>>(
      'textDocument/implementation',
      {},
    );
    expect(pythonResult).toEqual([]);
    expect(runtime?.transports?.typescript).toBe(editorPythonTransport);
    await runtime?.lifecycle?.workspaceAttached?.(workspaceInputCreate());
    expect(editorAttached).toBe(1);
    expect(pyrightAttached).toBe(1);
  });

  it('falls back to pyright per request when the editor transport rejects', async () => {
    const runtime = await workspaceTypeAwareBridgeProviderCreate({
      env: {},
      editorBackend: backendCreate('editor', async () => ({
        transports: {
          python: {
            async request(): Promise<never> {
              throw new Error('editor request unsupported');
            },
          },
        },
      })),
      pyrightBackend: backendCreate('pyright', async () => ({
        transports: {
          python: {
            async request<T>(): Promise<T> {
              return [{ source: 'pyright' }] as T;
            },
          },
        },
      })),
    });

    const pythonTransport = runtime?.transports?.python;
    expect(pythonTransport).toBeDefined();
    const resolved =
      pythonTransport && 'transportResolve' in pythonTransport
        ? pythonTransport.transportResolve(workspaceInputCreate())
        : pythonTransport;
    const result = await resolved?.request<Array<{ source: string }>>(
      'textDocument/implementation',
      {},
    );
    expect(result).toEqual([{ source: 'pyright' }]);
  });

  it('falls back to pyright when the editor backend is unavailable', async () => {
    const pyrightPythonTransport = {
      async request<T>(): Promise<T> {
        return [] as T;
      },
    };
    let editorAttached = 0;
    let pyrightAttached = 0;

    const runtime = await workspaceTypeAwareBridgeProviderCreate({
      env: {},
      editorBackend: backendCreate('editor', async () => {
        throw new Error('editor bridge unavailable');
      }),
      pyrightBackend: backendCreate('pyright', async () => ({
        transports: {
          python: pyrightPythonTransport,
        },
        lifecycle: {
          async workspaceAttached() {
            pyrightAttached += 1;
          },
        },
      })),
    });

    expect(runtime?.transports?.python).toBe(pyrightPythonTransport);
    expect(runtime?.transports?.typescript).toBeUndefined();
    await runtime?.lifecycle?.workspaceAttached?.(workspaceInputCreate());
    expect(editorAttached).toBe(0);
    expect(pyrightAttached).toBe(1);
  });

  it('composes lifecycle hooks across selected backends', async () => {
    const events: string[] = [];
    const editorRuntime = runtimeCreate({
      transports: {
        typescript: transportCreate(),
      },
      lifecycle: lifecycleCreate(events, 'editor'),
    });
    const pyrightRuntime = runtimeCreate({
      transports: {
        python: transportCreate(),
      },
      lifecycle: lifecycleCreate(events, 'pyright'),
    });

    const runtime = await workspaceTypeAwareBridgeProviderCreate({
      env: {},
      editorBackend: backendCreate('editor', async () => editorRuntime),
      pyrightBackend: backendCreate('pyright', async () => pyrightRuntime),
    });

    const workspace = workspaceInputCreate();
    const overlay = overlayInputCreate();
    const overlayClose = overlayCloseInputCreate();
    await runtime?.lifecycle?.workspaceAttached?.(workspace);
    await runtime?.lifecycle?.overlayOpened?.(overlay);
    await runtime?.lifecycle?.overlayUpdated?.(overlay);
    await runtime?.lifecycle?.overlayClosed?.(overlayClose);
    await runtime?.lifecycle?.workspaceDetached?.(workspace);

    expect(events).toEqual([
      'editor:attached',
      'pyright:attached',
      'editor:opened',
      'pyright:opened',
      'editor:updated',
      'pyright:updated',
      'editor:closed',
      'pyright:closed',
      'editor:detached',
      'pyright:detached',
    ]);
  });

  it('returns transports only through workspaceTypeAwareBridgeTransportsCreate', async () => {
    const pythonTransport = transportCreate();
    const transports = await workspaceTypeAwareBridgeTransportsCreate({
      env: {},
      editorBackend: backendCreate('editor', async () => undefined),
      pyrightBackend: backendCreate('pyright', async () => ({
        transports: {
          python: pythonTransport,
        },
      })),
    });
    expect(transports).toEqual({
      python: pythonTransport,
    });
  });
});

function transportCreate() {
  return {
    async request<T>(): Promise<T> {
      return [] as T;
    },
  };
}

function runtimeCreate(
  runtime: WorkspaceTypeAwareBridgeProviderRuntime,
): WorkspaceTypeAwareBridgeProviderRuntime {
  return runtime;
}

function lifecycleCreate(events: string[], label: string) {
  return {
    async workspaceAttached() {
      events.push(`${label}:attached`);
    },
    async workspaceDetached() {
      events.push(`${label}:detached`);
    },
    async overlayOpened() {
      events.push(`${label}:opened`);
    },
    async overlayUpdated() {
      events.push(`${label}:updated`);
    },
    async overlayClosed() {
      events.push(`${label}:closed`);
    },
  };
}

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
