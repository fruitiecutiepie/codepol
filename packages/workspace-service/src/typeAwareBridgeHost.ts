import { createRequire } from 'node:module';
import type {
  SymbolId,
  TypeAwareCallGraphSource,
  TypeAwareTypeHierarchySource,
} from '@codepol/core';
import {
  pythonCallGraphSourceCreate,
  pythonTypeHierarchySourceCreate,
} from '@codepol/python-language-bridge';
import {
  typeScriptCallGraphSourceCreate,
  typeScriptTypeHierarchySourceCreate,
} from '@codepol/typescript-language-bridge';

const nodeRequire = createRequire(__filename);

/**
 * Environment variable that points at a host-owned module exporting a
 * provider runtime, a provider factory, or a plain transport object for
 * the type-aware bridge seam.
 */
export const WORKSPACE_TYPE_AWARE_BRIDGE_PROVIDER_ENV =
  'CODEPOL_TYPE_AWARE_BRIDGE_PROVIDER';

/**
 * Per-query workspace metadata the bridge runtime can use to route a
 * request to the correct backend instance (editor-native LS or
 * subprocess fallback).
 */
export type WorkspaceTypeAwareBridgeExecutionContext = {
  clientSessionId: string;
  workspaceId: string;
  rootPath: string;
  configPath: string;
};

/**
 * Minimal JSON-RPC request surface shared by the TypeScript and Python
 * bridge packages. The host owns the actual tsserver / pyright /
 * pylance lifecycle; workspace-service only consumes this request
 * method.
 */
export type WorkspaceTypeAwareBridgeTransport = {
  request<T>(method: string, params: unknown): Promise<T>;
};

/**
 * Optional per-workspace router for transport selection. Hybrid
 * providers use this to pick the editor-native backend when available
 * and otherwise route to a subprocess-backed transport for the active
 * workspace.
 */
export type WorkspaceTypeAwareBridgeTransportResolver = {
  transportResolve(
    context: WorkspaceTypeAwareBridgeExecutionContext,
  ): WorkspaceTypeAwareBridgeTransport | undefined;
};

export type WorkspaceTypeAwareBridgeTransportSource =
  | WorkspaceTypeAwareBridgeTransport
  | WorkspaceTypeAwareBridgeTransportResolver;

/**
 * Host-supplied transports keyed by language id. The current
 * first-party registrar consumes `typescript`, `tsx`, and `python`, but
 * the map intentionally stays open so provider packages can export
 * additional language backends (for example `go`) ahead of the matching
 * bridge package.
 */
export type WorkspaceTypeAwareBridgeTransports = Partial<
  Record<string, WorkspaceTypeAwareBridgeTransportSource>
>;

export type WorkspaceTypeAwareBridgeSymbolLocation = {
  uri: string;
  line: number;
  character: number;
};

/**
 * Symbol-table callbacks the host bridge wrappers need in order to
 * instantiate the pure language-bridge factories on demand for the
 * currently-indexed workspace.
 */
export type WorkspaceTypeAwareBridgeSymbolTable = {
  symbolLocate(symbolId: SymbolId): WorkspaceTypeAwareBridgeSymbolLocation | undefined;
  symbolIdResolve(location: WorkspaceTypeAwareBridgeSymbolLocation): SymbolId | undefined;
  symbolKindResolve(symbolId: SymbolId): 'interface' | 'class' | 'other' | undefined;
};

export type WorkspaceTypeAwareBridgeCallGraphFactoryInput = {
  transport: WorkspaceTypeAwareBridgeTransport;
  symbolLocate(symbolId: SymbolId): WorkspaceTypeAwareBridgeSymbolLocation | undefined;
  symbolIdResolve(location: WorkspaceTypeAwareBridgeSymbolLocation): SymbolId | undefined;
};

export type WorkspaceTypeAwareBridgeTypeHierarchyFactoryInput =
  WorkspaceTypeAwareBridgeCallGraphFactoryInput & {
    symbolKindResolve(symbolId: SymbolId): 'interface' | 'class' | 'other' | undefined;
  };

export type WorkspaceTypeAwareBridgeRegistration = {
  languageId: string;
  fileExtensions: readonly string[];
};

/**
 * One first-party bridge definition: how to turn a resolved transport
 * plus workspace symbol-table callbacks into concrete call-graph and/or
 * type-hierarchy sources for one or more language ids.
 */
export type WorkspaceTypeAwareBridgeDefinition = {
  transportKey: string;
  registrations: readonly WorkspaceTypeAwareBridgeRegistration[];
  callGraphSourceCreate?(
    input: WorkspaceTypeAwareBridgeCallGraphFactoryInput,
  ): TypeAwareCallGraphSource;
  typeHierarchySourceCreate?(
    input: WorkspaceTypeAwareBridgeTypeHierarchyFactoryInput,
  ): TypeAwareTypeHierarchySource;
};

export const WORKSPACE_TYPE_AWARE_BRIDGE_DEFINITIONS_DEFAULT: readonly WorkspaceTypeAwareBridgeDefinition[] = [
  {
    transportKey: 'typescript',
    registrations: [
      {
        languageId: 'typescript',
        fileExtensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'],
      },
      {
        languageId: 'tsx',
        fileExtensions: ['.tsx', '.jsx'],
      },
    ],
    callGraphSourceCreate: typeScriptCallGraphSourceCreate,
    typeHierarchySourceCreate: typeScriptTypeHierarchySourceCreate,
  },
  {
    transportKey: 'python',
    registrations: [
      {
        languageId: 'python',
        fileExtensions: ['.py', '.pyw'],
      },
    ],
    callGraphSourceCreate: pythonCallGraphSourceCreate,
    typeHierarchySourceCreate: pythonTypeHierarchySourceCreate,
  },
];

export type WorkspaceTypeAwareBridgeWorkspaceLifecycleInput =
  WorkspaceTypeAwareBridgeExecutionContext;

export type WorkspaceTypeAwareBridgeOverlayLifecycleInput =
  WorkspaceTypeAwareBridgeExecutionContext & {
    uri: string;
    version: number;
    text: string;
  };

export type WorkspaceTypeAwareBridgeOverlayCloseLifecycleInput =
  WorkspaceTypeAwareBridgeExecutionContext & {
    uri: string;
  };

/**
 * Optional provider lifecycle hooks. Runtime backends use these to stay
 * in sync with workspace attachment and unsaved overlay edits.
 */
export type WorkspaceTypeAwareBridgeLifecycle = {
  workspaceAttached?(input: WorkspaceTypeAwareBridgeWorkspaceLifecycleInput): Promise<void> | void;
  workspaceDetached?(input: WorkspaceTypeAwareBridgeWorkspaceLifecycleInput): Promise<void> | void;
  overlayOpened?(input: WorkspaceTypeAwareBridgeOverlayLifecycleInput): Promise<void> | void;
  overlayUpdated?(input: WorkspaceTypeAwareBridgeOverlayLifecycleInput): Promise<void> | void;
  overlayClosed?(input: WorkspaceTypeAwareBridgeOverlayCloseLifecycleInput): Promise<void> | void;
  dispose?(): Promise<void> | void;
};

/**
 * Fully-resolved provider runtime. Keeps transport routing and optional
 * lifecycle hooks together so hosts can install one object at startup.
 */
export type WorkspaceTypeAwareBridgeProviderRuntime = {
  transports?: WorkspaceTypeAwareBridgeTransports;
  lifecycle?: WorkspaceTypeAwareBridgeLifecycle;
};

/**
 * Narrow engine surface consumed by the host bridge registrar. Kept
 * structural so the registrar stays decoupled from `WorkspaceService`
 * transport details and does not need the full engine class.
 */
export type WorkspaceTypeAwareBridgeHostEngine = {
  typeAwareCallGraphSourceRegister(
    languageId: string,
    source: TypeAwareCallGraphSource,
  ): void;
  typeAwareTypeHierarchySourceRegister(
    languageId: string,
    source: TypeAwareTypeHierarchySource,
  ): void;
  typeAwareBridgeSymbolTableGet(
    symbolId: SymbolId,
  ): WorkspaceTypeAwareBridgeSymbolTable | undefined;
  typeAwareBridgeExecutionContextGet():
    | WorkspaceTypeAwareBridgeExecutionContext
    | undefined;
  typeAwareBridgeLifecycleSet(
    lifecycle: WorkspaceTypeAwareBridgeLifecycle | undefined,
  ): void;
  typeAwareBridgeDefinitionsRegister(
    definitions: readonly WorkspaceTypeAwareBridgeDefinition[],
  ): void;
};

export type WorkspaceTypeAwareBridgeProviderFactory = (input: {
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

export type WorkspaceTypeAwareBridgeProviderResolveOptions = {
  env?: NodeJS.ProcessEnv;
  provider?: WorkspaceTypeAwareBridgeProviderRuntime;
  transports?: WorkspaceTypeAwareBridgeTransports;
  providerModuleId?: string;
  defaultProviderFactory?: WorkspaceTypeAwareBridgeProviderFactory;
};

export async function workspaceTypeAwareBridgeProviderResolve(
  options: WorkspaceTypeAwareBridgeProviderResolveOptions = {},
): Promise<WorkspaceTypeAwareBridgeProviderRuntime | undefined> {
  if (options.provider) {
    return options.provider;
  }
  if (options.transports) {
    return { transports: options.transports };
  }
  const env = options.env ?? process.env;
  const providerModuleId =
    options.providerModuleId ?? env[WORKSPACE_TYPE_AWARE_BRIDGE_PROVIDER_ENV];
  if (providerModuleId) {
    const loaded = nodeRequire(providerModuleId) as unknown;
    const factory = workspaceTypeAwareBridgeProviderFactoryResolve(loaded);
    if (factory) {
      return workspaceTypeAwareBridgeProviderRuntimeNormalize(await factory({ env }));
    }
    const provider = workspaceTypeAwareBridgeProviderFromModuleResolve(loaded);
    if (provider) {
      return provider;
    }
    throw new Error(
      `Type-aware bridge provider "${providerModuleId}" must export ` +
        '`workspaceTypeAwareBridgeProviderCreate`, ' +
        '`workspaceTypeAwareBridgeTransportsCreate`, a default factory, a runtime object, or a plain transports object.',
    );
  }
  if (options.defaultProviderFactory) {
    return workspaceTypeAwareBridgeProviderRuntimeNormalize(
      await options.defaultProviderFactory({ env }),
    );
  }
  return undefined;
}

export async function workspaceTypeAwareBridgeTransportsResolve(
  options: WorkspaceTypeAwareBridgeProviderResolveOptions = {},
): Promise<WorkspaceTypeAwareBridgeTransports | undefined> {
  return (await workspaceTypeAwareBridgeProviderResolve(options))?.transports;
}

export function workspaceTypeAwareBridgeSourcesRegister(input: {
  engine: WorkspaceTypeAwareBridgeHostEngine;
  provider?: WorkspaceTypeAwareBridgeProviderRuntime;
  transports?: WorkspaceTypeAwareBridgeTransports;
  definitions?: readonly WorkspaceTypeAwareBridgeDefinition[];
}): void {
  const provider = input.provider ?? (input.transports ? { transports: input.transports } : undefined);
  input.engine.typeAwareBridgeLifecycleSet(provider?.lifecycle);
  const transports = provider?.transports ?? input.transports;
  const definitions = input.definitions ?? WORKSPACE_TYPE_AWARE_BRIDGE_DEFINITIONS_DEFAULT;
  input.engine.typeAwareBridgeDefinitionsRegister(definitions);

  for (const definition of definitions) {
    const transportSource = transports?.[definition.transportKey];
    if (!transportSource) {
      continue;
    }
    const callGraphSource = definition.callGraphSourceCreate
      ? typeAwareCallGraphSourceDelegateCreate((symbolId) => {
          const symbolTable = input.engine.typeAwareBridgeSymbolTableGet(symbolId);
          const transport = workspaceTypeAwareBridgeTransportSourceResolve(
            transportSource,
            input.engine.typeAwareBridgeExecutionContextGet(),
          );
          if (!symbolTable || !transport) return undefined;
          return definition.callGraphSourceCreate!({
            transport,
            symbolLocate: symbolTable.symbolLocate,
            symbolIdResolve: symbolTable.symbolIdResolve,
          });
        })
      : undefined;
    const typeHierarchySource = definition.typeHierarchySourceCreate
      ? typeAwareTypeHierarchySourceDelegateCreate((symbolId) => {
          const symbolTable = input.engine.typeAwareBridgeSymbolTableGet(symbolId);
          const transport = workspaceTypeAwareBridgeTransportSourceResolve(
            transportSource,
            input.engine.typeAwareBridgeExecutionContextGet(),
          );
          if (!symbolTable || !transport) return undefined;
          return definition.typeHierarchySourceCreate!({
            transport,
            symbolLocate: symbolTable.symbolLocate,
            symbolIdResolve: symbolTable.symbolIdResolve,
            symbolKindResolve: symbolTable.symbolKindResolve,
          });
        })
      : undefined;

    for (const registration of definition.registrations) {
      if (callGraphSource) {
        input.engine.typeAwareCallGraphSourceRegister(
          registration.languageId,
          callGraphSource,
        );
      }
      if (typeHierarchySource) {
        input.engine.typeAwareTypeHierarchySourceRegister(
          registration.languageId,
          typeHierarchySource,
        );
      }
    }
  }
}

function typeAwareCallGraphSourceDelegateCreate(
  sourceResolve: (symbolId: SymbolId) => TypeAwareCallGraphSource | undefined,
): TypeAwareCallGraphSource {
  return {
    async typeAwareCallersGet(symbolId: SymbolId) {
      return (await sourceResolve(symbolId)?.typeAwareCallersGet?.(symbolId)) ?? [];
    },
    async typeAwareCalleesGet(symbolId: SymbolId) {
      return (await sourceResolve(symbolId)?.typeAwareCalleesGet?.(symbolId)) ?? [];
    },
  };
}

function typeAwareTypeHierarchySourceDelegateCreate(
  sourceResolve: (symbolId: SymbolId) => TypeAwareTypeHierarchySource | undefined,
): TypeAwareTypeHierarchySource {
  return {
    async typeAwareImplementersGet(symbolId: SymbolId) {
      return (await sourceResolve(symbolId)?.typeAwareImplementersGet?.(symbolId)) ?? [];
    },
    async typeAwareSupertypesGet(symbolId: SymbolId) {
      return (await sourceResolve(symbolId)?.typeAwareSupertypesGet?.(symbolId)) ?? [];
    },
  };
}

function workspaceTypeAwareBridgeTransportSourceResolve(
  source: WorkspaceTypeAwareBridgeTransportSource | undefined,
  context: WorkspaceTypeAwareBridgeExecutionContext | undefined,
): WorkspaceTypeAwareBridgeTransport | undefined {
  if (!source) {
    return undefined;
  }
  if (workspaceTypeAwareBridgeTransportResolverLike(source)) {
    if (!context) return undefined;
    return source.transportResolve(context);
  }
  return source;
}

function workspaceTypeAwareBridgeProviderFactoryResolve(
  value: unknown,
): WorkspaceTypeAwareBridgeProviderFactory | undefined {
  if (typeof value === 'function') {
    return value as WorkspaceTypeAwareBridgeProviderFactory;
  }
  if (value && typeof value === 'object') {
    const record = value as {
      default?: unknown;
      workspaceTypeAwareBridgeProviderCreate?: WorkspaceTypeAwareBridgeProviderFactory;
      workspaceTypeAwareBridgeTransportsCreate?: WorkspaceTypeAwareBridgeProviderFactory;
    };
    if (typeof record.workspaceTypeAwareBridgeProviderCreate === 'function') {
      return record.workspaceTypeAwareBridgeProviderCreate;
    }
    if (typeof record.workspaceTypeAwareBridgeTransportsCreate === 'function') {
      return record.workspaceTypeAwareBridgeTransportsCreate;
    }
    if (typeof record.default === 'function') {
      return record.default as WorkspaceTypeAwareBridgeProviderFactory;
    }
  }
  return undefined;
}

function workspaceTypeAwareBridgeProviderFromModuleResolve(
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

function workspaceTypeAwareBridgeProviderRuntimeNormalize(
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
  return Object.values(value).some((entry) => workspaceTypeAwareBridgeTransportSourceLike(entry));
}

function workspaceTypeAwareBridgeTransportResolverLike(
  value: unknown,
): value is WorkspaceTypeAwareBridgeTransportResolver {
  return (
    !!value &&
    typeof value === 'object' &&
    'transportResolve' in value &&
    typeof (value as { transportResolve?: unknown }).transportResolve === 'function'
  );
}

function workspaceTypeAwareBridgeTransportLike(
  value: unknown,
): value is WorkspaceTypeAwareBridgeTransport {
  return (
    !!value &&
    typeof value === 'object' &&
    'request' in value &&
    typeof (value as { request?: unknown }).request === 'function'
  );
}

function workspaceTypeAwareBridgeTransportSourceLike(
  value: unknown,
): value is WorkspaceTypeAwareBridgeTransportSource {
  return (
    workspaceTypeAwareBridgeTransportLike(value) ||
    workspaceTypeAwareBridgeTransportResolverLike(value)
  );
}
