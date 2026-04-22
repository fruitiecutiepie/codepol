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
 * Environment variable that points at a host-owned module exporting
 * either a transport object or a transport factory for the type-aware
 * bridge seam. The resolved module is loaded in the same Node process
 * as the workspace host (LSP in-process mode or the daemon).
 */
export const WORKSPACE_TYPE_AWARE_BRIDGE_PROVIDER_ENV =
  'CODEPOL_TYPE_AWARE_BRIDGE_PROVIDER';

/**
 * Minimal JSON-RPC request surface shared by the TypeScript and Python
 * bridge packages. The host owns the actual tsserver / pyright /
 * pylance client lifecycle; workspace-service only consumes this
 * request method.
 */
export type WorkspaceTypeAwareBridgeTransport = {
  request<T>(method: string, params: unknown): Promise<T>;
};

/**
 * Host-supplied transports keyed by the language-bridge package they
 * power. `typescript` also covers `.tsx` / `.jsx` because the
 * workspace maps those extensions to the `tsx` language id and the
 * same TypeScript language server answers both.
 */
export type WorkspaceTypeAwareBridgeTransports = Partial<{
  typescript: WorkspaceTypeAwareBridgeTransport;
  python: WorkspaceTypeAwareBridgeTransport;
}>;

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
};

export type WorkspaceTypeAwareBridgeTransportProvider = (input: {
  env: NodeJS.ProcessEnv;
}) =>
  | WorkspaceTypeAwareBridgeTransports
  | undefined
  | Promise<WorkspaceTypeAwareBridgeTransports | undefined>;

export type WorkspaceTypeAwareBridgeTransportsResolveOptions = {
  env?: NodeJS.ProcessEnv;
  transports?: WorkspaceTypeAwareBridgeTransports;
  providerModuleId?: string;
};

export async function workspaceTypeAwareBridgeTransportsResolve(
  options: WorkspaceTypeAwareBridgeTransportsResolveOptions = {},
): Promise<WorkspaceTypeAwareBridgeTransports | undefined> {
  if (options.transports) {
    return options.transports;
  }
  const env = options.env ?? process.env;
  const providerModuleId =
    options.providerModuleId ?? env[WORKSPACE_TYPE_AWARE_BRIDGE_PROVIDER_ENV];
  if (!providerModuleId) {
    return undefined;
  }
  const loaded = nodeRequire(providerModuleId) as
    | WorkspaceTypeAwareBridgeTransportProvider
    | WorkspaceTypeAwareBridgeTransports
    | {
        default?: WorkspaceTypeAwareBridgeTransportProvider | WorkspaceTypeAwareBridgeTransports;
        workspaceTypeAwareBridgeTransportsCreate?: WorkspaceTypeAwareBridgeTransportProvider;
      };

  const factory = workspaceTypeAwareBridgeTransportProviderResolve(loaded);
  if (factory) {
    return await factory({ env });
  }

  const transports = workspaceTypeAwareBridgeTransportsFromModuleResolve(loaded);
  if (transports) {
    return transports;
  }

  throw new Error(
    `Type-aware bridge provider "${providerModuleId}" must export ` +
      '`workspaceTypeAwareBridgeTransportsCreate`, a default factory, or a plain transports object.',
  );
}

export function workspaceTypeAwareBridgeSourcesRegister(input: {
  engine: WorkspaceTypeAwareBridgeHostEngine;
  transports?: WorkspaceTypeAwareBridgeTransports;
}): void {
  if (input.transports?.typescript) {
    const typeScriptCallGraphSource = typeAwareCallGraphSourceDelegateCreate((symbolId) => {
      const symbolTable = input.engine.typeAwareBridgeSymbolTableGet(symbolId);
      if (!symbolTable) return undefined;
      return typeScriptCallGraphSourceCreate({
        transport: input.transports!.typescript!,
        symbolLocate: symbolTable.symbolLocate,
        symbolIdResolve: symbolTable.symbolIdResolve,
      });
    });
    const typeScriptTypeHierarchySource = typeAwareTypeHierarchySourceDelegateCreate(
      (symbolId) => {
        const symbolTable = input.engine.typeAwareBridgeSymbolTableGet(symbolId);
        if (!symbolTable) return undefined;
        return typeScriptTypeHierarchySourceCreate({
          transport: input.transports!.typescript!,
          symbolLocate: symbolTable.symbolLocate,
          symbolIdResolve: symbolTable.symbolIdResolve,
          symbolKindResolve: symbolTable.symbolKindResolve,
        });
      },
    );
    for (const languageId of ['typescript', 'tsx']) {
      input.engine.typeAwareCallGraphSourceRegister(languageId, typeScriptCallGraphSource);
      input.engine.typeAwareTypeHierarchySourceRegister(
        languageId,
        typeScriptTypeHierarchySource,
      );
    }
  }

  if (input.transports?.python) {
    const pythonCallGraphSource = typeAwareCallGraphSourceDelegateCreate((symbolId) => {
      const symbolTable = input.engine.typeAwareBridgeSymbolTableGet(symbolId);
      if (!symbolTable) return undefined;
      return pythonCallGraphSourceCreate({
        transport: input.transports!.python!,
        symbolLocate: symbolTable.symbolLocate,
        symbolIdResolve: symbolTable.symbolIdResolve,
      });
    });
    const pythonTypeHierarchySource = typeAwareTypeHierarchySourceDelegateCreate((symbolId) => {
      const symbolTable = input.engine.typeAwareBridgeSymbolTableGet(symbolId);
      if (!symbolTable) return undefined;
      return pythonTypeHierarchySourceCreate({
        transport: input.transports!.python!,
        symbolLocate: symbolTable.symbolLocate,
        symbolIdResolve: symbolTable.symbolIdResolve,
        symbolKindResolve: symbolTable.symbolKindResolve,
      });
    });
    input.engine.typeAwareCallGraphSourceRegister('python', pythonCallGraphSource);
    input.engine.typeAwareTypeHierarchySourceRegister('python', pythonTypeHierarchySource);
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

function workspaceTypeAwareBridgeTransportProviderResolve(
  value: unknown,
): WorkspaceTypeAwareBridgeTransportProvider | undefined {
  if (typeof value === 'function') {
    return value as WorkspaceTypeAwareBridgeTransportProvider;
  }
  if (value && typeof value === 'object') {
    const record = value as {
      default?: WorkspaceTypeAwareBridgeTransportProvider | WorkspaceTypeAwareBridgeTransports;
      workspaceTypeAwareBridgeTransportsCreate?: WorkspaceTypeAwareBridgeTransportProvider;
    };
    if (typeof record.workspaceTypeAwareBridgeTransportsCreate === 'function') {
      return record.workspaceTypeAwareBridgeTransportsCreate;
    }
    if (typeof record.default === 'function') {
      return record.default as WorkspaceTypeAwareBridgeTransportProvider;
    }
  }
  return undefined;
}

function workspaceTypeAwareBridgeTransportsFromModuleResolve(
  value: unknown,
): WorkspaceTypeAwareBridgeTransports | undefined {
  if (workspaceTypeAwareBridgeTransportsLike(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    const record = value as { default?: unknown };
    if (workspaceTypeAwareBridgeTransportsLike(record.default)) {
      return record.default;
    }
  }
  return undefined;
}

function workspaceTypeAwareBridgeTransportsLike(
  value: unknown,
): value is WorkspaceTypeAwareBridgeTransports {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'typescript' in value || 'python' in value;
}
