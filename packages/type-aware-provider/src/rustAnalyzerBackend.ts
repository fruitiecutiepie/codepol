import type {
  WorkspaceTypeAwareBridgeProviderRuntime,
} from '@codepol/workspace-service';
import type { WorkspaceTypeAwareProviderBackend } from './providerBackend';
import {
  workspaceTypeAwareLspSubprocessBackendCreate,
  workspaceTypeAwareLspSubprocessRuntimeCreate,
  type WorkspaceTypeAwareLspSubprocessSessionFactory,
} from './lspSubprocessBackend';

export const WORKSPACE_TYPE_AWARE_RUST_ANALYZER_BIN_ENV =
  'CODEPOL_RUST_ANALYZER_BIN';
export const WORKSPACE_TYPE_AWARE_RUST_ANALYZER_ARGS_JSON_ENV =
  'CODEPOL_RUST_ANALYZER_ARGS_JSON';

// TODO: Add an `@codepol/rust-language-bridge` package (Rust equivalent
// of `@codepol/python-language-bridge`) so this transport can be wired
// into first-party type-aware call-graph and type-hierarchy bridge
// definitions.
export type WorkspaceTypeAwareRustAnalyzerSessionFactory =
  WorkspaceTypeAwareLspSubprocessSessionFactory;

export function workspaceTypeAwareRustAnalyzerBackendCreate(options: {
  sessionFactory?: WorkspaceTypeAwareRustAnalyzerSessionFactory;
} = {}): WorkspaceTypeAwareProviderBackend {
  return workspaceTypeAwareLspSubprocessBackendCreate({
    backendId: 'rust-analyzer-subprocess',
    transportKey: 'rust',
    languageId: 'rust',
    binaryEnvVar: WORKSPACE_TYPE_AWARE_RUST_ANALYZER_BIN_ENV,
    argsEnvVar: WORKSPACE_TYPE_AWARE_RUST_ANALYZER_ARGS_JSON_ENV,
    defaultBinary: 'rust-analyzer',
    sessionFactory: options.sessionFactory,
  });
}

export function workspaceTypeAwareRustAnalyzerRuntimeCreate(options: {
  env?: NodeJS.ProcessEnv;
  sessionFactory?: WorkspaceTypeAwareRustAnalyzerSessionFactory;
} = {}): WorkspaceTypeAwareBridgeProviderRuntime {
  return workspaceTypeAwareLspSubprocessRuntimeCreate({
    env: options.env,
    sessionFactory: options.sessionFactory,
    backendId: 'rust-analyzer-subprocess',
    transportKey: 'rust',
    languageId: 'rust',
    binaryEnvVar: WORKSPACE_TYPE_AWARE_RUST_ANALYZER_BIN_ENV,
    argsEnvVar: WORKSPACE_TYPE_AWARE_RUST_ANALYZER_ARGS_JSON_ENV,
    defaultBinary: 'rust-analyzer',
  });
}
