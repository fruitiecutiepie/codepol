import type {
  WorkspaceTypeAwareBridgeProviderRuntime,
} from '@codepol/workspace-service';
import type { WorkspaceTypeAwareProviderBackend } from './providerBackend';
import {
  workspaceTypeAwareLspSubprocessBackendCreate,
  workspaceTypeAwareLspSubprocessRuntimeCreate,
  type WorkspaceTypeAwareLspSubprocessSessionFactory,
} from './lspSubprocessBackend';

export const WORKSPACE_TYPE_AWARE_GOPLS_BIN_ENV = 'CODEPOL_GOPLS_BIN';
export const WORKSPACE_TYPE_AWARE_GOPLS_ARGS_JSON_ENV =
  'CODEPOL_GOPLS_ARGS_JSON';

// TODO: Add an `@codepol/go-language-bridge` package (Go equivalent of
// `@codepol/python-language-bridge`) so this transport can be wired into
// first-party type-aware call-graph and type-hierarchy bridge definitions.
export type WorkspaceTypeAwareGoplsSessionFactory =
  WorkspaceTypeAwareLspSubprocessSessionFactory;

export function workspaceTypeAwareGoplsBackendCreate(options: {
  sessionFactory?: WorkspaceTypeAwareGoplsSessionFactory;
} = {}): WorkspaceTypeAwareProviderBackend {
  return workspaceTypeAwareLspSubprocessBackendCreate({
    backendId: 'gopls-subprocess',
    transportKey: 'go',
    languageId: 'go',
    binaryEnvVar: WORKSPACE_TYPE_AWARE_GOPLS_BIN_ENV,
    argsEnvVar: WORKSPACE_TYPE_AWARE_GOPLS_ARGS_JSON_ENV,
    defaultBinary: 'gopls',
    sessionFactory: options.sessionFactory,
  });
}

export function workspaceTypeAwareGoplsRuntimeCreate(options: {
  env?: NodeJS.ProcessEnv;
  sessionFactory?: WorkspaceTypeAwareGoplsSessionFactory;
} = {}): WorkspaceTypeAwareBridgeProviderRuntime {
  return workspaceTypeAwareLspSubprocessRuntimeCreate({
    env: options.env,
    sessionFactory: options.sessionFactory,
    backendId: 'gopls-subprocess',
    transportKey: 'go',
    languageId: 'go',
    binaryEnvVar: WORKSPACE_TYPE_AWARE_GOPLS_BIN_ENV,
    argsEnvVar: WORKSPACE_TYPE_AWARE_GOPLS_ARGS_JSON_ENV,
    defaultBinary: 'gopls',
  });
}
