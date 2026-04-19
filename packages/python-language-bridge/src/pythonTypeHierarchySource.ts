/**
 * @packageDocumentation
 * Python implementation of {@link TypeAwareTypeHierarchySource}.
 *
 * Phase 9.5 / Gap 3. The bridge speaks LSP via the transport
 * supplied by the host — it never spawns `pyright` / `pylance`
 * itself. Two LSP requests power the source today:
 *
 * - `textDocument/implementation` for `typeAwareImplementersGet`.
 *   Pyright surfaces `@runtime_checkable` Protocol implementers and
 *   subclass relations through this method.
 * - `textDocument/typeDefinition` for `typeAwareSupertypesGet`,
 *   filtered to class / Protocol targets via the host's
 *   `symbolKindResolve` callback when present.
 */

import type {
  SymbolId,
  TypeAwareTypeHierarchyEdge,
  TypeAwareTypeHierarchySource,
} from '@codepol/core';
import type { LspTransport } from './lspTransport';

export type LspSymbolLocation = {
  uri: string;
  line: number;
  character: number;
};

export type PythonTypeHierarchySourceOptions = {
  transport: LspTransport;
  symbolLocate(symbolId: SymbolId): LspSymbolLocation | undefined;
  symbolIdResolve(location: LspSymbolLocation): SymbolId | undefined;
  /**
   * Optional kind resolver. When present, the bridge filters
   * `typeDefinition` results down to `'interface'` / `'class'`.
   * Python adapters surface Protocol classes as `'interface'`.
   */
  symbolKindResolve?(symbolId: SymbolId): 'interface' | 'class' | 'other' | undefined;
};

type LspLocation = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

type LspLocationLink = {
  targetUri: string;
  targetRange: { start: { line: number; character: number }; end: { line: number; character: number } };
  targetSelectionRange: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

type LspLocationOrLink = LspLocation | LspLocationLink;

function lspLocationStartGet(loc: LspLocationOrLink): LspSymbolLocation {
  if ('targetUri' in loc) {
    return {
      uri: loc.targetUri,
      line: loc.targetSelectionRange.start.line,
      character: loc.targetSelectionRange.start.character,
    };
  }
  return {
    uri: loc.uri,
    line: loc.range.start.line,
    character: loc.range.start.character,
  };
}

export function pythonTypeHierarchySourceCreate(
  options: PythonTypeHierarchySourceOptions,
): TypeAwareTypeHierarchySource {
  return {
    async typeAwareImplementersGet(
      supertypeSymbolId: SymbolId,
    ): Promise<TypeAwareTypeHierarchyEdge[]> {
      const location = options.symbolLocate(supertypeSymbolId);
      if (!location) return [];

      const result = await options.transport.request<LspLocationOrLink[] | LspLocation | null>(
        'textDocument/implementation',
        positionParamsCreate(location),
      );
      if (!result) return [];
      const locations = Array.isArray(result) ? result : [result];

      const edges: TypeAwareTypeHierarchyEdge[] = [];
      for (const loc of locations) {
        const start = lspLocationStartGet(loc);
        const subtypeSymbolId = options.symbolIdResolve(start);
        if (!subtypeSymbolId) continue;
        edges.push({
          subtypeSymbolId,
          supertypeSymbolId,
          relationKind: 'implements',
        });
      }
      return edges;
    },

    async typeAwareSupertypesGet(
      subtypeSymbolId: SymbolId,
    ): Promise<TypeAwareTypeHierarchyEdge[]> {
      const location = options.symbolLocate(subtypeSymbolId);
      if (!location) return [];

      const result = await options.transport.request<LspLocationOrLink[] | LspLocation | null>(
        'textDocument/typeDefinition',
        positionParamsCreate(location),
      );
      if (!result) return [];
      const locations = Array.isArray(result) ? result : [result];

      const edges: TypeAwareTypeHierarchyEdge[] = [];
      for (const loc of locations) {
        const start = lspLocationStartGet(loc);
        const supertypeSymbolId = options.symbolIdResolve(start);
        if (!supertypeSymbolId) continue;
        if (options.symbolKindResolve) {
          const kind = options.symbolKindResolve(supertypeSymbolId);
          if (kind !== 'interface' && kind !== 'class') continue;
        }
        edges.push({
          subtypeSymbolId,
          supertypeSymbolId,
          relationKind:
            options.symbolKindResolve?.(supertypeSymbolId) === 'interface'
              ? 'implements'
              : 'extends',
        });
      }
      return edges;
    },
  };
}

function positionParamsCreate(location: LspSymbolLocation): {
  textDocument: { uri: string };
  position: { line: number; character: number };
} {
  return {
    textDocument: { uri: location.uri },
    position: { line: location.line, character: location.character },
  };
}
