import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_TYPE_AWARE_GOPLS_ARGS_JSON_ENV,
  WORKSPACE_TYPE_AWARE_GOPLS_BIN_ENV,
  workspaceTypeAwareGoplsBackendCreate,
  workspaceTypeAwareGoplsRuntimeCreate,
} from './goplsBackend';

describe('workspaceTypeAwareGoplsBackendCreate', () => {
  it('creates a thin go subprocess backend wrapper', async () => {
    const backend = workspaceTypeAwareGoplsBackendCreate({
      sessionFactory: (input) => ({
        async request<T>(): Promise<T> {
          return [{ languageId: input.languageId, launchSpec: input.launchSpec }] as T;
        },
        async overlayOpen() {},
        async overlayUpdate() {},
        async overlayClose() {},
        async dispose() {},
      }),
    });

    const runtime = await backend.runtimeCreate({
      env: {
        [WORKSPACE_TYPE_AWARE_GOPLS_BIN_ENV]: 'custom-gopls',
        [WORKSPACE_TYPE_AWARE_GOPLS_ARGS_JSON_ENV]: JSON.stringify(['serve']),
      },
    });

    const goTransport = runtime?.transports?.go;
    const resolved =
      goTransport && 'transportResolve' in goTransport
        ? goTransport.transportResolve(workspaceInputCreate())
        : goTransport;
    const result = await resolved?.request<
      Array<{ languageId: string; launchSpec: { binary: string; args: string[] } }>
    >(
      'textDocument/implementation',
      {},
    );

    expect(backend.backendId).toBe('gopls-subprocess');
    expect(result).toEqual([
      {
        languageId: 'go',
        launchSpec: {
          binary: 'custom-gopls',
          args: ['serve'],
        },
      },
    ]);
  });
});

describe('workspaceTypeAwareGoplsRuntimeCreate', () => {
  it('creates a go transport keyed by language id', async () => {
    const runtime = workspaceTypeAwareGoplsRuntimeCreate({
      env: {},
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

    const goTransport = runtime.transports?.go;
    const resolved =
      goTransport && 'transportResolve' in goTransport
        ? goTransport.transportResolve(workspaceInputCreate())
        : goTransport;
    const result = await resolved?.request<Array<{ languageId: string }>>(
      'textDocument/implementation',
      {},
    );

    expect(result).toEqual([{ languageId: 'go' }]);
  });
});

function workspaceInputCreate() {
  return {
    clientSessionId: 'client-1',
    workspaceId: 'workspace-1',
    rootPath: '/tmp/workspace',
    configPath: '/tmp/workspace/codepol.toml',
  };
}
