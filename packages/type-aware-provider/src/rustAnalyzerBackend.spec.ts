import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_TYPE_AWARE_RUST_ANALYZER_ARGS_JSON_ENV,
  WORKSPACE_TYPE_AWARE_RUST_ANALYZER_BIN_ENV,
  workspaceTypeAwareRustAnalyzerBackendCreate,
  workspaceTypeAwareRustAnalyzerRuntimeCreate,
} from './rustAnalyzerBackend';

describe('workspaceTypeAwareRustAnalyzerBackendCreate', () => {
  it('creates a thin rust subprocess backend wrapper', async () => {
    const backend = workspaceTypeAwareRustAnalyzerBackendCreate({
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
        [WORKSPACE_TYPE_AWARE_RUST_ANALYZER_BIN_ENV]: 'custom-rust-analyzer',
        [WORKSPACE_TYPE_AWARE_RUST_ANALYZER_ARGS_JSON_ENV]: JSON.stringify(['--log-file', '/tmp/rust.log']),
      },
    });

    const rustTransport = runtime?.transports?.rust;
    const resolved =
      rustTransport && 'transportResolve' in rustTransport
        ? rustTransport.transportResolve(workspaceInputCreate())
        : rustTransport;
    const result = await resolved?.request<
      Array<{ languageId: string; launchSpec: { binary: string; args: string[] } }>
    >(
      'textDocument/implementation',
      {},
    );

    expect(backend.backendId).toBe('rust-analyzer-subprocess');
    expect(result).toEqual([
      {
        languageId: 'rust',
        launchSpec: {
          binary: 'custom-rust-analyzer',
          args: ['--log-file', '/tmp/rust.log'],
        },
      },
    ]);
  });
});

describe('workspaceTypeAwareRustAnalyzerRuntimeCreate', () => {
  it('creates a rust transport keyed by language id', async () => {
    const runtime = workspaceTypeAwareRustAnalyzerRuntimeCreate({
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

    const rustTransport = runtime.transports?.rust;
    const resolved =
      rustTransport && 'transportResolve' in rustTransport
        ? rustTransport.transportResolve(workspaceInputCreate())
        : rustTransport;
    const result = await resolved?.request<Array<{ languageId: string }>>(
      'textDocument/implementation',
      {},
    );

    expect(result).toEqual([{ languageId: 'rust' }]);
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
