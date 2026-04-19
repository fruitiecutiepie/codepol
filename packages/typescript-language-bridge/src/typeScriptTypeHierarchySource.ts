/**
 * @packageDocumentation
 * TypeScript implementation of {@link TypeAwareTypeHierarchySource}.
 *
 * Phase 9.5 / Gap 3. Mirrors `typeScriptCallGraphSourceCreate` —
 * the bridge speaks LSP via a host-supplied transport and never
 * spawns `tsserver` itself. Two LSP requests power the source
 * today (both standard, no server-specific extensions):
 *
 * - `textDocument/implementation` for `typeAwareImplementersGet`.
 * - `textDocument/typeDefinition` and (when supported) the call-
 *   hierarchy-style `typeHierarchy/supertypes` for
 *   `typeAwareSupertypesGet`. The bridge prefers the type-hierarchy
 *   path when the server advertises it; otherwise it falls back to
 *   `typeDefinition` and filters to interface / class targets via
 *   the host's `symbolKindResolve` callback.
 *
 * Honesty trade-off: when the language server cannot tell us the
 * relation kind, the bridge defaults to `'extends'` for upward edges
 * and `'implements'` for downward edges. Inventing a more specific
 * label without server confirmation would falsely advertise type-aware
 * classification the source did not actually provide.
 */

import type {
  SymbolId,
  TypeAwareTypeHierarchyEdge,
  TypeAwareTypeHierarchySource,
} from '@codepol/core';
import type { LspTransport } from './lspTransport';

/**
 * Minimal `(uri, line, character)` tuple the bridge sends in LSP
 * requests. Defined locally so the bridge has no compile-time
 * dependency on `vscode-languageserver-types`.
 *
 * Matches the shape used by
 * {@link TypeScriptCallGraphSourceOptions.symbolLocate} — hosts can
 * reuse one implementation for both bridges.
 */
export type LspSymbolLocation = {
  uri: string;
  line: number;
  character: number;
};

/**
 * Host-supplied callbacks. Same shape as the call-graph bridge with
 * one addition: {@link symbolKindResolve} lets the bridge filter
 * `typeDefinition` results down to interface / class targets without
 * walking the host's symbol table itself.
 */
export type TypeScriptTypeHierarchySourceOptions = {
  transport: LspTransport;
  symbolLocate(symbolId: SymbolId): LspSymbolLocation | undefined;
  symbolIdResolve(location: LspSymbolLocation): SymbolId | undefined;
  /**
   * Optional kind resolver. When present, the bridge filters
   * `typeDefinition` results down to `'interface'` / `'class'` —
   * everything else is dropped. When absent, all `typeDefinition`
   * results are accepted.
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

/**
 * Build a TypeScript {@link TypeAwareTypeHierarchySource} backed by the
 * supplied LSP transport. The transport's lifecycle is owned by the
 * host; the bridge only issues requests through it.
 */
export function typeScriptTypeHierarchySourceCreate(
  options: TypeScriptTypeHierarchySourceOptions,
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

      // Prefer `textDocument/typeDefinition` because it works against
      // every TypeScript language-server build today. The
      // `typeHierarchy/supertypes` extension exists but is not yet
      // universally supported — when hosts know their server speaks
      // it, they can layer a richer source on top.
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
          // `typeDefinition` doesn't tell us extends vs implements
          // — default to `'extends'` for class targets and
          // `'implements'` for interface targets, falling back to
          // `'extends'` when the kind resolver isn't available.
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
