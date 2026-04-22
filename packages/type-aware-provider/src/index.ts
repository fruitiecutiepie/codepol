import type {
  WorkspaceTypeAwareBridgeExecutionContext,
  WorkspaceTypeAwareBridgeProviderRuntime,
  WorkspaceTypeAwareBridgeTransport,
  WorkspaceTypeAwareBridgeTransportResolver,
  WorkspaceTypeAwareBridgeTransportSource,
  WorkspaceTypeAwareBridgeTransports,
} from '@codepol/workspace-service';
import { workspaceTypeAwareEditorAdapterBackendCreate } from './editorAdapterBackend';
import {
  workspaceTypeAwarePyrightBackendCreate,
  WORKSPACE_TYPE_AWARE_PYRIGHT_ARGS_JSON_ENV,
  WORKSPACE_TYPE_AWARE_PYRIGHT_BIN_ENV,
} from './pyrightBackend';
import type { WorkspaceTypeAwareProviderBackend } from './providerBackend';
import { workspaceTypeAwareBridgeLifecycleCompose } from './providerBackend';

export {
  WORKSPACE_TYPE_AWARE_EDITOR_BRIDGE_PROVIDER_ENV,
} from './editorAdapterBackend';
export {
  workspaceTypeAwareLspSubprocessArgsResolve,
  workspaceTypeAwareLspSubprocessBackendCreate,
  workspaceTypeAwareLspSubprocessConnectionHandlersInstallDefault,
  workspaceTypeAwareLspSubprocessInitializeParamsCreateDefault,
  workspaceTypeAwareLspSubprocessLaunchSpecResolve,
  workspaceTypeAwareLspSubprocessRuntimeCreate,
} from './lspSubprocessBackend';
export {
  WORKSPACE_TYPE_AWARE_PYRIGHT_ARGS_JSON_ENV,
  WORKSPACE_TYPE_AWARE_PYRIGHT_BIN_ENV,
} from './pyrightBackend';
export type { WorkspaceTypeAwareProviderBackend } from './providerBackend';
export type {
  WorkspaceTypeAwareLspSubprocessBackendOptions,
  WorkspaceTypeAwareLspSubprocessConnectionHandlersInstall,
  WorkspaceTypeAwareLspSubprocessInitializeParamsCreate,
  WorkspaceTypeAwareLspSubprocessLaunchSpec,
  WorkspaceTypeAwareLspSubprocessSessionFactory,
  WorkspaceTypeAwareLspSubprocessSessionFactoryInput,
  WorkspaceTypeAwareLspSubprocessSessionHandle,
} from './lspSubprocessBackend';

export type WorkspaceTypeAwareBridgeProviderCreateOptions = {
  env?: NodeJS.ProcessEnv;
  editorBackend?: WorkspaceTypeAwareProviderBackend;
  pyrightBackend?: WorkspaceTypeAwareProviderBackend;
};

export async function workspaceTypeAwareBridgeProviderCreate(
  options: WorkspaceTypeAwareBridgeProviderCreateOptions = {},
): Promise<WorkspaceTypeAwareBridgeProviderRuntime | undefined> {
  const env = options.env ?? process.env;
  const editorBackend =
    options.editorBackend ?? workspaceTypeAwareEditorAdapterBackendCreate();
  const pyrightBackend =
    options.pyrightBackend ?? workspaceTypeAwarePyrightBackendCreate();

  const editorRuntime = await providerRuntimeGet(editorBackend, env);
  const pyrightRuntime = await providerRuntimeGet(pyrightBackend, env);

  const transports: WorkspaceTypeAwareBridgeTransports = {};
  const selectedRuntimes = new Set<WorkspaceTypeAwareBridgeProviderRuntime>();

  if (editorRuntime?.transports?.typescript) {
    transports.typescript = editorRuntime.transports.typescript;
    selectedRuntimes.add(editorRuntime);
  }

  if (editorRuntime?.transports?.python && pyrightRuntime?.transports?.python) {
    transports.python = workspaceTypeAwareBridgeTransportSourceFallbackCompose(
      editorRuntime.transports.python,
      pyrightRuntime.transports.python,
    );
    selectedRuntimes.add(editorRuntime);
    selectedRuntimes.add(pyrightRuntime);
  } else if (editorRuntime?.transports?.python) {
    transports.python = editorRuntime.transports.python;
    selectedRuntimes.add(editorRuntime);
  } else if (pyrightRuntime?.transports?.python) {
    transports.python = pyrightRuntime.transports.python;
    selectedRuntimes.add(pyrightRuntime);
  }

  if (Object.keys(transports).length === 0) {
    return undefined;
  }

  return {
    transports,
    lifecycle: workspaceTypeAwareBridgeLifecycleCompose(
      [...selectedRuntimes].map((runtime) => runtime.lifecycle),
    ),
  };
}

export async function workspaceTypeAwareBridgeTransportsCreate(
  options: WorkspaceTypeAwareBridgeProviderCreateOptions = {},
): Promise<WorkspaceTypeAwareBridgeTransports | undefined> {
  return (await workspaceTypeAwareBridgeProviderCreate(options))?.transports;
}

async function providerRuntimeGet(
  backend: WorkspaceTypeAwareProviderBackend,
  env: NodeJS.ProcessEnv,
): Promise<WorkspaceTypeAwareBridgeProviderRuntime | undefined> {
  try {
    return await backend.runtimeCreate({ env });
  } catch {
    return undefined;
  }
}

function workspaceTypeAwareBridgeTransportSourceFallbackCompose(
  primary: WorkspaceTypeAwareBridgeTransportSource,
  fallback: WorkspaceTypeAwareBridgeTransportSource,
): WorkspaceTypeAwareBridgeTransportResolver {
  return {
    transportResolve(context: WorkspaceTypeAwareBridgeExecutionContext) {
      const primaryTransport = workspaceTypeAwareBridgeTransportResolve(primary, context);
      const fallbackTransport = workspaceTypeAwareBridgeTransportResolve(fallback, context);
      if (primaryTransport && fallbackTransport) {
        return workspaceTypeAwareBridgeTransportFallbackCreate(
          primaryTransport,
          fallbackTransport,
        );
      }
      return primaryTransport ?? fallbackTransport;
    },
  };
}

function workspaceTypeAwareBridgeTransportResolve(
  source: WorkspaceTypeAwareBridgeTransportSource,
  context: WorkspaceTypeAwareBridgeExecutionContext,
): WorkspaceTypeAwareBridgeTransport | undefined {
  if (workspaceTypeAwareBridgeTransportResolverLike(source)) {
    return source.transportResolve(context);
  }
  return source;
}

function workspaceTypeAwareBridgeTransportFallbackCreate(
  primary: WorkspaceTypeAwareBridgeTransport,
  fallback: WorkspaceTypeAwareBridgeTransport,
): WorkspaceTypeAwareBridgeTransport {
  return {
    async request<T>(method: string, params: unknown): Promise<T> {
      try {
        return await primary.request<T>(method, params);
      } catch {
        return await fallback.request<T>(method, params);
      }
    },
  };
}

function workspaceTypeAwareBridgeTransportResolverLike(
  value: WorkspaceTypeAwareBridgeTransportSource,
): value is WorkspaceTypeAwareBridgeTransportResolver {
  return 'transportResolve' in value;
}
