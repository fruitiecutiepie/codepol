import type {
  WorkspaceTypeAwareBridgeLifecycle,
  WorkspaceTypeAwareBridgeProviderRuntime,
  WorkspaceTypeAwareBridgeTransports,
} from '@codepol/workspace-service';

export type WorkspaceTypeAwareProviderBackend = {
  backendId: string;
  runtimeCreate(input: {
    env: NodeJS.ProcessEnv;
  }):
    | WorkspaceTypeAwareBridgeProviderRuntime
    | undefined
    | Promise<WorkspaceTypeAwareBridgeProviderRuntime | undefined>;
};

export function workspaceTypeAwareBridgeLifecycleCompose(
  lifecycles: Array<WorkspaceTypeAwareBridgeLifecycle | undefined>,
): WorkspaceTypeAwareBridgeLifecycle | undefined {
  const active = lifecycles.filter(
    (lifecycle): lifecycle is WorkspaceTypeAwareBridgeLifecycle => lifecycle !== undefined,
  );
  if (active.length === 0) {
    return undefined;
  }
  return {
    async workspaceAttached(input) {
      for (const lifecycle of active) {
        await workspaceTypeAwareProviderLifecycleCall(lifecycle.workspaceAttached?.(input));
      }
    },
    async workspaceDetached(input) {
      for (const lifecycle of active) {
        await workspaceTypeAwareProviderLifecycleCall(lifecycle.workspaceDetached?.(input));
      }
    },
    async overlayOpened(input) {
      for (const lifecycle of active) {
        await workspaceTypeAwareProviderLifecycleCall(lifecycle.overlayOpened?.(input));
      }
    },
    async overlayUpdated(input) {
      for (const lifecycle of active) {
        await workspaceTypeAwareProviderLifecycleCall(lifecycle.overlayUpdated?.(input));
      }
    },
    async overlayClosed(input) {
      for (const lifecycle of active) {
        await workspaceTypeAwareProviderLifecycleCall(lifecycle.overlayClosed?.(input));
      }
    },
    async dispose() {
      for (const lifecycle of active) {
        await workspaceTypeAwareProviderLifecycleCall(lifecycle.dispose?.());
      }
    },
  };
}

export function workspaceTypeAwareBridgeProviderRuntimeNormalize(
  value: unknown,
): WorkspaceTypeAwareBridgeProviderRuntime | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (workspaceTypeAwareBridgeProviderRuntimeLike(value)) {
    return value;
  }
  if (workspaceTypeAwareBridgeTransportsLike(value)) {
    return { transports: value };
  }
  return undefined;
}

export async function workspaceTypeAwareProviderLifecycleCall(
  lifecycleCall: Promise<void> | void,
): Promise<void> {
  try {
    await lifecycleCall;
  } catch {
    // Type-aware providers are optional upgrades. Lifecycle failures
    // should degrade to structural answers rather than breaking hosts.
  }
}

function workspaceTypeAwareBridgeProviderRuntimeLike(
  value: unknown,
): value is WorkspaceTypeAwareBridgeProviderRuntime {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'transports' in value || 'lifecycle' in value;
}

function workspaceTypeAwareBridgeTransportsLike(
  value: unknown,
): value is WorkspaceTypeAwareBridgeTransports {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'typescript' in value || 'python' in value;
}
