import { createRequire } from 'node:module';
import type {
  WorkspaceTypeAwareBridgeProviderRuntime,
  WorkspaceTypeAwareBridgeTransports,
} from '@codepol/workspace-service';
import type { WorkspaceTypeAwareProviderBackend } from './providerBackend';
import { workspaceTypeAwareBridgeProviderRuntimeNormalize } from './providerBackend';

const nodeRequire = createRequire(__filename);

export const WORKSPACE_TYPE_AWARE_EDITOR_BRIDGE_PROVIDER_ENV =
  'CODEPOL_TYPE_AWARE_EDITOR_BRIDGE_PROVIDER';

type WorkspaceTypeAwareEditorAdapterFactory = (input: {
  env: NodeJS.ProcessEnv;
}) =>
  | WorkspaceTypeAwareBridgeProviderRuntime
  | WorkspaceTypeAwareBridgeTransports
  | undefined
  | Promise<
      WorkspaceTypeAwareBridgeProviderRuntime
      | WorkspaceTypeAwareBridgeTransports
      | undefined
    >;

export function workspaceTypeAwareEditorAdapterBackendCreate(options: {
  providerModuleId?: string;
  runtimeResolve?: (input: {
    env: NodeJS.ProcessEnv;
  }) => Promise<WorkspaceTypeAwareBridgeProviderRuntime | undefined>;
} = {}): WorkspaceTypeAwareProviderBackend {
  return {
    backendId: 'editor-adapter',
    runtimeCreate: async ({ env }) => {
      if (options.runtimeResolve) {
        return await options.runtimeResolve({ env });
      }
      return await workspaceTypeAwareEditorAdapterRuntimeResolve({
        env,
        providerModuleId: options.providerModuleId,
      });
    },
  };
}

export async function workspaceTypeAwareEditorAdapterRuntimeResolve(options: {
  env?: NodeJS.ProcessEnv;
  providerModuleId?: string;
} = {}): Promise<WorkspaceTypeAwareBridgeProviderRuntime | undefined> {
  const env = options.env ?? process.env;
  const providerModuleId =
    options.providerModuleId ?? env[WORKSPACE_TYPE_AWARE_EDITOR_BRIDGE_PROVIDER_ENV];
  if (!providerModuleId) {
    return undefined;
  }
  const loaded = nodeRequire(providerModuleId) as unknown;
  const factory = workspaceTypeAwareEditorAdapterFactoryResolve(loaded);
  if (factory) {
    return workspaceTypeAwareBridgeProviderRuntimeNormalize(
      await factory({ env }),
    );
  }
  const runtime = workspaceTypeAwareEditorAdapterRuntimeFromModuleResolve(loaded);
  if (runtime) {
    return runtime;
  }
  throw new Error(
    `Editor type-aware backend "${providerModuleId}" must export ` +
      '`workspaceTypeAwareBridgeProviderCreate`, ' +
      '`workspaceTypeAwareBridgeTransportsCreate`, a default factory, a runtime object, or a plain transports object.',
  );
}

function workspaceTypeAwareEditorAdapterFactoryResolve(
  value: unknown,
): WorkspaceTypeAwareEditorAdapterFactory | undefined {
  if (typeof value === 'function') {
    return value as WorkspaceTypeAwareEditorAdapterFactory;
  }
  if (value && typeof value === 'object') {
    const record = value as {
      default?: unknown;
      workspaceTypeAwareBridgeProviderCreate?: WorkspaceTypeAwareEditorAdapterFactory;
      workspaceTypeAwareBridgeTransportsCreate?: WorkspaceTypeAwareEditorAdapterFactory;
    };
    if (typeof record.workspaceTypeAwareBridgeProviderCreate === 'function') {
      return record.workspaceTypeAwareBridgeProviderCreate;
    }
    if (typeof record.workspaceTypeAwareBridgeTransportsCreate === 'function') {
      return record.workspaceTypeAwareBridgeTransportsCreate;
    }
    if (typeof record.default === 'function') {
      return record.default as WorkspaceTypeAwareEditorAdapterFactory;
    }
  }
  return undefined;
}

function workspaceTypeAwareEditorAdapterRuntimeFromModuleResolve(
  value: unknown,
): WorkspaceTypeAwareBridgeProviderRuntime | undefined {
  const direct = workspaceTypeAwareBridgeProviderRuntimeNormalize(value);
  if (direct) {
    return direct;
  }
  if (value && typeof value === 'object') {
    const record = value as { default?: unknown };
    return workspaceTypeAwareBridgeProviderRuntimeNormalize(record.default);
  }
  return undefined;
}
