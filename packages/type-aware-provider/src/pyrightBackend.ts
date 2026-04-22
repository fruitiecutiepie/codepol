import type {
  WorkspaceTypeAwareBridgeProviderRuntime,
} from '@codepol/workspace-service';
import type { WorkspaceTypeAwareProviderBackend } from './providerBackend';
import {
  workspaceTypeAwareLspSubprocessBackendCreate,
  workspaceTypeAwareLspSubprocessRuntimeCreate,
  type WorkspaceTypeAwareLspSubprocessSessionFactory,
} from './lspSubprocessBackend';

export const WORKSPACE_TYPE_AWARE_PYRIGHT_BIN_ENV = 'CODEPOL_PYRIGHT_BIN';
export const WORKSPACE_TYPE_AWARE_PYRIGHT_ARGS_JSON_ENV =
  'CODEPOL_PYRIGHT_ARGS_JSON';

export type WorkspaceTypeAwarePyrightSessionFactory =
  WorkspaceTypeAwareLspSubprocessSessionFactory;

export function workspaceTypeAwarePyrightBackendCreate(options: {
  sessionFactory?: WorkspaceTypeAwarePyrightSessionFactory;
} = {}): WorkspaceTypeAwareProviderBackend {
  return workspaceTypeAwareLspSubprocessBackendCreate({
    backendId: 'pyright-subprocess',
    transportKey: 'python',
    languageId: 'python',
    binaryEnvVar: WORKSPACE_TYPE_AWARE_PYRIGHT_BIN_ENV,
    argsEnvVar: WORKSPACE_TYPE_AWARE_PYRIGHT_ARGS_JSON_ENV,
    defaultBinary: 'pyright-langserver',
    defaultArgs: ['--stdio'],
    sessionFactory: options.sessionFactory,
  });
}

export function workspaceTypeAwarePyrightRuntimeCreate(options: {
  env?: NodeJS.ProcessEnv;
  sessionFactory?: WorkspaceTypeAwarePyrightSessionFactory;
} = {}): WorkspaceTypeAwareBridgeProviderRuntime {
  return workspaceTypeAwareLspSubprocessRuntimeCreate({
    env: options.env,
    sessionFactory: options.sessionFactory,
    backendId: 'pyright-subprocess',
    transportKey: 'python',
    languageId: 'python',
    binaryEnvVar: WORKSPACE_TYPE_AWARE_PYRIGHT_BIN_ENV,
    argsEnvVar: WORKSPACE_TYPE_AWARE_PYRIGHT_ARGS_JSON_ENV,
    defaultBinary: 'pyright-langserver',
    defaultArgs: ['--stdio'],
  });
}
